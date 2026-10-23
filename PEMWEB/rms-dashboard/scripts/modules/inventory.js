// ========================================
// RMS — Modul Inventory & Stock Opname
// Fitur: Stok multi-lokasi, pencarian, opname (selisih >10% butuh approval),
//        transfer antar gudang, penyesuaian stok (optimistic locking)
// ========================================

import { cacheProducts, cacheStores, getCachedProducts, getCachedStores, debounce } from '../utils/idb.js';
import { apiGet, apiPost, updateStock } from '../utils/api.js';
import { hasRole } from '../utils/auth.js';
import { showToast } from '../utils/ui.js';
import { RMS_STATE, sectionQuery, esc } from '../utils/state.js';

const DEFAULT_MIN_STOCK = 10;
const OPNAME_APPROVAL_THRESHOLD = 10; // persen

let productCache = [];
let storeCache = [];
let searchQuery = '';
let initialized = false;
let opnameTarget = null;

// === Inisialisasi ===

export function initInventory() {
  if (initialized) return;
  initialized = true;

  const section = document.getElementById('section-inventory');
  if (!section) return;

  if (!section.querySelector('#inventory-search')) {
    const bar = document.createElement('div');
    bar.style.cssText = 'margin-bottom:1rem;';
    bar.innerHTML = '<input id="inventory-search" type="search" placeholder="Cari produk / SKU..." style="width:100%;max-width:320px;padding:0.5rem;">';
    section.insertBefore(bar, section.firstChild);
    bar.querySelector('input').addEventListener(
      'input',
      debounce((e) => {
        searchQuery = e.target.value;
        renderStockTable();
      }, 250)
    );
  }
  ensureOpnameModal();
  // Stok berubah di modul lain (mis. goods receipt dikonfirmasi) -> muat ulang
  window.addEventListener('rms:stock-updated', () => loadInventory());
}

export async function loadInventory() {
  initInventory();
  try {
    [productCache, storeCache] = await Promise.all([apiGet('/products'), apiGet('/stores')]);
    RMS_STATE.cache.products = productCache;
    RMS_STATE.cache.stores = storeCache;
    cacheProducts(productCache).catch(() => {});
    cacheStores(storeCache).catch(() => {});
  } catch (err) {
    console.warn('Inventory: pakai cache, API gagal:', err.message);
    productCache = RMS_STATE.cache.products.length ? RMS_STATE.cache.products : await getCachedProducts().catch(() => []);
    storeCache = RMS_STATE.cache.stores.length ? RMS_STATE.cache.stores : await getCachedStores().catch(() => []);
  }
  renderStockTable();
}

// === Util ===

function stockOf(product, warehouseId) {
  const list = Array.isArray(product.stock) ? product.stock : [];
  return list.find((s) => s.warehouseId === warehouseId) || null;
}

// Hitung selisih opname. Jika stok sistem 0 dan fisik > 0, selisih dianggap 100%.
export function opnameDeviation(physicalCount, systemCount) {
  const diffAbs = physicalCount - systemCount;
  let percent;
  if (systemCount === 0) percent = physicalCount === 0 ? 0 : 100;
  else percent = (Math.abs(diffAbs) / systemCount) * 100;
  let action = 'none';
  if (percent > OPNAME_APPROVAL_THRESHOLD) action = 'approval';
  else if (percent > 0) action = 'auto-adjust';
  return { diffAbs, percent, action };
}

// === Tabel Stok ===

