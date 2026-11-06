import { Router } from 'express';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'node:crypto';

const httpErr = (status, message) => Object.assign(new Error(message), { status });

const TAX_RATE = 0.10;
const FREE_SHIP_MIN = 50000;
const SHIP_FEE = 10000;

const orderSchema = z.object({
  items: z.array(z.object({
    productId: z.coerce.number().int().positive(),
    qty: z.coerce.number().int().min(1).max(50),
  })).min(1).max(50),
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().regex(/^[0-9+\-\s]{8,20}$/, 'Nomor telepon tidak valid'),
  fulfillment: z.enum(['AMBIL', 'ANTAR']),
  address: z.string().trim().max(110).default(''),
  note: z.string().trim().max(30).default(''),
  paymentMethod: z.enum(['CASH', 'TRANSFER', 'QRIS']),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

const digits = (s) => String(s || '').replace(/\D/g, '');

function shape(order) {
  const subtotal = Number(order.subtotal);
  const tax = Number(order.tax);
  const total = Number(order.total);
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    fulfillment: (order.notes || '').startsWith('[ANTAR]') ? 'ANTAR' : 'AMBIL',
    paymentMethod: order.Payment && order.Payment[0] ? order.Payment[0].paymentMethod : null,
    subtotal, tax, shipping: total - subtotal - tax, total,
    createdAt: order.createdAt,
    items: (order.orderItems || []).map((i) => ({
      name: i.productVariant && i.productVariant.product ? i.productVariant.product.name : 'Produk',
      qty: i.quantity,
      price: Number(i.price),
    })),
  };
}

const orderInclude = {
  Payment: true,
  orderItems: { include: { productVariant: { include: { product: true } } } },
};

async function createOnlineOrder(prisma, data) {
  const key = data.idempotencyKey || randomUUID();
  if (data.fulfillment === 'ANTAR' && data.address.length < 10) {
    throw httpErr(400, 'Alamat pengantaran wajib diisi (minimal 10 karakter)');
  }

  const wanted = new Map();
  for (const it of data.items) wanted.set(it.productId, (wanted.get(it.productId) || 0) + it.qty);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: { idempotencyKey: key }, include: orderInclude });
    if (existing) return shape(existing);

    const sys = await tx.user.findUnique({ where: { username: 'online-system' } });
    if (!sys) throw httpErr(500, 'Akun sistem pesanan online belum dibuat (jalankan seed)');
    const store = await tx.store.findFirst({ orderBy: { id: 'asc' } });
    const wh = store && await tx.warehouse.findFirst({ where: { storeId: store.id }, orderBy: { id: 'asc' } });
    if (!store || !wh) throw httpErr(500, 'Data toko atau gudang tidak ditemukan');

    const products = await tx.product.findMany({ where: { id: { in: [...wanted.keys()] } } });
    if (products.length !== wanted.size) throw httpErr(400, 'Ada produk yang tidak ditemukan');

    const lines = [];
    let subtotal = 0;
    for (const p of products) {
      const qty = wanted.get(p.id);
      const variant = await tx.productVariant.findFirst({ where: { productId: p.id }, orderBy: { id: 'asc' } });
      if (!variant) throw httpErr(400, `Produk ${p.name} tidak ditemukan`);
      const upd = await tx.stock.updateMany({
        where: { productVariantId: variant.id, warehouseId: wh.id, quantity: { gte: qty } },
        data: { quantity: { decrement: qty }, version: { increment: 1 } },
      });
      if (upd.count === 0) throw httpErr(409, `Stok ${p.name} tidak cukup`);
      const price = Number(p.price); // harga selalu dari database
      subtotal += price * qty;
      lines.push({ productVariantId: variant.id, quantity: qty, price, total: price * qty });
    }

    const tax = Math.round(subtotal * TAX_RATE);
    const shipping = data.fulfillment === 'ANTAR' && subtotal < FREE_SHIP_MIN ? SHIP_FEE : 0;
    const total = subtotal + tax + shipping;

    const notes = data.fulfillment === 'ANTAR'
      ? `[ANTAR] ${data.address}${data.note ? ' | Catatan: ' + data.note : ''} | Ongkir: ${shipping}`
      : `[AMBIL]${data.note ? ' Catatan: ' + data.note : ''}`;

    const order = await tx.order.create({
      data: {
        orderNumber: `ONL-${Date.now()}-${randomBytes(3).toString('hex')}`.toUpperCase(),
        storeId: store.id,
        channel: 'ONLINE',
        customerName: data.name,
        customerPhone: data.phone,
        subtotal, tax, total,
        notes,
        createdBy: sys.id,
        idempotencyKey: key,
        orderItems: { create: lines },
        Payment: { create: [{ amount: total, paymentMethod: data.paymentMethod, gateway: 'MANUAL' }] },
      },
      include: orderInclude,
    });
    return shape(order);
  });
}

// Endpoint publik untuk pembeli: tanpa login, tanpa harga modal, tanpa jumlah stok.
export function publicRoutes(prisma) {
  const r = Router();

  r.get('/public/products', async (_req, res, next) => {
    try {
      const rows = await prisma.product.findMany({
        include: { category: true, variants: { include: { Stock: true } } },
        orderBy: { id: 'asc' },
      });
      res.json(rows.map((p) => {
        const qty = p.variants.reduce(
          (a, v) => a + v.Stock.reduce((b, s) => b + s.quantity - s.reserved, 0), 0);
        return {
          id: p.id, sku: p.sku, name: p.name, description: p.description,
          price: Number(p.price), image: p.image,
          category: p.category ? p.category.name : null,
          available: qty > 0,
        };
      }));
    } catch (e) { next(e); }
  });

  r.post('/public/orders', async (req, res, next) => {
    try {
      const parsed = orderSchema.safeParse(req.body);
      if (!parsed.success) {
        throw httpErr(400, 'Data pesanan tidak valid: ' + parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
      }
      res.status(201).json(await createOnlineOrder(prisma, parsed.data));
    } catch (e) { next(e); }
  });

  r.get('/public/orders/track', async (req, res, next) => {
    try {
      const no = String(req.query.orderNumber || '').trim().toUpperCase();
      const phone = digits(req.query.phone);
      if (!no || phone.length < 8) throw httpErr(400, 'Nomor pesanan dan telepon wajib diisi');
      const order = await prisma.order.findUnique({ where: { orderNumber: no }, include: orderInclude });
      // pesan sama untuk "tidak ada" dan "telepon salah", supaya nomor pesanan tidak bisa ditebak
      if (!order || order.channel !== 'ONLINE' || digits(order.customerPhone) !== phone) {
        throw httpErr(404, 'Pesanan tidak ditemukan. Periksa nomor pesanan dan telepon.');
      }
      res.json(shape(order));
    } catch (e) { next(e); }
  });

  return r;
}