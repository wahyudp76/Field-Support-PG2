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
    return m ? m[0] : s;
  }
  // Tentukan urutan tanggal satu kolom: jika ada nilai dengan angka pertama > 12 → dd/mm, jika angka kedua > 12 → mm/dd
  function detectDateOrder(values) {
    let dmy = 0, mdy = 0;
    for (const v of values) { const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/\d{4}$/); if (!m) continue; if (+m[1] > 12) dmy++; else if (+m[2] > 12) mdy++; }
    return dmy > mdy ? 'dmy' : (mdy > 0 ? 'mdy' : 'auto');
  }
  // Format angka satu kolom: 'id' (1.234,56) bila ada koma desimal / pola ribuan-titik, selain itu 'en' (1234.56)
  function detectNumFormat(values) {
    let id = 0, en = 0, any = 0;
    for (const v of values) {
      const t = String(v).trim(); if (!t) continue; any++;
      if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) || /^-?\d+,\d+$/.test(t)) id++;
      else if (/^-?\d+(\.\d+)?$/.test(t)) en++;
      else return null; // ada teks → bukan kolom numerik
    }
    return any ? (id > 0 ? 'id' : 'en') : null;
  }
  function parseNum(v, fmt) {
    const t = String(v).trim(); if (!t) return NaN;
    if (fmt === 'id') return Number(t.replace(/\./g, '').replace(',', '.'));
    return Number(t);
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
    const text = await fetchText(APP_CONFIG.csvUrl(cfg.name), cfg.name);
    if (text.trim().startsWith('<')) throw new Error('Spreadsheet belum dibagikan publik (Anyone with the link → Viewer)');
    const raw = parseCSV(text);
    if (!raw.length) return { key, name: cfg.name, headers: [], rows: [] };

    // Batas kolom
    const rawHeaders = raw[0].map(h => String(h).trim());
    let last = rawHeaders.length;
    for (let i = 0; i < rawHeaders.length; i++) {
      if (rawHeaders[i] === '') { last = i; break; }
      if (cfg.endHeader && rawHeaders[i].toLowerCase() === cfg.endHeader.toLowerCase()) { last = i + 1; break; }
    }
    const headers = rawHeaders.slice(0, last);

    const body = raw.slice(1).map(r => r.slice(0, last)).filter(r => r.some(c => String(c).trim() !== ''));
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

    const rows = body.map((r, i) => {
      const o = { _i: i, _num: {} };
      headers.forEach((h, j) => {
        let v = r[j] == null ? '' : String(r[j]).trim();
        if (dateOrder[h] && v) v = toISODate(v, dateOrder[h]);
        o[h] = v;
        if (numFmt[h] && v) o._num[h] = parseNum(v, numFmt[h]);
      });
      return o;
    });

    // Kondisi keseluruhan (A/B/C) untuk sheet komponen
    if (compCols.length) {
      rows.forEach(r => {
        let worst = 'A'; const bad = [];
        for (const h of compCols) {
          const v = r[h].toUpperCase();
          if (v === 'C') { worst = 'C'; bad.push(h + ' (C)'); }
          else if (v === 'B') { if (worst !== 'C') worst = 'B'; bad.push(h + ' (B)'); }
        }
        r['Kondisi'] = worst;
        r['Komponen Bermasalah'] = bad.join(', ');
      });
      if (!headers.includes('Kondisi')) headers.push('Kondisi');
      if (!headers.includes('Komponen Bermasalah')) headers.push('Komponen Bermasalah');
    }
    return { key, name: cfg.name, headers, rows, meta: { dateOrder, numFmt, compCols, fetchedAt: Date.now() } };
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

  global.DataLayer = { fetchAll, fetchSheet, parseCSV, toNumber, toISODate, detectDateOrder, detectNumFormat };
})(window);
