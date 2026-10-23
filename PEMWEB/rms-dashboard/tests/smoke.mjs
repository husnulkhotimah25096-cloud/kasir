import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import fs from 'fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '');
const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
const w = dom.window;
for (const k of ['window','document','localStorage','navigator','CustomEvent','FormData','Event']) {
  try { Object.defineProperty(globalThis, k, { value: k === 'window' ? w : w[k], configurable: true, writable: true }); } catch {}
}
globalThis.crypto ??= w.crypto;
w.crypto ??= globalThis.crypto;
globalThis.Chart = class { constructor() {} destroy() {} };
globalThis.WebSocket = class { constructor() { setTimeout(() => this.onerror?.(new Error('no ws')), 0); } send() {} close() {} };
globalThis.confirm = () => true;
globalThis.prompt = (msg) => (/Alasan/.test(msg) ? 'salah input' : '1');
w.confirm = globalThis.confirm; w.prompt = globalThis.prompt;
w.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.setInterval = setInterval;
globalThis.getComputedStyle = w.getComputedStyle.bind(w);

// ---- API palsu sesuai kontrak ----
const db = {
  products: [
    { id: 1, sku: 'SKU-1', name: 'Kopi Susu', price: 20000, cost: 12000, stock: [{ warehouseId: 1, quantity: 50, version: 1 }, { warehouseId: 2, quantity: 5, version: 1 }] },
    { id: 2, sku: 'SKU-2', name: 'Roti Bakar', price: 15000, cost: 8000, stock: [{ warehouseId: 1, quantity: 0, version: 1 }] },
  ],
  stores: [{ id: 1, name: 'Gudang Pusat' }, { id: 2, name: 'Cabang A' }],
  journals: [
    { id: 1, entryDate: '2026-10-01', reference: 'GR-1', description: 'Barang masuk', totalDebit: 100000, totalCredit: 100000, isBalanced: true, status: 'POSTED' },
    { id: 2, entryDate: '2026-10-02', reference: 'ORD-1', description: 'Penjualan', totalDebit: 50000, totalCredit: 50000, isBalanced: true, status: 'POSTED' },
  ],
  suppliers: [{ id: 1, name: 'PT Maju', phone: '0811', paymentTerm: 'NET30' }],
  pos: [], grs: [], sales: [], batch: [], calls: [],
};
let online = true;
const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
globalThis.fetch = async (url, opts = {}) => {
  if (!online) throw new TypeError('Failed to fetch');
  const u = new URL(url); const path = u.pathname.replace('/api/v1', ''); const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : null;
  db.calls.push(`${method} ${path}`);
  if (method === 'GET') {
    if (path === '/products') return json(db.products);
    if (path === '/stores') return json(db.stores);
    if (path === '/journal-entries') return json(db.journals);
    if (path === '/accounts') return json([{ id: 1, code: '1-100', name: 'Kas' }]);
    if (path === '/suppliers') return json(db.suppliers);
    if (path === '/purchase-orders') return json(db.pos);
    if (path.startsWith('/purchase-orders/')) return json(db.pos.find((p) => p.id == path.split('/')[2]));
    if (path === '/goods-receipts') return json(db.grs);
    if (path === '/event-logs/simulator') return json([{ type: 'sale.completed', createdAt: new Date().toISOString(), payload: { id: 1, note: '<b>x</b>' } }]);
    if (path.startsWith('/dashboard/kpi')) return json({ totalOmzet: 1000000, margin: 22, stokWarning: 2, transaksiPending: 0 });
    if (path.startsWith('/dashboard/sales-trend')) return json([{ date: '2026-10-01', total: 100 }]);
    if (path.startsWith('/dashboard/top-products')) return json([{ name: 'Kopi', qty: 5 }]);
  }
  if (method === 'POST') {
    if (path === '/sales') { db.sales.push(body); return json({ id: db.sales.length }, 201); }
    if (path === '/sales/sync-batch') { db.batch.push(...body.sales); return json({ success: true, results: body.sales.map((s) => ({ idempotencyKey: s.idempotencyKey, status: 'created' })) }); }
    if (path === '/purchase-orders') { const id = db.pos.length + 1; const total = body.items.reduce((s, i) => s + i.qty * i.unitPrice, 0); db.pos.push({ id, poNumber: 'PO-' + id, supplierName: 'PT Maju', status: 'APPROVED', totalAmount: total, createdAt: new Date().toISOString(), poItems: body.items.map((i) => ({ ...i, qtyOrdered: i.qty, productName: 'x' })) }); return json({ id }, 201); }
    if (path === '/goods-receipts') { db.grs.push({ id: db.grs.length + 1, grNumber: 'GR-1', purchaseOrderId: body.purchaseOrderId, status: 'PENDING', receivedAt: new Date().toISOString() }); return json({ ok: 1 }, 201); }
    if (/\/goods-receipts\/\d+\/confirm/.test(path)) { db.grs[0].status = 'CONFIRMED'; return json({ message: 'ok' }); }
    if (path === '/stock/opname') { db.opname = body; return json({ message: 'opname ok' }); }
    if (/\/journal-entries\/\d+\/void/.test(path)) { db.journals[0].status = 'VOIDED'; db.voidBody = body; return json({ message: 'void ok' }); }
  }
  if (method === 'PUT' && path.startsWith('/stock/')) { db.put = body; return json({ ok: 1 }); }
  return json({ message: 'not found ' + path }, 404);
};

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const q = (s) => w.document.querySelector(s);

