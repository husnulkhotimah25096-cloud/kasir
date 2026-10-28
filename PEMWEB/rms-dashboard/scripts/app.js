// ========================================
// RMS — Single Page Application Router
// Shell aplikasi: tab, tema, dashboard, WebSocket, online/offline.
// Logika tiap tab ada di scripts/modules/*.js
// ========================================

import { persistTheme, loadTheme, debounce } from './utils/idb.js';
import { getUser } from './utils/auth.js';
import {
  setAuthToken,
  fetchDashboardKPI,
  fetchSalesTrend,
  fetchTopProducts
} from './utils/api.js';
import {
  initWebSocket,
  onStockUpdate,
  onOrderStatus,
  onPaymentUpdate,
  onJournalUpdate
} from './utils/websocket.js';
import { showToast, formatRupiah } from './utils/ui.js';
import { RMS_STATE, getCurrentStoreId } from './utils/state.js';
import * as POS from './modules/pos.js';
import * as Inventory from './modules/inventory.js';
import * as Finance from './modules/finance.js';
import * as Procurement from './modules/procurement.js';
import * as EventLogs from './modules/event-logs.js';
import { showLogin, setupAccountMenu } from './modules/login.js';
import { logout } from './utils/auth.js';

let currentTab = 'dashboard';
let currentTheme = loadTheme();

// --- Helper ---

function getThemeColors() {
  const dark = currentTheme === 'dark';
  return {
    text: dark ? '#f1f5f9' : '#1e293b',
    tooltipBg: dark ? '#1e293b' : '#f8fafc',
    grid: dark ? '#334155' : '#e2e8f0'
  };
}

// Canvas Chart.js tidak mengerti var(--css); ambil nilai aslinya.
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function toggleTheme() {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', currentTheme);
  persistTheme(currentTheme);

  const themeToggle = document.querySelector('button[data-action="theme-toggle"]');
  if (themeToggle) {
    themeToggle.textContent = currentTheme === 'light' ? '🌙' : '☀️';
  }
}

function setupTabNavigation() {
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchTab(btn.getAttribute('data-tab'), btn);
    });
  });
}

function switchTab(tabId, clickedBtn) {
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));
  if (clickedBtn) clickedBtn.classList.add('active');

  currentTab = tabId;
  RMS_STATE.ui.selectedTab = tabId;

  renderTabContent(tabId);
  fetchTabData(tabId);
}

function renderTabContent(tabId) {
  const contentDiv = document.querySelector('.content');
  if (!contentDiv) return;

  document.querySelectorAll('.tab-section').forEach((s) => s.classList.add('hidden'));

  const selectedSection = document.getElementById(`section-${tabId}`);
  if (selectedSection) {
    selectedSection.classList.remove('hidden');
  }

  const titleMap = {
    dashboard: 'Dashboard Analitik',
    pos: 'Aplikasi Kasir (POS)',
    inventory: 'Manajemen Stok & Opname',
    finance: 'Keuangan & Audit Log',
    procurement: 'Procurement (Barang Masuk)',
    eventlogs: 'Event Queue Simulator'
  };

  const titleElem = document.querySelector('.page-title');
  if (titleElem) {
    titleElem.textContent = titleMap[tabId] || 'RMS';
  }
}

function setupPeriodFilter() {
  const periodSelect = document.getElementById('period-filter');
  if (!periodSelect) return;

  periodSelect.addEventListener(
    'change',
    debounce(async (e) => {
      localStorage.setItem('rms_period', e.target.value);
      // Reload data tab yang aktif
      await fetchTabData(currentTab);
    }, 300)
  );
}

function renderKPICards(data) {
  const kpiGrid = document.querySelector('.kpi-grid');
  if (!kpiGrid) return;

  // Pakai ?? supaya nilai 0 tidak ikut tertimpa dummy
  const kpi = {
    totalOmzet: data?.totalOmzet ?? 125000000,
    margin: data?.margin ?? 18.5,
    stokWarning: data?.stokWarning ?? 4,
    transaksiPending: data?.transaksiPending ?? 12
  };

  kpiGrid.innerHTML = `
    <div class="kpi-card">
      <div class="kpi-value" id="kpi-total-omzet">Rp ${formatRupiah(kpi.totalOmzet)}</div>
      <div class="kpi-label">Total Omzet</div>
      <div class="kpi-icon">💰</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value" id="kpi-margin">${kpi.margin}%</div>
      <div class="kpi-label">Margin Rata-rata</div>
      <div class="kpi-icon">📊</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value" id="kpi-stok-warning">${kpi.stokWarning}</div>
      <div class="kpi-label">Stok Warning</div>
      <div class="kpi-icon">⚠️</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-value" id="kpi-transaksi-pending">${kpi.transaksiPending}</div>
      <div class="kpi-label">Transaksi Pending/Sync</div>
      <div class="kpi-icon">📥</div>
    </div>
  `;
}

