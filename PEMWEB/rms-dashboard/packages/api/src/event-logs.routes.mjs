import { Router } from 'express';
import { requireAuth, requireRole } from './auth.mjs';

const LIMIT = 50;

// Log aktivitas dikumpulkan dari tabel yang sudah ada (tanpa tabel baru).
export function eventLogRoutes(prisma) {
  const r = Router();

  r.get('/event-logs/simulator', requireAuth, requireRole('owner', 'admin'), async (_req, res, next) => {
    try {
      const [orders, payments, receipts, audits] = await Promise.all([
        prisma.order.findMany({ orderBy: { id: 'desc' }, take: LIMIT }),
        prisma.payment.findMany({
          where: { status: 'PAID' },
          include: { order: { select: { orderNumber: true } } },
          orderBy: { id: 'desc' },
          take: LIMIT,
        }),
        prisma.goodsReceipt.findMany({
          include: { purchaseOrder: { select: { poNumber: true } } },
          orderBy: { id: 'desc' },
          take: LIMIT,
        }),
        prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: LIMIT }),
      ]);

      const events = [];

      for (const o of orders) {
        events.push({
          type: o.channel === 'ONLINE' ? 'order.created' : 'sale.completed',
          status: o.status,
          createdAt: o.createdAt,
          payload: { orderNumber: o.orderNumber, channel: o.channel, total: Number(o.total), paymentStatus: o.paymentStatus },
        });
      }
      for (const p of payments) {
        events.push({
          type: 'payment.confirmed',
          status: p.status,
          createdAt: p.paidAt || p.createdAt,
          payload: { orderNumber: p.order ? p.order.orderNumber : null, method: p.paymentMethod, amount: Number(p.amount) },
        });
      }
      for (const g of receipts) {
        events.push({
          type: g.status === 'CANCELLED' ? 'goods.returned' : g.status === 'RECEIVED' ? 'goods.received' : 'goods.pending',
          status: g.status,
          createdAt: g.receivedAt,
          payload: { grNumber: g.grNumber, poNumber: g.purchaseOrder ? g.purchaseOrder.poNumber : null, notes: g.notes },
        });
      }
      for (const a of audits) {
        events.push({
          type: `audit.${String(a.action).toLowerCase()}`,
          status: a.entity,
          createdAt: a.timestamp,
          payload: { entity: a.entity, entityId: a.entityId, changes: a.changes },
        });
      }

      events.sort((x, y) => new Date(x.createdAt) - new Date(y.createdAt)); // terlama di atas, terbaru di bawah
      res.json(events.slice(-200));
    } catch (e) { next(e); }
  });

  return r;
}