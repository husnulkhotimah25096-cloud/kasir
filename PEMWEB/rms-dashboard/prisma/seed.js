const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const store = await prisma.store.upsert({
    where: { name: 'Toko Utama' },
    update: {},
    create: { name: 'Toko Utama', address: 'Jl. Contoh No. 1', phone: '0800000000', email: 'toko@rms.local' },
  });

  const wh = await prisma.warehouse.upsert({
    where: { code: 'GD-01' },
    update: {},
    create: { name: 'Gudang Utama', code: 'GD-01', storeId: store.id },
  });

  const hash = await bcrypt.hash('rms12345', 10);
  const users = [
    ['owner', 'Pemilik Toko', 'OWNER'],
    ['admin', 'Admin', 'ADMIN'],
    ['kasir', 'Kasir 1', 'KASIR'],
    ['gudang', 'Admin Gudang', 'GUDANG'],
    ['finance', 'Finance', 'FINANCE'],
    ['pembeli', 'Staf Pembelian', 'PEMBELIAN'],
  ];
  for (const [username, name, role] of users) {
    await prisma.user.upsert({
      where: { username },
      update: {},
      create: { username, name, role, email: `${username}@rms.local`, password: hash, storeId: store.id },
    });
  }

  const catNames = ['Makanan', 'Minuman', 'Kebutuhan Rumah'];
  const cats = {};
  for (const name of catNames) {
    cats[name] = await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name, storeId: store.id },
    });
  }

  const products = [
    ['SKU-001', 'Mie Instan Goreng', 'Makanan', 3500, 2800],
    ['SKU-002', 'Roti Tawar', 'Makanan', 16000, 12500],
    ['SKU-003', 'Biskuit Coklat', 'Makanan', 9000, 7000],
    ['SKU-004', 'Air Mineral 600ml', 'Minuman', 4000, 2800],
    ['SKU-005', 'Teh Botol', 'Minuman', 6000, 4500],
    ['SKU-006', 'Kopi Sachet', 'Minuman', 2000, 1500],
    ['SKU-007', 'Sabun Cuci Piring', 'Kebutuhan Rumah', 12000, 9500],
    ['SKU-008', 'Tisu Gulung', 'Kebutuhan Rumah', 8000, 6000],
  ];
  for (const [sku, name, cat, price, cost] of products) {
    const p = await prisma.product.upsert({
      where: { sku },
      update: {},
      create: { sku, name, price, cost, storeId: store.id, categoryId: cats[cat].id },
    });
    const v = await prisma.productVariant.upsert({
      where: { sku: `${sku}-DEF` },
      update: {},
      create: { sku: `${sku}-DEF`, productId: p.id },
    });
    await prisma.stock.upsert({
      where: { productVariantId_warehouseId: { productVariantId: v.id, warehouseId: wh.id } },
      update: {},
      create: { productVariantId: v.id, warehouseId: wh.id, quantity: 50 },
    });
  }

  const coa = [
    ['1100', 'Kas', 'ASSET', 'CASH'],
    ['1200', 'Bank', 'ASSET', 'BANK'],
    ['1300', 'Piutang Usaha', 'ASSET', 'ACCOUNTS_RECEIVABLE'],
    ['1400', 'Persediaan Barang', 'ASSET', null],
    ['2100', 'Hutang Usaha', 'LIABILITY', 'ACCOUNTS_PAYABLE'],
    ['3100', 'Modal Pemilik', 'EQUITY', null],
    ['4100', 'Penjualan', 'INCOME', 'SALES'],
    ['5100', 'Harga Pokok Penjualan', 'EXPENSE', 'COGS'],
    ['5200', 'Beban Operasional', 'EXPENSE', 'EXPENSE_OPERATIONAL'],
    ['5300', 'Beban Susut Persediaan', 'EXPENSE', 'EXPENSE_GENERAL'],
  ];
  for (const [code, name, type, subtype] of coa) {
    await prisma.account.upsert({
      where: { code },
      update: {},
      create: { code, name, type, subtype, storeId: store.id },
    });
  }
  console.log('Seed selesai. Login: owner/admin/kasir/gudang/finance/pembeli, password rms12345');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());