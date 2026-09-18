# 💧 Field Support Irigasi PG 2 — Dashboard Monitoring

Dashboard web interaktif untuk memonitor operasional irigasi PG 2. Data dibaca **langsung & real-time** dari Google Spreadsheet, dihosting gratis di **GitHub Pages** (tanpa server / Apps Script).

🔗 **Live:** https://wahyudp76.github.io/Field-Support-PG2/
📊 **Sumber data:** [Google Spreadsheet](https://docs.google.com/spreadsheets/d/1WbGTDqC0Anh6O54twsJfiBiWcTri7FHyQjXIFrOoLz4)

## Tab & Fitur

| Tab | Isi |
|---|---|
| 📊 Overview | KPI gabungan, grafik wilayah / engine / sumber air / status irrigator, ringkasan kondisi peralatan |
| 🚜 Detail Terpasang | Unit irigasi terpasang per wilayah (engine + irrigator), tren pemasangan per tanggal |
| 🌊 Sumber Air | Inventaris lebung & deep well, volume real & potensi (m³), status pengukuran |
| ⚙️ Mesin | Inventaris engine + kondisi komponen (A/B/C), komponen paling sering bermasalah |
| 💦 Irrigator | Inventaris irrigator + kondisi komponen, status terpasang / rusak |

Setiap tab: filter dropdown per kolom kunci, pencarian global, sort klik header, pagination, klik baris → detail lengkap, export CSV (hasil filter), tema gelap/terang, auto-refresh 5 menit, badge & chip berwarna.

## PWA (Installable)

Dashboard dapat dipasang sebagai aplikasi di Android / iOS / desktop:
- **Android/Chrome:** tombol **📲 Install** di header, atau menu ⋮ → *Install app*.
- **iOS/Safari:** Share → *Add to Home Screen*.
- Bekerja offline dengan data terakhir yang berhasil dimuat.

## Struktur File

```
Field-Support-PG2/
├── index.html                 # Halaman utama (layout & tab)
├── assets/
│   ├── css/style.css          # Tema & tampilan
│   ├── js/config.js           # ⚙️ Konfigurasi: ID spreadsheet, nama sheet, batas kolom
│   ├── js/data.js             # Ambil & parsing CSV dari Google Sheets, normalisasi data
│   ├── js/app.js              # Logika dashboard: KPI, filter, grafik, tabel, export
│   ├── img/og-cover.png        # gambar preview saat link dibagikan
│   └── icons/                  # ikon PWA 72–512 px (any + maskable), apple-touch, favicon
├── manifest.webmanifest        # Web App Manifest (installable PWA)
├── sw.js                       # Service worker: app shell offline + cache data terakhir
├── .github/workflows/pages.yml# Auto-deploy ke GitHub Pages saat push ke main
├── .nojekyll
└── README.md
```

## Cara Kerja Sinkronisasi Data

Dashboard memanggil endpoint CSV publik Google Sheets:
```
https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&sheet=<Nama Sheet>
```
Syarat: spreadsheet dibagikan **"Anyone with the link → Viewer"**. Setiap perubahan di spreadsheet langsung tampil setelah refresh (atau auto-refresh 5 menit).

Sheet yang dibaca: `Detail Terpasang`, `Sumber Air`, `Mesin`, `Irrigator`.
Pembacaan kolom berhenti pada header kosong pertama atau kolom terakhir yang ditentukan di `config.js` (`endHeader`), sehingga tabel pivot/catatan di sebelah kanan data **tidak ikut terbaca**.

## Aktifkan GitHub Pages (sekali saja)

1. Buka **Settings → Pages** di repo ini.
2. **Source:** pilih **GitHub Actions**.
3. Tunggu workflow *Deploy GitHub Pages* selesai (tab **Actions**), lalu buka https://wahyudp76.github.io/Field-Support-PG2/

## Kustomisasi

- Ganti ID spreadsheet / nama sheet → `assets/js/config.js`
- Ubah kolom filter, KPI, atau grafik → objek `CONFIG` di `assets/js/app.js`
- Ubah warna / tema → variabel CSS di `assets/css/style.css`

## Menjalankan Lokal

Cukup buka `index.html` di browser, atau jalankan server statis:
```bash
python3 -m http.server 8080
```
