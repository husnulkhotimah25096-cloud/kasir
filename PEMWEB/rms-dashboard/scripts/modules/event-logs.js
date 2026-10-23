// ========================================
// RMS — Modul Event Queue Simulator
// Fitur: Panel log transparan menampilkan JSON event payload
//        (sale.completed, stock.adjusted, payment.confirmed),
//        auto-refresh saat tab aktif, event realtime dari WebSocket
// ========================================

import { apiGet } from '../utils/api.js';
import { hasRole } from '../utils/auth.js';
import { RMS_STATE, sectionQuery, esc } from '../utils/state.js';

const REFRESH_MS = 2000;
const MAX_EVENTS = 200;

let timer = null;
let initialized = false;

export function initEventLogs() {
  initialized = true;
}

// Mulai auto-refresh (dipanggil saat tab dibuka)
export async function loadEventLogs() {
  if (!initialized) initEventLogs();
  const container = sectionQuery('eventlogs', '.log-container');
  if (!container) return;

  if (!hasRole('owner', 'admin')) {
    container.innerHTML = '<p class="text-muted">Akses terbatas: hanya owner dan admin.</p>';
    return;
  }

  await refreshEventLogs();
  stopEventLogs();
  timer = setInterval(() => {
    // Hentikan polling bila tab sudah tidak terlihat
    const section = document.getElementById('section-eventlogs');
    if (!section || section.classList.contains('hidden') || document.hidden) return;
    refreshEventLogs();
  }, REFRESH_MS);
}

export function stopEventLogs() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function refreshEventLogs() {
  try {
    const events = await apiGet('/event-logs/simulator');
    RMS_STATE.cache.events = events.slice(-MAX_EVENTS);
    renderEventLogTable(RMS_STATE.cache.events);
  } catch (err) {
    console.warn('Gagal refresh event logs:', err.message);
    renderEventLogTable(RMS_STATE.cache.events);
  }
}

// Tambah event dari WebSocket tanpa menunggu polling berikutnya
export function pushEvent(event) {
  RMS_STATE.cache.events.push({ createdAt: new Date().toISOString(), ...event });
  RMS_STATE.cache.events = RMS_STATE.cache.events.slice(-MAX_EVENTS);
  renderEventLogTable(RMS_STATE.cache.events);
}

export function renderEventLogTable(events = []) {
  const container = sectionQuery('eventlogs', '.log-container');
  if (!container) return;

  if (!events.length) {
    container.innerHTML = '<p class="text-muted">Tidak ada event di queue</p>';
    return;
  }

  container.innerHTML = events
    .map((e) => {
      const type = String(e.type || 'unknown');
      const time = e.createdAt ? new Date(e.createdAt).toLocaleTimeString('id-ID') : '-';
      const typeClass = type.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      return `
      <div class="log-entry">
        <span class="log-timestamp">${esc(time)}</span>
        <span class="log-type ${esc(typeClass)}">${esc(type.toUpperCase().replace('.', ' / '))}</span>
        ${e.status ? `<span class="log-status">${esc(e.status)}</span>` : ''}
        <pre class="log-payload">${esc(JSON.stringify(e.payload, null, 2))}</pre>
      </div>`;
    })
    .join('');

  const parent = container.parentNode;
  if (parent) parent.scrollTop = parent.scrollHeight;
}
