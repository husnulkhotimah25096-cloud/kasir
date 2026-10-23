# Catatan Perbaikan

## Tahap 1 — perbaikan error (sudah)
Error sintaks/import, `index.html` menjadi UI lengkap, enum ganda Prisma (lihat riwayat sebelumnya).

## Tahap 2 — modul dilengkapi (sudah)
- **utils/idb.js ditulis ulang**: sebelumnya memakai gaya promise (`await store.getAll()`, `tx.done`) pada
  IndexedDB mentah sehingga antrean offline tidak pernah bekerja. DB naik ke v2 (store `cache-journals`,
  `event-queue` autoIncrement). Separator ID komposit diganti dari `:` ke `|` (timestamp ISO mengandung `:`).
- **modules/pos.js**: cari produk, keranjang +/−, PPN 10%, split payment, antrean offline + sync batch
  (idempotencyKey), auto-simpan offline jika jaringan putus, badge antrean, struk.
- **modules/inventory.js**: tabel multi-gudang, pencarian, opname (selisih >10% butuh approval; stok sistem 0
  tidak lagi NaN), transfer, penyesuaian dengan optimistic locking (409 ditangani).
- **modules/finance.js**: jurnal, filter akun, void wajib alasan, ringkasan debit/kredit, cache offline.
- **modules/procurement.js**: supplier, PO multi-item, goods receipt, konfirmasi/retur (stok ditambah oleh
  server, bukan klien). Tab baru "Pembelian".
- **modules/event-logs.js**: dipulihkan dan ditulis ulang. (File ini sempat TERKOSONG di zip sebelumnya
  akibat kesalahan saya saat memperbaiki.) Payload di-escape.
- **modules/login.js**: form login + menu keluar (sebelumnya tidak ada cara login sama sekali).
- **app.js** dirampingkan: hanya shell (tab, tema, dashboard, WebSocket), logika tab didelegasikan ke modul.
  Bug dashboard diperbaiki (periode sebelumnya dikirim sebagai storeId).
- **tests/smoke.mjs**: 39 pemeriksaan perilaku (jsdom + fake-indexeddb + API palsu).
  Jalankan: `npm i -D jsdom fake-indexeddb` lalu `node tests/smoke.mjs` (butuh `"type": "module"`).
- **API_CONTRACT.md**: bentuk request/response yang diharapkan frontend — acuan untuk backend.

## Belum / perlu diketahui
- Backend belum ada. Frontend hanya teruji terhadap API palsu.
- Grafik Chart.js belum teruji di browser sungguhan (dites memakai stub).
- Ikon PWA & `sw.js` belum ada. CI/CD belum diperbaiki.
- `schema.prisma` masih bermasalah selain enum: mis. sintaks `Decimal(12, 2)` tidak valid Prisma
  (seharusnya `Decimal @db.Decimal(12,2)`), `Stock` terikat ke `productVariantId` (frontend memakai per produk+gudang),
  `JournalEntry` tidak punya total debit/kredit. Perlu dirapikan bersamaan dengan backend.
