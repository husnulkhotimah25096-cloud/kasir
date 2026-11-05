import { Router } from 'express';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'node:crypto';
import { requireAuth, requireRole } from './auth.mjs';
import { postReceiptJournal } from './journal.mjs';

const httpErr = (status, message) => Object.assign(new Error(message), { status });
const num = (d) => (d == null ? 0 : Number(d));
const tag = (p) => `${p}-${Date.now()}-${randomBytes(3).toString('hex')}`.toUpperCase();

// Frontend memakai CONFIRMED/RETURNED, skema memakai RECEIVED/CANCELLED
const GR_OUT = { PENDING: 'PENDING', RECEIVED: 'CONFIRMED', CANCELLED: 'RETURNED' };

const poInclude = {
  supplier: true,
  poItems: { include: { productVariant: { include: { product: true } } } },
};

const poShape = (po) => ({
  id: po.id,
  poNumber: po.poNumber,
  createdAt: po.createdAt,
  status: po.status,
  totalAmount: num(po.totalAmount),
  supplierName: po.supplier ? po.supplier.name : null,
});

const supplierSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().min(2).max(20),
  phone: z.string().trim().min(5).max(30),
}).passthrough();

const poSchema = z.object({
  supplierId: z.coerce.number().int().positive(),
  items: z.array(z.object({
    productId: z.coerce.number().int().positive(),
    qty: z.coerce.number().int().min(1).max(100000),
    unitPrice: z.coerce.number().min(0),
  })).min(1).max(50),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

async function defaultWarehouse(tx) {
  const store = await tx.store.findFirst({ orderBy: { id: 'asc' } });
  const wh = store && await tx.warehouse.findFirst({ where: { storeId: store.id }, orderBy: { id: 'asc' } });
  if (!wh) throw httpErr(500, 'Gudang tidak ditemukan');
  return wh;
}

export function procurementRoutes(prisma) {
  const r = Router();
  const read = requireRole('owner', 'admin', 'pembelian', 'pembeli', 'gudang');
  const buy = requireRole('owner', 'admin', 'pembelian', 'pembeli');
  const receive = requireRole('owner', 'admin', 'gudang');
  const idOf = (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw httpErr(400, 'ID tidak valid');
    return id;
  };

  // ---------- Supplier ----------
  r.get('/suppliers', requireAuth, read, async (_req, res, next) => {
    try {
      const rows = await prisma.supplier.findMany({ orderBy: { id: 'asc' } });
      res.json(rows.map((s) => ({
        id: s.id, name: s.name, code: s.code, contactName: s.contactName, phone: s.phone, paymentTerm: null,
      })));
    } catch (e) { next(e); }
  });

  r.post('/suppliers', requireAuth, buy, async (req, res, next) => {
    try {
      const p = supplierSchema.safeParse(req.body);
      if (!p.success) throw httpErr(400, 'Data supplier tidak valid: ' + p.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
      try {
        const s = await prisma.supplier.create({
          data: { name: p.data.name, code: p.data.code.toUpperCase(), phone: p.data.phone },
        });
        res.status(201).json({ id: s.id });
      } catch (e) {
        if (e.code === 'P2002') throw httpErr(409, 'Kode supplier sudah dipakai');
        throw e;
      }
    } catch (e) { next(e); }
  });

  // ---------- Purchase Order ----------
  r.get('/purchase-orders', requireAuth, read, async (_req, res, next) => {
    try {
      const rows = await prisma.purchaseOrder.findMany({ include: { supplier: true }, orderBy: { id: 'desc' }, take: 100 });
      res.json(rows.map(poShape));
    } catch (e) { next(e); }
  });

  r.get('/purchase-orders/:id', requireAuth, read, async (req, res, next) => {
    try {
      const po = await prisma.purchaseOrder.findUnique({ where: { id: idOf(req) }, include: poInclude });
      if (!po) throw httpErr(404, 'Purchase Order tidak ditemukan');
      res.json({
        ...poShape(po),
        items: po.poItems.map((i) => ({
          productName: i.productVariant && i.productVariant.product ? i.productVariant.product.name : 'Produk',
          qty: i.quantity,
          unitPrice: num(i.unitPrice),
        })),
      });
    } catch (e) { next(e); }
  });

  r.post('/purchase-orders', requireAuth, buy, async (req, res, next) => {
    try {
      const p = poSchema.safeParse(req.body);
      if (!p.success) throw httpErr(400, 'Data PO tidak valid: ' + p.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
      const key = p.data.idempotencyKey || randomUUID();

      const out = await prisma.$transaction(async (tx) => {
        const dup = await tx.purchaseOrder.findUnique({ where: { idempotencyKey: key } });
        if (dup) return dup;
        const supplier = await tx.supplier.findUnique({ where: { id: p.data.supplierId } });
        if (!supplier) throw httpErr(400, 'Supplier tidak ditemukan');

        const lines = [];
        let total = 0;
        for (const it of p.data.items) {
          const variant = await tx.productVariant.findFirst({ where: { productId: it.productId }, orderBy: { id: 'asc' } });
          if (!variant) throw httpErr(400, `Produk ${it.productId} tidak ditemukan`);
          const t = it.qty * it.unitPrice;
          total += t;
          lines.push({ productVariantId: variant.id, quantity: it.qty, unitPrice: it.unitPrice, total: t });
        }
        return tx.purchaseOrder.create({
          data: {
            poNumber: tag('PO'),
            supplierId: supplier.id,
            totalAmount: total,
            createdBy: req.user.id,
            idempotencyKey: key,
            poItems: { create: lines },
          },
        });
      });
      res.status(201).json({ id: out.id, poNumber: out.poNumber, message: 'Purchase Order dibuat' });
    } catch (e) { next(e); }
  });

  // ---------- Goods Receipt ----------
  r.get('/goods-receipts', requireAuth, read, async (_req, res, next) => {
    try {
      const rows = await prisma.goodsReceipt.findMany({ include: { purchaseOrder: true }, orderBy: { id: 'desc' }, take: 100 });
      res.json(rows.map((g) => ({
        id: g.id,
        grNumber: g.grNumber,
        purchaseOrderId: g.purchaseOrderId,
        poNumber: g.purchaseOrder ? g.purchaseOrder.poNumber : null,
        receivedAt: g.receivedAt,
        status: GR_OUT[g.status] || g.status,
      })));
    } catch (e) { next(e); }
  });

  r.post('/goods-receipts', requireAuth, receive, async (req, res, next) => {
    try {
      const p = z.object({ purchaseOrderId: z.coerce.number().int().positive() }).safeParse(req.body);
      if (!p.success) throw httpErr(400, 'purchaseOrderId tidak valid');

      const gr = await prisma.$transaction(async (tx) => {
        const po = await tx.purchaseOrder.findUnique({ where: { id: p.data.purchaseOrderId }, include: { poItems: true } });
        if (!po) throw httpErr(404, 'Purchase Order tidak ditemukan');
        if (!po.supplierId) throw httpErr(400, 'PO tidak punya supplier');
        if (!['PENDING', 'APPROVED'].includes(po.status)) throw httpErr(409, 'PO ini tidak bisa diterima (status ' + po.status + ')');
        const open = await tx.goodsReceipt.findFirst({
          where: { purchaseOrderId: po.id, status: { in: ['PENDING', 'RECEIVED'] } },
        });
        if (open) throw httpErr(409, 'PO ini sudah punya Goods Receipt');
        return tx.goodsReceipt.create({
          data: {
            grNumber: tag('GR'),
            purchaseOrderId: po.id,
            supplierId: po.supplierId,
            receivedBy: req.user.id,
            grItems: {
              create: po.poItems.map((i) => ({
                productVariantId: i.productVariantId,
                quantity: i.quantity,
                unitPrice: i.unitPrice,
                total: i.total,
              })),
            },
          },
        });
      });
      res.status(201).json({ id: gr.id, grNumber: gr.grNumber, message: 'Goods Receipt dibuat (menunggu konfirmasi)' });
    } catch (e) { next(e); }
  });

  // Konfirmasi: status berubah dan stok bertambah dalam satu transaksi
  r.post('/goods-receipts/:id/confirm', requireAuth, receive, async (req, res, next) => {
    try {
      const id = idOf(req);
      await prisma.$transaction(async (tx) => {
        const gr = await tx.goodsReceipt.findUnique({ where: { id }, include: { grItems: true } });
        if (!gr) throw httpErr(404, 'Goods Receipt tidak ditemukan');
        const upd = await tx.goodsReceipt.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'RECEIVED', receivedAt: new Date(), receivedBy: req.user.id },
        });
        if (upd.count === 0) throw httpErr(409, 'Goods Receipt sudah dikonfirmasi atau dibatalkan');

        const wh = await defaultWarehouse(tx);
        for (const it of gr.grItems) {
          await tx.stock.upsert({
            where: { productVariantId_warehouseId: { productVariantId: it.productVariantId, warehouseId: wh.id } },
            update: { quantity: { increment: it.quantity }, version: { increment: 1 } },
            create: { productVariantId: it.productVariantId, warehouseId: wh.id, quantity: it.quantity },
          });
        }
        await tx.purchaseOrder.update({
          where: { id: gr.purchaseOrderId },
          data: { status: 'RECEIVED', received: true, receivedAt: new Date() },
        });
        await postReceiptJournal(tx, id, req.user.id, false);
      });
      res.json({ message: 'Barang diterima, stok diperbarui' });
    } catch (e) { next(e); }
  });

  // Retur: stok dikurangi lagi, ditolak kalau stok sudah terpakai
  r.post('/goods-receipts/:id/return', requireAuth, receive, async (req, res, next) => {
    try {
      const id = idOf(req);
      const p = z.object({ reason: z.string().trim().min(3).max(200) }).safeParse(req.body);
      if (!p.success) throw httpErr(400, 'Alasan retur minimal 3 karakter');
      await prisma.$transaction(async (tx) => {
        const gr = await tx.goodsReceipt.findUnique({ where: { id }, include: { grItems: true } });
        if (!gr) throw httpErr(404, 'Goods Receipt tidak ditemukan');
        const upd = await tx.goodsReceipt.updateMany({
          where: { id, status: 'RECEIVED' },
          data: { status: 'CANCELLED', notes: 'Retur: ' + p.data.reason },
        });
        if (upd.count === 0) throw httpErr(409, 'Hanya penerimaan yang sudah dikonfirmasi yang bisa diretur');

        const wh = await defaultWarehouse(tx);
        for (const it of gr.grItems) {
          const dec = await tx.stock.updateMany({
            where: { productVariantId: it.productVariantId, warehouseId: wh.id, quantity: { gte: it.quantity } },
            data: { quantity: { decrement: it.quantity }, version: { increment: 1 } },
          });
          if (dec.count === 0) throw httpErr(409, 'Stok sudah terpakai, retur tidak bisa dilakukan');
        }
        await tx.purchaseOrder.update({
          where: { id: gr.purchaseOrderId },
          data: { status: 'APPROVED', received: false, receivedAt: null },
        });
        await postReceiptJournal(tx, id, req.user.id, true);
      });
      res.json({ message: 'Retur berhasil, stok dikurangi' });
    } catch (e) { next(e); }
  });

  return r;
}