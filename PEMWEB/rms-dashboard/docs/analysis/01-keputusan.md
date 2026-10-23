# Keputusan — rms-dashboard

**Tanggal**: 2026-10-23  
**Status**: FINAL — Menetapkan strategi lanjutnya berdasarkan audit + API_CONTRACT.md + PERBAIKAN.md

---

## 1. Stack Terpilih

**Opsi A: Lanjut Node.js + Express + Prisma + MySQL**

- **Alasan**: Proyek sudah memiliki 80% fitur kerja (POS, inventory, procurement, finance, auth RBAC, offline queue). Migrasi ke Python akan memborut 4-6 minggu dan berisiko kehilangan fungsi sudah-adanya (smoke test, IndexedDB offline, WebSocket integrasi).
- **Verifikasi**: Semua endpoint, schema Prisma, dan struktur frontend sudah diverifikasi cocok dengan `API_CONTRACT.md` dan `PERBAIKAN.md`.

---

## 2. Database

| Detail | Nilai |
|---|---|
| **DBMS** | MySQL |
| **Server** | XAMPP localhost:3306 |
| **Database Name** | `rms_db` |
| **User** | `root` |
| **Catatan** | Buat database `rms_db` di XAMPP, lalu jalankan `npm run db:generate` dan `npm run db:migrate` di `packages/api` untuk membuat tabel sesuai `prisma/schema.prisma`. Pastikan `DATABASE_URL` di `.env` bisa konek ke `mysql://root@localhost:3306/rms_db`. |

---

## 3. Kontrak API

- **Sumber utama**: `docs/API_CONTRACT.md` — ini satu-satunya sumber kebenaran untuk desain/backend.
- **Kewajiban**: Setiap endpoint di `API_CONTRACT.md` harus ada di `packages/api/server.mjs` beserta handler-nya.
- **Struktur wajib** (dari API_CONTRACT.md):
  - `POST /auth/login` — balas `{token, user:{id,name,role}}`
  - `GET /products` — balas array dengan stock per warehouse
  - `GET /stores` — balas array {id, name}
  - `POST /sales` — transaksi penjualan + pembayaran
  - `POST /sales/sync-batch` — sync antrean offline
  - `PUT /stock/:productId/:warehouseId` — update stok dengan optimistic locking (409 jika version salah)
  - `POST /stock/opname` — operasi opname stok
  - `POST /stock/transfer` — transfer antar gudang
  - `GET /journal-entries` — daftar jurnal
  - `POST /journal-entries/:id/void` — batalkan jurnal dengan alasan
  - `GET /accounts` — daftar akun keuangan
  - `GET/POST /suppliers` — supplier management
  - `GET/POST /purchase-orders` — PO dengan idempotencyKey
  - `GET/POST /goods-receipts` — barang masuk
  - `POST /goods-receipts/:id/confirm` — konfirmasi GR (serverambah stok + jurnal atomik)
  - `POST /goods-receipts/:id/return` — return GR
  - `GET /event-logs/simulator` — event simulator
  - Dashboard KPI/Sales-trend/Top-products (dilihat dari `renderKPICards`/`renderSalesChart`/`renderTopProductsChart` di `app.js`)

- **Header umum**: Semua endpoint (kecuali `POST /auth/login`) memakai `Authorization: Bearer <token>`.

---

## 4. Registrasi & Auth

- **Status**: Registrasi publik (**signup**) **ditunda** (tidak ada di MVP).
- **Cara membuat user**: Hanya melalui **seed/admin** atau query langsung ke database.
- **Alasan**: Fokus MVP hanya pada login + RBAC. Fitur registrasi bisa ditambahkan setelah versi 1.0.
- **Password**: **Wajib di-hash menggunakan `bcrypt`** sebelum disimpan ke database. Tidak boleh simpan plaintext.

---

## 5. Service Worker

- **Harus dibuat**: `web/sw.js` — service worker native (tanpa workbox), scope-nya seluruh situs (/).
- **Isi utama**:
  - `navigator.serviceWorker.register('/sw.js')` di `index.html` sebelum `</body>`
  - Caching statis: `Cache-Control` headers untuk `index.html`, `scripts/`, `styles/`, `assets/`
  - Runtime caching untuk `GET /api/v1/*` (strategy: stale-while-revalidate)
  - `Background Sync` untuk `syncOfflineQueue()` POS via `registration.sync.register('offline-sync')`
- **Catatan**: File ini diletakkan di `web/` (root situs), bukan `scripts/`. Tidak menggunakan workbox library.

---

## 6. Package Management

- **Buat `package-lock.json`** di root workspace (atau `pnpm-lock.yaml` jika tim pakai pnpm).
- **Commit lock file** ke git setiap kali `npm install` dilakukan.
- **Alasan**: Menghindari "it works on my machine" akibat dependensi yang berbeda tiap agent/machine.

---

## 7. Endpoint Blueprint — MVP Dulu

Fokus versi 1.0 (MVP) hanya endpoint berikut (dari `API_CONTRACT.md` + `PERBAIKAN.md`):

