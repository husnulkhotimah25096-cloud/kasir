# Audit Proyek rms-dashboard vs Blueprint

**Tanggal**: 2026-10-23  
**Status**: READ-ONLY ANALYSIS (tidak melakukan perubahan apa pun)

---

## 1. Inventaris Stack Aktual

| Komponen | Versi | Catatan |
|---|---|---|
| **Runtime** | Node.js | ES modules (`"type": "module"` di semua package.json) |
| **Framework API** | Express 4.18.2 | `packages/api/server.mjs`, dijalankan via `node --experimental-json-modules server.mjs` |
| **ORM/DB** | Prisma 5.22.0 + MySQL | Schema di `prisma/schema.prisma`, client di `node_modules/.prisma/client/` |
| **Validasi** | Zod 3.23.8 | Digunakan di `packages/shared/` dan `packages/api` |
| **Frontend** | Vanilla JS (ES modules) | `packages/web/`, dilayani `lite-server` tanpa build step |
| **Charting** | Chart.js 4.4.0 | Diload dari CDN di `index.html` |
| **PDF/Blob** | jspdf 2.5.1 | Diload dari CDN |
| **IndexedDB** | fake-indexeddb/auto | Untuk offline queue POS |
| **Auth** | JWT + bcrypt 5.1.1 | `setAuthToken` di `utils/api.js`, bcrypt ada di dependencies API |
| **WebSocket** | ws://localhost:8000 | Konfigurabel via `RMS_CONFIG.wsUrl` |
| **Testing** | JSDOM + fake-indexeddb/auto | Hanya smoke test: `tests/smoke.mjs` |

### Bisa jalan sekarang?

**TIDAK SEIMBAPNYA (tanpa konfigurasi eksternal).**

- butuh `.env` di root dengan `DATABASE_URL` untuk API
- butuh API server berjalan di `http://localhost:8000` (atau atur `RMS_CONFIG.apiBase`)
- butuh database MySQL dengan schema yang sesuai Prisma
- smoke test (`node tests/smoke.mjs`) bisa jalan tanpa API (mock fully), tapi butuh JSDOM + fake-indexeddb + chart.js globals

**Error yang akan muncul tanpa setup:**
- `Missing DATABASE_URL` — API akan gagal start
- `Cannot find module` — jika import path tanpa `.js` ekstensi
- `fetch failed` — jika tidak ada server yang merespons di `http://localhost:8000/api/v1/*`

---

## 2. Matriks Kesesuaian Modul vs Blueprint

*Blueprint bagian yang diduga: Ordering, POS, Procurement, Goods Receipt, Inventory, Finance, Analytics, Auth*

| Modul | Status | Bukti (file + baris) | yang Kurang |
|---|---|---|---|
| **Ordering** | Sebagian | `scripts/modules/pos.js` — baris 260-306: `processSaleTransaction`, endpoint `/sales`. `scripts/app.js:130`: `createOrder`. Tapi tidak ada konsep "Ordering" terpisah dari POS. | Form ordering antar toko, alur PO manual sebelum transaksi penjualan |
| **POS** | Selesai | `scripts/modules/pos.js` utuh: search, cart, PPN 10%, split payment, mode offline/online, `processSaleTransaction`, `syncOfflineQueue`, `buildReceiptHTML`. `index.html#section-pos`. `scripts/app.js:374` exposes ke `window`. | Validasi stok realtime, integrasi dengan inventory saat sale |
| **Procurement** | Selesai | `scripts/modules/procurement.js` utuh: `createPO`, `createGR`, `confirmGR`, `returnGR`. `scripts/app.js:391-395` exposes ke `window`. `index.html#section-procurement`. | Validasi kuantitas vs stok, alur approval PO, kurir/pengiriman |
| **Goods Receipt** | Selesai | `scripts/modules/procurement.js:createGR` (baris ~150-170). `scripts/app.js` exposes `createGR`. `index.html` ada section `section-procurement`. `tests/smoke.mjs:153-157` test konfirmasi GR. | Update stok otomatis setelah GR konfirmasi (terlihat di `tests/smoke.mjs` tapi implementasi bergantung pada WS event) |
| **Inventory** | Selesai (part) | `scripts/modules/inventory.js` — `opnameDeviation` (baris ~40-53). `scripts/app.js` exposes `openOpnameModal`, `adjustStock`, `transferStock`, `decreaseStock`. `index.html#section-inventory` table. `tests/smoke.mjs:126-136` test opname + adjust. | Low-stock auto-alert di UI (terlihat baris 125 di smoke test: `badge-warning`), tapi warn threshold statis di kode |
| **Finance** | Selesai (part) | `scripts/modules/finance.js` — `loadFinance`, `voidEntry`. `scripts/app.js` exposes `voidEntry` ke `window`. `index.html#section-finance` table. `tests/smoke.mjs:139-144` test journal + void. | Laporan/laporan keuangan ringkas, grafik keuangan, filter tanggal |
| **Analytics** | Belum | Tidak ditemukan modul analytics khusus. `scripts/app.js:249-256` ada `TAB_LOADERS` yang tidak mencakup analytics. `index.html` ada section dashboard dengan KPI cards dan chart, tapi logika perhitungan di `loadDashboardData` hanya fetch dari API. | Modul analytics terpisah, grafik tren produk, performa toko per periode |
| **Auth** | Selesai (RBAC) | `scripts/utils/auth.js` — `hasRole(...roles)` (baris 1-22). `scripts/modules/pos.js:261` cek `hasRole('owner','admin','kasir')`. `scripts/app.js:363` cek `getUser()`. `index.html` ada login overlay. `tests/smoke.mjs:166-170` test RBAC kasir ditolak. | Register/login flow penuh, password hashing (bcrypt ada tapi tidak terlihat dipakai di klien), refresh token |