export function renderStockTable() {
  const tbody = sectionQuery('inventory', '.stock-table tbody');
  if (!tbody) return;

  if (productCache.length === 0 || storeCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Data kosong</td></tr>';
    return;
  }

  const q = searchQuery.trim().toLowerCase();
  const products = q
    ? productCache.filter((p) => String(p.name).toLowerCase().includes(q) || String(p.sku || '').toLowerCase().includes(q))
    : productCache;

  const canEdit = hasRole('owner', 'admin', 'gudang');
  let rows = '';
  storeCache.forEach((store) => {
    products.forEach((product) => {
      const stock = stockOf(product, store.id);
      const qty = stock ? stock.quantity : 0;
      const min = product.minStock ?? DEFAULT_MIN_STOCK;
      const actions = canEdit
        ? `<button class="btn btn-small" type="button" onclick="openOpnameModal(${product.id}, ${store.id})">Opname</button>
           <button class="btn btn-small btn-secondary" type="button" onclick="transferStock(${product.id}, ${store.id})">Transfer</button>
           <button class="btn btn-small btn-secondary" type="button" onclick="adjustStock(${product.id}, ${store.id})">Sesuaikan</button>`
        : '-';
      rows += `
        <tr data-product-id="${esc(product.id)}" data-warehouse-id="${esc(store.id)}">
          <td>${esc(String(product.name).substring(0, 25))}${String(product.name).length > 25 ? '...' : ''}</td>
          <td>${esc(store.name)}</td>
          <td><span class="badge badge-${qty <= min ? 'warning' : 'online'}">${qty}</span></td>
          <td>${min}</td>
          <td>${actions}</td>
        </tr>`;
    });
  });
  tbody.innerHTML = rows || '<tr><td colspan="5" class="text-center">Tidak ditemukan</td></tr>';
}

// Update realtime dari WebSocket (stock.updated)
export function updateStockUI(payload) {
  if (!payload) return;
  const product = productCache.find((p) => String(p.id) === String(payload.productId));
  const stock = product && stockOf(product, payload.warehouseId);
  if (stock) {
    stock.quantity = payload.quantity;
    if (payload.version !== undefined) stock.version = payload.version;
  }
  const badge = document.querySelector(
    `#section-inventory tr[data-product-id="${payload.productId}"][data-warehouse-id="${payload.warehouseId}"] .badge`
  );
  if (badge) badge.textContent = payload.quantity;
}

// === Modal Opname (dibuat dinamis) ===

