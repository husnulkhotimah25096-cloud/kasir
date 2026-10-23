import { Router } from 'express';
import { z } from 'zod';
import { randomUUID, randomBytes } from 'node:crypto';
import pkg from '@prisma/client';
import { requireAuth, requireRole } from './auth.mjs';

const { OrderStatus, PaymentStatus } = pkg;
const httpErr = (status, message) => Object.assign(new Error(message), { status });

// Nama enum belum kita lihat, jadi dipilih dari kandidat yang ada di skema.
function pick(en, name, ...candidates) {
  const found = candidates.find((c) => en && en[c]);
  if (!found) throw new Error(`Enum ${name} tidak punya nilai ${candidates.join('/')}. Tersedia: ${Object.keys(en || {}).join(', ')}`);
  return en[found];
}

const num = z.coerce.number();
const saleSchema = z.object({
  storeId: num.int().positive(),
  items: z.array(z.object({ productId: num.int().positive(), qty: num.int().positive(), price: num.nonnegative() })).min(1),
  subtotal: num.nonnegative(),
  tax: num.nonnegative().default(0),
  total: num.nonnegative(),
  paymentMethod: z.string().min(1),
  payments: z.array(z.object({ method: z.string().min(1), amount: num.nonnegative() })).min(1),
  timestamp: z.string().optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
}).passthrough();

async function createSale(prisma, userId, data, key) {
  const paid = pick(PaymentStatus, 'PaymentStatus', 'PAID', 'COMPLETED', 'SUCCESS', 'CAPTURED', 'SETTLED');
  const done = pick(OrderStatus, 'OrderStatus', 'COMPLETED', 'DELIVERED', 'PAID', 'CONFIRMED', 'PROCESSING');

  const itemsSum = data.items.reduce((a, i) => a + i.qty * i.price, 0);
  if (Math.abs(itemsSum - data.subtotal) > 1) throw httpErr(400, 'Subtotal tidak sama dengan jumlah item');
  const paidSum = data.payments.reduce((a, p) => a + p.amount, 0);
  if (paidSum + 1 < data.total) throw httpErr(400, 'Pembayaran kurang dari total');

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
      if (existing) return { id: existing.id, duplicate: true };

      const wh = await tx.warehouse.findFirst({ where: { storeId: data.storeId }, orderBy: { id: 'asc' } });
      if (!wh) throw httpErr(400, 'Gudang untuk toko ini tidak ditemukan');

      const lines = [];
      for (const it of data.items) {
        const variant = await tx.productVariant.findFirst({ where: { productId: it.productId }, orderBy: { id: 'asc' } });
        if (!variant) throw httpErr(400, `Produk ${it.productId} tidak ditemukan`);
        const upd = await tx.stock.updateMany({
          where: { productVariantId: variant.id, warehouseId: wh.id, quantity: { gte: it.qty } },
          data: { quantity: { decrement: it.qty }, version: { increment: 1 } },
        });
        if (upd.count === 0) throw httpErr(409, `Stok produk ${it.productId} tidak cukup`);
        lines.push({ productVariantId: variant.id, quantity: it.qty, price: it.price, total: it.qty * it.price });
      }

      const when = data.timestamp && !Number.isNaN(Date.parse(data.timestamp)) ? new Date(data.timestamp) : new Date();
      const order = await tx.order.create({
        data: {
          orderNumber: `POS-${Date.now()}-${randomBytes(3).toString('hex')}`,
          storeId: data.storeId,
          channel: 'POS',
          subtotal: data.subtotal,
          tax: data.tax,
          total: data.total,
          status: done,
          paymentStatus: paid,
          createdBy: userId,
          idempotencyKey: key,
          createdAt: when,
          orderItems: { create: lines },
          Payment: { create: data.payments.map((p) => ({ amount: p.amount, paymentMethod: p.method.toUpperCase(), gateway: 'POS', status: paid, paidAt: when })) },
        },
      });
      return { id: order.id, duplicate: false };
    });
  } catch (e) {
    if (e.code === 'P2002') {
      const ex = await prisma.order.findUnique({ where: { idempotencyKey: key }, select: { id: true } });
      if (ex) return { id: ex.id, duplicate: true };
    }
    throw e;
  }
}

export function salesRoutes(prisma) {
  const r = Router();
  const allow = requireRole('owner', 'admin', 'kasir');

  r.post('/sales', requireAuth, allow, async (req, res, next) => {
    try {
      const parsed = saleSchema.safeParse(req.body);
      if (!parsed.success) throw httpErr(400, 'Data penjualan tidak valid: ' + parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
      const key = req.get('Idempotency-Key') || parsed.data.idempotencyKey || randomUUID();
      const out = await createSale(prisma, req.user.id, parsed.data, key);
      res.status(out.duplicate ? 200 : 201).json({ id: out.id });
    } catch (e) { next(e); }
  });

  r.post('/sales/sync-batch', requireAuth, allow, async (req, res, next) => {
    try {
      const list = req.body?.sales;
      if (!Array.isArray(list) || list.length > 200) throw httpErr(400, 'sales harus berupa array (maksimal 200)');
      const results = [];
      for (const raw of list) {
        const key = raw?.idempotencyKey;
        try {
          if (!key) throw httpErr(400, 'idempotencyKey wajib');
          const parsed = saleSchema.safeParse(raw);
          if (!parsed.success) throw httpErr(400, 'Data tidak valid: ' + parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
          const out = await createSale(prisma, req.user.id, parsed.data, key);
          results.push({ idempotencyKey: key, status: out.duplicate ? 'duplicate' : 'created' });
        } catch (e) {
          results.push({ idempotencyKey: key ?? null, status: 'failed', error: e.message });
        }
      }
      res.json({ results });
    } catch (e) { next(e); }
  });

  return r;
}