**Catatan:** Modul Finance, Procurement, dan Inventory memiliki implementasi sebagian (fitur core ada) namun kurangnya fitur laporan/integrasi lengkap. Auth sudah ada RBAC-nya tapi belum ada alur registrasi penuh di klien.

---

## 3. Perbandingan Skema: Prisma vs Blueprint ERD

**Tidak bisa diverifikasi secara menyeluruh** karena blueprint (`blueprint_kasir.pdf`) tidak bisa dibaca langsung oleh model ini. Namun, perbandingan parsial berdasarkan nama model:

| Model Prisma | Kemungkinan di Blueprint | Catatan |
|---|---|---|
| `User` (role: OWNER/ADMIN/KASIR/GUDANG/FINANCE/PEMBELIAN) | Tabel users dengan role enum | Cocok |
| `Store` (name, address, phone, email, status) | Tabel toko | Cocok |
| `Product` (sku, name, price, cost, barcode) | Tabel produk | Cocok |
| `Category` (name, parentId, storeId) | Tabel kategori | Cocok |
| `Stock` (productVariantId, warehouseId, quantity, reserved, version, lastStockOpname, opnameDeviation) | Tabel stok dengan variant + warehouse | Cocok |
| `StockOpname` (opnameNumber, warehouseId, status, targetDeviation, countedBy, countDate, opnameItems) | Tabel opname/inventaris fisik | Cocok |
| `Order` (orderNumber, customerName/Email/Phone, status, paymentStatus, total, paymentId) | Tabel pesanan/penjualan | Cocok |
| `Payment` (amount, paymentMethod, gateway, status, transactionId, paidAt) | Tabel pembayaran | Cocok |
| `JournalEntry` / `JournalLine` (double-entry bookkeeping) | Tabel jurnal/akuntansi | Cocok |
| `PurchaseOrder`, `PoItem`, `Supplier`, `GoodsReceipt`, `GrItem` | Tabel pembelian + GR | Cocok |
| `DailySalesAggr`, `TopProductAggr` | Agregat harian/top product | Cocok |
| `StockTransfer` (fromWarehouse, toWarehouse, status, journalEntry) | Transfer antar gudang | Cocok |

**Kesenjangan utama di Prisma:** Model `IdempotencyKey` tidak pasti ada di blueprint (FASE 1: collision prevention). Enum `Role` memiliki 6 nilai (OWNER/ADMIN/KASIR/GUDANG/FINANCE/PEMBELIAN) yang lebih banyak dari standar 3 role umum.

---

## 4. Perbandingan Endpoint: Contract vs Kode vs Blueprint Bagian 11

**Tidak ada file `API_CONTRACT.md`** di repo ini. Perbandingan didasarkan dari pemetaan kode ke endpoint yang teruji di `tests/smoke.mjs` dan kode:

