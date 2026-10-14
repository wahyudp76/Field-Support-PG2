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

## Tab Pipa (inventaris pipa)

Sheet **Pipa** berbentuk matriks ringkasan (bukan daftar per unit): baris = *Placement* (Central PG2 / OP2 / FM4), kolom = jenis pipa × kondisi. Satuan: **batang**.

- Struktur dibaca **otomatis dari header**: `Total <Jenis>` menentukan daftar jenis; `<Jenis> Good/Average/Poor/Reject` dibaca sebagai kondisi; sub-kolom lain (mis. `Ex Irrigator 100M`, `>50M`) dibaca sebagai kategori ukuran. Menambah jenis/penempatan baru di sheet otomatis ikut tampil.
- Dashboard **menjumlahkan komponen sendiri**; kolom `Total …` dan `Grand Total` di sheet hanya dipakai untuk cek silang — bila berbeda, sel ditandai oranye dan muncul peringatan di panel info.
- Isi tab: KPI (total, per jenis, Good/Average/Poor+Reject, penempatan), filter chip penempatan & jenis, chart (stacked per penempatan & jenis, komposisi jenis, kondisi, kondisi per penempatan), matriks seperti di sheet + baris total, analisa per jenis dan per penempatan.
- Overview: KPI *Total Pipa* dan kartu *Resume Inventaris Pipa* (chart + tabel ringkas + persentase Poor/Reject).

## Tab Unit Pendukung (tb_pendukung + tb_aktwilayah)

Sheet **Unit Pendukung** berisi dua tabel berdampingan dalam satu sheet; dashboard membacanya sebagai dua blok (dipisah kolom header kosong, dipilih berdasarkan header penanda di `config.js`: `block: '^kode\s*unit$'` dan `block: '^volume'`). Pivot bantuan di kanan (COUNTA/AVERAGE) otomatis diabaikan.

- **tb_pendukung** (Wilayah, Aktivitas = jenis unit, Kode Unit): KPI, filter chip Wilayah & Jenis, chart stacked per wilayah, komposisi jenis, matriks jenis × wilayah, daftar unit dengan pencarian.
- **tb_aktwilayah** (Wilayah, Aktivitas, Kode, Volume liter): tangki per wilayah & aktivitas, rata-rata volume (grouped bar), matriks aktivitas × wilayah (jumlah · rata-rata), daftar tangki.
- Pemeriksaan kualitas: kode duplikat (peringatan), kode placeholder `…0000` (info), awalan kode yang lazim dipakai jenis lain (info), volume jauh di bawah median aktivitas (info).
- Overview: KPI *Unit Pendukung* dan kartu *Resume Unit Pendukung*.

## Pemeriksaan kualitas data (validasi otomatis saat sync)

Setiap sinkronisasi, semua kolom angka & tanggal diperiksa. Bila ada nilai yang menyimpang, tombol **⚠️ N peringatan data** muncul di header, toast pemberitahuan tampil, dan sel terkait disorot kuning/merah di tabel (arahkan kursor untuk melihat alasannya).

| Deteksi | Contoh | Level |
|---|---|---|
| Pemisah desimal memakai titik di kolom berformat koma | `130317.78` → saran `130.317,78` | Peringatan |
| Pemisah ribuan memakai koma | `1,234.56` → saran `1.234,56` | Peringatan |
| Format campur / tidak valid | `1.234.56` | Error |
| Teks di kolom angka | `abc` | Error |
| Nilai ekstrem (> 50× median kolom) — indikasi salah pemisah | `104.183.210,00` → saran `104.183,21` | Peringatan |
| Tanggal tidak valid untuk format kolom | `31/13/2024` | Peringatan |

Panel peringatan menampilkan **sheet, nomor baris, kode, kolom, nilai terinput, masalah, dan saran perbaikan**; klik baris untuk melompat ke datanya; bisa diekspor CSV. Nilai **teks** dan **ekstrem** tidak diikutkan dalam total/KPI sampai diperbaiki di spreadsheet; nilai salah pemisah tetap dihitung sesuai maksud penulisnya.

## Ketahanan terhadap perubahan sheet

- **Kolom komponen A/B/C dideteksi otomatis** (kolom yang seluruh isinya A/B/C) → menambah/menghapus kolom komponen di sheet Mesin/Irrigator tidak perlu ubah kode.
- **Format tanggal & angka dideteksi per kolom** (`dd/mm/yyyy` vs `mm/dd/yyyy`, `1.234,56` vs `1234.56`).
- **Sinonim header** (`assets/js/config.js → synonyms`): mis. `Siram`↔`Terpasang`, `HP`↔`Power`, `Divisi`↔`Asal Mesin`. Jika header diganti nama, dashboard tetap bekerja; kolom yang benar-benar tidak ditemukan dicatat di console (`[Dashboard] Kolom tidak ditemukan`).
- **Gagal sinkron** (offline / Google tidak dapat diakses): data terakhir tetap ditampilkan, indikator merah "Offline — data terakhir".
- **Buka instan**: data sinkron terakhir disimpan di browser (localStorage, maks 7 hari) dan ditampilkan seketika saat dashboard dibuka, lalu disinkronkan ulang di latar belakang.
- Chart yang mengabaikan baris kosong menampilkan badge *n belum diisi* agar total batang vs KPI tetap transparan.
- Header kolom yang dipakai filter/chart tetapi tidak ditemukan di sheet dilaporkan sebagai peringatan di panel info (bukan hanya console).
- Unit tanpa penilaian komponen sama sekali tidak dihitung sebagai Kondisi A (ditandai *Belum ada penilaian* di panel info).

## Kustomisasi

- Ganti ID spreadsheet / nama sheet → `assets/js/config.js`
- Ubah kolom filter, KPI, atau grafik → objek `CONFIG` di `assets/js/app.js`
- Ubah warna / tema → variabel CSS di `assets/css/style.css`

## Menjalankan Lokal

Cukup buka `index.html` di browser, atau jalankan server statis:
```bash
python3 -m http.server 8080
```
