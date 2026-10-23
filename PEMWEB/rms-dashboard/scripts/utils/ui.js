// ========================================
// UI Helpers — dipakai bersama oleh semua modul
// (showToast, formatRupiah)
// ========================================

const TOAST_COLORS = {
  success: '#10b981',
  error: '#ef4444',
  info: '#3b82f6',
  warning: '#f59e0b'
};

// Format angka ke format Rupiah Indonesia (tanpa prefix "Rp")
export function formatRupiah(amount) {
  return Number(amount || 0).toLocaleString('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

function getToastContainer() {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    container.style.position = 'fixed';
    container.style.bottom = '1rem';
    container.style.left = '50%';
    container.style.transform = 'translateX(-50%)';
    container.style.zIndex = '9999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '0.5rem';
    document.body.appendChild(container);
  }
  return container;
}

// Tampilkan notifikasi singkat; hilang otomatis setelah 4 detik
export function showToast(message, type = 'info') {
  const container = getToastContainer();
  const toast = document.createElement('div');
  toast.style.background = TOAST_COLORS[type] || TOAST_COLORS.info;
  toast.style.color = 'white';
  toast.style.padding = '0.5rem 1rem';
  toast.style.borderRadius = '6px';
  toast.style.fontSize = '0.875rem';
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
