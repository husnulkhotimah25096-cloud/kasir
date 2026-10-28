// ========================================
// API Client untuk FastAPI RMS Backend
// Menggunakan Fetch API dengan JWT interceptor
// ========================================

// Base URL - akan diganti sesuai environment
const BASE_URL = globalThis.RMS_CONFIG?.apiBase || 'http://localhost:8000/api/v1';

// Simple auth state
let currentToken = null;
let tokenExpiry = null;

// Set JWT token (dari login response)
export function setAuthToken(token) {
  currentToken = token;
  tokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 jam
  localStorage.setItem('rms_token', token);
  localStorage.setItem('rms_token_expiry', tokenExpiry);
}

// Get auth token, refresh jika expired
export async function getAuthToken() {
  if (currentToken && Date.now() < tokenExpiry) {
    return currentToken;
  }
  
  const stored = localStorage.getItem('rms_token');
  const expiry = localStorage.getItem('rms_token_expiry');
  
  if (stored && expiry && Date.now() < parseInt(expiry)) {
    currentToken = stored;
    tokenExpiry = parseInt(expiry);
    return currentToken;
  }
  
  // TODO: Refresh token flow
  currentToken = null;
  tokenExpiry = null;
  return null;
}

// Hapus token (saat logout)
export function clearAuthToken() {
  currentToken = null;
  tokenExpiry = null;
  localStorage.removeItem('rms_token');
  localStorage.removeItem('rms_token_expiry');
}

// Header interceptor
async function fetchOptions(bodyOrUndefined) {
  const headers = {
    'Content-Type': 'application/json',
  };
  
  const token = await getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const options = { method: 'POST', headers };
  if (bodyOrUndefined !== undefined) {
    options.body = JSON.stringify(bodyOrUndefined);
  }
  return options;
}

async function fetchOptionsGet() {
  const headers = {
    'Content-Type': 'application/json',
  };
  const token = await getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return { method: 'GET', headers };
}

// --- Core API Methods ---

export async function apiGet(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, String(value));
  });
  
  const response = await fetch(url, await fetchOptionsGet());
  return handleResponse(response);
}

export async function apiPost(endpoint, body) {
  const response = await fetch(`${BASE_URL}${endpoint}`, await fetchOptions(body));
  return handleResponse(response);
}

export async function apiPut(endpoint, body) {
  const options = await fetchOptions(body);
  options.method = 'PUT';
  const response = await fetch(`${BASE_URL}${endpoint}`, options);
  return handleResponse(response);
}

export async function apiDelete(endpoint, id) {
  const response = await fetch(`${BASE_URL}${endpoint}/${id}`, { ...(await fetchOptionsGet()), method: 'DELETE' });
  return handleResponse(response);
}

// --- Specific RMS Endpoints ---

// Products
export async function fetchProducts(storeId = null) {
  let endpoint = '/products';
  if (storeId) {
    endpoint += `?storeId=${storeId}`;
  }
  return apiGet(endpoint);
}

export async function fetchProductDetail(productId) {
  return apiGet(`/products/${productId}`);
}

// Stores
export async function fetchStores() {
  return apiGet('/stores');
}

// Orders / Sales
export async function createOrder(orderData) {
  return apiPost('/orders', orderData);
}

export async function getOrder(orderId) {
  return apiGet(`/orders/${orderId}`);
}

export async function syncBatchSales(sales) {
  return apiPost('/sales/sync-batch', { sales });
}

// Sale Transaction
export async function createSaleTransaction(saleData) {
  return apiPost('/sales', saleData);
}

export async function voidSaleTransaction(transactionId) {
  return apiPost(`/sales/${transactionId}/void`);
}

// Stock
export async function updateStock(productId, warehouseId, delta, currentVersion) {
  return apiPut(`/stock/${productId}/${warehouseId}`, {
    delta, // positif = masukin, negatif = keluarkan
    currentVersion,
  });
}

export async function getStockLevel(productId, warehouseId) {
  return apiGet(`/stock/${productId}/${warehouseId}`);
}

// Finance / Journal
export async function fetchJournalEntries(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  return apiGet(`/journal-entries?${params}`);
}

export async function createJournalEntry(entryData) {
  return apiPost('/journal-entries', entryData);
}

// Accounts
export async function fetchAccounts() {
  return apiGet('/accounts');
}

// Suppliers
export async function fetchSuppliers() {
  return apiGet('/suppliers');
}

// Purchase Orders
export async function createPurchaseOrder(poData) {
  return apiPost('/purchase-orders', poData);
}

export async function getPurchaseOrder(poId) {
  return apiGet(`/purchase-orders/${poId}`);
}

// Analytics/Dashboard
export async function fetchDashboardKPI(storeId, period = '30d') {
  return apiGet(`/dashboard/kpi?storeId=${storeId}&period=${period}`);
}

export async function fetchSalesTrend(storeId, period = '30d') {
  return apiGet(`/dashboard/sales-trend?storeId=${storeId}&period=${period}`);
}

export async function fetchTopProducts(storeId, limit = 10, period = '30d') {
  return apiGet(`/dashboard/top-products?storeId=${storeId}&limit=${limit}&period=${period}`);
}

// Audit Log
export async function fetchAuditLogs(filters = {}) {
  const params = new URLSearchParams(filters).toString();
  return apiGet(`/audit-logs?${params}`);
}

// Webhook Idempotency Check
export async function checkIdempotency(key) {
  return apiPost('/idempotency/check', { key });
}

// Health check
export async function healthCheck() {
  return apiGet('/health');
}

// Response handler
async function handleResponse(response) {
  if (response.status === 401) {
    // Hanya anggap "sesi habis" kalau sebelumnya memang ada token.
    // Kalau tidak ada token (misalnya salah password saat login), biarkan error biasa.
    const hadToken = currentToken || localStorage.getItem('rms_token');
    if (hadToken) {
      clearAuthToken();
      globalThis.dispatchEvent(new CustomEvent('rms:session-expired'));
      throw new Error('Sesi habis, silakan login lagi');
    }
  }
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(
      errorData.detail || errorData.message || `HTTP ${response.status}`
    );
  }
  return response.json();
}