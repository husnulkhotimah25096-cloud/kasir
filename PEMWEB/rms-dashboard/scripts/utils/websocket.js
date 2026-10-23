// ========================================
// RMS — WebSocket Service untuk Real-Time Updates
// Menggunakan native WebSocket API dengan reconnection
// ========================================

// Connection state
let ws = null;
let reconnectTimeout = null;
let listeners = {
  stockUpdates: [],      // Product stock changes
  orderStatus: [],       // Order status changes
  paymentUpdates: [],    // Payment confirmation
  journalUpdates: []     // Journal entry changes
};

// Fungsi connect WebSocket
export function connectWS(baseUrl = 'ws://localhost:8000') {
  const url = `${baseUrl}/ws`;
  
  try {
    ws = new WebSocket(url);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      // Kirim subscribe pesan untuk setiap channel
      subscribeStock();
      subscribeOrders();
      subscribePayments();
      subscribeJournal();
    };
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      handleIncomingMessage(message);
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected, attempting reconnection...');
      startReconnect();
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  } catch (error) {
    console.error('WebSocket initialization error:', error);
    startReconnect();
  }
}

// --- Reconnection Logic ---

function startReconnect() {
  clearTimeout(reconnectTimeout);
  // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
  const delays = [1000, 2000, 4000, 8000, 15000, 30000];
  let attempt = 0;
  
  function attemptReconnect() {
    if (attempt < delays.length) {
      const delay = delays[attempt];
      console.log(`Retry WebSocket connection in ${delay}ms (attempt ${attempt + 1})`);
      reconnectTimeout = setTimeout(() => {
        attempt++;
        connectWS();
      }, delay);
    } else {
      console.warn('WebSocket max reconnection attempts reached');
      showToast('Koneksi real-time terputus, fallback ke polling', 'warning');
    }
  }
  
  attemptReconnect();
}

// --- Channel Subscriptions ---

function subscribeStock() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'stock-updates'
  }));
}

function subscribeOrders() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'order-status'
  }));
}

function subscribePayments() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'payment-updates'
  }));
}

function subscribeJournal() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'journal-updates'
  }));
}

// --- Message Handler ---

function handleIncomingMessage(message) {
  const { type, channel, payload } = message;
  
  switch (type) {
    case 'stock-update':
      listeners.stockUpdates.forEach(cb => cb(payload));
      break;
    case 'order-status':
      listeners.orderStatus.forEach(cb => cb(payload));
      break;
    case 'payment-confirmation':
      listeners.paymentUpdates.forEach(cb => cb(payload));
      break;
    case 'journal-entry':
      listeners.journalUpdates.forEach(cb => cb(payload));
      break;
    default:
      console.log('Unknown WebSocket message type:', type);
  }
}

// --- Public API: Event Listener Registration ---

export function onStockUpdate(callback) {
  listeners.stockUpdates.push(callback);
  // Jika sudah connected, registrasikan langsung
  if (ws && ws.readyState === WebSocket.OPEN) {
    subscribeStock();
  }
}

export function onOrderStatus(callback) {
  listeners.orderStatus.push(callback);
  if (ws && ws.readyState === WebSocket.OPEN) {
    subscribeOrders();
  }
}

export function onPaymentUpdate(callback) {
  listeners.paymentUpdates.push(callback);
  if (ws && ws.readyState === WebSocket.OPEN) {
    subscribePayments();
  }
}

export function onJournalUpdate(callback) {
  listeners.journalUpdates.push(callback);
  if (ws && ws.readyState === WebSocket.OPEN) {
    subscribeJournal();
  }
}

// --- Helper: Toast ---

function showToast(message, type = 'info') {
  // Cek apakah toast container sudah ada
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
  
  const colors = { info: '#3b82f6', success: '#10b981', warning: '#f59e0b', error: '#ef4444' };
  const bgColor = colors[type] || colors.info;
  
  const toast = document.createElement('div');
  toast.style.background = `rgba(${bgColor.replace('#','')}, 0.9)`;
  toast.style.color = 'white';
  toast.style.padding = '0.5rem 1rem';
  toast.style.borderRadius = '6px';
  toast.style.marginBottom = '0.5rem';
  toast.style.fontSize = '0.875rem';
  toast.textContent = message;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// --- Auto-connect saat modul dimuat ---

// Export function untuk dipanggil dari app.js
export function initWebSocket(baseUrl = 'ws://localhost:8000') {
  connectWS(baseUrl);
  // Auto-subscribe setelah connect
  setTimeout(() => {
    subscribeStock();
    subscribeOrders();
    subscribePayments();
    subscribeJournal();
  }, 1000);
}