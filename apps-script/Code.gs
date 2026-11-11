/**
 * =====================================================================
 *  Field Support Irigasi PG 2 — Web App penulis (Apps Script)
 *  Dipakai tombol "Pindah Unit", "Tarik ke Bengkel", "Pasang Unit", "Tukar Unit" di
 *  dashboard untuk mengubah / menghapus / menambah baris pada sheet
 *  "Detail Terpasang" secara langsung.
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
var SHEET_MESIN = 'Mesin', SHEET_IRR = 'Irrigator';
var SHEET_SUMBER = 'Sumber Air', SHEET_LOG_POMPA = 'Log Pompa Sumur', SHEET_POMPA_SUMUR = 'Pompa Sumur', SHEET_POMPA_ARSIP = 'Pompa Sumur (Arsip)'; // kolom "Pompa" di sheet Sumber Air
var MAX_HISTORY = 400;                  // panjang maksimal kolom Keterangan

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'ping') {
    var info = {};
    try { var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID); info.spreadsheet = ss.getName(); info.sheetDetail = !!ss.getSheetByName(SHEET_DETAIL); } catch (err) { info.spreadsheetError = String(err); }
    info.pinSet = !!PropertiesService.getScriptProperties().getProperty('PIN');
    return out_({ ok: true, app: 'FS PG2 writer', version: 13, time: new Date().toISOString(), info: info });
  }
  return out_({ ok: false, error: 'Gunakan POST (action: move | withdraw | install | swap | pump) atau ?action=ping' });
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
  if (body.action === 'withdraw') return withdraw_(body);
  if (body.action === 'install') return install_(body);
  if (body.action === 'swap') return swap_(body);
  if (body.action === 'pump') return pump_(body);
  if (body.action === 'syncPompaSumur') return syncPompaSumur_(body);
  if (body.action === 'repairCells') return repairCells_(body);
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
    if (tgl) sh.getRange(row, cTgl).setValue(tgl);
    sh.getRange(row, cKet).setValue(ket);

    // Kode Air & Sumber Air: PERTAHANKAN RUMUS bila ada (atau pulihkan dari baris lain yang masih berumus).
    // Bila rumus menghasilkan kode untuk lokasi baru → pakai hasil rumus. Bila kosong/#N/A (lokasi belum
    // punya sumber air di sheet Sumber Air) → tulis nilai pilihan pengguna (kode terdekat) sebagai teks.
    var kaMode = applyFormulaOrValue_(sh, row, cKA, String(to.kodeAir || '').trim().toUpperCase());
    var saMode = applyFormulaOrValue_(sh, row, cSA, String(to.sumberAir || '').trim());
    var kaFinal = String(sh.getRange(row, cKA).getDisplayValue()).trim(), saFinal = String(sh.getRange(row, cSA).getDisplayValue()).trim();

    log_(ss, [new Date(), b.user || '', row, old[cEng - 1], old[cIrr - 1], oldLok, old[cWil - 1], oldKA, lokasi, to.wil || '', kaFinal + (kaMode === 'formula' ? ' (rumus)' : ''), saFinal, to.keterangan || '']);
    SpreadsheetApp.flush();
    return out_({ ok: true, row: row, lokasi: lokasi, keterangan: ket, kodeAir: kaFinal, kodeAirMode: kaMode, sumberAir: saFinal, sumberAirMode: saMode });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally { lock.releaseLock(); }
}

/* ---------- tarik ke bengkel: hapus baris unit di Detail Terpasang (+ opsional ubah Status di Mesin/Irrigator) ---------- */
function withdraw_(b) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return out_({ ok: false, error: 'Sheet sedang dipakai proses lain, coba lagi' });
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID), sh = ss.getSheetByName(SHEET_DETAIL);
    if (!sh) return out_({ ok: false, error: 'Sheet "' + SHEET_DETAIL + '" tidak ditemukan' });
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var col = function (name) { var i = headers.indexOf(name); if (i < 0) throw new Error('Kolom "' + name + '" tidak ada di header'); return i + 1; };
    var cLok = col('Lokasi'), cWil = col('Wil'), cEng = col('Kode Engine'), cIrr = col('Kode Irigator'), cKA = col('Kode Air');
    var from = b.from || {}, same = function (v) {
      return String(v[cLok - 1]).trim() === String(from.lokasi || '').trim() && String(v[cEng - 1]).trim() === String(from.kodeEngine || '').trim() && String(v[cIrr - 1]).trim() === String(from.kodeIrigator || '').trim();
    };
    var row = Number(b.row) || 0;
    if (!(row >= 2 && row <= lastRow && same(sh.getRange(row, 1, 1, lastCol).getValues()[0]))) {
      row = 0; var all = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
      for (var i = 0; i < all.length; i++) if (same(all[i])) { if (row) return out_({ ok: false, error: 'Ada lebih dari satu baris yang cocok — rapikan baris ganda dulu' }); row = i + 2; }
      if (!row) return out_({ ok: false, error: 'Baris unit tidak ditemukan (mungkin sudah diubah orang lain). Refresh dashboard lalu ulangi.' });
    }
    var old = sh.getRange(row, 1, 1, lastCol).getValues()[0];
    var eng = String(old[cEng - 1]).trim(), irr = String(old[cIrr - 1]).trim();
    // kolom "No" biasanya rumus berantai (=A9+1). Simpan pola R1C1-nya sebelum hapus, lalu pulihkan sel yang jadi #REF!.
    var cNo = headers.indexOf('No') + 1, noFix = 0;
    var noPattern = cNo ? captureNoPattern_(sh, row, cNo, lastRow) : '';
    sh.deleteRow(row);
    if (cNo) noFix = repairNoColumn_(sh, row, cNo, noPattern);

    // opsional: perbarui kolom Status unit di sheet Mesin / Irrigator (mis. "Standby" / "Rusak")
    var upd = { mesin: '', irrigator: '' };
    if (b.statusMesin && eng) upd.mesin = setStatus_(ss, SHEET_MESIN, 'Kode Unit', eng, String(b.statusMesin));
    if (b.statusIrrigator && irr) upd.irrigator = setStatus_(ss, SHEET_IRR, 'KODE UNIT', irr, String(b.statusIrrigator));

    log_(ss, [new Date(), b.user || '', row, eng, irr, old[cLok - 1], old[cWil - 1], old[cKA - 1], 'TARIK KE BENGKEL', '', '', '', String(b.keterangan || '') + (upd.mesin ? ' | Mesin → ' + upd.mesin : '') + (upd.irrigator ? ' | Irrigator → ' + upd.irrigator : '')]);
    SpreadsheetApp.flush();
    return out_({ ok: true, row: row, deleted: true, status: upd, noFixed: noFix });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally { lock.releaseLock(); }
}