w.localStorage.setItem('rms_user', JSON.stringify({ id: 7, name: 'Tes', role: 'owner', token: 't0k3n' }));
await import('../scripts/app.js');
w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
await tick(150);

ok(w.document.querySelectorAll('#section-dashboard .kpi-grid > *').length > 0, 'Dashboard: KPI card dirender');
ok(!q('#login-overlay'), 'Login overlay tidak muncul bila sudah login');
ok(q('#account-menu'), 'Menu akun/Keluar tampil');

const go = async (tab) => { q(`.tab-btn[data-tab="${tab}"]`).click(); await tick(150); };

// ---- POS ----
await go('pos');
ok(w.document.querySelectorAll('#section-pos .product-item').length === 2, 'POS: 2 produk dirender');
q('#pos-search').value = 'kopi'; q('#pos-search').dispatchEvent(new w.Event('input')); await tick(350);
ok(w.document.querySelectorAll('#section-pos .product-item').length === 1, 'POS: pencarian memfilter produk');
q('#pos-search').value = ''; q('#pos-search').dispatchEvent(new w.Event('input')); await tick(350);
const items = w.document.querySelectorAll('#section-pos .product-item');
items[0].click(); items[0].click(); items[1].click();
ok(w.document.querySelectorAll('#section-pos .cart-item').length === 2, 'POS: keranjang berisi 2 baris');
ok(q('#section-pos .subtotal').textContent.includes('55.000'), 'POS: subtotal Rp 55.000 (2×20rb + 15rb)');
ok(q('#section-pos .grandtotal').textContent.includes('60.500'), 'POS: grand total termasuk PPN 10% = 60.500');
w.changeQty(1, 1);
ok(q('#section-pos .subtotal').textContent.includes('70.000'), 'POS: ubah qty (+) memperbarui total');
w.changeQty(1, -1);
await w.processSaleTransaction(); await tick();
ok(db.sales.length === 1 && db.sales[0].items.length === 2, 'POS online: POST /sales terkirim');
ok(db.sales[0].total === 60500 && db.sales[0].cashierId === 7, 'POS online: total & cashierId benar');
ok(w.document.querySelectorAll('#section-pos .cart-item').length === 0, 'POS online: keranjang dikosongkan');

// offline
online = false; w.dispatchEvent(new w.Event('offline')); await tick();
w.document.querySelectorAll('#section-pos .product-item')[0].click();
const offRes = await w.processSaleTransaction(); await tick();
ok(offRes?.offline === true, 'POS offline: transaksi masuk antrean IndexedDB');
ok(q('#pending-count').style.display !== 'none' && q('#pending-count').textContent.startsWith('1'), 'POS offline: badge antrean = 1');
online = true; w.dispatchEvent(new w.Event('online')); await tick(300);
ok(db.batch.length === 1 && db.batch[0].idempotencyKey, 'Sync: /sales/sync-batch menerima idempotencyKey');
ok(q('#pending-count').style.display === 'none', 'Sync: antrean kosong setelah berhasil');

