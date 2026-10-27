/* =====================================================================
 *  KONFIGURASI DASHBOARD  —  Field Support Irigasi PG 2
 *  Ubah di sini jika ID spreadsheet / nama sheet / kolom filter berubah.
 * ===================================================================== */
window.APP_CONFIG = {
  spreadsheetId: '1WbGTDqC0Anh6O54twsJfiBiWcTri7FHyQjXIFrOoLz4',

  // Sumber data: Google Visualization CSV endpoint (spreadsheet harus "Anyone with the link → Viewer")
  csvUrl: function (sheetName) {
    return 'https://docs.google.com/spreadsheets/d/' + this.spreadsheetId +
      '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(sheetName) + '&t=' + Date.now();
  },

  // Auto refresh (ms). 0 = nonaktif
  autoRefreshMs: 5 * 60 * 1000,
  pageSize: 25,

  // Kolom terakhir tiap sheet → tabel pivot / catatan di kanan diabaikan.
  // Pembacaan juga berhenti otomatis di header kosong pertama.
  sheets: {
    detail:    { name: 'Detail Terpasang', endHeader: 'Kode Air' },
    sumber:    { name: 'Sumber Air',       endHeader: 'Status'   },
    mesin:     { name: 'Mesin',            endHeader: null       }, // berhenti di header kosong pertama
    irrigator: { name: 'Irrigator',        endHeader: null       }, // berhenti di header kosong pertama (kolom inspeksi SKOR/KONDISI ikut terbaca)
    pipa:      { name: 'Pipa',             endHeader: 'Grand Total' }, // matriks ringkasan: Placement × jenis × kondisi (satuan: batang)
    // Sheet "Unit Pendukung" berisi 2 tabel berdampingan → dibaca sebagai 2 key (block = regex header penanda blok)
    pendukung: { name: 'Unit Pendukung',   endHeader: null, block: '^kode\\s*unit$' },  // tb_pendukung: Wilayah, Aktivitas(jenis unit), Kode Unit
    aktwil:    { name: 'Unit Pendukung',   endHeader: null, block: '^volume' }           // tb_aktwilayah: No, Wilayah, Aktivitas, Kode, Volume
  },

  // Komoditi yang memakai irigasi tetes (drip) → tidak memakai irrigator, sehingga Kode Irigator kosong adalah WAJAR.
  // Dicocokkan (tanpa membedakan huruf besar/kecil) dengan kolom Wil / Komoditi pada Detail Terpasang.
  dripCommodities: ['BANANA', 'GUAVA'],

  // Kolom non-komponen (dipakai untuk menghitung kondisi A/B/C keseluruhan unit)
  // Kolom komponen dideteksi OTOMATIS (kolom yang seluruh isinya A/B/C). Daftar ini hanya pengecualian tambahan
  // untuk kolom ringkasan yang kebetulan juga berisi A/B/C agar tidak ikut dihitung sebagai komponen.
  nonComponentCols: {
    mesin:     ['Mesin', 'Prodo', 'KONDISI', 'TEMUAN (B/C)', 'PETUGAS'],
    irrigator: ['KONDISI', 'TEMUAN (B/C)', 'PETUGAS']
  },

  // Sinonim nama kolom: dipakai bila header di spreadsheet diganti namanya
  synonyms: {
    'Siram': ['Terpasang'], 'Terpasang': ['Siram'],
    'HP': ['Power'], 'Power': ['HP'],
    'Divisi': ['Asal Mesin'], 'Asal Mesin': ['Divisi'],
    'Komoditi': ['Wil', 'Wilayah', 'WILAYAH'], 'Wil': ['Wilayah', 'WILAYAH', 'Komoditi'], 'Wilayah': ['Wil', 'WILAYAH'], 'WILAYAH': ['Wilayah', 'Wil']
  }
};
