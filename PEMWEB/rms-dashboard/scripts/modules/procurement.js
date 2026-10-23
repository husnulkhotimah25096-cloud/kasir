// ========================================
// RMS — Modul Procurement (Barang Masuk)
// Fitur: Supplier, Purchase Order (multi-item), Goods Receipt
//        (konfirmasi -> stok bertambah di server), retur barang
// UI dirender ke #section-procurement agar HTML tidak perlu diubah.
// ========================================

import { apiGet, apiPost } from '../utils/api.js';
import { hasRole } from '../utils/auth.js';
import { showToast, formatRupiah } from '../utils/ui.js';
import { RMS_STATE, esc } from '../utils/state.js';

let suppliers = [];
let purchaseOrders = [];
let goodsReceipts = [];
let products = [];
let poLines = []; // draft item PO
let initialized = false;

const canBuy = () => hasRole('owner', 'admin', 'pembeli');
const canReceive = () => hasRole('owner', 'admin', 'gudang');

const root = () => document.getElementById('procurement-root');
const $ = (sel) => root()?.querySelector(sel);

// === Inisialisasi: bangun kerangka UI sekali ===

export function initProcurement() {
  if (initialized) return;
  const container = root();
  if (!container) return;
  initialized = true;

  container.innerHTML = `
    <div style="display:grid;gap:1.5rem;">
      <section>
        <h3>Supplier</h3>
        <form id="supplier-form" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem;">
          <input name="name" placeholder="Nama supplier" required>
          <input name="code" placeholder="Kode" required style="width:90px;">
          <input name="phone" placeholder="Telepon" required>
          <input name="paymentTerm" placeholder="Termin (mis. NET30)" style="width:140px;">
          <button class="btn btn-small" type="submit">Tambah</button>
        </form>
        <table class="supplier-table" style="width:100%;"><thead><tr><th>Nama</th><th>Kontak</th><th>Termin</th><th>Aksi</th></tr></thead><tbody></tbody></table>
      </section>

      <section>
        <h3>Buat Purchase Order</h3>
        <form id="po-form" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:end;">
          <label>Supplier <select id="po-supplier-id" required></select></label>
          <label>Produk <select id="po-product-id"></select></label>
          <label>Qty <input id="po-qty" type="number" min="1" value="1" style="width:80px;"></label>
          <label>Harga satuan <input id="po-unit-price" type="number" min="0" style="width:120px;"></label>
          <button class="btn btn-small btn-secondary" type="button" id="po-add-line">+ Tambah item</button>
          <button class="btn btn-small" type="submit">Simpan PO</button>
        </form>
        <div id="po-draft" class="text-muted" style="margin-top:.5rem;"></div>
      </section>

      <section>
        <h3>Purchase Order</h3>
        <table class="po-table" style="width:100%;"><thead><tr><th>Nomor</th><th>Tanggal</th><th>Supplier</th><th>Status</th><th>Total</th><th>Aksi</th></tr></thead><tbody></tbody></table>
      </section>

      <section>
        <h3>Goods Receipt</h3>
        <table class="gr-table" style="width:100%;"><thead><tr><th>Nomor</th><th>PO</th><th>Diterima</th><th>Status</th><th>Aksi</th></tr></thead><tbody></tbody></table>
      </section>
    </div>
    <div id="po-detail-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;"></div>`;

  $('#supplier-form').addEventListener('submit', onSupplierSubmit);
  $('#po-form').addEventListener('submit', onPOSubmit);
  $('#po-add-line').addEventListener('click', addPOLine);
  $('#po-product-id').addEventListener('change', fillDefaultPrice);
  $('#po-detail-modal').addEventListener('click', (e) => {
    if (e.target.id === 'po-detail-modal' || e.target.dataset.close) closeDetail();
  });
}