/* ---------- pasang unit: sisipkan baris baru di bawah baris terakhir wilayah yang sama ----------
 * Kolom yang diisi manual: Tanggal, Bengkel, Lokasi, Wil, Kode Engine, Kode Irigator, Keterangan.
 * Kolom lain (No, Jenis Engine, Terpasang, Power, Sumber Air, Kode Air, …) MENIRU RUMUS baris acuan
 * (relatif, R1C1). Bila kolom tsb tidak berumus, atau rumusnya menghasilkan kosong/error, dipakai
 * nilai usulan dari dashboard (values[header]) sebagai teks.
 */
function install_(b) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return out_({ ok: false, error: 'Sheet sedang dipakai proses lain, coba lagi' });
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID), sh = ss.getSheetByName(SHEET_DETAIL);
    if (!sh) return out_({ ok: false, error: 'Sheet "' + SHEET_DETAIL + '" tidak ditemukan' });
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var col = function (name) { var i = headers.indexOf(name); if (i < 0) throw new Error('Kolom "' + name + '" tidak ada di header'); return i + 1; };
    var cLok = col('Lokasi'), cWil = col('Wil'), cEng = col('Kode Engine'), cIrr = col('Kode Irigator'), cKet = col('Keterangan'), cTgl = col('Tanggal'), cBkl = col('Bengkel');
    var cNo = headers.indexOf('No') + 1;

    var m = b.manual || {}, vals = b.values || {};
    var lokasi = String(m.lokasi || '').trim().toUpperCase(), wil = String(m.wil || '').trim().toUpperCase();
    var eng = String(m.kodeEngine || '').trim().toUpperCase(), irr = String(m.kodeIrigator || '').trim().toUpperCase();
    if (!lokasi) return out_({ ok: false, error: 'Lokasi kosong' });
    if (!wil) return out_({ ok: false, error: 'Wil kosong' });
    if (!eng && !irr) return out_({ ok: false, error: 'Isi minimal Kode Engine atau Kode Irigator' });

    // tolak bila unit masih tercatat terpasang di baris lain
    var data = lastRow >= 2 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
    for (var i = 0; i < data.length; i++) {
      if (eng && String(data[i][cEng - 1]).trim().toUpperCase() === eng) return out_({ ok: false, error: 'Kode Engine ' + eng + ' masih terpasang di ' + data[i][cLok - 1] + ' (baris ' + (i + 2) + '). Pindahkan / tarik dulu.' });
      if (irr && String(data[i][cIrr - 1]).trim().toUpperCase() === irr) return out_({ ok: false, error: 'Kode Irigator ' + irr + ' masih terpasang di ' + data[i][cLok - 1] + ' (baris ' + (i + 2) + '). Pindahkan / tarik dulu.' });
    }

    // baris acuan = baris terakhir dengan Wil yang sama; bila wilayah belum ada → baris data terakhir
    var ref = 0;
    for (var j = data.length - 1; j >= 0; j--) if (String(data[j][cWil - 1]).trim().toUpperCase() === wil) { ref = j + 2; break; }
    var placed = ref ? 'wil' : 'end';
    if (!ref) ref = Math.max(lastRow, 1);

    // simpan pola rumus (R1C1) tiap kolom dari baris acuan (atau baris berumus terdekat pada kolom itu)
    var pattern = [];
    for (var c = 1; c <= lastCol; c++) {
      var f = ref >= 2 ? sh.getRange(ref, c).getFormulaR1C1() : '';
      if (!f && lastRow >= 2) { var t = findFormulaCell_(sh, ref >= 2 ? ref : 2, c); if (t) f = t.getFormulaR1C1(); }
      pattern.push(f || '');
    }

    sh.insertRowAfter(ref);
    var row = ref + 1;
    // format (tanggal, border, dsb.) ikut baris acuan
    if (ref >= 2) sh.getRange(ref, 1, 1, lastCol).copyTo(sh.getRange(row, 1, 1, lastCol), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);

    // 1) kolom manual
    var tgl = null;
    if (m.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(m.tanggal)) { var p = m.tanggal.split('-'); tgl = new Date(+p[0], +p[1] - 1, +p[2]); }
    sh.getRange(row, cTgl).setValue(tgl || new Date());
    sh.getRange(row, cBkl).setValue(String(m.bengkel || '').trim());
    sh.getRange(row, cLok).setValue(lokasi);
    sh.getRange(row, cWil).setValue(wil);
    sh.getRange(row, cEng).setValue(eng);
    sh.getRange(row, cIrr).setValue(irr);
    sh.getRange(row, cKet).setValue(String(m.keterangan || '').trim());
    var manualCols = [cTgl, cBkl, cLok, cWil, cEng, cIrr, cKet];

    // 2) kolom lain: tiru rumus; bila tidak berumus / hasil kosong → nilai usulan
    var modes = {};
    for (var c2 = 1; c2 <= lastCol; c2++) {
      if (manualCols.indexOf(c2) >= 0 || !headers[c2 - 1]) continue;
      var h = headers[c2 - 1], cell = sh.getRange(row, c2), v = vals[h] !== undefined ? String(vals[h]).trim() : '';
      if (c2 === cNo) continue; // ditangani khusus di bawah
      if (pattern[c2 - 1]) {
        cell.setFormulaR1C1(pattern[c2 - 1]); SpreadsheetApp.flush();
        var shown = String(cell.getDisplayValue()).trim();
        if (shown && !/^#(N\/A|REF!|VALUE!|NAME\?|ERROR!|DIV\/0!|NUM!)/.test(shown)) { modes[h] = 'formula'; continue; }
        if (!v) { modes[h] = 'empty-formula'; continue; }
      }
      if (v) { cell.setValue(v); modes[h] = 'value'; } else modes[h] = 'empty';
    }

    // 3) kolom No: rumus berantai → pasang pola di baris baru DAN baris setelahnya (agar rantai tersambung); bila angka → nomor ulang
    var noFix = 0;
    if (cNo) {
      var noPat = pattern[cNo - 1] || (ref >= 2 && sh.getRange(ref, cNo).getFormula() ? sh.getRange(ref, cNo).getFormulaR1C1() : '');
      var newLast = sh.getLastRow();
      if (noPat) {
        if (row === 2) sh.getRange(2, cNo).setValue(1); else sh.getRange(row, cNo).setFormulaR1C1(noPat);
        if (row + 1 <= newLast && sh.getRange(row + 1, cNo).getFormula()) sh.getRange(row + 1, cNo).setFormulaR1C1(noPat);
        noFix = repairNoColumn_(sh, row, cNo, noPat);
        modes['No'] = 'formula';
      } else {
        var n = ref >= 2 ? Number(sh.getRange(ref, cNo).getValue()) : 0;
        for (var r2 = row; r2 <= newLast; r2++) sh.getRange(r2, cNo).setValue(++n);
        modes['No'] = 'value';
      }
    }

    // 4) status unit di sheet Mesin / Irrigator (mis. "Terpasang")
    var upd = { mesin: '', irrigator: '' };
    if (b.statusMesin && eng) upd.mesin = setStatus_(ss, SHEET_MESIN, 'Kode Unit', eng, String(b.statusMesin));
    if (b.statusIrrigator && irr) upd.irrigator = setStatus_(ss, SHEET_IRR, 'KODE UNIT', irr, String(b.statusIrrigator));

    SpreadsheetApp.flush();
    var out = sh.getRange(row, 1, 1, lastCol).getDisplayValues()[0], rowObj = {};
    headers.forEach(function (h2, k) { if (h2) rowObj[h2] = out[k]; });
    log_(ss, [new Date(), b.user || '', row, eng, irr, 'PASANG BARU', '', '', lokasi, wil, rowObj['Kode Air'] || '', rowObj['Sumber Air'] || '',
      String(m.keterangan || '') + (upd.mesin ? ' | Mesin → ' + upd.mesin : '') + (upd.irrigator ? ' | Irrigator → ' + upd.irrigator : '')]);
    return out_({ ok: true, row: row, placed: placed, afterRow: ref, rowData: rowObj, modes: modes, status: upd, noFixed: noFix });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally { lock.releaseLock(); }
}

