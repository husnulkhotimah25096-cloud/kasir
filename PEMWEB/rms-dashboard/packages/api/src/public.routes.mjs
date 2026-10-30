import { Router } from 'express';

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
          id: p.id,
          sku: p.sku,
          name: p.name,
          description: p.description,
          price: Number(p.price),
          image: p.image,
          category: p.category ? p.category.name : null,
          available: qty > 0,
        };
      }));
    } catch (e) { next(e); }
  });

  return r;
}