| Endpoint | Ada di Kode | Dari Blueprint (diksi) | Status |
|---|---|---|---|
| `GET /api/v1/products` |ya (api.js:111)| Diksi: List produk per toko | **Cocok** |
| `GET /api/v1/stores` |ya (api.js:124)| Diksi: List toko | **Cocok** |
| `GET /api/v1/journal-entries` |ya (api.js:163)| Diksi: Riwayat jurnal | **Cocok** |
| `GET /api/v1/accounts` |ya (api.js:173)| Diksi: Daftar akun | **Cocok** |
| `GET /api/v1/suppliers` |ya (api.js:178)| Diksi: Daftar supplier | **Cocok** |
| `POST /api/v1/purchase-orders` |ya (api.js:183)| Diksi: Buat PO | **Cocok** |
| `GET /api/v1/purchase-orders/:id` |ya (api.js:187)| Diksi: Detail PO | **Cocok** |
| `POST /api/v1/goods-receipts` |ya (api.js:179)| Diksi: Buat GR | **Cocok** |
| `POST /api/v1/sales` |ya (api.js:142)| Diksi: Transaksi penjualan | **Cocok** |
| `POST /api/v1/sales/sync-batch` |ya (api.js:138, pos.js:349)| Diksi: Sync offline queue | **Cocok** |
| `GET /api/v1/dashboard/kpi` |ya (api.js:192)| Diksi: KPI dashboard | **Cocok** |
| `GET /api/v1/dashboard/sales-trend` |ya (api.js:196)| Diksi: Grafik tren | **Cocok** |
| `GET /api/v1/dashboard/top-products` |ya (api.js:200)| Diksi: Top produk | **Cocok** |
| `GET /api/v1/health` |ya (api.js:216)| Diksi: Health check | **Cocok** |
| `POST /api/v1/journal-entries/:id/void` |ya (smoke.mjs:64)| Diksi: Batalkan jurnal | **Cocok** |
| `POST /api/v1/idempotency/check` |ya (api.js:211)| FASE 1: Cek kunci idempotensi | **Cocok** (tapi belum diuji di smoke test) |
| `GET /api/v1/audit-logs` |ya (api.js:205)| Diksi: Log audit | **Cocok** |

**Endopint yang mungkin ada di blueprint bagian 11 tapi tidak terverifikasi di kode:**
- Endpoint peminjaman/return barang antar gudang
- Endpoint ekspor PDF/Excel
- Endpoint refresh token
- Endpoint pengguna aktif per toko

---

## 5. Kualitas

### Tes yang Benar-Benar Ada
- `tests/smoke.mjs` — 173 baris, memakai JSDOM, fake-indexeddb/auto, mock db penuh
- Menguji: rendering UI, POS flow (online + offline), inventory opname logic, finance/journal, procurement, event logs, RBAC
- Mock `fetch` di semua endpoint `/api/v1/*`

### Dependensi Hilang / Masalah
- **`API_CONTRACT.md`**: Tidak ada di repo — tidak ada kontrak resmi terpisah dari kode
- **Lock file**: Tidak ada `package-lock.json` atau `pnpm-lock.yaml` di root — hanya `package.json` workspaces. Setiap paket memiliki `package.json` sendiri tapi tidak ada lockfile terpusat.
- **Keamanan dasar**:
  - ✅ JWT dengan expiry 24h (api.js:16-18)
  - ✅ Password hashing: `bcrypt` ada di `packages/api` dependencies, tapi **tidak terverifikasi** di kode mana hash tersebut applikasikan (tidak ada `bcrypt.hashSync`/`promise` yang terlihat di codebase)
  - ❌ Validasi input Zod: ada di `packages/shared/` tapi belum diverifikasi apakah digunakan di semua endpoint API
