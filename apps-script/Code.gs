/**
 * =====================================================================
 *  Field Support Irigasi PG 2 — Web App penulis (Apps Script)
 *  Dipakai tombol "Pindah Unit", "Tarik ke Bengkel" dan "Pasang Unit" di
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
var MAX_HISTORY = 400;                  // panjang maksimal kolom Keterangan

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'ping') {
    var info = {};
    try { var ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID); info.spreadsheet = ss.getName(); info.sheetDetail = !!ss.getSheetByName(SHEET_DETAIL); } catch (err) { info.spreadsheetError = String(err); }
    info.pinSet = !!PropertiesService.getScriptProperties().getProperty('PIN');
    return out_({ ok: true, app: 'FS PG2 writer', version: 6, time: new Date().toISOString(), info: info });
  }
  return out_({ ok: false, error: 'Gunakan POST (action: move | withdraw | install) atau ?action=ping' });
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
