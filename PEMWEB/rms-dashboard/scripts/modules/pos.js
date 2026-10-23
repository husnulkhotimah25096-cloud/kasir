// ========================================
// RMS — Modul Kasir (POS)
// Fitur: Pencarian produk, keranjang, PPN 10%, split payment,
//        mode offline (antrean IndexedDB) + sync batch, struk digital
// ========================================

import {
  getCachedProducts,
  cacheProducts,
  addPendingSale,
  getPendingSales,
  removePendingSale,
  debounce,
  generateUUID,
} from '../utils/idb.js';
import { apiGet, apiPost } from '../utils/api.js';
import { hasRole } from '../utils/auth.js';
import { showToast, formatRupiah } from '../utils/ui.js';
import { RMS_STATE, sectionQuery, getCurrentStoreId, getCurrentUserId, esc } from '../utils/state.js';

const PPN_RATE = 0.1;

let productCache = [];
let cart = [];
let lastReceipt = null;
let initialized = false;

// === Inisialisasi (dipanggil sekali oleh app.js) ===

export function initPOS() {
  if (initialized) return;
  initialized = true;

  const section = document.getElementById('section-pos');
  if (!section) return;

  injectToolbar(section);
  setupSearch();
  setupPaymentMethods();
  refreshPendingBadge();
  renderCart();
  calculateTotal();
}

// Dipanggil setiap tab POS dibuka
export async function loadPOS() {
  initPOS();
  try {
    productCache = await apiGet('/products');
    RMS_STATE.cache.products = productCache;
    cacheProducts(productCache).catch(() => {});
  } catch (err) {
    console.warn('POS: gagal ambil produk dari API, pakai cache:', err.message);
    productCache = RMS_STATE.cache.products.length
      ? RMS_STATE.cache.products
      : await getCachedProducts().catch(() => []);
  }
  renderProductList(productCache);
  refreshPendingBadge();
}

// Render ulang daftar produk (dipakai app.js saat data awal tiba)
export function setProducts(products) {
  productCache = products || [];
  renderProductList(productCache);
}

// === Toolbar: search + status antrean offline ===

function injectToolbar(section) {
  if (section.querySelector('#pos-toolbar')) return;
  const bar = document.createElement('div');
  bar.id = 'pos-toolbar';
  bar.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap;';
  bar.innerHTML = `
    <input id="pos-search" type="search" placeholder="Cari nama / SKU..." style="flex:1;min-width:180px;padding:0.5rem;">
    <span id="pending-count" class="badge" style="display:none;"></span>
    <button id="sync-batch" class="btn btn-small" type="button">Sinkronkan Offline</button>
    <button id="print-receipt" class="btn btn-small btn-secondary" type="button">Cetak Struk</button>
  `;
  section.insertBefore(bar, section.firstChild);
  bar.querySelector('#sync-batch').addEventListener('click', () => syncOfflineQueue({ manual: true }));
  bar.querySelector('#print-receipt').addEventListener('click', printReceipt);
}

async function refreshPendingBadge() {
  const badge = document.getElementById('pending-count');
  if (!badge) return;
  try {
    const pending = await getPendingSales();
    badge.textContent = `${pending.length} antrean offline`;
    badge.style.display = pending.length ? '' : 'none';
  } catch (_) {
    badge.style.display = 'none';
  }
}

// === Pencarian Produk ===

function setupSearch() {
  const input = document.getElementById('pos-search');
  if (!input) return;
  const run = debounce((query) => renderProductList(filterProducts(query)), 250);
  input.addEventListener('input', (e) => run(e.target.value));
}

export function filterProducts(query, products = productCache) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return products;
  return products.filter(
    (p) => String(p.name).toLowerCase().includes(q) || String(p.sku || '').toLowerCase().includes(q)
  );
}

function renderProductList(products) {
  const list = sectionQuery('pos', '.product-list');
  if (!list) return;

  if (!products || products.length === 0) {
    list.innerHTML = '<p class="text-muted">Produk tidak ditemukan</p>';
    return;
  }

  list.innerHTML = products
    .map(
      (p) => `
    <div class="product-item" data-product-id="${esc(p.id)}" data-product-sku="${esc(p.sku)}" data-product-price="${esc(p.price)}" data-product-name="${esc(p.name)}">
      <span class="product-name" title="${esc(p.name)}">${esc(String(p.name).substring(0, 22))}${String(p.name).length > 22 ? '...' : ''}</span>
      <span class="product-sku">${esc(p.sku)}</span>
      <span class="product-price">Rp ${formatRupiah(p.price)}</span>
    </div>`
    )
    .join('');

  list.querySelectorAll('.product-item').forEach((item) => {
    item.addEventListener('click', () => addToCart(item));
  });
}

