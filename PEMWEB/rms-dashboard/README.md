# RMS - Retail Management System

Aplikasi manajemen toko ritel: kasir (POS), stok, pesanan online, pembelian ke pemasok, serta pembukuan otomatis (jurnal, akun, audit log).

## Fitur

| Modul | Isi |
|---|---|
| Dashboard | Ringkasan penjualan, tren, produk terlaris, ekspor PDF dan Excel |
| Kasir (POS) | Transaksi penjualan di toko, tunai atau non-tunai, PPN 10% |
| Stok & Opname | Daftar stok per produk, batas stok minimum, stok opname |
| Pesanan Online | Katalog dan checkout untuk pembeli, pesanan ambil di toko atau antar |
| Pembelian | Supplier, Purchase Order, Goods Receipt (penerimaan barang), dan retur |
| Keuangan & Audit | Jurnal otomatis, daftar akun, void jurnal dengan jurnal pembalik, audit log |
| Event Logs | Riwayat aktivitas yang diambil dari database |

### Jurnal otomatis

Setiap transaksi membuat jurnal di dalam transaksi database yang sama, jadi transaksi tidak bisa tersimpan tanpa jurnalnya.

| Kejadian | Debit | Kredit |
|---|---|---|
| Penjualan kasir atau pesanan online lunas | Kas (tunai) atau Bank (lainnya), dan HPP | Penjualan, Hutang PPN, dan Persediaan |
| Konfirmasi penerimaan barang | Persediaan | Hutang Usaha |
| Retur barang | Hutang Usaha | Persediaan |
| Void jurnal | Jurnal pembalik (debit dan kredit ditukar) | |

Akun yang dipakai: 1100 Kas, 1200 Bank, 1400 Persediaan, 2100 Hutang Usaha, 2200 Hutang PPN, 4100 Penjualan, 5100 HPP.

## Teknologi

- Front-end: HTML, CSS, JavaScript (tanpa framework)
- Back-end: Node.js, Express, Zod
- Database: MySQL dengan Prisma

## Struktur folder

```
rms-dashboard/
  index.html            Dashboard staf (perlu login)
  katalog.html          Katalog produk untuk pembeli
  checkout.html         Checkout pesanan online
  pesanan.html          Status pesanan pembeli
  demo.html             Halaman demo
  scripts/app.js        Logika front-end
  packages/api/
    server.mjs          Titik masuk server API
    src/*.routes.mjs    Rute per modul
    src/journal.mjs     Pembuat jurnal otomatis
  prisma/
    schema.prisma       Skema database
    seed.js             Data awal (akun, pengguna, produk)
```

## Cara menjalankan

### 1. Prasyarat

- Node.js (versi LTS)
- MySQL, misalnya lewat XAMPP

### 2. Nyalakan MySQL

Buka XAMPP Control Panel, lalu klik **Start** pada MySQL sampai berwarna hijau.

### 3. Siapkan database

Buat database kosong bernama `rms_db` lewat phpMyAdmin (`http://localhost/phpmyadmin`).

Buat file `.env` di folder `rms-dashboard` (sesuaikan user dan password MySQL Anda):

```
DATABASE_URL="mysql://root:@localhost:3306/rms_db"
```

### 4. Pasang dependensi dan isi data awal

```powershell
cd "C:\PEMWEB1 V2\PEMWEB\rms-dashboard"
npm install
npx prisma db push
node prisma/seed.js
```

Seed membuat daftar akun, pengguna, dan data contoh. Aman dijalankan ulang.

### 5. Jalankan aplikasi

```powershell
npm run dev
```

Biarkan terminal tetap menyala. Alamat aplikasi ditampilkan di terminal.

## Akun login

Password semua akun: `rms12345`

| Username | Peran |
|---|---|
| owner | Pemilik, akses penuh |
| admin | Administrator |
| kasir | Transaksi kasir |
| gudang | Penerimaan barang dan stok |
| finance | Keuangan dan audit |
| pembeli | Pelanggan |

Katalog (`katalog.html`) dan checkout dapat dibuka pembeli tanpa login.

## Alur demo

1. **Kasir.** Login sebagai `kasir`, jual 1 Mie Instan Goreng (Rp 3.500 + PPN Rp 350 = Rp 3.850).
2. **Jurnal penjualan.** Login sebagai `owner`, buka **Keuangan & Audit**. Harus ada jurnal `POS-...` berstatus *Balanced* dengan debit dan kredit Rp 6.650 (Rp 3.850 + HPP Rp 2.800).
3. **Pesanan online.** Buka `katalog.html`, buat pesanan dari sisi pembeli. Di dashboard, buka **Pesanan Online**, lalu klik **Tandai lunas**. Jurnal `ONL-...` muncul.
4. **Pembelian.** Di **Pembelian**, konfirmasi satu Goods Receipt. Jurnal `GR-...` muncul (Persediaan didebit, Hutang Usaha dikredit). Retur menambah jurnal `GR_RETURN`.
5. **Void.** Di **Keuangan & Audit**, klik **Void** pada satu jurnal dan isi alasan. Jurnal asal berstatus *Void*, jurnal pembalik `VOID-...` muncul, dan audit log mencatat tindakannya.

Void hanya membalik jurnal, bukan stok atau status pesanannya. Itu koreksi pembukuan, bukan pembatalan transaksi.

### Pemeriksaan keseimbangan (phpMyAdmin, tab SQL)

```sql
SELECT SUM(debit) AS total_debit, SUM(credit) AS total_kredit FROM JournalLine;
SELECT code, name, balance FROM Account ORDER BY code;
SELECT action, entity, entityId, changes FROM AuditLog ORDER BY id DESC LIMIT 3;
```

Total debit harus sama dengan total kredit.

## Batas input

Kolom teks MySQL dibatasi 191 karakter, sehingga input dibatasi: alamat 110, catatan 30, dan alasan retur atau void 150 karakter.

## Pemecahan masalah

| Masalah | Penyebab dan solusi |
|---|---|
| Server tidak mau naik | MySQL belum menyala. Start MySQL di XAMPP, lalu jalankan ulang `npm run dev`. |
| `Akun 2200 belum ada` | Seed belum dijalankan. Jalankan `node prisma/seed.js`. |
| Jurnal tidak muncul untuk transaksi lama | Fitur jurnal otomatis hanya berlaku untuk transaksi baru. |
| Tampilan tidak berubah setelah perubahan kode | Restart server dan tekan `Ctrl+Shift+R` di browser. |

## Deploy

- Front-end dapat di-deploy ke Vercel: atur **Root Directory** ke `PEMWEB/rms-dashboard` dan Framework Preset **Other**.
- API (Express) dan database MySQL tidak berjalan di Vercel. Keduanya perlu di-host terpisah (misalnya Render atau Railway untuk API, dan MySQL online), lalu alamat API di front-end diarahkan ke sana.
