import { Router } from 'express';
import { requireAuth } from './auth.mjs';

const LOW_STOCK_THRESHOLD = 10; // varian dengan stok <= angka ini dihitung "Stok Warning"
const DAY = 24 * 60 * 60 * 1000;
const WIB = 7 * 60 * 60 * 1000; // UTC+7

function parsePeriod(p) {
  const m = /^(\d+)d$/.exec(String(p || ''));
  const days = m ? Number(m[1]) : 30;
  return Math.min(Math.max(days, 1), 365);
}

// Awal hari (WIB) untuk "days" hari terakhir, termasuk hari ini
function periodRange(days) {
  const todayShifted = Math.floor((Date.now() + WIB) / DAY) * DAY;
  const since = new Date(todayShifted - (days - 1) * DAY - WIB);
  return { since, todayShifted };
}

// Order dari Kasir bisa tersimpan tanpa storeId, jadi filternya dibuat longgar
function storeFilter(storeId) {
  return Number.isFinite(storeId) ? { OR: [{ storeId }, { storeId: null }] } : {};
}

function paidWhere(storeId, since) {
  return {
    paymentStatus: 'PAID',
    status: { not: 'CANCELLED' },
    createdAt: { gte: since },
    ...storeFilter(storeId)
  };
}

export function dashboardRoutes(prisma) {
  const r = Router();

  r.get('/dashboard/kpi', requireAuth, async (req, res, next) => {
    try {
      const storeId = parseInt(req.query.storeId, 10);
      const days = parsePeriod(req.query.period);
      const { since } = periodRange(days);
      const where = paidWhere(storeId, since);

      const [omzet, items, pending, stokWarning] = await Promise.all([
        prisma.order.aggregate({ where, _sum: { total: true } }),
        prisma.orderItem.findMany({
          where: { order: where },
          select: {
            quantity: true,
            total: true,
            productVariant: { select: { product: { select: { cost: true } } } }
          }
        }),
        prisma.order.count({
          where: {
            paymentStatus: 'PENDING',
            status: { not: 'CANCELLED' },
            ...storeFilter(storeId)
          }
        }),
        prisma.productVariant.count({
          where: {
            stock: { lte: LOW_STOCK_THRESHOLD },
            ...(Number.isFinite(storeId) ? { product: { storeId } } : {})
          }
        })
      ]);

      let revenue = 0;
      let cogs = 0;
      for (const it of items) {
        revenue += Number(it.total);
        cogs += it.quantity * Number(it.productVariant?.product?.cost ?? 0);
      }
      const margin = revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : 0;

      res.json({
        totalOmzet: Number(omzet._sum.total ?? 0),
        margin,
        stokWarning,
        transaksiPending: pending
      });
    } catch (e) { next(e); }
  });

  r.get('/dashboard/sales-trend', requireAuth, async (req, res, next) => {
    try {
      const storeId = parseInt(req.query.storeId, 10);
      const days = parsePeriod(req.query.period);
      const { since, todayShifted } = periodRange(days);

      const orders = await prisma.order.findMany({
        where: paidWhere(storeId, since),
        select: { createdAt: true, total: true }
      });

      const byDay = new Map();
      for (const o of orders) {
        const key = new Date(o.createdAt.getTime() + WIB).toISOString().slice(0, 10);
        byDay.set(key, (byDay.get(key) ?? 0) + Number(o.total));
      }

      const labels = [];
      const values = [];
      for (let i = 0; i < days; i++) {
        const key = new Date(todayShifted - (days - 1 - i) * DAY).toISOString().slice(0, 10);
        labels.push(`${key.slice(8, 10)}/${key.slice(5, 7)}`);
        values.push(byDay.get(key) ?? 0);
      }

      res.json({ labels, values });
    } catch (e) { next(e); }
  });

  r.get('/dashboard/top-products', requireAuth, async (req, res, next) => {
    try {
      const storeId = parseInt(req.query.storeId, 10);
      const days = parsePeriod(req.query.period);
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 50);
      const { since } = periodRange(days);

      const items = await prisma.orderItem.findMany({
        where: { order: paidWhere(storeId, since) },
        select: {
          quantity: true,
          total: true,
          productVariant: { select: { product: { select: { id: true, name: true } } } }
        }
      });

      const agg = new Map();
      for (const it of items) {
        const p = it.productVariant?.product;
        if (!p) continue;
        const cur = agg.get(p.id) ?? { name: p.name, sold: 0, revenue: 0 };
        cur.sold += it.quantity;
        cur.revenue += Number(it.total);
        agg.set(p.id, cur);
      }

      const products = [...agg.values()].sort((a, b) => b.sold - a.sold).slice(0, limit);
      res.json({ products });
    } catch (e) { next(e); }
  });

  return r;
}