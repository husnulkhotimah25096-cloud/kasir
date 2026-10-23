// ========================================
// RMS — Modul Keuangan & Audit Log
// Fitur: Jurnal Umum (double-entry), filter akun, void via contra entry,
//        indikator keseimbangan debit/kredit, cache offline jurnal
// ========================================

import { cacheJournals, getCachedJournals } from '../utils/idb.js';
import { fetchJournalEntries, fetchAccounts, apiPost } from '../utils/api.js';
import { hasRole } from '../utils/auth.js';
import { showToast, formatRupiah } from '../utils/ui.js';
import { RMS_STATE, sectionQuery, esc } from '../utils/state.js';

let journalCache = [];
let accountsLoaded = false;
let initialized = false;
let selectedAccountId = '';

// === Inisialisasi ===

export function initFinance() {
  if (initialized) return;
  initialized = true;

  const section = document.getElementById('section-finance');
  if (!section || section.querySelector('#finance-account-filter')) return;

  const bar = document.createElement('div');
  bar.style.cssText = 'margin-bottom:1rem;display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;';
  bar.innerHTML = `
    <label for="finance-account-filter">Akun:</label>
    <select id="finance-account-filter"><option value="">Semua Akun</option></select>
    <span id="finance-summary" class="text-muted"></span>`;
  section.insertBefore(bar, section.firstChild);
  bar.querySelector('select').addEventListener('change', (e) => {
    selectedAccountId = e.target.value;
    loadFinance();
  });
}

export async function loadFinance() {
  initFinance();

  if (!hasRole('owner', 'admin', 'finance')) {
    const tbody = sectionQuery('finance', '.journal-table tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center">Akses ditolak. Dibutuhkan role owner, admin, atau finance.</td></tr>';
    return;
  }

  try {
    journalCache = await fetchJournalEntries(selectedAccountId ? { accountId: selectedAccountId } : {});
    if (!selectedAccountId) cacheJournals(journalCache).catch(() => {});
  } catch (err) {
    console.warn('Finance: API gagal, pakai cache:', err.message);
    journalCache = RMS_STATE.cache.journals.length ? RMS_STATE.cache.journals : await getCachedJournals().catch(() => []);
    showToast('Menampilkan jurnal dari cache (offline)', 'info');
  }
  RMS_STATE.cache.journals = journalCache;
  renderJournalTable(journalCache);
  loadAccountFilter();
}

// === Filter Akun ===

async function loadAccountFilter() {
  if (accountsLoaded) return;
  const select = document.getElementById('finance-account-filter');
  if (!select) return;
  try {
    const accounts = await fetchAccounts();
    select.innerHTML =
      '<option value="">Semua Akun</option>' +
      accounts.map((a) => `<option value="${esc(a.id)}">${esc(a.code)} - ${esc(a.name)}</option>`).join('');
    select.value = selectedAccountId;
    accountsLoaded = true;
  } catch (err) {
    console.warn('Gagal memuat akun:', err.message);
  }
}

// === Tabel Jurnal ===

export function isEntryBalanced(j) {
  if (typeof j.isBalanced === 'boolean') return j.isBalanced;
  return Number(j.totalDebit) === Number(j.totalCredit);
}

export function renderJournalTable(journals = []) {
  const tbody = sectionQuery('finance', '.journal-table tbody');
  if (!tbody) return;

  if (!journals.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Tidak ada jurnal</td></tr>';
    updateSummary([]);
    return;
  }

  const canVoid = hasRole('owner', 'admin', 'finance');
  tbody.innerHTML = journals
    .map((j) => {
      const date = new Date(j.entryDate || j.postedAt);
      const voided = String(j.status || '').toUpperCase() === 'VOIDED' || String(j.status || '').toUpperCase() === 'CANCELLED';
      const status = voided ? '🚫 Void' : isEntryBalanced(j) ? '✅ Balanced' : '❌ Unbalanced';
      const action = voided || !canVoid
        ? '-'
        : `<button class="btn btn-small btn-secondary" type="button" onclick="voidEntry(${Number(j.id)})">Void</button>`;
      return `
    <tr${voided ? ' style="opacity:.6"' : ''}>
      <td>${Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('id-ID')}</td>
      <td>${esc(j.reference || j.referenceType || '-')}</td>
      <td>${esc(j.description || '-')}</td>
      <td>Rp ${formatRupiah(j.totalDebit)}</td>
      <td>Rp ${formatRupiah(j.totalCredit)}</td>
      <td>${status}</td>
      <td>${action}</td>
    </tr>`;
    })
    .join('');
  updateSummary(journals);
}

function updateSummary(journals) {
  const el = document.getElementById('finance-summary');
  if (!el) return;
  const active = journals.filter((j) => !['VOIDED', 'CANCELLED'].includes(String(j.status || '').toUpperCase()));
  const debit = active.reduce((s, j) => s + Number(j.totalDebit || 0), 0);
  const credit = active.reduce((s, j) => s + Number(j.totalCredit || 0), 0);
  el.textContent = journals.length
    ? `Total debit Rp ${formatRupiah(debit)} · kredit Rp ${formatRupiah(credit)} ${debit === credit ? '(seimbang)' : '(TIDAK seimbang)'}`
    : '';
}

// === Void Jurnal (membuat reversal/contra entry) ===

export async function voidEntry(journalId) {
  if (!hasRole('owner', 'admin', 'finance')) {
    showToast('Role Anda tidak boleh void jurnal', 'error');
    return;
  }
  const reason = prompt('Alasan void jurnal (wajib, tercatat di audit log):');
  if (!reason || !reason.trim()) return;
  if (!confirm('Void akan membuat reversal entry dan tidak bisa dibatalkan. Lanjutkan?')) return;

  try {
    const result = await apiPost(`/journal-entries/${journalId}/void`, { reason: reason.trim() });
    showToast(result?.message || 'Jurnal di-void, reversal entry dibuat', 'success');
    await loadFinance();
  } catch (err) {
    showToast('Gagal void jurnal: ' + err.message, 'error');
  }
}

// Pembaruan realtime dari WebSocket
export function updateJournalUI() {
  if (document.getElementById('section-finance')?.classList.contains('hidden') === false) {
    loadFinance();
  }
}