// network drop di tengah online
online = false;
w.document.querySelectorAll('#section-pos .product-item')[1].click();
const r3 = await w.processSaleTransaction(); await tick();
ok(r3?.offline === true, 'POS: jaringan putus saat online -> otomatis disimpan offline (tidak hilang)');
online = true; await w.dispatchEvent(new w.Event('online')); await tick(300);

// ---- Inventory ----
await go('inventory');
ok(w.document.querySelectorAll('#section-inventory .stock-table tbody tr').length === 4, 'Inventory: 2 gudang × 2 produk = 4 baris');
ok(q('#section-inventory tr[data-product-id="1"][data-warehouse-id="2"] .badge-warning'), 'Inventory: stok ≤ min diberi badge warning');
const { opnameDeviation } = await import('../scripts/modules/inventory.js');
ok(opnameDeviation(50, 50).action === 'none', 'Opname: sama -> none');
ok(opnameDeviation(48, 50).action === 'auto-adjust', 'Opname: selisih 4% -> auto-adjust');
ok(opnameDeviation(40, 50).action === 'approval', 'Opname: selisih 20% -> approval');
ok(opnameDeviation(3, 0).action === 'approval' && Number.isFinite(opnameDeviation(3, 0).percent), 'Opname: stok sistem 0 tidak menghasilkan NaN/Infinity');
w.openOpnameModal(1, 1);
q('#opname-physical-count').value = '40';
q('#opname-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(150);
ok(db.opname?.requiresApproval === true && db.opname.diffAbs === -10, 'Opname UI: kirim requiresApproval + diffAbs');
await w.adjustStock(1, 1); await tick();
ok(db.put?.delta === -49 && db.put?.currentVersion === 1, 'Adjust: delta & version (optimistic lock) terkirim');

// ---- Finance ----
await go('finance');
ok(w.document.querySelectorAll('#section-finance .journal-table tbody tr').length === 2, 'Finance: 2 jurnal dirender');
ok(q('#finance-account-filter').options.length === 2, 'Finance: filter akun terisi');
await w.voidEntry(1); await tick(150);
ok(db.voidBody?.reason === 'salah input', 'Finance: void mengirim alasan');
ok(q('#section-finance .journal-table tbody').innerHTML.includes('Void'), 'Finance: jurnal void ditandai');

// ---- Procurement ----
await go('procurement');
ok(q('#procurement-root .supplier-table tbody tr'), 'Procurement: tabel supplier tampil');
q('#po-qty').value = '10'; q('#po-unit-price').value = '9000'; q('#po-add-line').click();
ok(q('#po-draft').textContent.includes('90.000'), 'Procurement: draft PO menghitung total');
q('#po-form').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(200);
ok(db.pos.length === 1 && db.pos[0].totalAmount === 90000, 'Procurement: PO tersimpan via POST');
await w.createGR(1); await tick(200);
ok(db.grs.length === 1, 'Procurement: Goods Receipt dibuat');
let stockEvent = false; w.addEventListener('rms:stock-updated', () => (stockEvent = true));
await w.confirmGR(1); await tick(200);
ok(db.grs[0].status === 'CONFIRMED' && stockEvent, 'Procurement: konfirmasi GR + event refresh stok');

// ---- Event logs ----
await go('eventlogs');
ok(q('#section-eventlogs .log-entry'), 'Event logs: entri tampil');
ok(!q('#section-eventlogs .log-payload b'), 'Event logs: payload di-escape (anti-XSS)');
ok(db.calls.some((c) => c.startsWith('GET /dashboard/kpi')), 'Dashboard memanggil /dashboard/kpi');

// ---- Role ----
w.localStorage.setItem('rms_user', JSON.stringify({ id: 9, name: 'K', role: 'kasir', token: 'x' }));
await go('finance');
ok(q('#section-finance .journal-table tbody').textContent.includes('Akses ditolak'), 'RBAC: kasir ditolak di Keuangan');
await go('procurement');
ok(q('#procurement-root').textContent.includes('Akses ditolak'), 'RBAC: kasir ditolak di Pembelian');

console.log(`\n${pass} lulus, ${fail} gagal`);
process.exit(fail ? 1 : 0);