/* ---------- tukar / ganti engine atau irigator pada lokasi yang sudah terpasang ----------
 * body.kind  : 'engine' | 'irrigator'  (kolom "Kode Engine" / "Kode Irigator")
 * body.mode  : 'swap'    → unit di baris A bertukar dengan unit di baris B (keduanya terpasang)
 *              'replace' → unit di baris A diganti body.newKode (unit standby); unit lama kembali ke bengkel
 * body.a / body.b : {row, lokasi, kodeEngine, kodeIrigator} (verifikasi isi baris seperti move_)
 * body.tanggal 'yyyy-mm-dd', body.keterangan, body.statusOld / body.statusNew (kolom Status di sheet Mesin/Irrigator)
 * body.derived : {a:{'Jenis Engine':..,'Power':..}, b:{...}} → hanya ditulis bila sel tsb TIDAK berumus
 * Riwayat ditambahkan ke kolom Keterangan tiap baris; dicatat juga di "Log Perpindahan".
 */
function swap_(b) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return out_({ ok: false, error: 'Sheet sedang dipakai proses lain, coba lagi' });
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID), sh = ss.getSheetByName(SHEET_DETAIL);
    if (!sh) return out_({ ok: false, error: 'Sheet "' + SHEET_DETAIL + '" tidak ditemukan' });
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var col = function (name) { var i = headers.indexOf(name); if (i < 0) throw new Error('Kolom "' + name + '" tidak ada di header'); return i + 1; };
    var cLok = col('Lokasi'), cWil = col('Wil'), cEng = col('Kode Engine'), cIrr = col('Kode Irigator'), cKet = col('Keterangan'), cTgl = col('Tanggal'), cKA = col('Kode Air');
    var isIrr = b.kind === 'irrigator', cUnit = isIrr ? cIrr : cEng, label = isIrr ? 'irigator' : 'engine';
    var mode = b.mode === 'replace' ? 'replace' : 'swap';

    var all = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
    var same = function (v, f) {
      return String(v[cLok - 1]).trim() === String(f.lokasi || '').trim() && String(v[cEng - 1]).trim() === String(f.kodeEngine || '').trim() && String(v[cIrr - 1]).trim() === String(f.kodeIrigator || '').trim();
    };
    var findRow = function (f, nm) {
      var row = Number(f && f.row) || 0;
      if (row >= 2 && row <= lastRow && same(all[row - 2], f)) return row;
      row = 0;
      for (var i = 0; i < all.length; i++) if (same(all[i], f)) { if (row) throw new Error('Ada lebih dari satu baris yang cocok untuk ' + nm + ' (' + f.lokasi + ') — rapikan baris ganda dulu'); row = i + 2; }
      if (!row) throw new Error('Baris ' + nm + ' (' + (f && f.lokasi) + ') tidak ditemukan — mungkin sudah diubah orang lain. Refresh dashboard lalu ulangi.');
      return row;
    };
    var rowA = findRow(b.a, 'lokasi A'), rowB = 0;
    var oldA = all[rowA - 2].slice(), kodeA = String(oldA[cUnit - 1]).trim(), lokA = String(oldA[cLok - 1]).trim();
    var kodeB = '', lokB = '', oldB = null;
    if (mode === 'swap') {
      rowB = findRow(b.b, 'lokasi B');
      if (rowB === rowA) return out_({ ok: false, error: 'Lokasi A dan B sama' });
      oldB = all[rowB - 2].slice(); kodeB = String(oldB[cUnit - 1]).trim(); lokB = String(oldB[cLok - 1]).trim();
      if (!kodeA && !kodeB) return out_({ ok: false, error: 'Kedua baris tidak punya kode ' + label });
    } else {
      kodeB = String(b.newKode || '').trim().toUpperCase();
      if (!kodeB) return out_({ ok: false, error: 'Kode ' + label + ' pengganti kosong' });
      if (kodeB === kodeA) return out_({ ok: false, error: 'Kode pengganti sama dengan kode sekarang' });
      for (var k = 0; k < all.length; k++) if (String(all[k][cUnit - 1]).trim().toUpperCase() === kodeB) return out_({ ok: false, error: 'Kode ' + kodeB + ' masih terpasang di ' + all[k][cLok - 1] + ' (baris ' + (k + 2) + '). Gunakan mode Tukar antar lokasi.' });
    }

    var tgl = null;
    if (b.tanggal && /^\d{4}-\d{2}-\d{2}$/.test(b.tanggal)) { var p = b.tanggal.split('-'); tgl = new Date(+p[0], +p[1] - 1, +p[2]); }
    var stamp = Utilities.formatDate(tgl || new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy');
    var note = String(b.keterangan || '').trim();
    var addKet = function (row, oldKet, hist) {
      var ket = [note, hist, String(oldKet || '').trim()].filter(String).join(' | ');
      if (ket.length > MAX_HISTORY) ket = ket.slice(0, MAX_HISTORY - 1) + '…';
      sh.getRange(row, cKet).setValue(ket); return ket;
    };
    var writeDerived = function (row, d) {
      if (!d) return;
      Object.keys(d).forEach(function (h) {
        var c = headers.indexOf(h) + 1; if (!c || c === cUnit) return;
        var cell = sh.getRange(row, c); if (cell.getFormula()) return;
        cell.setValue(String(d[h] || '').trim());
      });
    };
    var derived = b.derived || {};
    var cap = label.charAt(0).toUpperCase() + label.slice(1);

    sh.getRange(rowA, cUnit).setValue(kodeB);
    if (tgl) sh.getRange(rowA, cTgl).setValue(tgl);
    var ketA = addKet(rowA, oldA[cKet - 1], mode === 'swap'
      ? 'Tukar ' + label + ' ' + (kodeA || '–') + ' → ' + (kodeB || '–') + ' (dengan ' + lokB + ') ' + stamp
      : 'Ganti ' + label + ' ' + (kodeA || '–') + ' → ' + kodeB + ' ' + stamp);
    writeDerived(rowA, derived.a);

    var ketB = '';
    if (mode === 'swap') {
      sh.getRange(rowB, cUnit).setValue(kodeA);
      if (tgl) sh.getRange(rowB, cTgl).setValue(tgl);
      ketB = addKet(rowB, oldB[cKet - 1], 'Tukar ' + label + ' ' + (kodeB || '–') + ' → ' + (kodeA || '–') + ' (dengan ' + lokA + ') ' + stamp);
      writeDerived(rowB, derived.b);
    }

    // status unit di sheet Mesin / Irrigator (hanya mode ganti)
    var upd = { old: '', neu: '' }, shName = isIrr ? SHEET_IRR : SHEET_MESIN, keyH = isIrr ? 'KODE UNIT' : 'Kode Unit';
    if (mode === 'replace') {
      if (b.statusOld && kodeA) upd.old = setStatus_(ss, shName, keyH, kodeA, String(b.statusOld));
      if (b.statusNew && kodeB) upd.neu = setStatus_(ss, shName, keyH, kodeB, String(b.statusNew));
    }

    var tag = mode === 'swap' ? 'TUKAR ' + cap.toUpperCase() : 'GANTI ' + cap.toUpperCase();
    var engA = isIrr ? oldA[cEng - 1] : kodeB, irrA = isIrr ? kodeB : oldA[cIrr - 1];
    log_(ss, [new Date(), b.user || '', rowA, engA, irrA, lokA, oldA[cWil - 1], oldA[cKA - 1], lokA + ' (' + tag + ')', oldA[cWil - 1], oldA[cKA - 1], '', cap + ' ' + (kodeA || '–') + ' → ' + (kodeB || '–') + (note ? ' | ' + note : '') + (upd.old ? ' | ' + kodeA + ' → ' + upd.old : '') + (upd.neu ? ' | ' + kodeB + ' → ' + upd.neu : '')]);
    if (mode === 'swap') {
      var engB = isIrr ? oldB[cEng - 1] : kodeA, irrB = isIrr ? kodeA : oldB[cIrr - 1];
      log_(ss, [new Date(), b.user || '', rowB, engB, irrB, lokB, oldB[cWil - 1], oldB[cKA - 1], lokB + ' (' + tag + ')', oldB[cWil - 1], oldB[cKA - 1], '', cap + ' ' + (kodeB || '–') + ' → ' + (kodeA || '–') + (note ? ' | ' + note : '')]);
    }
    SpreadsheetApp.flush();
    return out_({ ok: true, mode: mode, kind: b.kind, rowA: rowA, rowB: rowB, kodeA: kodeB, kodeB: mode === 'swap' ? kodeA : '', ketA: ketA, ketB: ketB, status: upd });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally { lock.releaseLock(); }
}

