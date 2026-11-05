import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from './auth.mjs';
import { postOrderSaleJournal } from './journal.mjs';

const httpErr = (status, message) => Object.assign(new Error(message), { status });
const STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'];
const NEXT = { PENDING: 'CONFIRMED', CONFIRMED: 'PREPARING', PREPARING: 'READY', READY: 'COMPLETED' };

const include = {
  Payment: true,
  orderItems: { include: { productVariant: { include: { product: true } } } },
};

function shape(o) {
  const notes = o.notes || '';
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    createdAt: o.createdAt,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    fulfillment: notes.startsWith('[ANTAR]') ? 'ANTAR' : 'AMBIL',
    notes,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.Payment[0] ? o.Payment[0].paymentMethod : null,
    total: Number(o.total),
    items: o.orderItems.map((i) => ({
      name: i.productVariant && i.productVariant.product ? i.productVariant.product.name : 'Produk',
      qty: i.quantity,
      price: Number(i.price),
    })),
  };
}

export function onlineOrderRoutes(prisma) {
  const r = Router();
  const allow = requireRole('owner', 'admin', 'kasir');
  const fresh = async (id) => shape(await prisma.order.findUnique({ where: { id }, include }));
  const idOf = (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpErr(400, 'ID pesanan tidak valid');
    return id;
  };

  r.get('/online-orders', requireAuth, allow, async (req, res, next) => {
    try {
      const status = req.query.status ? String(req.query.status).toUpperCase() : undefined;
      if (status && !STATUSES.includes(status)) throw httpErr(400, 'Status tidak valid');
      const rows = await prisma.order.findMany({
        where: { channel: 'ONLINE', ...(status ? { status } : {}) },
        include,
        orderBy: { id: 'desc' },
        take: 100,
      });
      res.json(rows.map(shape));
    } catch (e) { next(e); }
  });

  // Tandai lunas setelah staf memastikan uang diterima (transfer/QRIS masuk, atau COD dibayar)
  r.post('/online-orders/:id/pay', requireAuth, allow, async (req, res, next) => {
    try {
      const id = idOf(req);
      await prisma.$transaction(async (tx) => {
        const upd = await tx.order.updateMany({
          where: { id, channel: 'ONLINE', paymentStatus: 'PENDING', status: { not: 'CANCELLED' } },
          data: { paymentStatus: 'PAID' },
        });
        if (upd.count === 0) throw httpErr(409, 'Pesanan tidak ditemukan, sudah lunas, atau sudah dibatalkan');
        await tx.payment.updateMany({
          where: { orderId: id, status: 'PENDING' },
          data: { status: 'PAID', paidAt: new Date() },
        });
        await postOrderSaleJournal(tx, id, req.user.id);
      });
      res.json(await fresh(id));
    } catch (e) { next(e); }
  });

  // Ubah status satu langkah ke depan: PENDING > CONFIRMED > PREPARING > READY > COMPLETED
  r.post('/online-orders/:id/status', requireAuth, allow, async (req, res, next) => {
    try {
      const id = idOf(req);
      const parsed = z.object({ status: z.enum(['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) }).safeParse(req.body);
      if (!parsed.success) throw httpErr(400, 'Status tujuan tidak valid');
      const target = parsed.data.status;

      const cur = await prisma.order.findFirst({
        where: { id, channel: 'ONLINE' },
        select: { status: true, paymentStatus: true },
      });
      if (!cur) throw httpErr(404, 'Pesanan tidak ditemukan');
      if (NEXT[cur.status] !== target) throw httpErr(409, 'Urutan status tidak valid');
      if (target === 'COMPLETED' && cur.paymentStatus !== 'PAID') {
        throw httpErr(409, 'Tandai lunas dulu sebelum menyelesaikan pesanan');
      }
      const upd = await prisma.order.updateMany({ where: { id, status: cur.status }, data: { status: target } });
      if (upd.count === 0) throw httpErr(409, 'Status pesanan sudah berubah, muat ulang daftar');
      res.json(await fresh(id));
    } catch (e) { next(e); }
  });

  // Batalkan pesanan yang belum dibayar, stok dikembalikan
  r.post('/online-orders/:id/cancel', requireAuth, allow, async (req, res, next) => {
    try {
      const id = idOf(req);
      await prisma.$transaction(async (tx) => {
        const o = await tx.order.findFirst({ where: { id, channel: 'ONLINE' }, include: { orderItems: true } });
        if (!o) throw httpErr(404, 'Pesanan tidak ditemukan');
        const upd = await tx.order.updateMany({
          where: { id, status: { notIn: ['COMPLETED', 'CANCELLED'] }, paymentStatus: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
        if (upd.count === 0) {
          throw httpErr(409, 'Pesanan tidak bisa dibatalkan (sudah selesai, sudah dibatalkan, atau sudah dibayar)');
        }
        const wh = await tx.warehouse.findFirst({ where: { storeId: o.storeId }, orderBy: { id: 'asc' } });
        if (!wh) throw httpErr(500, 'Gudang tidak ditemukan');
        for (const it of o.orderItems) {
          await tx.stock.updateMany({
            where: { productVariantId: it.productVariantId, warehouseId: wh.id },
            data: { quantity: { increment: it.quantity }, version: { increment: 1 } },
          });
        }
        await tx.payment.updateMany({
          where: { orderId: id, status: 'PENDING' },
          data: { status: 'FAILED', failureReason: 'Pesanan dibatalkan' },
        });
      });
      res.json(await fresh(id));
    } catch (e) { next(e); }
  });

  return r;
}