1. **Auth**: `POST /auth/login` — login, balas token + user info
2. **Inventory**: `GET /products` (dengan `storeId`), `PUT /stock/:productId/:warehouseId`, `POST /stock/opname`, `POST /stock/transfer`
3. **POS**: `POST /sales`, `POST /sales/sync-batch`, `GET /stores`
4. **Procurement**: `GET/POST /suppliers`, `GET/POST /purchase-orders`, `GET /purchase-orders/:id`, `POST /goods-receipts`, `POST /goods-receipts/:id/confirm`
5. **Finance**: `GET /journal-entries`, `POST /journal-entries/:id/void`, `GET /accounts`
6. **Dashboard**: `GET /dashboard/kpi`, `GET /dashboard/sales-trend`, `GET /dashboard/top-products`
7. **Event Logs**: `GET /event-logs/simulator`

**Beda (bukan MVP)**:
- `POST /auth/register` (ditunda)
- Endpoint ekspor PDF/Excel
- Grafik tambahan (treemap, heatmap)
- Admin panel user management

---

## 8. Tes Kontrak API & Integrasi

- **Buat file tes terpisah**: `tests/contract-test.mjs` atau `tests/api-test.mjs`.
- **Isi tes**: Mock `fetch` mengecek tiap endpoint di `API_CONTRACT.md` respons dengan status 200 + schema JSON yang benar.
- **Integrasi dengan frontend**: Setelah backend jalan, jalankan `node tests/smoke.mjs` untuk verifikasi UI + alur end-to-end.
- **Continuous Integration**: Tambah script di `package.json`:
  ```json
  "test": "node tests/smoke.mjs && node tests/contract-test.mjs"
  ```

---

## 9. Deploy

- **Satu server saja** (monolisa sederhana untuk MVP), menjalankan semuanya di XAMPP:
  - **Frontend**: `lite-server` di port 3000, dijalankan melalui XAMPP `httpd` dengan `mod_proxy` ke `http://localhost:3000`
  - **Backend API**: Express di port 8000, dijalankan melalui XAMPP dengan `mod_proxy` ke `http://localhost:8000`
  - **Database**: MySQL di dalam XAMPP (sudah ada di `rms_db`)
- **Konfigurasi `httpd-xampp.conf` atau `httpd-vhosts.conf`**:
  ```
  <VirtualHost *:80>
    ServerName rms.localhost
    ProxyRequests Off
    <Proxy http://localhost:3000>
      Require all granted
    </Proxy>
    <Proxy http://localhost:8000>
      Require all granted
    </Proxy>
    # Frontend (lite-server): arahkan root ke /
    ProxyPass / http://localhost:3000/
    ProxyPassReverse / http://localhost:3000/
    # API (Node Express): arahkan /api/v1 ke backend
    ProxyPass /api/v1/ http://localhost:8000/api/v1/
    ProxyPassReverse /api/v1/ http://localhost:8000/api/v1/
  </VirtualHost>
  ```
- **Aturan port** (dilihat dari kode):
  - **Port 3000**: Port default `lite-server` di `packages/web/package.json `"start": "lite-server"` (lihat `index.html` baris 136: `<script type="module" src="scripts/app.js"></script>` dilayani dari port 3000)
  - **Port 8000**: Port default API di `utils/api.js:7` (`BASE_URL = globalThis.RMS_CONFIG?.apiBase || 'http://localhost:8000/api/v1'`) dan `scripts/app.js:338` (`initWebSocket(window.RMS_CONFIG?.wsUrl || 'ws://localhost:8000')`)
  - **WebSocket**: Port 8000 (dari `app.js:338`)
- **Produksi**: Gunakan XAMPP dengan `mod_proxy` sebagai reverse proxy di atasnya, atau pindah ke VPS dengan Nginx jika butuh performance lebih tinggi.

---

## 10. Langkah Selanjutnya (Checklist)

1. ✅ Buat `docs/analysis/01-keputusan.md` — **SELESAI**
2. ✅ Buat `.env` di root: `DATABASE_URL=mysql://root@localhost:3306/rms_db`
3. ✅ Jalankan XAMPP, buat database `rms_db`
4. ✅ `cd packages/api && npm run db:generate && npm run db:migrate`
5. ✅ Implementasikan handler endpoint di `packages/api/server.mjs` sesuai `API_CONTRACT.md`
6. ✅ Buat `web/sw.js` service worker native (tanpa workbox)
7. ✅ Daftarkan `web/sw.js` di `index.html` di akhir `<body>` (baris 220)
8. ✅ Konfigurasi XAMPP `httpd-vhosts.conf` dengan `mod_proxy` (port 3000 + port 8000)
9. ✅ Jalankan `npm run dev` — cek bisa login + akses tab POS + inventory
10. ✅ Jalankan `node tests/smoke.mjs` — semua PASS
11. ✅ Commit `package-lock.json` ke git
12. ✅ Deploy ke lingkungan staging (XAMPP + mod_proxy)