/* ---------- pompa sumur bor: ubah kolom "Pompa" di sheet Sumber Air ----------
 * body.changes = [{kode:'SW08001', pompa:'Kosong', expect:'Ada Pompa'}, {kode:'SW08007', pompa:'Ada Pompa'}]
 * Hanya kolom "Pompa" yang ditulis (nilai teks). Kolom Status/Update dibiarkan (bila berumus akan ikut berubah sendiri).
 */
function pump_(b) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return out_({ ok: false, error: 'Sheet sedang dipakai proses lain, coba lagi' });
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID), sh = ss.getSheetByName(SHEET_SUMBER);
    if (!sh) return out_({ ok: false, error: 'Sheet "' + SHEET_SUMBER + '" tidak ditemukan' });
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var cKode = headers.indexOf('Kode Baru') + 1, cPompa = headers.indexOf('Pompa') + 1, cLok = headers.indexOf('Lokasi') + 1, cJenis = headers.indexOf('Jenis Sumber Air') + 1, cStatus = headers.indexOf('Status') + 1, cUpd = headers.indexOf('Update') + 1, cKet = headers.indexOf('Keterangan') + 1;
    if (!cKode || !cPompa) return out_({ ok: false, error: 'Kolom "Kode Baru" / "Pompa" tidak ada di header sheet Sumber Air' });
    var changes = Array.isArray(b.changes) ? b.changes : [];
    if (!changes.length) return out_({ ok: false, error: 'Tidak ada perubahan' });
    var allowed = ['Ada Pompa', 'Kosong', 'Rusak'];
    var codes = sh.getRange(2, cKode, lastRow - 1, 1).getValues().map(function (v) { return String(v[0]).trim().toUpperCase(); });
    var plan = [];
    for (var i = 0; i < changes.length; i++) {
      var ch = changes[i], kode = String(ch.kode || '').trim().toUpperCase(), val = String(ch.pompa || '').trim();
      if (allowed.indexOf(val) < 0) return out_({ ok: false, error: 'Nilai Pompa tidak valid: ' + val + ' (pakai Ada Pompa / Kosong / Rusak)' });
      var idx = codes.indexOf(kode); if (idx < 0) return out_({ ok: false, error: 'Kode ' + kode + ' tidak ditemukan di sheet Sumber Air' });
      if (codes.indexOf(kode, idx + 1) >= 0) return out_({ ok: false, error: 'Kode ' + kode + ' ganda di sheet Sumber Air — rapikan dulu' });
      var row = idx + 2, cur = String(sh.getRange(row, cPompa).getDisplayValue()).trim();
      if (ch.expect !== undefined && ch.expect !== null && String(ch.expect).trim() !== cur) return out_({ ok: false, error: 'Data ' + kode + ' sudah berubah (Pompa sekarang "' + (cur || 'kosong') + '"). Refresh dashboard lalu ulangi.' });
      plan.push({ kode: kode, row: row, from: cur, to: val, lokasi: cLok ? sh.getRange(row, cLok).getDisplayValue() : '', jenis: cJenis ? sh.getRange(row, cJenis).getDisplayValue() : '' });
    }
    // riwayat di kolom "Keterangan" sheet Sumber Air (seperti Pindah Engine): [keterangan baru | riwayat | keterangan lama]
    var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy'), who = b.user ? ' (' + b.user + ')' : '';
    var userNote = String(b.keterangan || '').trim();
    var src = plan.filter(function (x) { return /ada/i.test(x.from) && !/ada/i.test(x.to); })[0];   // sumur asal (pompa diambil)
    var dst = plan.filter(function (x) { return !/ada/i.test(x.from) && /ada/i.test(x.to); })[0];   // sumur tujuan (pompa dipasang)
    var results = [];
    for (var j = 0; j < plan.length; j++) {
      var p = plan[j]; sh.getRange(p.row, cPompa).setValue(p.to);
      var hist;
      if (plan.length > 1 && p === src && dst) hist = 'Pompa dipindah ke ' + dst.kode + (dst.lokasi ? ' (' + dst.lokasi + ')' : '') + ' ' + stamp + who + (p.to !== 'Kosong' ? ' → ' + p.to : '');
      else if (plan.length > 1 && p === dst && src) hist = 'Pompa dipindah dari ' + src.kode + (src.lokasi ? ' (' + src.lokasi + ')' : '') + ' ' + stamp + who;
      else hist = 'Pompa: ' + (p.from || 'kosong') + ' → ' + p.to + ' ' + stamp + who;
      p.hist = hist;
      if (cKet) {
        var oldKet = String(sh.getRange(p.row, cKet).getDisplayValue() || '').trim();
        var ket = [userNote, hist, oldKet].filter(String).join(' | ');
        if (ket.length > MAX_HISTORY) ket = ket.slice(0, MAX_HISTORY - 1) + '…';
        sh.getRange(p.row, cKet).setValue(ket);
      }
      results.push({ kode: p.kode, row: p.row, from: p.from, to: p.to, lokasi: p.lokasi, hist: hist });
    }
    SpreadsheetApp.flush();
    for (var k = 0; k < results.length; k++) { var r = results[k]; r.status = cStatus ? sh.getRange(r.row, cStatus).getDisplayValue() : ''; r.update = cUpd ? sh.getRange(r.row, cUpd).getDisplayValue() : ''; }
    var lg = ss.getSheetByName(SHEET_LOG_POMPA);
    if (!lg) { lg = ss.insertSheet(SHEET_LOG_POMPA); lg.appendRow(['Waktu', 'Pengguna', 'Aksi', 'Kode Sumur', 'Lokasi', 'Baris', 'Pompa Lama', 'Pompa Baru', 'Keterangan']); lg.setFrozenRows(1); }
    var aksi = String(b.mode || (plan.length > 1 ? 'PINDAH POMPA' : 'UBAH POMPA')).toUpperCase(), note = String(b.keterangan || '');
    if (plan.length > 1) note = (note ? note + ' | ' : '') + plan.map(function (x) { return x.kode; }).join(' → ');
    results.forEach(function (r) { lg.appendRow([new Date(), b.user || '', aksi, r.kode, r.lokasi, r.row, r.from, r.to, note]); });
    // opsional: pindahkan catatan pompa di sheet "Pompa Sumur" (kolom LOKASI) ke lokasi sumur tujuan
    var sumurRes = null;
    if (b.sumur && b.sumur.fromLokasi && b.sumur.toLokasi) sumurRes = movePompaSumur_(ss, String(b.sumur.fromLokasi), String(b.sumur.toLokasi), String(b.sumur.toKode || ''), b.user || '');
    return out_({ ok: true, results: results, sumur: sumurRes });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally { lock.releaseLock(); }
}

