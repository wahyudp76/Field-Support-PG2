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
    irrigator: { name: 'Irrigator',        endHeader: 'Status'   }
  },

  // Kolom non-komponen (dipakai untuk menghitung kondisi A/B/C keseluruhan unit)
  nonComponentCols: {
    mesin:     ['No', 'Kode Unit', 'Spec', 'Pump', 'Divisi', 'Asal Mesin', 'Mesin', 'Prodo', 'Category', 'Jenis', 'HP', 'Pompa', 'Status', 'Komoditi'],
    irrigator: ['NO', 'KODE UNIT', 'WILAYAH', 'Category', 'Unit', 'Nozzle', 'Status']
  }
};