export async function loadProcurement() {
  initProcurement();
  if (!root()) return;
  if (!hasRole('owner', 'admin', 'pembeli', 'gudang')) {
    root().innerHTML = '<p>Akses ditolak. Dibutuhkan role owner, admin, pembeli, atau gudang.</p>';
    initialized = false;
    return;
  }

  try {
    [suppliers, purchaseOrders, goodsReceipts, products] = await Promise.all([
      apiGet('/suppliers'),
      apiGet('/purchase-orders'),
      apiGet('/goods-receipts'),
      RMS_STATE.cache.products.length ? Promise.resolve(RMS_STATE.cache.products) : apiGet('/products'),
    ]);
    RMS_STATE.cache.products = products;
  } catch (err) {
    showToast('Gagal memuat data procurement: ' + err.message, 'error');
  }
  renderSupplierTable();
  renderSupplierSelect();
  renderProductSelect();
  renderPOTable();
  renderGRTable();
  renderDraft();
}

// === Supplier ===

function renderSupplierTable() {
  const tbody = $('.supplier-table tbody');
  if (!tbody) return;
  if (!suppliers.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">Belum ada supplier</td></tr>';
    return;
  }
  tbody.innerHTML = suppliers
    .map(
      (s) => `<tr>
        <td>${esc(s.name)}</td>
        <td>${esc(s.contactName || s.phone || '-')}</td>
        <td>${esc(s.paymentTerm || '-')}</td>
        <td>${canBuy() ? `<button class="btn btn-small" type="button" onclick="createPO(${Number(s.id)})">Buat PO</button>` : '-'}</td>
      </tr>`
    )
    .join('');
}

function renderSupplierSelect() {
  const sel = $('#po-supplier-id');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = suppliers.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  if (current) sel.value = current;
}

async function onSupplierSubmit(e) {
  e.preventDefault();
  if (!canBuy()) return showToast('Role Anda tidak boleh menambah supplier', 'error');
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    await apiPost('/suppliers', data);
    showToast('Supplier ditambahkan', 'success');
    form.reset();
    suppliers = await apiGet('/suppliers');
    renderSupplierTable();
    renderSupplierSelect();
  } catch (err) {
    showToast('Gagal menambah supplier: ' + err.message, 'error');
  }
}