function renderSalesChart(data) {
  const ctx = document.getElementById('sales-trend-chart');
  if (!ctx || typeof Chart === 'undefined') return;

  if (window.salesChart) window.salesChart.destroy();

  const labels = data?.labels || ['Hari Ini', 'Kemarin', '2Hn', '3Hn', '4Hn', '5Hn'];
  const values = data?.values || [150000, 200000, 180000, 220000, 190000, 250000];
  const c = getThemeColors();

  window.salesChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Omzet Harian',
          data: values,
          borderColor: cssVar('--color-primary', '#4f46e5'),
          backgroundColor: 'rgba(79, 70, 229, 0.1)',
          tension: 0.3,
          fill: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: c.text } },
        tooltip: { backgroundColor: c.tooltipBg, titleColor: c.text, bodyColor: c.text }
      },
      scales: {
        x: { ticks: { color: c.text }, grid: { color: c.grid } },
        y: { ticks: { color: c.text }, grid: { color: c.grid } }
      }
    }
  });
}

function renderTopProductsChart(data) {
  const ctx = document.getElementById('top-products-chart');
  if (!ctx || typeof Chart === 'undefined') return;

  if (window.topProductsChart) window.topProductsChart.destroy();

  const products = data?.products || [
    { name: 'Produk A', sold: 150, revenue: 750000 },
    { name: 'Produk B', sold: 120, revenue: 600000 },
    { name: 'Produk C', sold: 95, revenue: 475000 },
    { name: 'Produk D', sold: 78, revenue: 390000 }
  ];
  const c = getThemeColors();

  window.topProductsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: products.map((p) => p.name),
      datasets: [
        {
          label: 'Top Selling',
          data: products.map((p) => p.sold),
          backgroundColor: cssVar('--color-primary', '#4f46e5')
        },
        {
          label: 'Revenue',
          data: products.map((p) => p.revenue),
          backgroundColor: cssVar('--color-success', '#16a34a'),
          yAxisID: 'revenue'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: c.text } } },
      scales: {
        x: { ticks: { color: c.text }, grid: { color: c.grid } },
        y: { ticks: { color: c.text }, grid: { color: c.grid } },
        revenue: {
          type: 'linear',
          position: 'right',
          ticks: { color: c.text },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

// --- Data per Tab ---

const TAB_LOADERS = {
  dashboard: loadDashboardData,
  pos: POS.loadPOS,
  inventory: Inventory.loadInventory,
  finance: Finance.loadFinance,
  procurement: Procurement.loadProcurement,
  eventlogs: EventLogs.loadEventLogs
};

async function fetchTabData(tabId) {
  if (tabId !== 'eventlogs') EventLogs.stopEventLogs();
  const loader = TAB_LOADERS[tabId];
  if (!loader) return;
  try {
    await loader();
  } catch (err) {
    console.error(`Gagal memuat tab ${tabId}:`, err);
    showToast(`Gagal memuat data ${tabId}`, 'warning');
  }
}

async function loadDashboardData() {
  const period = localStorage.getItem('rms_period') || '30d';
  const storeId = getCurrentStoreId();
  try {
    const [kpi, salesTrend, topProducts] = await Promise.all([
      fetchDashboardKPI(storeId, period),
      fetchSalesTrend(storeId, period),
      fetchTopProducts(storeId, 10, period)
    ]);
    RMS_STATE.cache.kpi = kpi;
    renderKPICards(kpi);
    renderSalesChart(salesTrend);
    renderTopProductsChart(topProducts);
  } catch (err) {
    console.error('Gagal load dashboard data:', err);
    renderKPICards(RMS_STATE.cache.kpi || {});
    showToast('Gagal memuat data dashboard', 'warning');
  }
}

// --- Online/Offline ---

function setupOnlineOfflineHandling() {
  window.addEventListener('online', () => {
    RMS_STATE.currentMode = 'online';
    showToast('Kembali online, menyinkronkan transaksi...', 'info');
    POS.syncOfflineQueue();
  });

  window.addEventListener('offline', () => {
    RMS_STATE.currentMode = 'offline';
    showToast('Mode offline - transaksi disimpan secara lokal', 'info');
  });
}

// --- Real-Time UI Updates (WebSocket) ---

function updateOrderUI(payload) {
  const orderRow = document.querySelector(`[data-order-id="${payload.orderId}"]`);
  const statusCell = orderRow?.querySelector('.order-status');
  if (statusCell) statusCell.textContent = String(payload.status).toUpperCase();
  showToast(`Order #${payload.orderId} status: ${payload.status}`, 'info');
  EventLogs.pushEvent({ type: 'order.status', payload });
}

function updatePaymentUI(payload) {
  showToast(`Pembayaran #${payload.paymentId}: ${payload.status} - Rp ${formatRupiah(payload.amount)}`, 'success');
  EventLogs.pushEvent({ type: 'payment.confirmed', payload });
}

function updateStockUI(payload) {
  Inventory.updateStockUI(payload);
  POS.updatePOSStock(payload);
  EventLogs.pushEvent({ type: 'stock.adjusted', payload });
}

function updateJournalUI(payload) {
  showToast('Jurnal terupdate', 'info');
  Finance.updateJournalUI();
  EventLogs.pushEvent({ type: 'journal.posted', payload });
}

// --- Inisialisasi ---

function startSession(user) {
  setAuthToken(user.token || '');
  setupAccountMenu();

  initWebSocket(window.RMS_CONFIG?.wsUrl || 'ws://localhost:8000');
  onStockUpdate(updateStockUI);
  onOrderStatus(updateOrderUI);
  onPaymentUpdate(updatePaymentUI);
  onJournalUpdate(updateJournalUI);

  if (navigator.onLine) POS.syncOfflineQueue();
  fetchTabData(currentTab);
}

// Sesi habis (token ditolak server dengan 401): keluar lalu kembali ke login
let sessionExpiredHandled = false;
window.addEventListener('rms:session-expired', () => {
  if (sessionExpiredHandled) return; // beberapa request bisa gagal bersamaan
  sessionExpiredHandled = true;
  logout();
  showToast('Sesi habis, silakan login lagi', 'info');
  setTimeout(() => location.reload(), 1200);
});

document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.querySelector('button[data-action="theme-toggle"]');

  currentTheme = loadTheme();
  document.documentElement.setAttribute('data-theme', currentTheme);
  if (themeToggle) {
    themeToggle.textContent = currentTheme === 'light' ? '🌙' : '☀️';
    themeToggle.addEventListener('click', toggleTheme);
  }

  setupTabNavigation();
  setupOnlineOfflineHandling();
  setupPeriodFilter();
  renderTabContent(currentTab);

  const user = getUser();
  if (user) {
    startSession(user);
  } else {
    showLogin((loggedIn) => startSession(loggedIn));
  }
});

// --- Ekspos ke window ---
// File ini ES Module, jadi fungsi TIDAK otomatis global.
// Tombol dengan onclick="..." di HTML hasil render butuh ini.
Object.assign(window, {
  showToast,
  // POS
  addToCart: POS.addToCart,
  removeFromCart: POS.removeFromCart,
  changeQty: POS.changeQty,
  applySplitPayment: POS.applySplitPayment,
  processSaleTransaction: POS.processSaleTransaction,
  printReceipt: POS.printReceipt,
  // Inventory
  openOpnameModal: Inventory.openOpnameModal,
  transferStock: Inventory.transferStock,
  adjustStock: Inventory.adjustStock,
  decreaseStock: Inventory.decreaseStock,
  // Finance
  voidEntry: Finance.voidEntry,
  // Procurement
  createPO: Procurement.createPO,
  viewPODetail: Procurement.viewPODetail,
  createGR: Procurement.createGR,
  confirmGR: Procurement.confirmGR,
  returnGR: Procurement.returnGR
});
