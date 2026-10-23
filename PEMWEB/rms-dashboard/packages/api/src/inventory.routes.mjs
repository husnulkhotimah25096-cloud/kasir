import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from './auth.mjs';

const num = (d) => (d == null ? 0 : Number(d));
const httpErr = (status, message) => Object.assign(new Error(message), { status });

function mapProduct(p) {
  const stock = [];
  for (const v of p.variants) {
    for (const s of v.Stock) stock.push({ warehouseId: s.warehouseId, quantity: s.quantity, version: s.version });
  }
  return { id: p.id, sku: p.sku, name: p.name, price: num(p.price), cost: num(p.cost), minStock: 0, stock };
}

const include = { variants: { include: { Stock: true }, orderBy: { id: 'asc' } } };

export function inventoryRoutes(prisma) {
  const r = Router();
  r.use(requireAuth);

  r.get('/products', async (req, res, next) => {
    try {
      const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
      const rows = await prisma.product.findMany({ where: storeId ? { storeId } : {}, include, orderBy: { id: 'asc' } });
      res.json(rows.map(mapProduct));
    } catch (e) { next(e); }
  });

  r.get('/products/:id', async (req, res, next) => {
    try {
      const p = await prisma.product.findUnique({ where: { id: Number(req.params.id) }, include });
      if (!p) throw httpErr(404, 'Produk tidak ditemukan');
      res.json(mapProduct(p));
    } catch (e) { next(e); }
  });

  r.get('/stores', async (_req, res, next) => {
    try {
      const rows = await prisma.store.findMany({ orderBy: { id: 'asc' } });
      res.json(rows.map((s) => ({ id: s.id, name: s.name })));
    } catch (e) { next(e); }
  });

  async function findStock(productId, warehouseId, db = prisma) {
    return db.stock.findFirst({
      where: { warehouseId, productVariant: { productId } },
      orderBy: { productVariantId: 'asc' },
    });
  }

  r.get('/stock/:productId/:warehouseId', async (req, res, next) => {
    try {
      const s = await findStock(Number(req.params.productId), Number(req.params.warehouseId));
      if (!s) throw httpErr(404, 'Stok tidak ditemukan');
      res.json({ warehouseId: s.warehouseId, quantity: s.quantity, version: s.version });
    } catch (e) { next(e); }
  });

  const putBody = z.object({ delta: z.number().int(), currentVersion: z.number().int() });
  r.put('/stock/:productId/:warehouseId', requireRole('owner', 'admin', 'gudang'), async (req, res, next) => {
    try {
      const parsed = putBody.safeParse(req.body);
      if (!parsed.success) throw httpErr(400, 'delta dan currentVersion wajib berupa bilangan bulat');
      const { delta, currentVersion } = parsed.data;
      const productId = Number(req.params.productId);
      const warehouseId = Number(req.params.warehouseId);

      const result = await prisma.$transaction(async (tx) => {
        const s = await findStock(productId, warehouseId, tx);
        if (!s) throw httpErr(404, 'Stok tidak ditemukan');
        if (s.quantity + delta < 0) throw httpErr(400, 'Stok tidak boleh negatif');
        const upd = await tx.stock.updateMany({
          where: { id: s.id, version: currentVersion },
          data: { quantity: { increment: delta }, version: { increment: 1 } },
        });
        if (upd.count === 0) throw httpErr(409, 'Konflik versi stok, muat ulang data');
        return tx.stock.findUnique({ where: { id: s.id } });
      });
      res.json({ warehouseId: result.warehouseId, quantity: result.quantity, version: result.version });
    } catch (e) { next(e); }
  });

  return r;
}