function ensureOpnameModal() {
  if (document.getElementById('opname-modal')) return;
  const modal = document.createElement('div');
  modal.id = 'opname-modal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;';
  modal.innerHTML = `
    <div style="background:var(--color-surface,#fff);color:var(--color-text,#111);padding:1.5rem;border-radius:8px;min-width:300px;max-width:90vw;">
      <h3>Stock Opname</h3>
      <p><strong id="opname-product-name"></strong> — <span id="opname-warehouse-name"></span></p>
      <form id="opname-form">
        <label>Stok sistem <input id="opname-current-stock" type="number" readonly style="width:100%;margin-bottom:.5rem;"></label>
        <label>Hitung fisik <input id="opname-physical-count" type="number" min="0" required style="width:100%;margin-bottom:.5rem;"></label>
        <label>Catatan <input id="opname-notes" type="text" style="width:100%;margin-bottom:.75rem;"></label>
        <div style="display:flex;gap:.5rem;justify-content:flex-end;">
          <button type="button" class="btn btn-secondary btn-small" id="opname-cancel">Batal</button>
          <button type="submit" class="btn btn-small">Proses</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#opname-cancel').addEventListener('click', closeOpnameModal);
  modal.querySelector('#opname-form').addEventListener('submit', onOpnameSubmit);
}

function closeOpnameModal() {
  const modal = document.getElementById('opname-modal');
  if (modal) modal.style.display = 'none';
  opnameTarget = null;
}

export function openOpnameModal(productId, warehouseId) {
  ensureOpnameModal();
  const product = productCache.find((p) => String(p.id) === String(productId));
  const warehouse = storeCache.find((w) => String(w.id) === String(warehouseId));
  if (!product || !warehouse) return;

  opnameTarget = { productId: product.id, warehouseId: warehouse.id };
  const stock = stockOf(product, warehouse.id);
  document.getElementById('opname-product-name').textContent = product.name;
  document.getElementById('opname-warehouse-name').textContent = warehouse.name;
  document.getElementById('opname-current-stock').value = stock ? stock.quantity : 0;
  document.getElementById('opname-physical-count').value = '';
  document.getElementById('opname-notes').value = '';
  document.getElementById('opname-modal').style.display = 'flex';
}

async function onOpnameSubmit(e) {
  e.preventDefault();
  if (!opnameTarget) return;

  const physical = parseInt(document.getElementById('opname-physical-count').value, 10);
  if (Number.isNaN(physical) || physical < 0) {
    showToast('Jumlah fisik harus angka ≥ 0', 'error');
    return;
  }
  const systemCount = parseInt(document.getElementById('opname-current-stock').value, 10) || 0;
  const { diffAbs, percent, action } = opnameDeviation(physical, systemCount);

  if (action === 'none') {
    showToast('Stok sesuai, tidak ada penyesuaian', 'success');
    closeOpnameModal();
    return;
  }
  if (action === 'approval') {
    const msg = `Selisih ${percent.toFixed(1)}% (> ${OPNAME_APPROVAL_THRESHOLD}%). Butuh approval Manager.\n\nAjukan approval?`;
    if (!confirm(msg)) return;
  }

  try {
    const result = await apiPost('/stock/opname', {
      ...opnameTarget,
      physicalCount: physical,
      systemCount,
      diffAbs,
      diffPercent: Number(percent.toFixed(2)),
      requiresApproval: action === 'approval',
      notes: document.getElementById('opname-notes').value || undefined,
    });
    showToast(
      result?.message || (action === 'approval' ? 'Opname diajukan, menunggu approval' : 'Opname diproses, stok disesuaikan'),
      'success'
    );
    closeOpnameModal();
    await loadInventory();
  } catch (err) {
    showToast('Gagal proses opname: ' + err.message, 'error');
  }
}

// === Transfer & Penyesuaian ===

export async function transferStock(productId, fromWarehouseId) {
  const product = productCache.find((p) => String(p.id) === String(productId));
  const from = stockOf(product || {}, fromWarehouseId);
  const others = storeCache.filter((s) => String(s.id) !== String(fromWarehouseId));
  if (!product || !others.length) {
    showToast('Tidak ada gudang tujuan', 'warning');
    return;
  }

  const options = others.map((s) => `${s.id} = ${s.name}`).join('\n');
  const toId = parseInt(prompt(`Gudang tujuan (isi ID):\n${options}`) || '', 10);
  if (!others.some((s) => s.id === toId)) return;

  const qty = parseInt(prompt(`Jumlah yang ditransfer (tersedia ${from?.quantity ?? 0}):`) || '', 10);
  if (!qty || qty <= 0) return;
  if (qty > (from?.quantity ?? 0)) {
    showToast('Jumlah melebihi stok tersedia', 'error');
    return;
  }

  try {
    const result = await apiPost('/stock/transfer', {
      productId: product.id,
      fromWarehouseId: Number(fromWarehouseId),
      toWarehouseId: toId,
      quantity: qty,
    });
    showToast(result?.message || 'Transfer stok berhasil', 'success');
    await loadInventory();
  } catch (err) {
    showToast('Gagal transfer: ' + err.message, 'error');
  }
}

export async function adjustStock(productId, warehouseId) {
  const product = productCache.find((p) => String(p.id) === String(productId));
  const stock = stockOf(product || {}, warehouseId);
  if (!product) return;

  const current = stock?.quantity ?? 0;
  const next = parseInt(prompt(`Stok baru untuk "${product.name}" (sekarang ${current}):`) || '', 10);
  if (Number.isNaN(next) || next < 0 || next === current) return;

  try {
    await updateStock(product.id, Number(warehouseId), next - current, stock?.version ?? 0);
    showToast('Stok berhasil disesuaikan', 'success');
    await loadInventory();
  } catch (err) {
    const msg = err.status === 409 ? 'Stok sudah diubah pengguna lain, muat ulang lalu coba lagi' : err.message;
    showToast('Gagal menyesuaikan stok: ' + msg, 'error');
    if (err.status === 409) loadInventory();
  }
}

// Kurangi stok 1 unit (aksi cepat dari tabel lama / dashboard)
export async function decreaseStock(productId, warehouseId) {
  const product = productCache.find((p) => String(p.id) === String(productId));
  const stock = stockOf(product || {}, warehouseId);
  if ((stock?.quantity ?? 0) <= 0) {
    showToast('Stok habis, tidak bisa dikurangi', 'error');
    return;
  }
  try {
    await updateStock(Number(productId), Number(warehouseId), -1, stock.version ?? 0);
    showToast('Stok berhasil dikurangi', 'success');
    await loadInventory();
  } catch (err) {
    showToast('Gagal mengurangi stok: ' + err.message, 'error');
  }
}
