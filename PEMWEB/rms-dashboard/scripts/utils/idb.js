// ========================================
// IndexedDB Wrapper untuk RMS PWA Offline-First
// (IndexedDB mentah + helper promise; tanpa library eksternal)
// ========================================

const DB_NAME = 'rms-db';
const DB_VERSION = 2;
export const STORES = {
  PENDING_SALES: 'pending-sales',
  CACHE_PRODUCTS: 'cache-products',
  CACHE_STORES: 'cache-stores',
  CACHE_JOURNALS: 'cache-journals',
  EVENT_QUEUE: 'event-queue',
};

// --- Helper promise ---

// Bungkus IDBRequest menjadi Promise
function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Tunggu transaksi selesai (commit)
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaksi IndexedDB dibatalkan'));
  });
}

// Jalankan operasi pada satu object store, lalu tunggu commit.
async function withStore(storeName, mode, fn) {
  const db = await openDB();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const result = await fn(store);
  if (mode === 'readwrite') await txDone(tx);
  return result;
}

// Buka/buat Database
export function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORES.PENDING_SALES)) {
        db.createObjectStore(STORES.PENDING_SALES, { keyPath: 'idempotencyKey' });
      }
      if (!db.objectStoreNames.contains(STORES.CACHE_PRODUCTS)) {
        db.createObjectStore(STORES.CACHE_PRODUCTS);
      }
      if (!db.objectStoreNames.contains(STORES.CACHE_STORES)) {
        db.createObjectStore(STORES.CACHE_STORES);
      }
      if (!db.objectStoreNames.contains(STORES.CACHE_JOURNALS)) {
        db.createObjectStore(STORES.CACHE_JOURNALS);
      }
      // v1 membuat event-queue tanpa key; ganti dengan autoIncrement
      if (event.oldVersion > 0 && event.oldVersion < 2 && db.objectStoreNames.contains(STORES.EVENT_QUEUE)) {
        db.deleteObjectStore(STORES.EVENT_QUEUE);
      }
      if (!db.objectStoreNames.contains(STORES.EVENT_QUEUE)) {
        db.createObjectStore(STORES.EVENT_QUEUE, { autoIncrement: true });
      }
    };
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
    request.onblocked = () => reject(new Error(`${DB_NAME} diblokir tab lain`));
  });
}

// --- Pending Sales (Offline Queue) ---

export async function addPendingSale(saleData) {
  const idempotencyKey = generateCompositeId(
    saleData.storeId,
    saleData.cashierId,
    saleData.timestamp,
    saleData.uuid
  );
  const record = {
    idempotencyKey,
    saleData,
    queuedAt: new Date().toISOString(),
  };
  await withStore(STORES.PENDING_SALES, 'readwrite', (store) => req(store.add(record)));
  return idempotencyKey;
}

export function getPendingSales() {
  return withStore(STORES.PENDING_SALES, 'readonly', (store) => req(store.getAll()));
}

export function removePendingSale(idempotencyKey) {
  return withStore(STORES.PENDING_SALES, 'readwrite', (store) => req(store.delete(idempotencyKey)));
}

// --- Cache (products, stores, journals) ---

function makeCache(storeName) {
  return {
    async put(data) {
      await withStore(storeName, 'readwrite', (store) => req(store.put({ data }, 'current')));
    },
    async get() {
      const result = await withStore(storeName, 'readonly', (store) => req(store.get('current')));
      return result?.data || [];
    },
  };
}

const productCache = makeCache(STORES.CACHE_PRODUCTS);
const storeCache = makeCache(STORES.CACHE_STORES);
const journalCache = makeCache(STORES.CACHE_JOURNALS);

export const cacheProducts = (products) => productCache.put(products);
export const getCachedProducts = () => productCache.get();
export const cacheStores = (stores) => storeCache.put(stores);
export const getCachedStores = () => storeCache.get();
export const cacheJournals = (journals) => journalCache.put(journals);
export const getCachedJournals = () => journalCache.get();

// --- Event Queue ---

export async function addEventQueue(event) {
  await withStore(STORES.EVENT_QUEUE, 'readwrite', (store) => req(store.add(event)));
}

export function getEventQueue() {
  return withStore(STORES.EVENT_QUEUE, 'readonly', (store) => req(store.getAll()));
}

export function clearEventQueue() {
  return withStore(STORES.EVENT_QUEUE, 'readwrite', (store) => req(store.clear()));
}

// --- Utility: Composite ID Generation ---

export function generateUUID() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Format: storeId:cashierId:timestamp:uuid
// Catatan: timestamp ISO mengandung ":" sehingga parsing memakai pola tetap (lihat parseCompositeKey).
export function generateCompositeId(storeId, cashierId, timestamp, uuid) {
  return `${storeId}|${cashierId}|${timestamp}|${uuid || generateUUID()}`;
}

export function parseCompositeKey(key) {
  const [storeId, cashierId, timestamp, uuid] = String(key).split('|');
  return { storeId, cashierId, timestamp, uuid: uuid || null };
}

// --- Persist Theme ---

export function persistTheme(theme) {
  try {
    localStorage.setItem('rms-theme', theme);
  } catch (_) { /* storage tidak tersedia */ }
}

export function loadTheme() {
  try {
    return localStorage.getItem('rms-theme') || 'light';
  } catch (_) {
    return 'light';
  }
}

// --- Debounce / Throttle ---

export function debounce(func, wait) {
  let timeout;
  return function debounced(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
    return timeout;
  };
}

export function throttle(func, limit) {
  let inThrottle = false;
  return function throttled(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