// === Keranjang ===

export function addToCart(element) {
  const productId = String(element.dataset.productId);
  const existing = cart.find((item) => item.productId === productId);

  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({
      productId,
      productName: element.dataset.productName,
      productPrice: parseFloat(element.dataset.productPrice) || 0,
      productSku: element.dataset.productSku,
      qty: 1,
    });
  }
  renderCart();
  calculateTotal();
}

export function removeFromCart(index) {
  cart.splice(index, 1);
  renderCart();
  calculateTotal();
}

export function changeQty(index, delta) {
  const item = cart[index];
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) cart.splice(index, 1);
  renderCart();
  calculateTotal();
}

export function getCart() {
  return cart.map((i) => ({ ...i }));
}

export function clearCart() {
  cart = [];
  renderCart();
  calculateTotal();
}

function renderCart() {
  const container = sectionQuery('pos', '.cart-items');
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = '<p class="text-muted">Keranjang kosong</p>';
    return;
  }

  container.innerHTML = cart
    .map(
      (item, i) => `
    <div class="cart-item">
      <span>${esc(item.productName)}</span>
      <span>
        <button class="btn btn-small" type="button" onclick="changeQty(${i}, -1)">−</button>
        ${item.qty}
        <button class="btn btn-small" type="button" onclick="changeQty(${i}, 1)">+</button>
      </span>
      <span>Rp ${formatRupiah(item.productPrice * item.qty)}</span>
      <button class="btn btn-danger btn-small" type="button" onclick="removeFromCart(${i})">Hapus</button>
    </div>`
    )
    .join('');
}

export function calculateTotal() {
  const total = cart.reduce((sum, item) => sum + item.productPrice * item.qty, 0);
  const tax = Math.round(total * PPN_RATE);
  const grandTotal = total + tax;

  const setText = (sel, val) => {
    const el = sectionQuery('pos', sel);
    if (el) el.textContent = `Rp ${formatRupiah(val)}`;
  };
  setText('.cart-total .subtotal', total);
  setText('.cart-total .tax', tax);
  setText('.cart-total .grandtotal', grandTotal);

  return { total, tax, grandTotal };
}

// === Metode Pembayaran ===

function setupPaymentMethods() {
  const select = sectionQuery('pos', 'select.payment-method');
  if (!select) return;
  select.classList.add('selected');
}

function selectedPaymentMethod() {
  return sectionQuery('pos', 'select.payment-method')?.value || 'cash';
}

// Split payment: methods = [{ method: 'cash', amount: 50000 }, ...]
export function applySplitPayment(methods = []) {
  const { grandTotal } = calculateTotal();
  const paid = methods.reduce((sum, m) => sum + Number(m.amount || 0), 0);
  const remaining = grandTotal - paid;

  methods.forEach((m) => showToast(`${m.method}: Rp ${formatRupiah(m.amount)} diterima`, 'success'));

  if (remaining > 0) {
    showToast(`Sisa bayar: Rp ${formatRupiah(remaining)}`, 'warning');
    return remaining;
  }
  if (remaining < 0) showToast(`Kembalian: Rp ${formatRupiah(Math.abs(remaining))}`, 'info');

  processSaleTransaction({ payments: methods });
  return remaining;
}

// === Transaksi ===

