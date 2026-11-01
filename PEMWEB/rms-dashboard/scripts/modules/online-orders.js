// ========================================
// RMS — Modul Pesanan Online
// Staf melihat pesanan dari toko online, menandai lunas, mengubah status, dan membatalkan
// ========================================

import { apiGet, apiPost } from '../utils/api.js';
import { hasRole } from '../utils/auth.js';
import { esc } from '../utils/state.js';
import { showToast } from '../utils/ui.js';

const STATUS = { PENDING: 'Menunggu konfirmasi', CONFIRMED: 'Dikonfirmasi', PREPARING: 'Disiapkan', READY: 'Siap', COMPLETED: 'Selesai', CANCELLED: 'Dibatalkan' };
const PAYST = { PENDING: 'Belum dibayar', PAID: 'Lunas', FAILED: 'Gagal', REFUNDED: 'Dikembalikan', PARTIALLY_REFUNDED: 'Dikembalikan sebagian' };
const METHOD = { CASH: 'Tunai / COD', TRANSFER: 'Transfer', QRIS: 'QRIS' };
const NEXT = { PENDING: ['CONFIRMED', 'Konfirmasi'], CONFIRMED: ['PREPARING', 'Siapkan'], PREPARING: ['READY', 'Tandai siap'], READY: ['COMPLETED', 'Selesaikan'] };
const rupiah = (n) => 'Rp ' + new Intl.NumberFormat('id-ID').format(n);
const REFRESH_MS = 5000;

let timer = null;
const sec = () => document.getElementById('section-onlineorders');
const isVisible = () => { const s = sec(); return s && !s.classList.contains('hidden') && !document.hidden; };

export function initOnlineOrders() {
  if (sec()) return;
  const anchor = [...document.querySelectorAll('.tab-section')].pop();
  const btn = document.querySelector('.tab-btn[data-tab="onlineorders"]');
  if (!anchor || !btn) return;

  const s = document.createElement('section');
  s.id = 'section-onlineorders';
  s.className = 'tab-section hidden';
  s.innerHTML = `
    <div style="display:flex;gap:.6rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap;">
      <select id="oo-filter" class="input" style="padding:.5rem .7rem;border-radius:8px;">
        <option value="">Semua status</option>
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
      </select>
      <button type="button" id="oo-reload" class="btn btn-small btn-secondary">Muat ulang</button>
    </div>
    <div id="oo-list"></div>`;
  anchor.after(s);

  s.querySelector('#oo-filter').addEventListener('change', refresh);
  s.querySelector('#oo-reload').addEventListener('click', refresh);
  s.querySelector('#oo-list').addEventListener('click', onAction);

  btn.addEventListener('click', () => {
    const title = document.querySelector('.page-title');
    if (title) title.textContent = 'Pesanan Online';
    refresh();
    clearInterval(timer);
    timer = setInterval(() => { if (isVisible()) refresh(); }, REFRESH_MS);
  });
}

async function refresh() {
  const list = document.getElementById('oo-list');
  if (!list) return;
  if (!hasRole('owner', 'admin', 'kasir')) {
    list.innerHTML = '<p class="text-muted">Akses terbatas: hanya owner, admin, dan kasir.</p>';
    return;
  }
  const status = document.getElementById('oo-filter').value;
  try {
    render(await apiGet('/online-orders', status ? { status } : {}));
  } catch (e) {
    list.innerHTML = `<p class="text-muted">Gagal memuat pesanan: ${esc(e.message)}</p>`;
  }
}

function render(orders) {
  const list = document.getElementById('oo-list');
  if (!orders.length) { list.innerHTML = '<p class="text-muted">Belum ada pesanan online.</p>'; return; }

  list.innerHTML = orders.map((o) => {
    const next = NEXT[o.status];
    const canPay = o.paymentStatus === 'PENDING' && o.status !== 'CANCELLED';
    const canCancel = !['COMPLETED', 'CANCELLED'].includes(o.status) && o.paymentStatus === 'PENDING';
    const items = o.items.map((i) => `${esc(i.name)} × ${i.qty}`).join(', ');
    return `
    <div style="border:1px solid rgba(236,72,153,.35);background:rgba(127,127,127,.08);border-radius:12px;padding:.9rem;margin-bottom:.75rem;">
      <div style="display:flex;justify-content:space-between;gap:.5rem;flex-wrap:wrap;">
        <strong style="font-family:monospace;word-break:break-all;">${esc(o.orderNumber)}</strong>
        <span>${esc(new Date(o.createdAt).toLocaleString('id-ID'))}</span>
      </div>
      <div style="margin:.4rem 0;">
        <span style="font-weight:700;">${esc(STATUS[o.status] || o.status)}</span> ·
        <span>${esc(PAYST[o.paymentStatus] || o.paymentStatus)}</span> ·
        <span>${esc(METHOD[o.paymentMethod] || o.paymentMethod || '-')}</span>
      </div>
      <div>${esc(o.customerName || '-')} · ${esc(o.customerPhone || '-')}</div>
      <div style="opacity:.85;margin:.3rem 0;">${esc(o.notes)}</div>
      <div style="opacity:.85;">${items}</div>
      <div style="font-weight:800;margin:.4rem 0;">${rupiah(o.total)}</div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
        ${canPay ? `<button type="button" class="btn btn-small" data-act="pay" data-id="${o.id}">Tandai lunas</button>` : ''}
        ${next ? `<button type="button" class="btn btn-small btn-secondary" data-act="status" data-to="${next[0]}" data-id="${o.id}">${esc(next[1])}</button>` : ''}
        ${canCancel ? `<button type="button" class="btn btn-small btn-secondary" data-act="cancel" data-id="${o.id}">Batalkan</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function onAction(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const { act, id, to } = b.dataset;
  if (act === 'cancel' && !confirm('Batalkan pesanan ini? Stok akan dikembalikan.')) return;
  b.disabled = true;
  try {
    if (act === 'pay') await apiPost(`/online-orders/${id}/pay`);
    else if (act === 'status') await apiPost(`/online-orders/${id}/status`, { status: to });
    else if (act === 'cancel') await apiPost(`/online-orders/${id}/cancel`);
    showToast('Pesanan diperbarui', 'info');
  } catch (err) {
    showToast(err.message, 'error');
  }
  refresh();
}