/* ---------- tambah baris di sheet "Pompa Sumur" untuk sumur ber-pompa (Sumber Air) yang belum punya catatan ----------
 * body.items = [{lokasi:'108D', kode:'SW08002', kondisi:'Baik', status:'Siap Operasi'}, ...]
 * Baris baru disisipkan di bawah baris terakhir; format & rumus (bila ada) meniru baris terakhir; kolom yang diisi:
 *   LOKASI, Kondisi Akhir Sumur (dari Kondisi Sumur Sumber Air), Keterangan = "SIAP PAKAI" bila status Siap Operasi/Standby.
 */
function syncPompaSumur_(b) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return out_({ ok: false, error: 'Sheet sedang dipakai proses lain, coba lagi' });
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID), sh = ss.getSheetByName(SHEET_POMPA_SUMUR);
    if (!sh) return out_({ ok: false, error: 'Sheet "' + SHEET_POMPA_SUMUR + '" tidak ditemukan' });
    var items = Array.isArray(b.items) ? b.items : [], removeList = Array.isArray(b.remove) ? b.remove : [];
    if (!items.length && !removeList.length) return out_({ ok: false, error: 'Tidak ada perubahan yang dipilih' });
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var up = headers.map(function (h) { return h.toUpperCase(); });
    var cLok = up.indexOf('LOKASI') + 1, cNo = up.indexOf('NO') + 1, cKond = up.indexOf('KONDISI AKHIR SUMUR') + 1, cKet = up.indexOf('KETERANGAN') + 1;
    if (!cLok) return out_({ ok: false, error: 'Kolom LOKASI tidak ada di sheet ' + SHEET_POMPA_SUMUR });
    var norm = function (v) { return String(v || '').toUpperCase().replace(/\s+/g, ''); };
    var existing = {}, maxNo = 0, lastData = 1;
    if (lastRow >= 2) {
      var data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
      data.forEach(function (r, i) { var l = norm(r[cLok - 1]); if (l) { existing[l] = i + 2; lastData = i + 2; } if (cNo) { var n = Number(r[cNo - 1]); if (isFinite(n) && n > maxNo) maxNo = n; } });
    }
    var lower = lastData >= 2 && /[a-z]/.test(String(sh.getRange(lastData, cLok).getValue())) && !/[A-Z]/.test(String(sh.getRange(lastData, cLok).getValue()));
    var noPat = cNo && lastData >= 2 ? sh.getRange(lastData, cNo).getFormulaR1C1() : '';
    var added = [], skipped = [];
    items.forEach(function (it) {
      var lok = norm(it.lokasi); if (!lok) return;
      if (existing[lok]) { skipped.push({ lokasi: lok, reason: 'sudah ada (baris ' + existing[lok] + ')' }); return; }
      var row = lastData + 1;
      if (row > sh.getMaxRows()) sh.insertRowAfter(sh.getMaxRows()); else if (lastData >= 2) sh.insertRowAfter(lastData);
      if (lastData >= 2) sh.getRange(lastData, 1, 1, lastCol).copyTo(sh.getRange(row, 1, 1, lastCol), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
      // tiru rumus kolom (bila ada) dari baris terakhir
      if (lastData >= 2) for (var c = 1; c <= lastCol; c++) { var f = sh.getRange(lastData, c).getFormulaR1C1(); if (f) sh.getRange(row, c).setFormulaR1C1(f); }
      sh.getRange(row, cLok).setValue(lower ? lok.toLowerCase() : lok);
      if (cNo) { if (noPat) sh.getRange(row, cNo).setFormulaR1C1(noPat); else sh.getRange(row, cNo).setValue(++maxNo); }
      if (cKond && it.kondisi) sh.getRange(row, cKond).setValue(String(it.kondisi).trim());
      if (cKet) sh.getRange(row, cKet).setValue(/siap/i.test(String(it.status || '')) ? 'SIAP PAKAI' : '');
      existing[lok] = row; lastData = row;
      added.push({ lokasi: lok, kode: it.kode || '', row: row });
    });
    // ARSIPKAN catatan yang lokasinya di Sumber Air sudah tidak ber-pompa: salin nilai ke sheet arsip, lalu hapus barisnya
    var archived = [];
    if (removeList.length) {
      var ar = ss.getSheetByName(SHEET_POMPA_ARSIP);
      if (!ar) { ar = ss.insertSheet(SHEET_POMPA_ARSIP); ar.appendRow(['Diarsipkan', 'Oleh', 'Alasan'].concat(headers)); ar.setFrozenRows(1); }
      var rowsToDel = [];
      removeList.forEach(function (it) {
        var lok = norm(it.lokasi), r = lok && existing[lok]; if (!r) { skipped.push({ lokasi: lok, reason: 'tidak ditemukan' }); return; }
        var vals = sh.getRange(r, 1, 1, lastCol).getDisplayValues()[0];
        ar.appendRow([new Date(), b.user || '', 'Pompa di Sumber Air: ' + (it.pompa || 'tidak ada') + ' (pompa sudah dipindah)'].concat(vals));
        rowsToDel.push(r); archived.push({ lokasi: lok, row: r, pompa: it.pompa || '' }); delete existing[lok];
      });
      var noPatDel = cNo && rowsToDel.length ? captureNoPattern_(sh, rowsToDel[0], cNo, sh.getLastRow()) : '';
      rowsToDel.sort(function (a, b2) { return b2 - a; }).forEach(function (r) { sh.deleteRow(r); });
      if (cNo && rowsToDel.length) repairNoColumn_(sh, Math.min.apply(null, rowsToDel), cNo, noPatDel);
    }
    SpreadsheetApp.flush();
    var lg = ss.getSheetByName(SHEET_LOG_POMPA);
    if (!lg) { lg = ss.insertSheet(SHEET_LOG_POMPA); lg.appendRow(['Waktu', 'Pengguna', 'Aksi', 'Kode Sumur', 'Lokasi', 'Baris', 'Pompa Lama', 'Pompa Baru', 'Keterangan']); lg.setFrozenRows(1); }
    archived.forEach(function (a) { lg.appendRow([new Date(), b.user || '', 'ARSIPKAN CATATAN POMPA SUMUR', '', a.lokasi, a.row, 'Ada Pompa', a.pompa, 'Baris dipindah ke sheet ' + SHEET_POMPA_ARSIP + ' (pompa sudah tidak di lokasi ini menurut Sumber Air)']); });
    added.forEach(function (a) { lg.appendRow([new Date(), b.user || '', 'TAMBAH CATATAN POMPA SUMUR', a.kode, a.lokasi, a.row, '', 'Ada Pompa', 'Baris baru di sheet ' + SHEET_POMPA_SUMUR + ' (sinkron dari Sumber Air)']); });
    return out_({ ok: true, added: added, archived: archived, skipped: skipped });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally { lock.releaseLock(); }
}

