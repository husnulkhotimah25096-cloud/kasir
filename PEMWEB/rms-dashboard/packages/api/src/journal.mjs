// Pembuat jurnal otomatis. Semua fungsi dipanggil di dalam transaksi database (tx).
const httpErr = (status, message) => Object.assign(new Error(message), { status });
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const cut = (s) => String(s ?? '').slice(0, 190); // kolom String di MySQL = VARCHAR(191)
const DEBIT_NORMAL = ['ASSET', 'EXPENSE'];
const CASH_METHODS = ['CASH', 'TUNAI'];

async function accountByCode(tx, code) {
  const a = await tx.account.findUnique({ where: { code } });
  if (!a) throw httpErr(500, `Akun ${code} belum ada. Jalankan: node prisma/seed.js`);
  return a;
}

// lines: [{ code | accountId, debit, credit, description }]
export async function postJournal(tx, { referenceType, referenceId, reference, description, lines, createdBy, storeId, postedAt }) {
  const clean = lines
    .map((l) => ({ ...l, debit: r2(l.debit || 0), credit: r2(l.credit || 0) }))
    .filter((l) => l.debit > 0 || l.credit > 0);
  if (!clean.length) return null;

  const td = r2(clean.reduce((a, l) => a + l.debit, 0));
  const tc = r2(clean.reduce((a, l) => a + l.credit, 0));
  if (td !== tc) throw httpErr(500, `Jurnal tidak seimbang (debit ${td}, kredit ${tc})`);

  // satu transaksi hanya boleh punya satu jurnal
  const dup = await tx.journalEntry.findFirst({ where: { referenceType, referenceId }, select: { id: true } });
  if (dup) return dup;

  const entry = await tx.journalEntry.create({
    data: {
      referenceType, referenceId,
      reference: cut(reference), description: cut(description),
      status: 'POSTED', createdBy, storeId,
      ...(postedAt ? { postedAt } : {}),
    },
  });

  let order = 1;
  for (const l of clean) {
    const acc = l.accountId
      ? await tx.account.findUnique({ where: { id: l.accountId } })
      : await accountByCode(tx, l.code);
    if (!acc) throw httpErr(500, 'Akun jurnal tidak ditemukan');
    const delta = DEBIT_NORMAL.includes(acc.type) ? l.debit - l.credit : l.credit - l.debit;
    await tx.account.update({ where: { id: acc.id }, data: { balance: { increment: delta } } });
    const after = Number((await tx.account.findUnique({ where: { id: acc.id }, select: { balance: true } })).balance);
    await tx.journalLine.create({
      data: {
        journalEntryId: entry.id, accountId: acc.id,
        debit: l.debit, credit: l.credit,
        description: cut(l.description || description),
        balanceBefore: r2(after - delta), balanceAfter: after,
        lineOrder: order++,
      },
    });
  }
  return entry;
}

// Penjualan (kasir atau pesanan online yang sudah lunas)
export async function postOrderSaleJournal(tx, orderId, userId, postedAt) {
  const o = await tx.order.findUnique({
    where: { id: orderId },
    include: { Payment: true, orderItems: { include: { productVariant: { include: { product: true } } } } },
  });
  if (!o) throw httpErr(404, 'Pesanan untuk jurnal tidak ditemukan');
  const store = o.storeId ? { id: o.storeId } : await tx.store.findFirst({ orderBy: { id: 'asc' } });

  const total = r2(o.total), tax = r2(o.tax);
  const revenue = Math.max(0, r2(total - tax));
  const cogs = r2(o.orderItems.reduce((a, i) => a + i.quantity * Number(i.productVariant?.product?.cost ?? 0), 0));

  const lines = [];
  let remaining = total;
  for (const p of o.Payment.filter((x) => x.status === 'PAID')) {
    const amt = Math.min(Number(p.amount), remaining);
    if (amt <= 0) continue;
    remaining = r2(remaining - amt);
    const method = String(p.paymentMethod).toUpperCase();
    lines.push({ code: CASH_METHODS.includes(method) ? '1100' : '1200', debit: amt, description: `Penerimaan ${method}` });
  }
  if (remaining > 0) lines.push({ code: '1100', debit: remaining, description: 'Penerimaan' });

  lines.push({ code: '5100', debit: cogs, description: 'Harga pokok penjualan' });
  lines.push({ code: '4100', credit: revenue, description: 'Penjualan' });
  lines.push({ code: '2200', credit: tax, description: 'PPN keluaran' });
  lines.push({ code: '1400', credit: cogs, description: 'Persediaan keluar' });

  return postJournal(tx, {
    referenceType: 'ORDER', referenceId: o.id, reference: o.orderNumber,
    description: `Penjualan ${o.orderNumber}`, lines, createdBy: userId, storeId: store.id, postedAt,
  });
}

// Penerimaan barang (isReturn = false) atau retur (isReturn = true)
export async function postReceiptJournal(tx, grId, userId, isReturn) {
  const gr = await tx.goodsReceipt.findUnique({ where: { id: grId }, include: { grItems: true } });
  if (!gr) throw httpErr(404, 'Goods Receipt untuk jurnal tidak ditemukan');
  const store = await tx.store.findFirst({ orderBy: { id: 'asc' } });
  const amount = r2(gr.grItems.reduce((a, i) => a + Number(i.total), 0));
  const lines = isReturn
    ? [{ code: '2100', debit: amount, description: 'Pengurangan hutang usaha' }, { code: '1400', credit: amount, description: 'Persediaan keluar' }]
    : [{ code: '1400', debit: amount, description: 'Persediaan masuk' }, { code: '2100', credit: amount, description: 'Hutang usaha' }];
  return postJournal(tx, {
    referenceType: isReturn ? 'GR_RETURN' : 'GR', referenceId: gr.id, reference: gr.grNumber,
    description: `${isReturn ? 'Retur barang' : 'Penerimaan barang'} ${gr.grNumber}`,
    lines, createdBy: userId, storeId: store.id,
  });
}