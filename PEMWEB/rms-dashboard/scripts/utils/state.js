// ========================================
// State global RMS — dipakai bersama app.js dan semua modul
// ========================================

export const RMS_STATE = {
  currentMode: typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'online',
  cache: {
    products: [],
    stores: [],
    journals: [],
    events: [],
    kpi: null,
  },
  ui: {
    selectedTab: 'dashboard',
  },
};

// Ambil query di dalam section tab (id section-<tab>)
export function sectionQuery(tabId, selector) {
  return document.querySelector(`#section-${tabId} ${selector}`);
}

export function getCurrentStoreId() {
  return parseInt(localStorage.getItem('rms_current_store') || '1', 10);
}

export function getCurrentUserId() {
  try {
    const user = JSON.parse(localStorage.getItem('rms_user') || 'null');
    if (user?.id) return Number(user.id);
  } catch (_) { /* abaikan */ }
  return parseInt(localStorage.getItem('rms_user_id') || '1', 10);
}

// Escape teks sebelum dimasukkan ke innerHTML (cegah XSS dari data API)
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