// Pindahkan catatan pompa sumur: cari baris dengan LOKASI = fromLokasi (abaikan spasi/huruf besar), ubah ke toLokasi, tambah riwayat di Keterangan
function movePompaSumur_(ss, fromLok, toLok, toKode, user) {
  try {
    var sh = ss.getSheetByName(SHEET_POMPA_SUMUR); if (!sh) return { ok: false, error: 'Sheet "' + SHEET_POMPA_SUMUR + '" tidak ditemukan' };
    var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    var cLok = headers.map(function (h) { return h.toUpperCase(); }).indexOf('LOKASI') + 1, cKet = headers.indexOf('Keterangan') + 1;
    if (!cLok) return { ok: false, error: 'Kolom LOKASI tidak ada di sheet ' + SHEET_POMPA_SUMUR };
    var norm = function (v) { return String(v || '').toUpperCase().replace(/\s+/g, ''); };
    var vals = lastRow >= 2 ? sh.getRange(2, cLok, lastRow - 1, 1).getValues() : [], row = 0, dup = false;
    for (var i = 0; i < vals.length; i++) if (norm(vals[i][0]) === norm(fromLok)) { if (row) dup = true; row = i + 2; }
    if (!row) return { ok: false, error: 'Lokasi ' + fromLok + ' tidak ada di sheet ' + SHEET_POMPA_SUMUR };
    if (dup) return { ok: false, error: 'Lokasi ' + fromLok + ' ganda di sheet ' + SHEET_POMPA_SUMUR + ' — rapikan dulu' };
    for (var j = 0; j < vals.length; j++) if (norm(vals[j][0]) === norm(toLok) && j + 2 !== row) return { ok: false, error: 'Lokasi tujuan ' + toLok + ' sudah punya catatan pompa di sheet ' + SHEET_POMPA_SUMUR };
    // pertahankan gaya penulisan lokasi yang ada (huruf kecil / kapital)
    var oldRaw = String(vals[row - 2][0]), newVal = /[a-z]/.test(oldRaw) && !/[A-Z]/.test(oldRaw) ? toLok.toLowerCase() : toLok.toUpperCase();
    sh.getRange(row, cLok).setValue(newVal);
    if (cKet) {
      var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'dd/MM/yyyy');
      var oldKet = String(sh.getRange(row, cKet).getDisplayValue()).trim();
      var hist = 'Pindah dari ' + norm(fromLok) + (toKode ? ' ke ' + toKode : '') + ' ' + stamp + (user ? ' (' + user + ')' : '');
      var ket = [oldKet, hist].filter(String).join(' | '); if (ket.length > MAX_HISTORY) ket = ket.slice(0, MAX_HISTORY - 1) + '…';
      sh.getRange(row, cKet).setValue(ket);
    }
    return { ok: true, row: row, from: norm(fromLok), to: norm(toLok) };
  } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
}