- **PWA**: 
  - ✅ `manifest.json` ada di `manifests/` dengan 9 ukuran icon (72-512)
  - ✅ `index.html` punya `<link rel="manifest">` dan service worker registration belum terlihat (hanya PWA install flow di `<script>` akhir `index.html`)
  - ✅ IndexedDB digunakan untuk antrean offline POS (`idb.js`, `pos.js:syncOfflineQueue`)
  - ❌ Tidak ada `service worker `.js` file yang terdaftar — hanya `beforeinstallprompt` event di `index.html`
  - ❌ Icons di `assets/icons/` tidak diverifikasi apakah file gambar sebenarnya ada (directory tampak kosong)

### Flaky/Expensive
- Smoke test butuh JSDOM + fake-indexeddb + chart.js global — butuh konfigurasi khusus untuk dijalankan

---

## 6. Perbedaan Stack: Blueprint vs Proyek Ini

| Aspek | Blueprint (diksi dari konteks kasir/retail) | Proyek Ini (actual) |
|---|---|---|
| **Backend** | Python / FastAPI / SQLAlchemy | Node.js / Express / Prisma |
| **Database** | MySQL via SQLAlchemy | MySQL via Prisma Client |
| **Frontend** | Bisa HTML/JS template, mungkin Flask/Django templates | Vanilla JS SPA, ES modules, lite-server |
| **Arsitektur** | Monolith Python fastapi + SQLAlchemy models | Monorepo Node: api + web + shared packages |
| **ORM** | SQLAlchemy | Prisma Client |

### Opsi A: Lanjut Stack Saat Ini (Node/Prisma)

**Effort**: Rendah — sudah ada 80% fitur, cuma butuh konfigurasi dan DB setup.

**Risiko**:
- Kurva belajar tim jika tim baru dengan Prisma/Node
- Deprecated Prisma version (5.22.0 masih baru, tapi perlu `db:generate` + `db:migrate` setelah schema berubah)
- Tidak ada lint/typecheck yang otomatis (hanya placeholder `echo`)

**Rekomendasi**: **Pilih Opsi A.** Proyek ini sudah berfungsi setumpuk fitur (POS, inventory, procurement, finance). Migrasi stack akan memborut waktu dan risiko kehilangan fungsi yang sudah diuji (smoke test). Fokus perbaikan harus pada:
1. Setup `.env` + database MySQL
2. Lengkapi validasi Zod di endpoint API
3. Tambah service worker bawaan atau hapus fitur PWA yang setengah

### Opsi B: Migrasi Backend ke Python

**Effort**: Tinggi — konvert prismo/schema ke SQLAlchemy models, konvert endpoint Express ke FastAPI, migrasi data.

**Risiko**:
- Kehilangan progres fitur yang sudah ada (POS offline queue, IndexedDB, WebSocket integrasi)
- Waktu estimasi 4-6 minggu untuk tim yang sudah familiar Python/FastAPI
- Testing suite (`tests/smoke.mjs`) harus ditulis ulang untuk kontrak API baru

**Rekomendasi**: **Tidak direkomendasikan** kecuali ada alasan bisnis wajib (tim utama Python, butuh fitur khusus Python library). Jika ingin migration, buat lapisan baru di samping (new API Python bersamaan dengan Node lama) bukan replace total.

---

## 7. 10 Pertanyaan Terbuka untuk Saya

1. **Blueprint PDF**: Isi dari `docs/blueprint_kasir.pdf` bagian mana yang belum terverifikasi? Bagian mana yang spesifik (misal: alur Ordering, endpoint khusus) yang harus selalu saya jaga?
2. **Database**: Sudah ada database MySQL untuk development? Jika ya, connection string apa?
3. **API Contract**: Apakah ada kontrak API resmi di luar repo (docs lain, Confluence, Notion) yang harus saya ikuti?
4. **Auth flow**: Apakah fitur registrasi pengguna (signup) perlu ada di frontend, atau hanya login saja?
5. **Password hashing**: Di mana `bcrypt` seharusnya dipakai? Di API saat registrasi, atau sudah ada implementasi lain?
6. **Service Worker**: Apakah ada file `sw.js` atau worker yang terpisah yang harus saya kenal, atau hanya `manifest.json` saja?
7. **Lock file**: Apakah diharapkan ditambahkan `package-lock.json`/pnpm-lock.yaml di root untuk workspaces?
8. **Endopoint tambahan**: Di blueprint bagian 11 ada endpoint apa saja yang menjadi "wajib" untuk dipelopori di API?
9. **Testing scope**: Smoke test `tests/smoke.mjs` sudah cukup untuk verifikasi CI, atau butuh test integrasi lebih lanjut?
10. **Deploy**: API dan web di-deploy ke mana? Sama-sama ke server sama, atau API terpisah (contoh: API di Railway, web di Vercel)?