export async function processSaleTransaction(options = {}) {
  if (!hasRole('owner', 'admin', 'kasir')) {
    showToast('Role Anda tidak boleh melakukan transaksi', 'error');
    return null;
  }
  if (cart.length === 0) {
    showToast('Keranjang kosong', 'warning');
    return null;
  }

  const { grandTotal, total, tax } = calculateTotal();
  const sale = {
    storeId: getCurrentStoreId(),
    cashierId: getCurrentUserId(),
    items: cart.map((item) => ({
      productId: Number(item.productId),
      qty: item.qty,
      price: item.productPrice,
    })),
    subtotal: total,
    tax,
    total: grandTotal,
    paymentMethod: options.payments?.length > 1 ? 'split' : (options.payments?.[0]?.method || selectedPaymentMethod()),
    payments: options.payments || [{ method: selectedPaymentMethod(), amount: grandTotal }],
    timestamp: new Date().toISOString(),
  };
  const receiptItems = cart.map((i) => ({ ...i }));

  if (RMS_STATE.currentMode === 'online') {
    try {
      const result = await apiPost('/sales', sale);
      lastReceipt = { sale, items: receiptItems, id: result?.id, offline: false };
      showToast(`Transaksi${result?.id ? ` #${result.id}` : ''} berhasil disimpan`, 'success');
      clearCart();
      return result;
    } catch (err) {
      // Jaringan putus di tengah jalan -> simpan offline agar transaksi tidak hilang
      if (err.name === 'TypeError') {
        RMS_STATE.currentMode = 'offline';
        return queueOffline(sale, receiptItems);
      }
      showToast('Gagal menyimpan transaksi: ' + err.message, 'error');
      return null;
    }
  }
  return queueOffline(sale, receiptItems);
}

async function queueOffline(sale, receiptItems) {
  try {
    const idempotencyKey = await addPendingSale({
      storeId: sale.storeId,
      cashierId: sale.cashierId,
      timestamp: sale.timestamp,
      uuid: generateUUID(),
      sale,
    });
    lastReceipt = { sale, items: receiptItems, id: null, offline: true, key: idempotencyKey };
    showToast('Transaksi disimpan offline, akan disinkronkan saat online', 'info');
    clearCart();
    refreshPendingBadge();
    return { offline: true, idempotencyKey };
  } catch (err) {
    showToast('Gagal menyimpan transaksi offline: ' + err.message, 'error');
    return null;
  }
}

// === Sinkronisasi antrean offline ===
// Kontrak API: POST /sales/sync-batch { sales: [{ idempotencyKey, ...sale }] }
//   -> { results: [{ idempotencyKey, status: 'created' | 'duplicate' | 'failed', error? }] }

let syncing = false;

export async function syncOfflineQueue({ manual = false } = {}) {
  if (syncing) return;
  syncing = true;
  try {
    const pending = await getPendingSales();
    if (!pending.length) {
      if (manual) showToast('Tidak ada transaksi offline yang menunggu', 'info');
      return;
    }
    if (RMS_STATE.currentMode !== 'online') {
      if (manual) showToast('Masih offline, sinkronisasi ditunda', 'warning');
      return;
    }

    const payload = pending.map((p) => ({ idempotencyKey: p.idempotencyKey, ...p.saleData.sale }));
    const data = await apiPost('/sales/sync-batch', { sales: payload });

    const results = Array.isArray(data?.results) ? data.results : [];
    let ok = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === 'created' || r.status === 'duplicate') {
        await removePendingSale(r.idempotencyKey);
        ok += 1;
      } else {
        failed += 1;
      }
    }
    if (results.length === 0 && data?.success) {
      // Server lama tanpa detail per-item: anggap semua berhasil
      for (const p of pending) await removePendingSale(p.idempotencyKey);
      ok = pending.length;
    }

    if (ok) showToast(`${ok} transaksi berhasil disinkronkan`, 'success');
    if (failed) showToast(`${failed} transaksi gagal, akan dicoba lagi`, 'error');
  } catch (err) {
    console.error('Sync gagal:', err);
    showToast('Sinkronisasi gagal, akan dicoba lagi', 'error');
  } finally {
    syncing = false;
    refreshPendingBadge();
  }
}

// === Struk Digital ===

export function buildReceiptHTML(receipt) {
  const { sale, items } = receipt;
  const rows = items
    .map((i) => `<tr><td>${esc(i.productName)} × ${i.qty}</td><td style="text-align:right">Rp ${formatRupiah(i.productPrice * i.qty)}</td></tr>`)
    .join('');
  return `
    <h3 style="text-align:center">RMS — Struk Pembelian</h3>
    <p style="text-align:center">${new Date(sale.timestamp).toLocaleString('id-ID')}${receipt.offline ? '<br><em>(transaksi offline)</em>' : ''}</p>
    <table style="width:100%">${rows}
      <tr><td>Subtotal</td><td style="text-align:right">Rp ${formatRupiah(sale.subtotal)}</td></tr>
      <tr><td>PPN 10%</td><td style="text-align:right">Rp ${formatRupiah(sale.tax)}</td></tr>
      <tr><td><strong>Total</strong></td><td style="text-align:right"><strong>Rp ${formatRupiah(sale.total)}</strong></td></tr>
    </table>
    <p>Pembayaran: ${esc(sale.paymentMethod)}</p>`;
}

export function printReceipt() {
  if (!lastReceipt) {
    showToast('Belum ada transaksi untuk dicetak', 'warning');
    return;
  }
  const win = window.open('', '_blank', 'width=380,height=600');
  if (!win) {
    showToast('Pop-up diblokir browser', 'warning');
    return;
  }
  win.document.write(`<html><head><title>Struk</title></head><body style="font-family:monospace">${buildReceiptHTML(lastReceipt)}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

// Pembaruan stok realtime dari WebSocket
export function updatePOSStock(payload) {
  const p = productCache.find((x) => String(x.id) === String(payload?.productId));
  if (p && Array.isArray(p.stock)) {
    const s = p.stock.find((x) => x.warehouseId === payload.warehouseId);
    if (s) s.quantity = payload.quantity;
  }
}