// ambil pola rumus relatif (R1C1) kolom No: dari baris yang dihapus, atau baris lain yang berumus
function captureNoPattern_(sh, row, cNo, lastRow) {
  var f = sh.getRange(row, cNo).getFormulaR1C1();
  if (f) return f;
  var cand = [row - 1, row + 1, row - 2, row + 2];
  for (var i = 0; i < cand.length; i++) if (cand[i] >= 3 && cand[i] <= lastRow) { f = sh.getRange(cand[i], cNo).getFormulaR1C1(); if (f) return f; }
  return '';
}

// setelah deleteRow: setiap sel kolom No yang error (#REF!) atau berisi "#REF" di rumusnya diisi ulang dengan pola R1C1; baris 2 (data pertama) diberi angka 1
function repairNoColumn_(sh, row, cNo, pattern) {
  var lastRow = sh.getLastRow(), fixed = 0; if (lastRow < 2) return 0;
  var rng = sh.getRange(2, cNo, lastRow - 1, 1), fs = rng.getFormulas(), vs = rng.getDisplayValues();
  for (var i = 0; i < fs.length; i++) {
    var r = i + 2, broken = /#REF/i.test(fs[i][0]) || /^#/.test(String(vs[i][0]));
    if (!broken) continue;
    if (r === 2) sh.getRange(r, cNo).setValue(1);
    else if (pattern) sh.getRange(r, cNo).setFormulaR1C1(pattern);
    else sh.getRange(r, cNo).setFormulaR1C1('=R[-1]C+1');
    fixed++;
  }
  // bila baris yang dihapus adalah baris data pertama dan sel baru di baris 2 masih rumus ke header, paksa angka 1
  if (row === 2 && lastRow >= 2 && sh.getRange(2, cNo).getFormula()) { sh.getRange(2, cNo).setValue(1); fixed++; }
  return fixed;
}

// ubah kolom "Status" pada baris dengan kode unit tertentu; mengembalikan status baru atau '' bila tidak ditemukan
function setStatus_(ss, sheetName, keyHeader, code, status) {
  var sh = ss.getSheetByName(sheetName); if (!sh) return '';
  var lastCol = sh.getLastColumn(), lastRow = sh.getLastRow();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
  var ik = headers.map(function (h) { return h.toLowerCase(); }).indexOf(keyHeader.toLowerCase()), is = headers.indexOf('Status');
  if (ik < 0 || is < 0 || lastRow < 2) return '';
  var keys = sh.getRange(2, ik + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) if (String(keys[i][0]).trim() === code) { sh.getRange(i + 2, is + 1).setValue(status); return status; }
  return '';
}

/**
 * Pastikan sel (row,col) berumus bila kolom tersebut memang memakai rumus di baris lain, lalu evaluasi:
 *  - rumus menghasilkan nilai (bukan kosong / error) → biarkan rumus ("formula")
 *  - rumus kosong/error atau kolom memang tidak berumus → tulis nilai teks ("value") bila ada; kembalikan "empty" bila nilai kosong
 */
