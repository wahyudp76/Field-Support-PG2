/* =====================================================================
 *  DATA LAYER — ambil & normalisasi data dari Google Sheets (CSV)
 * ===================================================================== */
(function (global) {
  'use strict';

  /* ---------- CSV parser (RFC-4180, tahan koma/petik/baris baru) ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], n = text[i + 1];
      if (q) {
        if (c === '"' && n === '"') { field += '"'; i++; }
        else if (c === '"') q = false;
        else field += c;
      } else {
        if (c === '"') q = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\r') { /* skip */ }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* ---------- Konversi angka format Indonesia "130.317,78" → 130317.78 ---------- */
  function toNumber(v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    let s = String(v).trim();
    if (!s) return NaN;
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
    const n = Number(s);
    return isNaN(n) ? NaN : n;
  }

  /* ---------- Normalisasi tanggal "5/29/2026" | "23/07/2024" → "2026-05-29" ---------- */
  const MONTHS = { jan: 1, feb: 2, peb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7, agu: 8, ags: 8, aug: 8, sep: 9, sept: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12 };
  const ERR_RE = /^#(REF|N\/A|VALUE|DIV\/0|NAME\?|NUM|NULL|ERROR)!?/i;
  const pad2 = n => String(n).padStart(2, '0');
  const validYMD = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 ? y + '-' + pad2(m) + '-' + pad2(d) : null;
  /* Tafsir longgar untuk tanggal yang tidak baku (dipakai parser & Repair all): 29-Mei-2026, 29 Mei 2026, 2026/05/29, 29.05.2026, 29-05-26, 20260529, serial Excel */
  function looseDate(s, order) {
    s = String(s || '').trim(); if (!s) return null;
    let m = s.match(/^(\d{1,2})[\s\-\/.]+([A-Za-z]{3,9})[\s\-\/.,]+(\d{2,4})$/);
    if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined) { const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()]; let y = +m[3]; if (y < 100) y += 2000; return validYMD(y, mo, +m[1]); }
    m = s.match(/^([A-Za-z]{3,9})[\s\-\/.]+(\d{1,2}),?[\s\-\/.]+(\d{4})$/);
    if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined) return validYMD(+m[3], MONTHS[m[1].slice(0, 3).toLowerCase()], +m[2]);
    m = s.match(/^(\d{4})[\-\/.](\d{1,2})[\-\/.](\d{1,2})(?:[ T].*)?$/);
    if (m) return validYMD(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{2,4})$/);
    if (m) { let a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000; let dd, mm; if (order === 'mdy' && a <= 12) { mm = a; dd = b; } else if (a > 12 || order === 'dmy') { dd = a; mm = b; } else if (b > 12) { mm = a; dd = b; } else { dd = a; mm = b; } return validYMD(y, mm, dd); }
    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return validYMD(+m[1], +m[2], +m[3]);
    if (/^\d{5}$/.test(s)) { const n = +s; if (n > 20000 && n < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + n * 864e5); return d.toISOString().slice(0, 10); } }
    return null;
  }
  function toISODate(v, order) {
    const s = String(v || '').trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const a = +m[1], b = +m[2], y = m[3];
      let dd, mm;
      if (order === 'dmy') { dd = a; mm = b; } else if (order === 'mdy') { mm = a; dd = b; }
      else if (a > 12) { dd = a; mm = b; } else { mm = a; dd = b; }
      if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return s;
      return y + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    return looseDate(s, order) || s; // tampilan d-Mmm-yyyy (29-Mei-2026) dan variasi lain tetap dikenali
  }
  // Tentukan urutan tanggal satu kolom: jika ada nilai dengan angka pertama > 12 → dd/mm, jika angka kedua > 12 → mm/dd
  function detectDateOrder(values) {
    let dmy = 0, mdy = 0;
    for (const v of values) { const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/\d{4}$/); if (!m) continue; if (+m[1] > 12) dmy++; else if (+m[2] > 12) mdy++; }
    return dmy > mdy ? 'dmy' : (mdy > 0 ? 'mdy' : 'auto');
  }
  /* Klasifikasi satu nilai angka:
   *  'int'  → 1234            (netral)
   *  'id'   → 1.234,56 / 12,5 (koma desimal, titik ribuan)
   *  'en'   → 1234.56         (titik desimal)
   *  'amb'  → 1.234           (ambigu: ribuan-titik ATAU desimal 3 digit)
   *  'mixed'→ 1,234.56 / 1.234.56 / 1,2,3 (format campur/tidak valid)
   *  'text' → bukan angka */
  function classifyNum(t) {
    if (/^-?\d+$/.test(t)) return 'int';
    if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) return 'amb';
    if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(t) || /^-?\d+,\d+$/.test(t)) return 'id';
    if (/^-?\d+\.\d+$/.test(t)) return 'en';
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return 'en-thousand';
    if (/^-?[\d.,]+$/.test(t)) return 'mixed';
    return 'text';
  }
  // Format dominan satu kolom. Kolom dianggap numerik bila ≥ 80% nilai terisi berupa angka.
  function detectNumFormat(values) {
    const c = { int: 0, id: 0, en: 0, amb: 0, 'en-thousand': 0, mixed: 0, text: 0 }; let any = 0;
    for (const v of values) { const t = String(v).trim(); if (!t) continue; any++; c[classifyNum(t)]++; }
    if (!any) return null;
    const numeric = any - c.text - c.mixed;
    if (numeric / any < 0.8 || numeric < 1) return null;
    if (c.id === 0 && c.en === 0 && c['en-thousand'] === 0 && c.amb === 0) return 'int';
    const idScore = c.id + c.amb, enScore = c.en + c['en-thousand'];
    return idScore >= enScore ? 'id' : 'en';
  }
  // Parse mengikuti format kolom; nilai yang menyimpang tetap di-parse sesuai maksud penulisnya
  // (mis. "130317.78" di kolom id → 130317.78) supaya angka dashboard tetap benar, lalu dilaporkan.
  function parseNum(v, fmt) {
    const t = String(v).trim(); if (!t) return NaN;
    const k = classifyNum(t);
    if (k === 'int') return Number(t);
    if (k === 'id') return Number(t.replace(/\./g, '').replace(',', '.'));
    if (k === 'en') return Number(t);
    if (k === 'en-thousand') return Number(t.replace(/,/g, ''));
    if (k === 'amb') return fmt === 'en' ? Number(t) : Number(t.replace(/\./g, ''));
    return NaN;
  }
  // Periksa satu nilai terhadap format kolom → { level, reason, suggest } atau null
  function checkNum(t, fmt) {
    const k = classifyNum(t);
    if (k === 'text') return fmt === 'int' ? { level: 'info', reason: 'Teks di kolom angka', suggest: 'Kosongkan atau isi angka' } : { level: 'error', reason: 'Bukan angka (teks) di kolom angka', suggest: 'Isi angka saja, contoh 1.234,56' };
    if (k === 'mixed') return { level: 'error', reason: 'Format angka tidak valid (titik/koma campur)', suggest: 'Gunakan titik untuk ribuan dan koma untuk desimal, contoh 130.317,78' };
    if (fmt === 'id' && k === 'en') return { level: 'warn', reason: 'Pemisah desimal memakai TITIK, kolom ini memakai KOMA', suggest: 'Ganti menjadi ' + Number(t).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) };
    if (fmt === 'id' && k === 'en-thousand') return { level: 'warn', reason: 'Pemisah ribuan memakai KOMA, kolom ini memakai TITIK', suggest: 'Ganti menjadi ' + Number(t.replace(/,/g, '')).toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) };
    if (fmt === 'en' && (k === 'id' || k === 'en-thousand')) return { level: 'warn', reason: 'Pemisah desimal memakai KOMA, kolom ini memakai TITIK', suggest: 'Ganti menjadi ' + parseNum(t, fmt) };
    return null;
  }

  /* ---------- fetch dengan timeout + retry ---------- */
  async function fetchText(url, label, tries = 3) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
      try {
        const res = await fetch(url, { cache: 'no-store', signal: ctl.signal });
        clearTimeout(t);
        if (res.status === 429 || res.status >= 500) throw new Error('HTTP ' + res.status);
        if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status + ' saat mengambil sheet "' + label + '"'), { fatal: true });
        return await res.text();
      } catch (e) {
        clearTimeout(t); lastErr = e;
        if (e.fatal) throw e;
        if (i < tries - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
      }
    }
    throw new Error((lastErr && lastErr.name === 'AbortError' ? 'Timeout' : (lastErr && lastErr.message || 'Gagal')) + ' saat mengambil sheet "' + label + '"');
  }

  /* ---------- Ambil satu sheet ---------- */
  async function fetchSheet(key) {
    const cfg = APP_CONFIG.sheets[key];
    // Satu sheet fisik bisa dipakai beberapa key (blok tabel berdampingan) → unduh sekali per siklus sinkron
    const url = APP_CONFIG.csvUrl(cfg.name).replace(/&t=\d+$/, '');
    if (!fetchSheet._memo || fetchSheet._memo.url !== url || Date.now() - fetchSheet._memo.at > 5000) fetchSheet._memo = { url, at: Date.now(), p: fetchText(APP_CONFIG.csvUrl(cfg.name), cfg.name) };
    const text = await fetchSheet._memo.p;
    if (text.trim().startsWith('<')) throw new Error('Spreadsheet belum dibagikan publik (Anyone with the link → Viewer)');
    let raw = parseCSV(text);
    if (!raw.length) return { key, name: cfg.name, headers: [], rows: [] };
    // Blok tabel: pilih kelompok kolom (dipisah header kosong) yang headernya cocok dengan cfg.block
    if (cfg.block) {
      const hdr = raw[0].map(h => String(h).trim()); const blocks = []; let start = null;
      hdr.forEach((h, i) => { if (h && start === null) start = i; if (!h && start !== null) { blocks.push([start, i]); start = null; } });
      if (start !== null) blocks.push([start, hdr.length]);
      const re = new RegExp(cfg.block, 'i');
      const b = blocks.find(([a, z]) => hdr.slice(a, z).some(h => re.test(h)) && !hdr.slice(a, z).some(h => /\b(COUNTA?|SUM|AVERAGE|MAX|MIN)\b\s+of\b/i.test(h)));
      if (!b) throw new Error('Blok tabel dengan header /' + cfg.block + '/ tidak ditemukan di sheet "' + cfg.name + '"');
      raw = raw.map(r => r.slice(b[0], b[1]));
    }

    // Batas kolom
    const rawHeaders = raw[0].map(h => String(h).trim());
    let last = rawHeaders.length;
    for (let i = 0; i < rawHeaders.length; i++) {
      if (rawHeaders[i] === '') { last = i; break; }
      if (cfg.endHeader && rawHeaders[i].toLowerCase() === cfg.endHeader.toLowerCase()) { last = i + 1; break; }
    }
    const headers = rawHeaders.slice(0, last);
    // Pengaman: bila nama sheet tidak ada, gviz diam-diam mengembalikan sheet PERTAMA → deteksi lewat kolom kunci agar tidak menampilkan data yang salah
    const must = cfg.keyHeader || cfg.endHeader;
    if (must && !headers.some(h => h.toLowerCase() === String(must).toLowerCase())) throw new Error('Sheet "' + cfg.name + '" tidak berisi kolom "' + must + '" — nama sheet berubah atau spreadsheet mengembalikan sheet lain');

    // simpan nomor baris sheet asli (header = baris 1) agar baris kosong di tengah tidak menggeser nomor baris
    const sheetRow = []; const body = [];
    raw.slice(1).forEach((r0, i0) => { const r = r0.slice(0, last); if (r.some(c => String(c).trim() !== '')) { body.push(r); sheetRow.push(i0 + 2); } });
    const colVals = j => body.map(r => (r[j] == null ? '' : String(r[j]).trim()));

    // Deteksi per kolom: tanggal, angka, komponen A/B/C
    const dateOrder = {}, numFmt = {}, compCols = [];
    const nonComp = new Set((APP_CONFIG.nonComponentCols[key] || []).map(x => x.toLowerCase()));
    headers.forEach((h, j) => {
      const vals = colVals(j);
      if (/tanggal|\btgl\b|\bdate\b/i.test(h) && !/update/i.test(h)) { dateOrder[h] = detectDateOrder(vals); return; }
      const nf = detectNumFormat(vals); if (nf) numFmt[h] = nf;
      if (APP_CONFIG.nonComponentCols[key] && !nonComp.has(h.toLowerCase())) {
        let any = false, ok = true;
        for (const v of vals) { if (!v) continue; any = true; if (!/^[abc]$/i.test(v)) { ok = false; break; } }
        if (any && ok) compCols.push(h);
      }
    });

    const issues = [];
    const idCol = ['kode unit', 'kode baru', 'kode engine', 'kode'].map(n => headers.find(h => h.toLowerCase() === n)).find(Boolean) || headers[1] || headers[0];
    const rows = body.map((r, i) => {
      const o = { _i: i, _row: sheetRow[i], _num: {}, _flag: null };
      headers.forEach((h, j) => {
        let v = r[j] == null ? '' : String(r[j]).trim();
        if (dateOrder[h] && v) {
          const iso = toISODate(v, dateOrder[h]);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
            if (ERR_RE.test(v)) issues.push({ row: sheetRow[i], col: h, value: v, level: 'error', reason: 'Rumus error (' + v + ') di kolom tanggal', suggest: 'Repair all: salin ulang rumus dari baris sebelah', fix: { kind: 'formula' } });
            else issues.push({ row: sheetRow[i], col: h, value: v, level: 'warn', reason: 'Tanggal tidak dikenali (format kolom ' + (dateOrder[h] === 'dmy' ? 'dd/mm/yyyy' : 'mm/dd/yyyy') + ')', suggest: 'Tulis ' + (dateOrder[h] === 'dmy' ? 'dd/mm/yyyy' : 'mm/dd/yyyy') });
          }
          v = iso;
        }
        o[h] = v;
        if (v && !numFmt[h] && !dateOrder[h] && ERR_RE.test(v)) issues.push({ row: sheetRow[i], col: h, value: v, level: 'error', reason: 'Rumus error (' + v + ')', suggest: 'Repair all: salin ulang rumus dari baris sebelah', fix: { kind: 'formula' } });
        if (numFmt[h] && v) {
          const chk = checkNum(v, numFmt[h]);
          o._num[h] = parseNum(v, numFmt[h]);
          if (chk) {
            const n = o._num[h];
            if (ERR_RE.test(v)) { chk.level = 'error'; chk.reason = 'Rumus error (' + v + ')'; chk.suggest = 'Repair all: salin ulang rumus dari baris sebelah'; chk.fix = { kind: 'formula' }; }
            else if (chk.level === 'warn' && isFinite(n)) chk.fix = { kind: 'num', value: n }; // pemisah ribuan/desimal keliru → tulis ulang sebagai angka
            issues.push({ row: sheetRow[i], col: h, value: v, ...chk }); (o._flag || (o._flag = {}))[h] = chk;
          }
        }
      });
      return o;
    });
    // Nilai ekstrem: > 50× median kolom (hanya kolom desimal, ≥ 20 data) → kemungkinan salah pemisah (130.317,78 ditulis 130317,78 ×1000 dst.)
    Object.keys(numFmt).forEach(h => {
      if (numFmt[h] === 'int' || /koordinat|tahun|no/i.test(h)) return;
      const vals = rows.map(r => r._num[h]).filter(n => !isNaN(n) && n > 0).sort((a, b) => a - b);
      if (vals.length < 20) return;
      const med = vals[Math.floor(vals.length / 2)], p95 = vals[Math.floor(vals.length * 0.95)];
      rows.forEach(r => {
        const n = r._num[h]; if (isNaN(n) || (r._flag && r._flag[h])) return;
        if (n > Math.max(med * 50, p95 * 10)) { const chk = { level: 'warn', reason: 'Nilai ekstrem (' + Math.round(n / med) + '× median kolom) — kemungkinan salah pemisah ribuan/desimal; TIDAK dihitung dalam total', suggest: 'Periksa: mungkin seharusnya ' + (n / 1000).toLocaleString('id-ID', { maximumFractionDigits: 2 }) }; issues.push({ row: (r._row || r._i + 2), col: h, value: r[h], ...chk }); (r._flag || (r._flag = {}))[h] = chk; r._num[h] = NaN; }
        else if (n < 0) { const chk = { level: 'warn', reason: 'Nilai negatif', suggest: 'Periksa tanda minus' }; issues.push({ row: (r._row || r._i + 2), col: h, value: r[h], ...chk }); (r._flag || (r._flag = {}))[h] = chk; }
      });
    });

    // Kondisi keseluruhan (A/B/C) untuk sheet komponen
    if (compCols.length) {
      rows.forEach(r => {
        let worst = 'A', filled = 0; const bad = [];
        for (const h of compCols) {
          const v = r[h].toUpperCase(); if (v) filled++;
          if (v === 'C') { worst = 'C'; bad.push(h + ' (C)'); }
          else if (v === 'B') { if (worst !== 'C') worst = 'B'; bad.push(h + ' (B)'); }
        }
        if (!filled) { worst = ''; issues.push({ row: (r._row || r._i + 2), col: 'Kondisi Komponen', value: '(semua komponen kosong)', level: 'info', reason: 'Belum ada penilaian komponen A/B/C', suggest: 'Isi kondisi komponen unit ini' }); }
        r['Kondisi Komponen'] = worst;
        r['Komponen Bermasalah'] = bad.join(', ');
      });
      if (!headers.includes('Kondisi Komponen')) headers.push('Kondisi Komponen');
      if (!headers.includes('Komponen Bermasalah')) headers.push('Komponen Bermasalah');
    }
    issues.forEach(x => { x.id = rows[x.row - 2][idCol] || ''; x.sheet = cfg.name; });
    return { key, name: cfg.name, headers, rows, issues, meta: { dateOrder, numFmt, compCols, idCol, fetchedAt: Date.now() } };
  }

  /* ---------- Ambil semua sheet paralel ---------- */
  async function fetchAll() {
    const keys = Object.keys(APP_CONFIG.sheets);
    const results = await Promise.allSettled(keys.map(fetchSheet));
    const out = { generatedAt: new Date(), sheets: {} };
    results.forEach((r, i) => {
      const k = keys[i];
      out.sheets[k] = r.status === 'fulfilled'
        ? r.value
        : { key: k, name: APP_CONFIG.sheets[k].name, headers: [], rows: [], error: r.reason.message };
    });
    return out;
  }

  global.DataLayer = { fetchAll, fetchSheet, parseCSV, toNumber, toISODate, detectDateOrder, detectNumFormat, classifyNum, checkNum, parseNum };
})(window);
