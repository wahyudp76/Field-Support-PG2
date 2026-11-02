/**
 * =====================================================================
 *  Field Support Irigasi PG 2 — Web App penulis (Apps Script)
 *  Dipakai tombol "Pindah Unit" di dashboard untuk mengubah baris pada
 *  sheet "Detail Terpasang" secara langsung.
 *
 *  CARA PASANG (sekali saja):
 *   1. Buka spreadsheet → Extensions → Apps Script → hapus isi Code.gs,
 *      tempel seluruh file ini → Simpan (Ctrl+S).
 *   2. Project Settings (ikon ⚙) → Script Properties → Add property:
 *        PIN  = angka/kata sandi yang akan diminta dashboard (mis. 2468)
 *   3. Deploy → New deployment → ikon ⚙ pilih "Web app":
 *        Description : FS PG2 writer
 *        Execute as  : Me (akun Anda, pemilik sheet)
 *        Who has access : Anyone
 *      → Deploy → Authorize access (izinkan) → salin "Web app URL"
 *      (bentuknya https://script.google.com/macros/s/…/exec).
 *   4. Tempel URL tersebut ke assets/js/config.js → writeApi.url
 *      (atau di dashboard: tombol ✏️ → "Atur URL Web App").
 *   5. Setiap kali mengubah kode ini: Deploy → Manage deployments →
 *      ✎ Edit → Version: New version → Deploy (URL tetap sama).
 *
 *  Uji cepat di browser: <URL>?action=ping  → {"ok":true,...}
 * =====================================================================
 */

var SPREADSHEET_ID = '1WbGTDqC0Anh6O54twsJfiBiWcTri7FHyQjXIFrOoLz4'; // dipakai bila project ini TIDAK terikat ke spreadsheet
var SHEET_DETAIL = 'Detail Terpasang';
var SHEET_LOG = 'Log Perpindahan';      // dibuat otomatis bila belum ada
var MAX_HISTORY = 400;                  // panjang maksimal kolom Keterangan

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'ping') {
    var info = {};
    try { var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID); info.spreadsheet = ss.getName(); info.sheetDetail = !!ss.getSheetByName(SHEET_DETAIL); } catch (err) { info.spreadsheetError = String(err); }
    info.pinSet = !!PropertiesService.getScriptProperties().getProperty('PIN');
    return out_({ ok: true, app: 'FS PG2 writer', version: 2, time: new Date().toISOString(), info: info });
  }
  return out_({ ok: false, error: 'Gunakan POST (action: move) atau ?action=ping' });
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out_({ ok: false, error: 'Body bukan JSON' }); }

  var pin = String(PropertiesService.getScriptProperties().getProperty('PIN') || '');
  if (!pin) return out_({ ok: false, error: 'PIN belum diatur di Script Properties' });
  if (String(body.pin || '') !== pin) return out_({ ok: false, error: 'PIN salah', code: 'PIN' });

  if (body.action === 'verify') return out_({ ok: true });
  if (body.action === 'move') return move_(body);
  return out_({ ok: false, error: 'Aksi tidak dikenal: ' + body.action });
}