function applyFormulaOrValue_(sh, row, col, value) {
  var cell = sh.getRange(row, col);
  if (!cell.getFormula()) {
    var tpl = findFormulaCell_(sh, row, col);
    if (tpl) tpl.copyTo(cell, SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false); // referensi relatif ikut bergeser
  }
  if (cell.getFormula()) {
    SpreadsheetApp.flush();
    var shown = String(cell.getDisplayValue()).trim();
    if (shown && !/^#(N\/A|REF!|VALUE!|NAME\?|ERROR!|DIV\/0!|NUM!)/.test(shown)) return 'formula';
    if (!value) return 'empty-formula'; // tidak ada pengganti: biarkan rumus (kosong) agar terlihat perlu dilengkapi
  }
  if (value) { cell.setValue(value); return 'value'; }
  if (!cell.getFormula()) cell.setValue('');
  return 'empty';
}

// cari sel berumus terdekat pada kolom yang sama (baris di atas lalu di bawah) sebagai templat
function findFormulaCell_(sh, row, col) {
  var lastRow = sh.getLastRow(), n = Math.max(row - 2, lastRow - row);
  var formulas = sh.getRange(2, col, lastRow - 1, 1).getFormulas();
  for (var d = 1; d <= n; d++) {
    var up = row - d, down = row + d;
    if (up >= 2 && formulas[up - 2][0]) return sh.getRange(up, col);
    if (down <= lastRow && formulas[down - 2][0]) return sh.getRange(down, col);
  }
  return null;
}

function log_(ss, rowVals) {
  var sh = ss.getSheetByName(SHEET_LOG);
  if (!sh) { sh = ss.insertSheet(SHEET_LOG); sh.appendRow(['Waktu', 'Pengguna', 'Baris', 'Kode Engine', 'Kode Irigator', 'Lokasi Lama', 'Wil Lama', 'Kode Air Lama', 'Lokasi Baru', 'Wil Baru', 'Kode Air Baru', 'Sumber Air Baru', 'Keterangan']); sh.setFrozenRows(1); }
  sh.appendRow(rowVals);
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* REPAIR ALL — perbaiki sel yang salah format (dipanggil dari tombol "Repair all" di dashboard)
 * items: [{sheet, row, col (nama header), kind: 'date'|'num'|'formula', value}]
 *  date    → tulis sebagai tanggal asli (value 'yyyy-mm-dd'); format tampilan kolom tidak diubah
 *  num     → tulis sebagai angka (value number) sehingga pemisah ribuan/desimal mengikuti locale spreadsheet
 *  formula → sel error (#REF!/#N/A/...): salin ulang rumus R1C1 dari baris terdekat di kolom yang sama yang rumusnya sehat;
 *            bila tidak ada rumus sehat di kolom itu, dilewati (tidak menebak)
 * Nilai lama dicatat di sheet "Log Perbaikan Format" agar bisa ditelusuri/dikembalikan. */
function repairCells_(b) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return out_({ ok: false, error: 'Sheet sedang dipakai proses lain, coba lagi' });
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
    var items = Array.isArray(b.items) ? b.items.slice(0, 400) : [];
    if (!items.length) return out_({ ok: false, error: 'Tidak ada sel yang dipilih' });
    var fixed = [], skipped = [], cache = {};
    var lg = ss.getSheetByName(SHEET_LOG_REPAIR);
    if (!lg) { lg = ss.insertSheet(SHEET_LOG_REPAIR); lg.appendRow(['Waktu', 'Pengguna', 'Sheet', 'Baris', 'Kolom', 'Jenis', 'Nilai Lama', 'Rumus Lama', 'Nilai/Rumus Baru']); lg.setFrozenRows(1); }
    var isErr = function (v) { return /^#(REF|N\/A|VALUE|DIV\/0|NAME\?|NUM|NULL|ERROR)!?/i.test(String(v || '')); };
    items.forEach(function (it) {
      try {
        var name = String(it.sheet || '').split(' › ')[0].trim();
        var c = cache[name];
        if (!c) {
          var sh = ss.getSheetByName(name); if (!sh) { skipped.push({ sheet: name, row: it.row, col: it.col, reason: 'sheet tidak ditemukan' }); return; }
          var lastCol = sh.getLastColumn(), headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
          c = cache[name] = { sh: sh, headers: headers, lastRow: sh.getLastRow() };
        }
        var col = c.headers.indexOf(String(it.col || '').trim().toLowerCase()) + 1, row = Number(it.row);
        if (!col || !row || row < 2 || row > c.lastRow) { skipped.push({ sheet: name, row: it.row, col: it.col, reason: 'kolom/baris tidak ditemukan' }); return; }
        var cell = c.sh.getRange(row, col), oldV = cell.getDisplayValue(), oldF = cell.getFormula(), newDesc = '';
        if (it.kind === 'formula') {
          if (!isErr(oldV) && !oldF) { skipped.push({ sheet: name, row: row, col: it.col, reason: 'sel sudah tidak error' }); return; }
          var pat = '';
          for (var d = 1; d <= 30 && !pat; d++) {
            [row - d, row + d].forEach(function (r) {
              if (pat || r < 2 || r > c.lastRow) return;
              var rg = c.sh.getRange(r, col); var f = rg.getFormulaR1C1();
              if (f && !/#REF/i.test(f) && !isErr(rg.getDisplayValue())) pat = f;
            });
          }
          if (!pat) { skipped.push({ sheet: name, row: row, col: it.col, reason: 'tidak ada rumus sehat di kolom ini untuk ditiru' }); return; }
          cell.setFormulaR1C1(pat); newDesc = c.sh.getRange(row, col).getFormula();
        } else if (it.kind === 'date') {
          var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(it.value || '')); if (!m) { skipped.push({ sheet: name, row: row, col: it.col, reason: 'nilai tanggal tidak valid' }); return; }
          if (oldF) { skipped.push({ sheet: name, row: row, col: it.col, reason: 'sel berisi rumus, tidak ditimpa' }); return; }
          cell.setValue(new Date(+m[1], +m[2] - 1, +m[3])); newDesc = it.value;
        } else if (it.kind === 'num') {
          var n = Number(it.value); if (!isFinite(n)) { skipped.push({ sheet: name, row: row, col: it.col, reason: 'nilai angka tidak valid' }); return; }
          if (oldF) { skipped.push({ sheet: name, row: row, col: it.col, reason: 'sel berisi rumus, tidak ditimpa' }); return; }
          cell.setValue(n); newDesc = String(n);
        } else { skipped.push({ sheet: name, row: row, col: it.col, reason: 'jenis perbaikan tidak dikenal' }); return; }
        fixed.push({ sheet: name, row: row, col: it.col, kind: it.kind, from: oldV, to: newDesc });
        lg.appendRow([new Date(), b.user || '', name, row, it.col, it.kind, oldV, oldF, newDesc]);
      } catch (e1) { skipped.push({ sheet: it.sheet, row: it.row, col: it.col, reason: String(e1 && e1.message || e1) }); }
    });
    SpreadsheetApp.flush();
    return out_({ ok: true, fixed: fixed, skipped: skipped });
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally { lock.releaseLock(); }
}
