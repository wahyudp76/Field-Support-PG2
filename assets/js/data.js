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
  function toISODate(v) {
    const s = String(v || '').trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      let a = +m[1], b = +m[2], y = m[3];
      // Jika angka pertama > 12 pasti dd/mm ; jika kedua > 12 pasti mm/dd ; default mm/dd (format gviz US)
      let mm, dd;
      if (a > 12) { dd = a; mm = b; } else if (b > 12) { mm = a; dd = b; } else { mm = a; dd = b; }
      return y + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : s;
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

    const dateCols = headers.filter(h => /tanggal|date/i.test(h));
    const rows = raw.slice(1)
      .map(r => r.slice(0, last))
      .filter(r => r.some(c => String(c).trim() !== ''))
      .map((r, i) => {
        const o = { _i: i };
        headers.forEach((h, j) => { o[h] = (r[j] == null ? '' : String(r[j]).trim()); });
        dateCols.forEach(h => { if (o[h]) o[h] = toISODate(o[h]); });
        return o;
      });

    // Kondisi keseluruhan (A/B/C) untuk sheet komponen
    const nonComp = APP_CONFIG.nonComponentCols[key];
    if (nonComp) {
      const skip = new Set(nonComp.map(s => s.toLowerCase()));
      const comp = headers.filter(h => !skip.has(h.toLowerCase()));
      rows.forEach(r => {
        let worst = 'A', bad = [];
        comp.forEach(h => {
          const v = r[h].toUpperCase();
          if (v === 'C') { worst = 'C'; bad.push(h + ' (C)'); }
          else if (v === 'B') { if (worst !== 'C') worst = 'B'; bad.push(h + ' (B)'); }
        });
        r['Kondisi'] = worst;
        r['Komponen Bermasalah'] = bad.join(', ');
      });
      if (!headers.includes('Kondisi')) headers.push('Kondisi');
      if (!headers.includes('Komponen Bermasalah')) headers.push('Komponen Bermasalah');
    }
    return { key, name: cfg.name, headers, rows };
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

  global.DataLayer = { fetchAll, fetchSheet, parseCSV, toNumber, toISODate };
})(window);