/* ---------- pindah unit: update baris yang ada ---------- */
function move_(b) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return out_({ ok: false, error: 'Sheet sedang dipakai proses lain, coba lagi' });
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID), sh = ss.getSheetByName(SHEET_DETAIL);
    if (!sh) return out_({ ok: false, error: 'Sheet "' + SHEET_DETAIL + '" tidak ditemukan' });

    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var col = function (name) { var i = headers.indexOf(name); if (i < 0) throw new Error('Kolom "' + name + '" tidak ada di header'); return i + 1; };
    var cLok = col('Lokasi'), cWil = col('Wil'), cEng = col('Kode Engine'), cIrr = col('Kode Irigator'), cKet = col('Keterangan'),
        cTgl = col('Tanggal'), cSA = col('Sumber Air'), cKA = col('Kode Air');

    // --- cari baris target: nomor baris + verifikasi isi (agar tidak salah baris bila sheet berubah) ---
    var row = Number(b.row) || 0;
    var match = function (r) {
      var v = sh.getRange(r, 1, 1, lastCol).getValues()[0];
      return String(v[cLok - 1]).trim() === String(b.from.lokasi || '').trim() &&
             String(v[cEng - 1]).trim() === String(b.from.kodeEngine || '').trim() &&
             String(v[cIrr - 1]).trim() === String(b.from.kodeIrigator || '').trim();
    };
    if (!(row >= 2 && row <= lastRow && match(row))) {
      row = 0;
      var all = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
      for (var i = 0; i < all.length; i++) {
        var v = all[i];
        if (String(v[cLok - 1]).trim() === String(b.from.lokasi || '').trim() &&
            String(v[cEng - 1]).trim() === String(b.from.kodeEngine || '').trim() &&
            String(v[cIrr - 1]).trim() === String(b.from.kodeIrigator || '').trim()) { if (row) return out_({ ok: false, error: 'Ada lebih dari satu baris yang cocok (' + b.from.lokasi + ' / ' + b.from.kodeEngine + ') — rapikan baris ganda dulu' }); row = i + 2; }
      }
      if (!row) return out_({ ok: false, error: 'Baris unit tidak ditemukan (mungkin sudah diubah orang lain). Refresh dashboard lalu ulangi.' });
    }

    var to = b.to || {};
    var lokasi = String(to.lokasi || '').trim().toUpperCase();
    if (!lokasi) return out_({ ok: false, error: 'Lokasi baru kosong' });
    var old = sh.getRange(row, 1, 1, lastCol).getValues()[0];
    var oldLok = String(old[cLok - 1]).trim(), oldKA = String(old[cKA - 1]).trim(), oldKet = String(old[cKet - 1]).trim();

    // tanggal: terima "yyyy-mm-dd" → tulis sebagai Date agar format kolom mengikuti sheet
    var tgl = null;
    if (to.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(to.tanggal)) { var p = to.tanggal.split('-'); tgl = new Date(+p[0], +p[1] - 1, +p[2]); }

    var stamp = Utilities.formatDate(tgl || new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy');
    var hist = 'Pindah dari ' + oldLok + (oldKA ? ' (' + oldKA + ')' : '') + ' ' + stamp;
    var ket = [String(to.keterangan || '').trim(), hist, oldKet].filter(String).join(' | ');
    if (ket.length > MAX_HISTORY) ket = ket.slice(0, MAX_HISTORY - 1) + '…';

    sh.getRange(row, cLok).setValue(lokasi);
    if (to.wil) sh.getRange(row, cWil).setValue(String(to.wil).trim().toUpperCase());
    if (to.sumberAir !== undefined) sh.getRange(row, cSA).setValue(String(to.sumberAir || '').trim());
    if (to.kodeAir !== undefined) sh.getRange(row, cKA).setValue(String(to.kodeAir || '').trim().toUpperCase());
    if (tgl) sh.getRange(row, cTgl).setValue(tgl);
    sh.getRange(row, cKet).setValue(ket);

    log_(ss, [new Date(), b.user || '', row, old[cEng - 1], old[cIrr - 1], oldLok, old[cWil - 1], oldKA, lokasi, to.wil || '', to.kodeAir || '', to.sumberAir || '', to.keterangan || '']);
    SpreadsheetApp.flush();
    return out_({ ok: true, row: row, lokasi: lokasi, keterangan: ket });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally { lock.releaseLock(); }
}

function log_(ss, rowVals) {
  var sh = ss.getSheetByName(SHEET_LOG);
  if (!sh) { sh = ss.insertSheet(SHEET_LOG); sh.appendRow(['Waktu', 'Pengguna', 'Baris', 'Kode Engine', 'Kode Irigator', 'Lokasi Lama', 'Wil Lama', 'Kode Air Lama', 'Lokasi Baru', 'Wil Baru', 'Kode Air Baru', 'Sumber Air Baru', 'Keterangan']); sh.setFrozenRows(1); }
  sh.appendRow(rowVals);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