// Tombol "Buat PO" di tabel supplier: pilih supplier lalu fokus ke form
export function createPO(supplierId) {
  const sel = $('#po-supplier-id');
  if (sel) {
    sel.value = String(supplierId);
    $('#po-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('#po-product-id')?.focus();
  }
}

// === Purchase Order ===

function renderProductSelect() {
  const sel = $('#po-product-id');
  if (!sel) return;
  sel.innerHTML = products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  fillDefaultPrice();
}

function fillDefaultPrice() {
  const p = products.find((x) => String(x.id) === $('#po-product-id')?.value);
  const price = $('#po-unit-price');
  if (p && price && !price.value) price.value = p.cost ?? '';
}

function addPOLine() {
  const productId = Number($('#po-product-id').value);
  const qty = parseInt($('#po-qty').value, 10);
  const unitPrice = parseFloat($('#po-unit-price').value);
  const product = products.find((p) => p.id === productId);
  if (!product || !(qty > 0) || !(unitPrice >= 0)) {
    return showToast('Isi produk, qty (>0), dan harga satuan dengan benar', 'warning');
  }
  const existing = poLines.find((l) => l.productId === productId && l.unitPrice === unitPrice);
  if (existing) existing.qty += qty;
  else poLines.push({ productId, productName: product.name, qty, unitPrice });
  $('#po-unit-price').value = '';
  renderDraft();
}

export function removePOLine(index) {
  poLines.splice(index, 1);
  renderDraft();
}

function renderDraft() {
  const el = $('#po-draft');
  if (!el) return;
  if (!poLines.length) {
    el.textContent = 'Belum ada item. Tambahkan minimal satu item.';
    return;
  }
  const total = poLines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  el.innerHTML =
    poLines
      .map((l, i) => `${esc(l.productName)} × ${l.qty} @ Rp ${formatRupiah(l.unitPrice)} <a href="#" data-remove="${i}">hapus</a>`)
      .join('<br>') + `<br><strong>Total Rp ${formatRupiah(total)}</strong>`;
  el.querySelectorAll('[data-remove]').forEach((a) =>
    a.addEventListener('click', (ev) => {
      ev.preventDefault();
      removePOLine(Number(a.dataset.remove));
    })
  );
}

async function onPOSubmit(e) {
  e.preventDefault();
  if (!canBuy()) return showToast('Role Anda tidak boleh membuat PO', 'error');
  if (!poLines.length) return showToast('Tambahkan minimal satu item PO', 'warning');

  const payload = {
    supplierId: Number($('#po-supplier-id').value),
    items: poLines.map(({ productId, qty, unitPrice }) => ({ productId, qty, unitPrice })),
    idempotencyKey: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
  };
  try {
    const result = await apiPost('/purchase-orders', payload);
    showToast(result?.message || 'Purchase Order dibuat', 'success');
    poLines = [];
    purchaseOrders = await apiGet('/purchase-orders');
    renderPOTable();
    renderDraft();
  } catch (err) {
    showToast('Gagal membuat PO: ' + err.message, 'error');
  }
}

const poStatusLabel = (s) => ({ PENDING: 'Menunggu', APPROVED: 'Disetujui', RECEIVED: 'Diterima', CANCELLED: 'Dibatalkan', VOIDED: 'Void' }[String(s).toUpperCase()] || s);

function renderPOTable() {
  const tbody = $('.po-table tbody');
  if (!tbody) return;
  if (!purchaseOrders.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center">Purchase Order kosong</td></tr>';
    return;
  }
  tbody.innerHTML = purchaseOrders
    .map((po) => {
      const status = String(po.status).toUpperCase();
      const canGR = canReceive() && ['APPROVED', 'PENDING'].includes(status);
      return `<tr>
        <td>${esc(po.poNumber || '#' + po.id)}</td>
        <td>${esc(new Date(po.createdAt || po.poDate).toLocaleDateString('id-ID'))}</td>
        <td>${esc(po.supplierName || po.supplier?.name || '-')}</td>
        <td>${esc(poStatusLabel(po.status))}</td>
        <td>Rp ${formatRupiah(po.totalAmount)}</td>
        <td>
          <button class="btn btn-small btn-secondary" type="button" onclick="viewPODetail(${Number(po.id)})">Detail</button>
          ${canGR ? `<button class="btn btn-small" type="button" onclick="createGR(${Number(po.id)})">Terima Barang</button>` : ''}
        </td>
      </tr>`;
    })
    .join('');
}

export async function viewPODetail(poId) {
  try {
    const po = await apiGet(`/purchase-orders/${poId}`);
    const items = po.poItems || po.items || [];
    const rows = items
      .map(
        (i) => `<tr><td>${esc(i.productName || 'Produk #' + i.productId)}</td><td>${i.qtyOrdered ?? i.qty}</td><td>Rp ${formatRupiah(i.unitPrice)}</td><td>Rp ${formatRupiah((i.qtyOrdered ?? i.qty) * i.unitPrice)}</td></tr>`
      )
      .join('');
    const modal = $('#po-detail-modal') || document.getElementById('po-detail-modal');
    modal.innerHTML = `
      <div style="background:var(--color-surface,#fff);color:var(--color-text,#111);padding:1.5rem;border-radius:8px;min-width:320px;max-width:90vw;">
        <h3>Purchase Order ${esc(po.poNumber || '#' + po.id)}</h3>
        <p>Supplier: ${esc(po.supplierName || po.supplier?.name || '-')} · Status: ${esc(poStatusLabel(po.status))}</p>
        <table style="width:100%;margin-top:.75rem;"><thead><tr><th>Produk</th><th>Qty</th><th>Harga</th><th>Subtotal</th></tr></thead><tbody>${rows}</tbody></table>
        <p style="margin-top:.75rem;"><strong>Total: Rp ${formatRupiah(po.totalAmount)}</strong></p>
        <button class="btn btn-small" type="button" data-close="1">Tutup</button>
      </div>`;
    modal.style.display = 'flex';
  } catch (err) {
    showToast('Gagal memuat detail PO: ' + err.message, 'error');
  }
}

function closeDetail() {
  const modal = document.getElementById('po-detail-modal');
  if (modal) modal.style.display = 'none';
}

// === Goods Receipt ===

export async function createGR(poId) {
  if (!canReceive()) return showToast('Role Anda tidak boleh menerima barang', 'error');
  if (!confirm('Buat Goods Receipt untuk Purchase Order ini?')) return;
  try {
    const result = await apiPost('/goods-receipts', { purchaseOrderId: poId });
    showToast(result?.message || 'Goods Receipt dibuat (menunggu konfirmasi)', 'success');
    await loadProcurement();
  } catch (err) {
    showToast('Gagal membuat Goods Receipt: ' + err.message, 'error');
  }
}

const grStatusLabel = (s) => ({ PENDING: 'Menunggu konfirmasi', CONFIRMED: 'Dikonfirmasi', RETURNED: 'Diretur', PARTIAL: 'Sebagian' }[String(s).toUpperCase()] || s);

function renderGRTable() {
  const tbody = $('.gr-table tbody');
  if (!tbody) return;
  if (!goodsReceipts.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center">Goods Receipt kosong</td></tr>';
    return;
  }
  tbody.innerHTML = goodsReceipts
    .map((gr) => {
      const status = String(gr.status).toUpperCase();
      const actions = !canReceive()
        ? '-'
        : status === 'PENDING'
          ? `<button class="btn btn-small" type="button" onclick="confirmGR(${Number(gr.id)})">Konfirmasi</button>`
          : status === 'CONFIRMED'
            ? `<button class="btn btn-small btn-secondary" type="button" onclick="returnGR(${Number(gr.id)})">Retur</button>`
            : '-';
      return `<tr>
        <td>${esc(gr.grNumber || '#' + gr.id)}</td>
        <td>${esc(gr.poNumber || gr.purchaseOrderId)}</td>
        <td>${esc(new Date(gr.receivedAt || gr.receivedDate).toLocaleDateString('id-ID'))}</td>
        <td>${esc(grStatusLabel(gr.status))}</td>
        <td>${actions}</td>
      </tr>`;
    })
    .join('');
}

// Server yang menambah stok saat konfirmasi (satu transaksi atomik dengan jurnal).
export async function confirmGR(grId) {
  if (!canReceive()) return showToast('Role Anda tidak boleh konfirmasi penerimaan', 'error');
  if (!confirm('Konfirmasi penerimaan barang? Stok akan bertambah.')) return;
  try {
    const result = await apiPost(`/goods-receipts/${grId}/confirm`, {});
    showToast(result?.message || 'Barang diterima, stok diperbarui', 'success');
    window.dispatchEvent(new CustomEvent('rms:stock-updated'));
    await loadProcurement();
  } catch (err) {
    showToast('Gagal konfirmasi: ' + err.message, 'error');
  }
}

export async function returnGR(grId) {
  if (!canReceive()) return showToast('Role Anda tidak boleh meretur barang', 'error');
  const reason = prompt('Alasan retur barang:');
  if (!reason || !reason.trim()) return;
  try {
    const result = await apiPost(`/goods-receipts/${grId}/return`, { reason: reason.trim() });
    showToast(result?.message || 'Retur berhasil diajukan', 'info');
    window.dispatchEvent(new CustomEvent('rms:stock-updated'));
    await loadProcurement();
  } catch (err) {
    showToast('Gagal retur: ' + err.message, 'error');
  }
}
