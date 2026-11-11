/* =====================================================================
 *  APP — Dashboard Field Support Irigasi PG 2   (v2)
 *  - Filter multi-pilih (checklist) per kolom
 *  - Ukuran halaman tabel dapat dipilih
 *  - Render malas (lazy) per tab + debounce + cache pencarian
 * ===================================================================== */
(function () {
  'use strict';
  const { toNumber } = DataLayer;
  const PAGE_SIZES = [25, 50, 100, 250, 'Semua'];
  const PALETTE = ['#64748b', '#6b94c2', '#5f9f78', '#b8893a', '#b25454', '#7a6a99', '#5b9aa0', '#94a3b8', '#8fb0d0', '#9cc3a8', '#d4b06a', '#c98585', '#a797c2', '#475569']; // abu dominan + warna lembut
  // Peta warna cerah lama → versi lembut (tema abu-abu santai)
  const MONO = { '#22c55e': '#5f9f78', '#4ade80': '#5f9f78', '#16a34a': '#4c8a66', '#f59e0b': '#b8893a', '#fbbf24': '#d4b06a', '#f97316': '#c4844f', '#ef4444': '#b25454', '#f87171': '#c98585', '#dc2626': '#9b3b3b', '#38bdf8': '#6b94c2', '#0ea5e9': '#5b8bb8', '#a78bfa': '#7a6a99', '#8b5cf6': '#7a6a99', '#14b8a6': '#5b9aa0', '#6366f1': '#6b7fb8', '#ec4899': '#c27a9c', '#94a3b8': '#94a3b8', '#64748b': '#64748b', '#84cc16': '#8aa65a', '#111827': '#475569', '#374151': '#64748b' };
  const mono = c => (typeof c === 'string' && MONO[c.toLowerCase()]) || c;
  if (window.Chart) Chart.register({ id: 'monoColors', beforeUpdate(c) { c.data.datasets.forEach((d, di) => { if (Array.isArray(d.backgroundColor)) d.backgroundColor = d.backgroundColor.map((x, i) => mono(x)); else if (typeof d.backgroundColor === 'string') d.backgroundColor = mono(d.backgroundColor); if (typeof d.borderColor === 'string') d.borderColor = mono(d.borderColor); }); } });

  /* ---------- helper ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const cssId = s => String(s).replace(/[^a-z0-9]/gi, '_');
  const uniq = (rows, k) => [...new Set(rows.map(r => r[k]).filter(v => v !== '' && v != null))];
  const sortNat = arr => arr.sort((a, b) => String(a).localeCompare(String(b), 'id', { numeric: true }));
  const numv = (r, k) => { const n = r._num && r._num[k]; return n !== undefined ? n : toNumber(r[k]); };
  const sum = (rows, k) => { let a = 0; for (const r of rows) { const n = numv(r, k); if (!isNaN(n)) a += n; } return a; };
  // ambil nilai kolom, coba sinonim bila kolom tidak ada
  const val = (r, ...names) => { for (const n of names) if (r[n] !== undefined) return r[n]; return ''; };
  const fmt = (n, d = 0) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n || 0);
  const avgStr = (rows, k) => { const v = rows.map(r => parseFloat(String(r[k] || '').replace(',', '.'))).filter(n => isFinite(n)); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toLocaleString('id-ID', { maximumFractionDigits: 1 }) : '–'; };
  // token kode lokasi: "007 F" → 007F, "001A C 006C C1 G" → 001A,001C,006C,006C1,006G
  const lokTokens = s => { const out = []; let num = null; for (const t of String(s || '').toUpperCase().replace(/[,;/]+/g, ' ').split(/\s+/)) { const m = /^(\d{3})([A-Z]\d*)?$/.exec(t); if (m) { num = m[1]; out.push(num + (m[2] || '')); } else if (/^[A-Z]\d*$/.test(t) && num) out.push(num + t); } return out; };
  /* Pompa Sumur: normalisasi LOKASI, tautkan ke Sumber Air (Kode Baru/Wilayah/Pompa/Status), hitung komponen bekas & umur maintenance */
  const SUMUR_DERIVED = ['Status Catatan', 'Kode Sumur', 'Wilayah', 'Pompa (Sumber Air)', 'Status (Sumber Air)', 'Komponen Bekas/Repair', 'Hari Sejak Maintenance'];
  function enrichSumur(s) {
    if (!s || s.error || !s.headers.length) return;
    const S = RAW.sumber && !RAW.sumber.error ? RAW.sumber.rows : [];
    const byCode = new Map();
    S.forEach(r => { if (!/deep|sumur|bor/i.test(r['Jenis Sumber Air'] || '')) return; lokTokens(r['Lokasi']).forEach(c => { if (!byCode.has(c)) byCode.set(c, r); }); });
    S.forEach(r => { if (!/deep|sumur|bor/i.test(r['Jenis Sumber Air'] || '')) return; lokTokens(r['Kedekatan Lokasi']).forEach(c => { if (!byCode.has(c)) byCode.set(c, r); }); });
    const lokH = altKey(s.headers, 'LOKASI') || 'LOKASI', tglH = s.headers.find(h => /tgl|tanggal/i.test(h));
    const condCols = s.headers.filter(h => /^kondisi\s/i.test(h) && !/akhir sumur/i.test(h)).concat(s.headers.filter(h => /^baut\+mur pipa/i.test(h)));
    if (!s.headers.includes('Kode Sumur')) { const i = s.headers.indexOf(lokH) + 1; s.headers.splice(i, 0, ...SUMUR_DERIVED); }
    const today = Date.now();
    s.rows.forEach(r => {
      const lok = String(r[lokH] || '').trim().toUpperCase().replace(/\s+/g, ''); r[lokH] = lok;
      const sa = byCode.get(lok) || null;
      r['Kode Sumur'] = sa ? sa['Kode Baru'] : ''; r['Wilayah'] = sa ? String(sa['Wilayah'] || '').trim() : ''; r['Pompa (Sumber Air)'] = sa ? String(sa['Pompa'] || '').trim() : ''; r['Status (Sumber Air)'] = sa ? String(sa['Status'] || '').trim() : '';
      r['Status Catatan'] = !sa ? 'Lokasi tak dikenal' : /ada/i.test(sa['Pompa'] || '') ? 'Aktif' : 'Pompa sudah dipindah';
      r['Komponen Bekas/Repair'] = String(condCols.filter(h => /bekas|repair|rusak/i.test(r[h] || '')).length);
      const d = tglH && /^\d{4}-\d{2}-\d{2}$/.test(r[tglH] || '') ? new Date(r[tglH]) : null;
      r['Hari Sejak Maintenance'] = d ? String(Math.max(0, Math.round((today - d.getTime()) / 864e5))) : '';
      r._sumurParts = condCols.filter(h => /bekas|repair|rusak/i.test(r[h] || '')).map(h => h.replace(/^kondisi\s+/i, '').trim());
    });
    s.meta = s.meta || {}; s.meta.condCols = condCols; s.meta.lokH = lokH; s.meta.tglH = tglH;
  }
  function sumurPartStats(rows) { const m = new Map(); rows.forEach(r => (r._sumurParts || []).forEach(p => m.set(p, (m.get(p) || 0) + 1))); return [...m.entries()].sort((a, b) => b[1] - a[1]); }
  const count = (rows, k) => { const m = new Map(); for (const r of rows) { const v = r[k] || '(kosong)'; m.set(v, (m.get(v) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const isTrue = (v, re) => re.test(String(v || ''));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(t._t); t._t = setTimeout(() => t.className = 'toast', 3500); }

  /* ---------- konfigurasi per tab ---------- */
  const CONFIG = {
    detail: {
      title: 'Detail Unit Terpasang', icon: '🚜',
      freezeUntil: 'Wil',
      filters: ['Wil', 'Bengkel', 'Jenis Engine', 'Sumber Air', 'Terpasang', 'Power', 'Tanggal'],
      kpis: [
        { label: 'Total Unit', icon: '🚜', c: '#f59e0b', fn: r => r.length },
        { label: 'Terpasang', icon: '✅', c: '#38bdf8', fn: r => r.filter(x => isTrue(val(x, 'Terpasang', 'Siram'), /terpasang/i)).length },
        { label: 'Rusak', icon: '🛠️', c: '#ef4444', fn: r => r.filter(x => isTrue(val(x, 'Terpasang', 'Siram'), /rusak/i)).length },
        { label: 'Wilayah', icon: '📍', c: '#a78bfa', fn: r => uniq(r, 'Wil').length },
        { label: 'Engine Unik', icon: '⚙️', c: '#f59e0b', fn: r => uniq(r, 'Kode Engine').length },
        { label: 'Irigator Unik', icon: '💦', c: '#ec4899', fn: r => uniq(r, 'Kode Irigator').length },
        { label: 'Ada Catatan', icon: '📝', c: '#f97316', fn: r => r.filter(x => x['Keterangan']).length },
      ],
      charts: [
        { id: 'c1', title: 'Unit per Wilayah', type: 'bar', key: 'Wil' },
        { id: 'c2', title: 'Jenis Engine', type: 'doughnut', key: 'Jenis Engine' },
        { id: 'c3', title: 'Sumber Air', type: 'doughnut', key: 'Sumber Air' },
        { id: 'c4', title: 'Pemasangan per Tanggal', type: 'line', key: 'Tanggal' },
      ],
      chips: {
        'Siram': v => /terpasang/i.test(v) ? 'chip-green' : /rusak/i.test(v) ? 'chip-red' : 'chip-amber',
        'Terpasang': v => /terpasang/i.test(v) ? 'chip-green' : /rusak/i.test(v) ? 'chip-red' : 'chip-amber',
        'Sumber Air': v => /deep|sumur/i.test(v) ? 'chip-blue' : 'chip-purple',
        'Jenis Engine': () => 'chip-gray',
        'Keterangan': () => 'chip-red'
      }
    },
    sumber: {
      title: 'Inventaris Sumber Air', icon: '🌊',
      freezeUntil: 'Wilayah',
      // filter bawaan: hanya wilayah PG2 (W08–W15); nilai yang tidak ada di data diabaikan
      defaultFilters: { PG: ['PG2'], Wilayah: ['W08', 'W09', 'W10', 'W11', 'W12', 'W13', 'W14', 'W15'] },
      filters: ['Wilayah', 'PG', 'Jenis Sumber Air', 'Sumber Air Alami/Buatan', 'Keterangan (Aktif Irigasi/Tidak)', 'Keterangan Ukur', 'Kondisi Sumur', 'Pompa', 'Status', 'Tahun'],
      kpis: [
        { label: 'Total Sumber Air', icon: '🌊', c: '#38bdf8', fn: r => r.length },
        { label: 'Lebung / Reservoir', icon: '🏞️', c: '#22c55e', fn: r => r.filter(x => isTrue(x['Jenis Sumber Air'], /reservoir|lebung/i)).length, sub: r => { const e = r.filter(x => /electric/i.test(x['Jenis Sumber Air'] || '') && /reservoir|lebung/i.test(x['Jenis Sumber Air'] || '')).length; return e ? e + ' electric' : ''; } },
        { label: 'Deep Well', icon: '🕳️', c: '#a78bfa', fn: r => r.filter(x => isTrue(x['Jenis Sumber Air'], /deep|sumur/i)).length, sub: r => { const e = r.filter(x => /electric/i.test(x['Jenis Sumber Air'] || '') && /deep|sumur/i.test(x['Jenis Sumber Air'] || '')).length; return e ? e + ' electric' : ''; } },
        { label: 'Sumur Ada Pompa', icon: '🔄', c: '#0ea5e9', fn: r => r.filter(x => /ada/i.test(x['Pompa'] || '')).length, sub: r => { const k = r.filter(x => /kosong/i.test(x['Pompa'] || '')).length, d = r.filter(x => /rusak/i.test(x['Pompa'] || '')).length; return (k || d) ? k + ' kosong · ' + d + ' rusak' : ''; } },
        { label: 'Aktif Irigasi', icon: '✅', c: '#f59e0b', fn: r => r.filter(x => isTrue(x['Keterangan (Aktif Irigasi/Tidak)'], /aktif/i) && !isTrue(x['Keterangan (Aktif Irigasi/Tidak)'], /tidak|non/i)).length },
        { label: 'Sudah Diukur', icon: '📐', c: '#14b8a6', fn: r => r.filter(x => isTrue(x['Keterangan Ukur'], /^ukur/i)).length },
        { label: 'Vol. Real (m³)', icon: '📏', c: '#ec4899', fn: r => fmt(sum(r, 'Volume Real Ukur (Overflow Terbuka)')) },
        { label: 'Vol. Potensi (m³)', icon: '📈', c: '#6366f1', fn: r => fmt(sum(r, 'Volume Potensi Maksimal (Overflow Terbuka)')) },
      ],
      charts: [
        { id: 'c1', title: 'Sumber Air per Wilayah', type: 'bar', key: 'Wilayah', limit: 30 },
        { id: 'c2', title: 'Jenis Sumber Air', type: 'doughnut', key: 'Jenis Sumber Air' },
        { id: 'c3', title: 'Status Pengukuran', type: 'doughnut', key: 'Keterangan Ukur', colors: { 'Ukur': '#38bdf8', 'Belum Ukur': '#f59e0b' } },
        { id: 'c4', title: 'Status Pompa Sumur Bor', type: 'doughnut', key: 'Status', exclude: /^lebung$/i, colors: { 'Siap Operasi': '#4b7a5e', 'Siap Standby': '#8aa58f', 'Kosong Standby': '#b08a4a', 'Kosong Operasi': '#a85d4a' } },
      ],
      chips: {
        'Keterangan (Aktif Irigasi/Tidak)': v => /tidak|non/i.test(v) ? 'chip-red' : 'chip-green',
        'Keterangan Ukur': v => /belum/i.test(v) ? 'chip-amber' : 'chip-blue',
        'Jenis Sumber Air': v => /deep|sumur/i.test(v) ? 'chip-purple' : 'chip-blue',
        'Pompa': v => /lebung/i.test(v) ? 'chip-gray' : /ada/i.test(v) ? 'chip-green' : /rusak/i.test(v) ? 'chip-red' : 'chip-amber',
        'Status': v => /lebung/i.test(v) ? 'chip-gray' : /operasi/i.test(v) ? 'chip-green' : /standby/i.test(v) ? 'chip-amber' : 'chip-gray',
        'Kondisi Sumur': v => /baik/i.test(v) ? 'chip-green' : /rusak/i.test(v) ? 'chip-red' : /perbaikan/i.test(v) ? 'chip-amber' : 'chip-gray'
      },
      numCols: ['Luas Badan Air', 'Volume Real Ukur (Overflow Terbuka)', 'Volume Potensi Maksimal (Overflow Terbuka)']
    },
    sumur: {
      title: 'Pompa Sumur Bor (catatan maintenance & komponen)', icon: '🛢️',
      freezeUntil: 'Wilayah',
      filters: ['Status Catatan', 'Wilayah', 'Kondisi Akhir Sumur', 'Pompa (Sumber Air)', 'Kondisi Bowl', 'Kondisi Line Shaft', 'Jenis/Merk Pompa', 'Komponen Bekas/Repair'],
      kpis: [
        { label: 'Pompa Aktif (Ada Pompa)', icon: '🛢️', c: '#38bdf8', fn: r => r.filter(x => x['Status Catatan'] === 'Aktif').length, sub: r => { const h = r.filter(x => x['Status Catatan'] === 'Pompa sudah dipindah').length, u = r.filter(x => x['Status Catatan'] === 'Lokasi tak dikenal').length; return fmt(r.length) + ' catatan' + (h ? ' · ' + h + ' riwayat (pompa dipindah)' : '') + (u ? ' · ' + u + ' lokasi tak dikenal' : ''); } },
        { label: 'Rata-rata Pipa Kolom', icon: '🧱', c: '#22c55e', fn: r => { const v = r.map(x => parseFloat(String(x['Jumlah Pipa Kolom (Batang)'] || '').replace(',', '.'))).filter(n => isFinite(n)); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) + ' btg' : '–'; }, sub: r => { const v = r.map(x => parseFloat(String(x['Jumlah Pipa Kolom (Batang)'] || '').replace(',', '.'))).filter(n => isFinite(n)); return v.length ? 'total ' + fmt(v.reduce((a, b) => a + b, 0)) + ' batang · ' + v.length + ' pompa terisi' : 'belum ada data'; } },
        { label: 'Sumur Baik', icon: '🟢', c: '#14b8a6', fn: r => r.filter(x => /baik/i.test(x['Kondisi Akhir Sumur'] || '')).length },
        { label: 'Ada Komponen Bekas/Repair', icon: '🟠', c: '#f59e0b', fn: r => r.filter(x => Number(x['Komponen Bekas/Repair']) > 0).length },
        { label: 'Rata-rata Kedalaman Pompa (m)', icon: '📏', c: '#a78bfa', fn: r => avgStr(r, 'Kedalaman pompa (m)'), sub: r => { const a = avgStr(r, 'Jumlah Pipa Kolom (Batang)'); return a !== '–' ? 'rata-rata ' + a + ' pipa kolom' : ''; } },
        { label: 'Rata-rata Kedalaman Sumur (m)', icon: '🕳️', c: '#6366f1', fn: r => avgStr(r, 'Kedalaman Sumur (m)'), sub: r => { const a = avgStr(r, 'Statistic Water Level (m)'); return a !== '–' ? 'SWL rata-rata ' + a + ' m' : ''; } },
        { label: 'Maintenance > 180 hari', icon: '⏰', c: '#ef4444', fn: r => r.filter(x => Number(x['Hari Sejak Maintenance']) > 180).length, sub: r => { const n = r.filter(x => x['Hari Sejak Maintenance'] === '').length; return n ? n + ' tanpa tanggal' : ''; } },
        { label: 'Pompa di Sumber Air', icon: '🔄', c: '#ec4899', fn: r => r.filter(x => /ada/i.test(x['Pompa (Sumber Air)'] || '')).length, sub: r => { const n = r.filter(x => x['Kode Sumur'] && !/ada/i.test(x['Pompa (Sumber Air)'] || '')).length; return n ? n + ' tercatat tanpa pompa di Sumber Air' : ''; } },
      ],
      charts: [
        { id: 'c1', title: 'Pompa Sumur per Wilayah', type: 'bar', key: 'Wilayah' },
        { id: 'c2', title: 'Kondisi Bowl', type: 'doughnut', key: 'Kondisi Bowl', colors: { Baru: '#22c55e', Bekas: '#f59e0b', Repair: '#ef4444' } },
        { id: 'c3', title: 'Jumlah Pipa Kolom (Batang)', type: 'bar', key: 'Jumlah Pipa Kolom (Batang)' },
        { id: 'c4', title: 'Komponen Bekas / Repair Terbanyak', type: 'hbar', custom: 'sumurParts' },
      ],
      chips: {
        'Kondisi Akhir Sumur': v => /baik/i.test(v) ? 'chip-green' : 'chip-red',
        'Pompa (Sumber Air)': v => /ada/i.test(v) ? 'chip-green' : /rusak/i.test(v) ? 'chip-red' : 'chip-amber',
        'Status Catatan': v => v === 'Aktif' ? 'chip-green' : v === 'Pompa sudah dipindah' ? 'chip-gray' : 'chip-amber',
        'Komponen Bekas/Repair': v => Number(v) > 0 ? 'chip-amber' : 'chip-green',
        'Hari Sejak Maintenance': v => Number(v) > 180 ? 'chip-red' : Number(v) > 90 ? 'chip-amber' : 'chip-green'
      }
    },
    mesin: {
      title: 'Inventaris Mesin / Engine', icon: '⚙️',
      freezeUntil: 'Asal Mesin',   // kolom paling kiri s.d. kolom ini dibekukan saat scroll horizontal
      filters: ['Asal Mesin', 'Komoditi', 'Jenis', 'Spec', 'Pompa', 'Power', 'KONDISI', 'Status', 'Kondisi Komponen'],
      kpis: [
        { label: 'Total Mesin', icon: '⚙️', c: '#f59e0b', fn: r => r.length },
        { label: 'Asal Mesin', icon: '🏭', c: '#38bdf8', fn: r => uniq(r, 'Asal Mesin').length },
        { label: 'Terpasang', icon: '✅', c: '#22c55e', fn: r => r.filter(x => isTrue(x['Status'], /terpasang/i)).length },
        { label: 'Standby', icon: '⏸️', c: '#a78bfa', fn: r => r.filter(x => isTrue(x['Status'], /standby/i)).length },
        { label: 'Rusak', icon: '🛠️', c: '#ef4444', fn: r => r.filter(x => isTrue(x['Status'], /rusak/i)).length },
        { label: 'Komponen B/C', icon: '🟠', c: '#f59e0b', fn: r => r.filter(x => x['Kondisi Komponen'] && x['Kondisi Komponen'] !== 'A').length },
        { label: 'Kritis (Inspeksi)', icon: '🔴', c: '#ef4444', fn: r => r.filter(x => /kritis/i.test(x['KONDISI'] || '')).length, sub: r => { const n = r.filter(x => /perhatian/i.test(x['KONDISI'] || '')).length; return n ? n + ' perlu perhatian' : ''; } },
        { label: 'Ada Catatan', icon: '📝', c: '#f97316', fn: r => r.filter(x => x['Keterangan']).length },
      ],
      charts: [
        { id: 'c1', title: 'Mesin per Komoditi', type: 'bar', key: 'Komoditi' },
        { id: 'c2', title: 'Asal Mesin', type: 'doughnut', key: 'Asal Mesin' },
        { id: 'c3', title: 'Kondisi Keseluruhan', type: 'doughnut', key: 'Kondisi Komponen', colors: { A: '#22c55e', B: '#f59e0b', C: '#ef4444' } },
        { id: 'c4', title: 'Komponen Paling Sering Bermasalah', type: 'hbar', custom: 'components' },
      ],
      chips: {
        'Kondisi Komponen': v => v === 'A' ? 'chip-green' : v === 'B' ? 'chip-amber' : 'chip-red',
        'KONDISI': v => /baik/i.test(v) ? 'chip-green' : /perhatian/i.test(v) ? 'chip-amber' : 'chip-red', // kolom KONDISI hasil inspeksi (Baik / Perlu Perhatian / Kritis) — menggantikan kolom Category
        'Status': v => /terpasang|siap|aktif/i.test(v) ? 'chip-green' : /rusak/i.test(v) ? 'chip-red' : /standby/i.test(v) ? 'chip-amber' : 'chip-gray',
        'Pompa': v => /sumur/i.test(v) ? 'chip-blue' : 'chip-purple',
        'Jenis': () => 'chip-gray',
        'Keterangan': () => 'chip-red',
        'Komponen Bermasalah': () => 'chip-red'
      }
    },
    pipa: { title: 'Inventaris Pipa', icon: '🔩', custom: 'pipa', filters: [], kpis: [], charts: [] },
    pendukung: { title: 'Unit Pendukung', icon: '🚜', custom: 'pendukung', filters: [], kpis: [], charts: [] },
    irrigator: {
      title: 'Inventaris Irrigator', icon: '💦',
      freezeUntil: 'WILAYAH',
      filters: ['WILAYAH', 'Unit', 'KONDISI', 'Status', 'Nozzle', 'Kondisi Komponen'],
      kpis: [
        { label: 'Total Irrigator', icon: '💦', c: '#38bdf8', fn: r => r.length },
        { label: 'Terpasang', icon: '✅', c: '#22c55e', fn: r => r.filter(x => isTrue(x['Status'], /terpasang/i)).length },
        { label: 'Rusak', icon: '🛠️', c: '#ef4444', fn: r => r.filter(x => isTrue(x['Status'], /rusak/i)).length },
        { label: 'Wilayah', icon: '📍', c: '#a78bfa', fn: r => uniq(r, 'WILAYAH').length },
        { label: 'Kondisi A — Baik', icon: '🟢', c: '#22c55e', fn: r => r.filter(x => x['Kondisi Komponen'] === 'A').length },
        { label: 'Ada Komponen B/C', icon: '🟠', c: '#f59e0b', fn: r => r.filter(x => x['Kondisi Komponen'] !== 'A').length },
        { label: 'Kritis (Inspeksi)', icon: '🔴', c: '#ef4444', fn: r => r.filter(x => /kritis/i.test(x['KONDISI'] || '')).length, sub: r => { const n = r.filter(x => /perhatian/i.test(x['KONDISI'] || '')).length; return n ? n + ' perlu perhatian' : ''; } },
      ],
      charts: [
        { id: 'c1', title: 'Irrigator per Wilayah', type: 'bar', key: 'WILAYAH' },
        { id: 'c2', title: 'Tipe Unit', type: 'doughnut', key: 'Unit' },
        { id: 'c3', title: 'Status', type: 'doughnut', key: 'Status', colors: { Terpasang: '#22c55e', Rusak: '#ef4444' } },
        { id: 'c4', title: 'Komponen Paling Sering Bermasalah', type: 'hbar', custom: 'components' },
      ],
      chips: {
        'Status': v => /terpasang/i.test(v) ? 'chip-green' : /rusak/i.test(v) ? 'chip-red' : 'chip-gray',
        'Kondisi Komponen': v => v === 'A' ? 'chip-green' : v === 'B' ? 'chip-amber' : 'chip-red',
        'KONDISI': v => /baik/i.test(v) ? 'chip-green' : /perhatian/i.test(v) ? 'chip-amber' : 'chip-red', // kolom KONDISI hasil inspeksi (Baik / Perlu Perhatian / Kritis) — menggantikan kolom Category
        'Komponen Bermasalah': () => 'chip-red'
      }
    }
  };

  /* ---------- state ---------- */
  const RAW = {}, state = {}, charts = {}, dirty = {};
  let currentTab = 'overview', timer = null, loading = false;
  const newState = (k) => {
    const st = { filters: {}, search: '', sort: null, dir: 1, page: 1, size: Number(localStorage.getItem('fs_pagesize')) || 25 };
    const df = k && CONFIG[k] && CONFIG[k].defaultFilters;
    if (df && RAW[k] && !RAW[k].error) Object.entries(df).forEach(([f, vals]) => { if (!RAW[k].headers.includes(f)) return; const have = new Set(RAW[k].rows.map(r => r[f])); const set = new Set(vals.filter(v => have.has(v))); if (set.size) st.filters[f] = set; });
    return st;
  };

  /* ---------- theme ---------- */
  function applyTheme(t) { document.body.setAttribute('data-theme', t); $('themeBtn').innerHTML = (t === 'light' ? '☀️' : '🌙') + ' <span class="t">Tema</span>'; localStorage.setItem('fs_theme', t); }
  window.toggleTheme = () => { applyTheme(document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light'); rerenderAll(); };
  applyTheme('light'); // tema monokrom tunggal (tanpa mode gelap)

  /* ---------- load ---------- */
  const CACHE_KEY = 'fs_pg2_data_v1';
  function saveCache(d) {
    try { const slim = {}; Object.keys(d.sheets).forEach(k => { const s = d.sheets[k]; if (!s.error) slim[k] = { key: k, name: s.name, headers: s.headers, issues: s.issues, meta: s.meta, rows: s.rows.map(r => { const o = {}; for (const h in r) if (h !== '_s') o[h] = r[h]; return o; }) }; });
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), sheets: slim })); } catch (e) { /* kuota penuh → abaikan */ }
  }
  function loadCache() {
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (!c || !c.sheets || Date.now() - c.at > 7 * 864e5) return null; return c; } catch (e) { return null; }
  }
  // sinkron otomatis DITUNDA selama kartu tulis-balik (Pindah Unit / Pasang Unit / Tarik ke Bengkel / Pompa) sedang terbuka
  const editOpen = () => { const m = document.getElementById('editModal'); return !!(m && m.classList.contains('show')); };
  function scheduleAuto(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (editOpen()) { $('syncInfo').textContent = 'Sinkron otomatis ditunda (form terbuka)'; scheduleAuto(30000); return; }
      loadData(false);
    }, ms);
  }
  window.loadData = async function (manual) {
    if (!manual && editOpen()) { scheduleAuto(30000); return; }
    if (loading) return; loading = true;
    const btn = $('refreshBtn'); btn.disabled = true; $('syncInfo').textContent = window.__fromCache ? $('syncInfo').textContent : 'Sinkron…'; $('syncDot').className = 'dot'; window.__fromCache = false;
    try {
      const d = await DataLayer.fetchAll();
      onData(d);
      if (!onData.failed) saveCache(d);
      if (manual && !onData.failed) toast('Data berhasil disinkronkan ✔');
    } catch (e) {
      $('syncDot').className = 'dot err'; $('syncInfo').textContent = 'Gagal sinkron';
      toast('Gagal memuat data: ' + e.message, true);
    } finally {
      loading = false; btn.disabled = false; $('loader').classList.add('hide');
      if (APP_CONFIG.autoRefreshMs) scheduleAuto(APP_CONFIG.autoRefreshMs);
    }
  };

  function onData(d) {
    const errs = [], kept = [];
    // sheet pendamping tanpa tab sendiri (tb_aktwilayah) — diproses lebih dulu agar tersedia saat tab Unit Pendukung dibangun
    ['aktwil'].forEach(k => {
      const s = d.sheets[k]; if (!s) return;
      if (s.error) { if (!(RAW[k] && RAW[k].rows.length)) { RAW[k] = s; errs.push(s.name + ' (' + k + '): ' + s.error); } else RAW[k].stale = true; return; }
      s.stale = false; RAW[k] = s;
    });
    Object.keys(CONFIG).forEach(k => {
      let s = d.sheets[k] || { headers: [], rows: [] };
      if (s.error && RAW[k] && RAW[k].rows.length) {
        // gagal ambil sheet ini → pertahankan data lama (jangan kosongkan dashboard)
        kept.push(RAW[k].name); RAW[k].stale = true; dirty[k] = true; return;
      }
      // pre-compute string pencarian per baris (performa)
      s.rows.forEach(r => { r._s = s.headers.map(h => r[h]).join(' \u0001 ').toLowerCase(); });
      if (k === 'sumur') enrichSumur(s);
      // pre-compute ulang string pencarian bila kolom turunan ditambahkan
      if (k === 'sumur') s.rows.forEach(r => { r._s = s.headers.map(h => r[h]).join(' \u0001 ').toLowerCase(); });
      s.stale = false; RAW[k] = s;
      if (s.error) errs.push(s.name + ': ' + s.error);
      if (!state[k]) state[k] = newState(k);
      $('badge-' + k).textContent = fmt(k === 'sumur' ? s.rows.filter(r => r['Status Catatan'] === 'Aktif').length : s.rows.length);
      if (k === 'sumur') $('badge-' + k).title = fmt(s.rows.length) + ' catatan di sheet Pompa Sumur · angka = pompa aktif (Ada Pompa di Sumber Air)';
      buildView(k);
      dirty[k] = true;
    });
    relationalChecks();
    updateIssues();
    renderOverview();
    if (currentTab !== 'overview') renderView(currentTab);
    const t = d.generatedAt, allKept = kept.length === Object.keys(CONFIG).length;
    if (!allKept) { $('syncInfo').textContent = 'Update ' + t.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); $('ftime').textContent = 'Terakhir sinkron: ' + t.toLocaleString('id-ID'); }
    if (kept.length || errs.length) {
      $('syncDot').className = 'dot err'; if (allKept) $('syncInfo').textContent = 'Offline — data terakhir';
      toast((kept.length ? 'Gagal sinkron ' + kept.join(', ') + ' — menampilkan data terakhir. ' : '') + (errs.length ? 'Gagal dimuat: ' + errs.join(' | ') : ''), true);
      onData.failed = true;
    } else onData.failed = false;
    // Peringatan kolom konfigurasi yang tidak ditemukan (membantu saat header sheet diganti)
    const missing = [];
    Object.keys(CONFIG).forEach(k => { if (!RAW[k].headers.length) return; CONFIG[k].filters.forEach(f => { if (!altKey(RAW[k].headers, f)) missing.push(RAW[k].name + ' → ' + f); }); });
    if (missing.length) console.warn('[Dashboard] Kolom tidak ditemukan:', missing);
  }

  /* ---------- tabs ---------- */
  window.switchTab = function (t) {
    if (!t || (t !== 'overview' && !CONFIG[t])) t = 'overview';
    currentTab = t; if (location.hash !== '#' + t) history.replaceState(null, '', '#' + t);
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === t));
    document.querySelectorAll('.view').forEach(x => x.classList.toggle('active', x.id === 'view-' + t));
    closeAllDropdowns();
    if (t !== 'overview' && RAW[t] && dirty[t]) renderView(t);
  };
  function rerenderAll() { renderOverview(); Object.keys(CONFIG).forEach(k => { dirty[k] = true; }); if (currentTab !== 'overview') renderView(currentTab); }

  /* ---------- build view ---------- */
  function buildView(k) {
    const cfg = CONFIG[k], data = RAW[k], el = $('view-' + k);
    if (data.error) { el.innerHTML = `<div class="alert">⚠️ Sheet "<b>${esc(data.name)}</b>" gagal dimuat: ${esc(data.error)}</div>`; return; }
    if (cfg.custom === 'pipa') return buildPipa();
    if (cfg.custom === 'pendukung') return buildPend();
    // hancurkan chart lama milik tab ini (canvas akan dibuat ulang)
    Object.keys(charts).forEach(id => { if (id.startsWith(k + '-')) { try { charts[id].destroy(); } catch (e) {} delete charts[id]; } });
    const filters = [...new Set(cfg.filters.map(f => altKey(data.headers, f)).filter(Boolean))];
    // buang nilai filter lama yang sudah tidak ada di data
    Object.keys(state[k].filters).forEach(f => { if (!filters.includes(f)) delete state[k].filters[f]; });

    el.innerHTML = `
      <div class="kpis" id="${k}-kpis"></div>
      <div class="filters">
        <div class="fgroup search"><label>🔍 Cari</label><input type="text" id="${k}-search" placeholder="Cari kode, lokasi, keterangan… (Enter)" autocomplete="off"></div>
        ${filters.map(f => `<div class="fgroup"><label title="${esc(f)}">${esc(f)}</label><div class="ms" data-f="${esc(f)}" id="${k}-ms-${cssId(f)}"><button type="button" class="ms-btn"><span class="ms-txt">Semua</span><span class="ms-caret">▾</span></button><div class="ms-dd"></div></div></div>`).join('')}
        <div class="fgroup" style="flex:0;min-width:auto"><label>&nbsp;</label><button class="btn btn-outline" id="${k}-reset">✕ Reset</button></div>
      </div>
      <div class="active-filters" id="${k}-af"></div>
      ${k === 'sumur' ? '<div class="card sumur-resume" id="sumur-resume"></div>' : ''}
      <div class="charts">${cfg.charts.map(c => `<div class="card"><h3>${esc(c.title)}</h3><div class="chart-box"><canvas id="${k}-${c.id}"></canvas></div></div>`).join('')}</div>
      <div class="tbl-head">
        <h3>${cfg.icon} ${esc(cfg.title)}</h3>
        <div class="tbl-tools">
          <span class="info" id="${k}-info"></span>
          ${k === 'detail' && window.FSEdit ? '<button class="btn btn-primary" type="button" id="detail-install" onclick="FSEdit.install()" title="Tambah baris unit baru di sheet Detail Terpasang">➕ Pasang Unit</button>' : ''}
          ${k === 'sumber' && window.FSEdit ? '<button class="btn btn-primary" type="button" id="sumber-pump" onclick="FSEdit.pump()" title="Pindah / ubah ketersediaan pompa sumur bor (kolom Pompa di sheet Sumber Air)">🔄 Pindah Pompa Sumur</button>' : ''}
          ${k === 'sumur' && window.FSEdit ? '<button class="btn btn-primary" type="button" id="sumur-sync" onclick="FSEdit.syncSumur()" title="Tambahkan catatan untuk sumur ber-pompa (Sumber Air) yang belum ada di sheet Pompa Sumur">🔄 Sinkron dari Sumber Air</button>' : ''}
          <label class="ps switch" title="Bekukan kolom kiri s.d. ${esc(cfg.freezeUntil || '')}"><input type="checkbox" id="${k}-freeze" ${cfg.freezeUntil ? 'checked' : 'disabled'}> 🧊 Freeze kolom</label>
          <label class="ps">Tampilkan <select id="${k}-size">${PAGE_SIZES.map(s => `<option value="${s}">${s}</option>`).join('')}</select> baris</label>
        </div>
      </div>
      <div class="tbl-wrap"><table><thead id="${k}-thead"></thead><tbody id="${k}-tbody"></tbody></table></div>
      <div class="pager"><span id="${k}-pinfo"></span><div class="pg" id="${k}-pg"></div></div>`;

    // events
    const search = $(k + '-search');
    const doSearch = () => { const v = search.value; if (v !== state[k].search) { state[k].search = v; state[k].page = 1; renderView(k); } };
    search.addEventListener('input', debounce(doSearch, 250));
    search.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    search.value = state[k].search;

    el.querySelectorAll('.ms').forEach(ms => initMultiSelect(k, ms));
    $(k + '-reset').addEventListener('click', () => resetFilters(k));
    $(k + '-thead').addEventListener('click', e => { const th = e.target.closest('th'); if (th) sortBy(k, th.dataset.h); });
    $(k + '-tbody').addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (tr) showDetail(k, +tr.dataset.i); });
    $(k + '-pg').addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (b) { state[k].page = +b.dataset.p; renderView(k); el.querySelector('.tbl-wrap').scrollTop = 0; } });
    $(k + '-af').addEventListener('click', e => { const c = e.target.closest('[data-f]'); if (!c) return; const f = c.dataset.f, v = c.dataset.v; if (v !== undefined) state[k].filters[f].delete(v); else delete state[k].filters[f]; if (state[k].filters[f] && !state[k].filters[f].size) delete state[k].filters[f]; state[k].page = 1; syncMsButtons(k); renderView(k); });
    const fz = $(k + '-freeze');
    if (localStorage.getItem('fs_freeze_' + k) === '0') fz.checked = false;
    fz.addEventListener('change', () => { localStorage.setItem('fs_freeze_' + k, fz.checked ? '1' : '0'); applyFreeze(k); });
    const sizeSel = $(k + '-size');
    sizeSel.value = String(state[k].size === Infinity ? 'Semua' : state[k].size);
    if (sizeSel.selectedIndex < 0) sizeSel.value = '25';
    sizeSel.addEventListener('change', e => { const v = e.target.value; state[k].size = v === 'Semua' ? Infinity : +v; localStorage.setItem('fs_pagesize', v === 'Semua' ? 'Infinity' : v); state[k].page = 1; renderView(k); });
    if (localStorage.getItem('fs_pagesize') === 'Infinity') state[k].size = Infinity;
  }

  /* ---------- multi-select (checklist) ---------- */
  function initMultiSelect(k, ms) {
    const f = ms.dataset.f, btn = ms.querySelector('.ms-btn'), dd = ms.querySelector('.ms-dd');
    btn.addEventListener('click', e => { e.stopPropagation(); const open = ms.classList.contains('open'); closeAllDropdowns(); if (!open) { renderDropdown(k, ms); ms.classList.add('open'); dd.querySelector('input[type=text]')?.focus(); } });
    dd.addEventListener('click', e => e.stopPropagation());
    dd.addEventListener('change', e => {
      const cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
      const set = state[k].filters[f] || (state[k].filters[f] = new Set());
      cb.checked ? set.add(cb.value) : set.delete(cb.value);
      if (!set.size) delete state[k].filters[f];
      state[k].page = 1; syncMsButtons(k); renderView(k); renderDropdown(k, ms, dd.querySelector('input[type=text]')?.value || '');
    });
    dd.addEventListener('input', e => { if (e.target.matches('input[type=text]')) filterDropdownItems(dd, e.target.value); });
    dd.addEventListener('click', e => {
      const a = e.target.closest('[data-act]'); if (!a) return;
      const visible = [...dd.querySelectorAll('.ms-item:not(.hide) input')];
      const set = state[k].filters[f] || (state[k].filters[f] = new Set());
      if (a.dataset.act === 'all') visible.forEach(i => set.add(i.value));
      else if (a.dataset.act === 'none') delete state[k].filters[f];
      else if (a.dataset.act === 'inv') visible.forEach(i => set.has(i.value) ? set.delete(i.value) : set.add(i.value));
      if (state[k].filters[f] && !state[k].filters[f].size) delete state[k].filters[f];
      state[k].page = 1; syncMsButtons(k); renderView(k); renderDropdown(k, ms, dd.querySelector('input[type=text]')?.value || '');
    });
    syncMsButton(k, ms);
  }
  function renderDropdown(k, ms, q = '') {
    const f = ms.dataset.f, dd = ms.querySelector('.ms-dd'), set = state[k].filters[f] || new Set();
    // hitung jumlah per nilai berdasarkan filter LAIN yang aktif (cascading)
    const others = filtered(k, f);
    const cnt = new Map(); others.forEach(r => { const v = r[f]; if (v !== '') cnt.set(v, (cnt.get(v) || 0) + 1); });
    const vals = sortNat(uniq(RAW[k].rows, f));
    dd.innerHTML = `
      <div class="ms-top"><input type="text" placeholder="Cari nilai…" value="${esc(q)}"></div>
      <div class="ms-acts"><a data-act="all">Pilih semua</a><a data-act="inv">Balik</a><a data-act="none">Hapus</a></div>
      <div class="ms-list">${vals.map(v => `<label class="ms-item"><input type="checkbox" value="${esc(v)}" ${set.has(v) ? 'checked' : ''}><span class="ms-lbl">${esc(v)}</span><span class="ms-cnt">${cnt.get(v) || 0}</span></label>`).join('') || '<div class="empty" style="padding:14px">Tidak ada nilai</div>'}</div>`;
    if (q) filterDropdownItems(dd, q);
  }
  function filterDropdownItems(dd, q) { q = q.toLowerCase(); dd.querySelectorAll('.ms-item').forEach(it => it.classList.toggle('hide', !it.querySelector('.ms-lbl').textContent.toLowerCase().includes(q))); }
  function syncMsButton(k, ms) { const set = state[k].filters[ms.dataset.f]; const t = ms.querySelector('.ms-txt'); if (!set || !set.size) { t.textContent = 'Semua'; ms.classList.remove('has'); } else { t.textContent = set.size === 1 ? [...set][0] : set.size + ' dipilih'; ms.classList.add('has'); } }
  function syncMsButtons(k) { document.querySelectorAll(`#view-${k} .ms`).forEach(ms => syncMsButton(k, ms)); }
  function closeAllDropdowns() { document.querySelectorAll('.ms.open').forEach(m => m.classList.remove('open')); }
  document.addEventListener('click', closeAllDropdowns);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAllDropdowns(); closeModal(); if (window.closeIssues) closeIssues(); } });

  /* ---------- filter / sort ---------- */
  function filtered(k, skipField) {
    const s = state[k], q = s.search.toLowerCase().trim();
    const active = Object.entries(s.filters).filter(([f, set]) => f !== skipField && set && set.size);
    let rows = RAW[k].rows;
    if (active.length || q) rows = rows.filter(r => {
      for (const [f, set] of active) if (!set.has(r[f])) return false;
      return !q || r._s.includes(q);
    });
    if (s.sort && !skipField) {
      const c = s.sort, d = s.dir, numeric = isNumericCol(k, c);
      rows = [...rows].sort((a, b) => {
        const x = a[c], y = b[c];
        if (x === '' && y !== '') return 1; if (y === '' && x !== '') return -1;
        return (numeric ? numv(a, c) - numv(b, c) : String(x).localeCompare(String(y), 'id', { numeric: true })) * d;
      });
    }
    return rows;
  }
  function isNumericCol(k, c) { return !!(RAW[k].meta && RAW[k].meta.numFmt && RAW[k].meta.numFmt[c]); }
  function resetFilters(k) { const size = state[k].size; state[k] = newState(k); state[k].size = size; $(k + '-search').value = ''; syncMsButtons(k); renderView(k); }
  function sortBy(k, c) { const s = state[k]; if (s.sort === c) s.dir *= -1; else { s.sort = c; s.dir = 1; } renderView(k); }

  /* ---------- render tab ---------- */
  function renderView(k) {
    if (!RAW[k] || RAW[k].error || !$(k + '-kpis')) return;
    dirty[k] = false;
    if (CONFIG[k].custom === 'pipa') return renderPipa();
    if (CONFIG[k].custom === 'pendukung') return renderPend();
    const cfg = CONFIG[k], rows = filtered(k), s = state[k], headers = RAW[k].headers;

    $(k + '-kpis').innerHTML = cfg.kpis.map(x => `<div class="kpi" style="--c:${mono(x.c)}"><div class="icon">${x.icon}</div><div class="val">${x.fn(rows)}</div><div class="lbl">${x.label}</div>${x.sub && x.sub(rows) ? `<div class="sub">${esc(x.sub(rows))}</div>` : ''}</div>`).join('');

    if (k === 'sumur') renderSumurResume(rows);
    // chip filter aktif
    const af = [];
    Object.entries(s.filters).forEach(([f, set]) => set && set.size && (set.size <= 3
      ? [...set].forEach(v => af.push(`<span class="chip chip-blue" data-f="${esc(f)}" data-v="${esc(v)}" title="Hapus">${esc(f)}: <b>${esc(v)}</b> ✕</span>`))
      : af.push(`<span class="chip chip-blue" data-f="${esc(f)}" title="Hapus semua">${esc(f)}: <b>${set.size} nilai</b> ✕</span>`)));
    if (s.search) af.push(`<span class="chip chip-purple">🔍 "${esc(s.search)}"</span>`);
    if (CONFIG[k].defaultFilters && af.length) af.push(`<span class="chip chip-gray" title="Filter bawaan tab ini: ${esc(Object.entries(CONFIG[k].defaultFilters).map(([f, v]) => f + ' = ' + v.join('/')).join(' · '))}. Klik ✕ pada chip untuk melihat semua PG; tombol Reset mengembalikan ke bawaan">ⓘ bawaan: PG2 · W08–W15</span>`);
    $(k + '-af').innerHTML = af.join('');

    requestAnimationFrame(() => cfg.charts.forEach(c => {
      if (c.custom === 'components') { drawChart(k + '-' + c.id, 'hbar', componentStats(k, rows), 10); return; }
      if (c.custom === 'sumurParts') { const st = sumurPartStats(rows); if (!st.length) { noChart(k + '-' + c.id, 'Komponen bekas/repair'); return; } drawChart(k + '-' + c.id, 'hbar', st, 10); return; }
      const key = altKey(headers, c.key);
      if (!key) { noChart(k + '-' + c.id, c.key); return; }
      const all = count(rows, key), blank = all.find(x => x[0] === '(kosong)');
      let e = all.filter(x => x[0] !== '(kosong)' && !(c.exclude && c.exclude.test(String(x[0]))));
      const note = $(k + '-' + c.id)?.closest('.card')?.querySelector('h3');
      if (note) { let sp = note.querySelector('.blank-note'); if (blank && e.length) { if (!sp) { sp = document.createElement('span'); sp.className = 'blank-note'; note.appendChild(sp); } sp.textContent = fmt(blank[1]) + ' belum diisi'; sp.title = 'Baris dengan kolom "' + key + '" kosong tidak ditampilkan di chart'; } else if (sp) sp.remove(); }
      if (c.type === 'line') e = e.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      else if (c.type === 'bar') e = e.sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'id', { numeric: true }));
      drawChart(k + '-' + c.id, c.type, e, c.type === 'line' ? 120 : (c.limit || 12), c.colors);
    }));

    // tabel
    const size = s.size === Infinity ? Math.max(rows.length, 1) : s.size;
    const pages = Math.max(1, Math.ceil(rows.length / size)); if (s.page > pages) s.page = pages;
    const start = (s.page - 1) * size, slice = rows.slice(start, start + size);
    $(k + '-info').textContent = `${fmt(rows.length)} dari ${fmt(RAW[k].rows.length)} baris` + (rows.length ? ` · menampilkan ${fmt(start + 1)}–${fmt(start + slice.length)}` : '');
    const nFreeze = freezeCount(k);
    $(k + '-thead').innerHTML = '<tr>' + headers.map((h, i) => `<th data-h="${esc(h)}" class="${s.sort === h ? 'sorted ' : ''}${i < nFreeze ? 'fz' : ''}${i === nFreeze - 1 ? ' fz-last' : ''}">${esc(h)}<span class="arrow">${s.sort === h ? (s.dir > 0 ? '▲' : '▼') : '⇅'}</span></th>`).join('') + '</tr>';
    const cells = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) { const r = slice[i]; let t = `<tr class="clickable" data-i="${r._i}">`; for (let j = 0; j < headers.length; j++) { const h = headers[j]; const fl = r._flag && r._flag[h] && r._flag[h].level !== 'info' ? r._flag[h] : null; const cls = (j < nFreeze ? 'fz' + (j === nFreeze - 1 ? ' fz-last' : '') : '') + (fl ? ' bad' + (fl.level === 'error' ? ' err' : '') : ''); t += cls ? `<td class="${cls}"${fl ? ` title="${esc(fl.reason)} — ${esc(fl.suggest)}"` : ''}>${cell(k, h, r[h], r)}</td>` : `<td>${cell(k, h, r[h])}</td>`; } cells[i] = t + '</tr>'; }
    $(k + '-tbody').innerHTML = cells.length ? cells.join('') : `<tr><td colspan="${headers.length}" class="empty">Tidak ada data yang cocok dengan filter</td></tr>`;
    $(k + '-pinfo').textContent = `Halaman ${s.page} / ${pages}`;
    let pg = ''; const btn = (p, l, cur) => `<button class="btn btn-outline ${cur ? 'cur' : ''}" data-p="${p}">${l}</button>`;
    if (pages > 1) {
      if (s.page > 1) pg += btn(1, '«') + btn(s.page - 1, '‹');
      for (let p = Math.max(1, s.page - 2); p <= Math.min(pages, s.page + 2); p++) pg += btn(p, p, p === s.page);
      if (s.page < pages) pg += btn(s.page + 1, '›') + btn(pages, '»');
    }
    $(k + '-pg').innerHTML = pg;
    requestAnimationFrame(() => applyFreeze(k));
  }

  /* ---------- kolom beku (sticky kiri) ---------- */
  function freezeCount(k) {
    const cfg = CONFIG[k], fz = $(k + '-freeze');
    if (!cfg.freezeUntil || (fz && !fz.checked)) return 0;
    const key = altKey(RAW[k].headers, cfg.freezeUntil);
    const idx = key ? RAW[k].headers.indexOf(key) : -1;
    return idx < 0 ? 0 : idx + 1;
  }
  function applyFreeze(k) {
    const wrap = document.querySelector(`#view-${k} .tbl-wrap`); if (!wrap) return;
    const n = freezeCount(k), ths = wrap.querySelectorAll('thead th');
    let st = $(k + '-fzstyle'); if (!st) { st = document.createElement('style'); st.id = k + '-fzstyle'; document.head.appendChild(st); }
    wrap.classList.toggle('frozen', n > 0);
    if (!n) { st.textContent = ''; return; }
    // ukur lebar header sekali, tulis aturan CSS nth-child → tidak ada penulisan style per sel
    let acc = 0, css = '';
    for (let i = 0; i < n; i++) { css += `#view-${k} .tbl-wrap.frozen tr>:nth-child(${i + 1}){left:${acc}px}`; acc += ths[i] ? ths[i].getBoundingClientRect().width : 0; }
    st.textContent = css;
  }
  let rzT; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (currentTab !== 'overview') applyFreeze(currentTab); }, 150); });

  // cari nama kolom alternatif (case-insensitive / sinonim) jika header sheet berubah
  const SYN = APP_CONFIG.synonyms || {};
  function altKey(headers, key) {
    if (headers.includes(key)) return key;
    const low = headers.find(h => h.toLowerCase() === String(key).toLowerCase()); if (low) return low;
    return (SYN[key] || []).find(a => headers.includes(a)) || null;
  }
  function noChart(id, key) {
    const c = $(id); if (!c) return;
    if (charts[id]) { try { charts[id].destroy(); } catch (e) {} delete charts[id]; }
    const box = c.parentElement; box.innerHTML = `<div class="empty" style="padding:70px 10px 0;font-size:12.5px">Kolom "<b>${esc(key)}</b>" tidak ditemukan di sheet</div><canvas id="${id}" hidden></canvas>`;
  }
  function componentCols(k) { return (RAW[k].meta && RAW[k].meta.compCols) || []; }
  function componentStats(k, rows) {
    const comp = componentCols(k), m = new Map();
    for (const r of rows) for (const h of comp) { const v = r[h]; if (v === 'B' || v === 'C' || v === 'b' || v === 'c') m.set(h, (m.get(h) || 0) + 1); }
    const e = [...m.entries()].sort((a, b) => b[1] - a[1]);
    return e.length ? e : [['Semua komponen kondisi A', 0]];
  }

  function cell(k, h, v, r) {
    if (v === '' || v == null) return '<span class="dash">—</span>';
    if (r && r._flag && r._flag[h]) return `<span class="bad-v" title="${esc(r._flag[h].reason)} — ${esc(r._flag[h].suggest)}">${esc(v)}</span>`;
    const cfg = CONFIG[k];
    if (cfg.numCols && cfg.numCols.includes(h)) { const n = toNumber(v); if (!isNaN(n)) return `<span class="num">${fmt(n, 2)}</span>`; }
    if (h === 'Komponen Bermasalah') return `<span class="chip chip-red" title="${esc(v)}">${esc(v.length > 60 ? v.slice(0, 57) + '…' : v)}</span>`;
    if (cfg.chips && cfg.chips[h]) return `<span class="chip ${cfg.chips[h](String(v))}">${esc(v)}</span>`;
    if (v.length === 1 && (k === 'mesin' || k === 'irrigator')) { const sv = v.toUpperCase(); if (sv === 'A' || sv === 'B' || sv === 'C') return `<span class="cond cond-${sv}">${sv}</span>`; }
    return esc(v);
  }

  /* ---------- detail modal ---------- */
  function showDetail(k, i) {
    const r = RAW[k].rows.find(x => x._i === i); if (!r) return;
    const title = r['Kode Unit'] || r['KODE UNIT'] || r['Kode Engine'] || r['Kode Baru'] || (r['LOKASI'] ? 'Pompa Sumur ' + r['LOKASI'] + (r['Kode Sumur'] ? ' · ' + r['Kode Sumur'] : '') : '') || CONFIG[k].title;
    $('modalTitle').textContent = CONFIG[k].icon + ' ' + title;
    const editBar = k === 'detail' && window.FSEdit ? `<div class="kv edit-bar"><span>Pindahkan unit ini ke lokasi lain — perubahan langsung ditulis ke sheet <b>Detail Terpasang</b> (butuh PIN).</span><button class="btn btn-outline" type="button" onclick="FSEdit.swap(${r._i})" title="Tukar engine/irigator dengan lokasi lain, atau ganti dengan unit standby">🔁 Tukar Unit</button><button class="btn btn-primary" type="button" onclick="FSEdit.open(${r._i})">✏️ Pindah Unit</button></div>` : '';
    const pumpBar = k === 'sumber' && window.FSEdit && /deep|sumur|bor/i.test(r['Jenis Sumber Air'] || '') ? `<div class="kv edit-bar"><span>Pompa: <b>${esc(r['Pompa'] || 'belum diisi')}</b> — pindahkan pompa ke sumur lain atau ubah kondisinya; ditulis ke kolom <b>Pompa</b> sheet <b>Sumber Air</b> (butuh PIN).</span><button class="btn btn-primary" type="button" onclick="FSEdit.pump('${esc(String(r['Kode Baru'] || '')).replace(/'/g, '')}')">🔄 Pindah Pompa Sumur</button></div>` : '';
    $('modalBody').innerHTML = editBar + pumpBar + RAW[k].headers.map(h => { const fl = r._flag && r._flag[h]; return `<div class="kv" ${fl ? 'style="outline:1px solid #f59e0b"' : ''}><b>${esc(h)}${fl ? ' ⚠️' : ''}</b>${cell(k, h, r[h], r)}${fl ? `<div style="font-size:11px;color:#f59e0b;margin-top:4px">${esc(fl.reason)}<br>${esc(fl.suggest)}</div>` : ''}</div>`; }).join('');
    $('modal').classList.add('show');
  }
  window.closeModal = () => $('modal').classList.remove('show');

  /* ---------- charts ---------- */
  function themeColors() { return { text: '#4b5563', grid: '#e5e7eb', border: '#ffffff' }; }
  const centerText = {
    id: 'centerText',
    afterDraw(chart) {
      if (chart.config.type !== 'doughnut') return;
      const total = chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
      const { ctx, chartArea: { left, right, top, bottom } } = chart;
      const x = (left + right) / 2, y = (top + bottom) / 2, tc = themeColors();
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 20px Inter, sans-serif'; ctx.fillStyle = tc.text; ctx.fillText(fmt(total), x, y - 7);
      ctx.font = '600 10px Inter, sans-serif'; ctx.fillStyle = tc.text; ctx.globalAlpha = .7; ctx.fillText('TOTAL', x, y + 11);
      ctx.restore();
    }
  };
  // Plugin: label angka pada setiap batang (tanpa library tambahan)
  const barValues = {
    id: 'barValues',
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(0); if (!meta || meta.hidden) return;
      const horiz = chart.options.indexAxis === 'y', g = chart.ctx, col = themeColors().text;
      g.save(); g.font = '700 11px Inter, system-ui, sans-serif'; g.fillStyle = col;
      g.textAlign = horiz ? 'left' : 'center'; g.textBaseline = horiz ? 'middle' : 'bottom';
      meta.data.forEach((bar, i) => {
        const v = chart.data.datasets[0].data[i]; if (v == null || isNaN(v)) return;
        const p = bar.getProps(['x', 'y', 'base'], true);
        if (horiz) g.fillText(fmt(v), p.x + 5, p.y); else g.fillText(fmt(v), p.x, p.y - 4);
      });
      g.restore();
    }
  };

  function drawChart(id, type, entries, limit = 12, colorMap) {
    const ctx = $(id); if (!ctx || typeof Chart === 'undefined') return;
    entries = entries.slice(0, limit);
    if (!entries.length || (entries.length === 1 && entries[0][1] === 0 && type === 'hbar')) {
      if (charts[id]) { try { charts[id].destroy(); } catch (e) {} delete charts[id]; }
      let ph = ctx.parentElement.querySelector('.empty'); if (!ph) { ph = document.createElement('div'); ph.className = 'empty chart-empty'; ctx.parentElement.appendChild(ph); }
      ph.textContent = entries.length ? '✅ ' + entries[0][0] : 'Tidak ada data untuk filter ini'; ctx.hidden = true; return;
    }
    if (ctx.hidden) { ctx.hidden = false; const ph = ctx.parentElement.querySelector('.empty'); if (ph) ph.remove(); }
    const tc = themeColors();
    const isBar = type === 'bar' || type === 'hbar', isLine = type === 'line', isPie = type === 'doughnut' || type === 'pie';
    const colors = colorMap ? entries.map((e, i) => colorMap[e[0]] || PALETTE[i % PALETTE.length]) : entries.map((_, i) => PALETTE[i % PALETTE.length]);
    const labels = entries.map(e => e[0]), data = entries.map(e => e[1]);

    // update in-place jika tipe sama (lebih ringan & animasi halus)
    let ex = charts[id];
    if (ex && (ex.canvas !== ctx || !ctx.isConnected)) { try { ex.destroy(); } catch (e) {} delete charts[id]; ex = null; }
    if (ex && ex._t === type) {
      ex.data.labels = labels; ex.data.datasets[0].data = data;
      if (isPie) ex.data.datasets[0].backgroundColor = colors;
      ex.options.plugins.legend.labels.color = tc.text;
      if (ex.options.scales.x) { ex.options.scales.x.ticks.color = tc.text; ex.options.scales.y.ticks.color = tc.text; ex.options.scales.x.grid.color = tc.grid; ex.options.scales.y.grid.color = tc.grid; }
      if (isPie) ex.data.datasets[0].borderColor = tc.border;
      ex.update(); return;
    }
    if (ex) ex.destroy();

    const dataset = isPie ? {
      data, backgroundColor: colors, borderColor: tc.border, borderWidth: 3, borderRadius: 14, spacing: 3, hoverOffset: 10, hoverBorderWidth: 0
    } : isLine ? {
      data, fill: true, tension: .4, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2.5, borderColor: '#4f6f8f', pointBackgroundColor: '#4f6f8f',
      backgroundColor: c => { const { ctx: g, chartArea } = c.chart; if (!chartArea) return 'rgba(107,148,194,.15)'; const gr = g.createLinearGradient(0, chartArea.top, 0, chartArea.bottom); gr.addColorStop(0, 'rgba(107,148,194,.35)'); gr.addColorStop(1, 'rgba(107,148,194,0)'); return gr; }
    } : {
      data, backgroundColor: type === 'hbar' ? '#b25454' : '#6b94c2', hoverBackgroundColor: type === 'hbar' ? '#9b3b3b' : '#4f6f8f',
      borderRadius: 8, borderSkipped: false, maxBarThickness: 42
    };

    const chart = new Chart(ctx, {
      type: isBar ? 'bar' : 'doughnut',
      data: { labels, datasets: [dataset] },
      plugins: isPie ? [centerText] : isBar ? [barValues] : [],
      options: {
        responsive: true, maintainAspectRatio: false, locale: 'id-ID', animation: { duration: 550, easing: 'easeOutQuart' },
        indexAxis: type === 'hbar' ? 'y' : 'x',
        cutout: isPie ? '64%' : undefined,
        layout: { padding: isPie ? 6 : type === 'hbar' ? { right: 36 } : { top: 18 } },
        interaction: { intersect: false, mode: isLine ? 'index' : 'nearest' },
        plugins: {
          legend: { display: isPie, position: 'right', labels: { color: tc.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 11, weight: '600' } } },
          tooltip: {
            backgroundColor: 'rgba(15,23,42,.92)', padding: 10, cornerRadius: 10, titleFont: { weight: '700' }, displayColors: isPie,
            callbacks: {
              label: c => { const v = c.parsed.y ?? c.parsed.x ?? c.parsed; if (isPie) { const tot = c.dataset.data.reduce((a, b) => a + b, 0); return ` ${fmt(v)} unit (${tot ? Math.round(v / tot * 100) : 0}%)`; } return ' ' + fmt(v) + ' unit'; }
            }
          }
        },
        scales: (isBar || isLine) ? {
          x: { beginAtZero: true, grace: type === 'hbar' ? '10%' : 0, ticks: { color: tc.text, maxRotation: 45, autoSkip: true, precision: 0, font: { size: 11 } }, grid: { display: type === 'hbar', color: tc.grid }, border: { display: false } },
          y: { beginAtZero: true, grace: type === 'hbar' ? 0 : '8%', ticks: { color: tc.text, precision: 0, font: { size: 11 } }, grid: { display: type !== 'hbar', color: tc.grid }, border: { display: false } }
        } : {}
      }
    });
    if (isLine) { chart.config.type = 'line'; chart.update(); }
    chart._t = type; charts[id] = chart;
  }

  /* ---------- overview ---------- */
  function renderOverview() {
    const d = RAW.detail?.rows || [], s = RAW.sumber?.rows || [], m = RAW.mesin?.rows || [], ir = RAW.irrigator?.rows || [];
    const k = [
      { l: 'Unit Terpasang', v: fmt(d.length), i: '🚜', c: '#f59e0b', t: 'detail' },
      { l: 'Wilayah Aktif', v: uniq(d, altKey(RAW.detail?.headers || [], 'Wil') || 'Wil').length, i: '📍', c: '#38bdf8', t: 'detail' },
      { l: 'Total Sumber Air', v: fmt(s.length), i: '🌊', c: '#a78bfa', t: 'sumber' },
      { l: 'Lebung', v: fmt(s.filter(x => isTrue(x['Jenis Sumber Air'], /reservoir|lebung/i)).length), i: '🏞️', c: '#14b8a6', t: 'sumber' },
      { l: 'Deep Well', v: fmt(s.filter(x => isTrue(x['Jenis Sumber Air'], /deep|sumur/i)).length), i: '🕳️', c: '#f59e0b', t: 'sumber' },
      { l: 'Pompa Sumur Bor Aktif', v: fmt((RAW.sumur && !RAW.sumur.error ? RAW.sumur.rows : []).filter(x => x['Status Catatan'] === 'Aktif').length), i: '🛢️', c: '#0ea5e9', t: 'sumur' },
      { l: 'Total Mesin', v: fmt(m.length), i: '⚙️', c: '#ec4899', t: 'mesin' },
      { l: 'Total Irrigator', v: fmt(ir.length), i: '💦', c: '#06b6d4', t: 'irrigator' },
      { l: 'Volume Air Real (m³)', v: fmt(sum(s, 'Volume Real Ukur (Overflow Terbuka)')), i: '📏', c: '#6366f1', t: 'sumber' },
      { l: 'Total Pipa (batang)', v: fmt(pipaModel().grand), i: '🔩', c: '#f97316', t: 'pipa' },
      { l: 'Unit Pendukung', v: fmt((RAW.pendukung && !RAW.pendukung.error ? RAW.pendukung.rows : []).length), i: '🚜', c: '#84cc16', t: 'pendukung' },
    ];
    $('ov-kpis').innerHTML = k.map(x => `<div class="kpi link" style="--c:${mono(x.c)}" data-t="${x.t}" title="Buka tab"><div class="icon">${x.i}</div><div class="val">${x.v}</div><div class="lbl">${x.l}</div></div>`).join('');
    requestAnimationFrame(() => {
      const nz = a => a.filter(x => x[0] !== '(kosong)');
      drawChart('ov-c1', 'bar', nz(count(d, altKey(RAW.detail?.headers || [], 'Wil') || 'Wil')).sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'id', { numeric: true })));
      drawChart('ov-c2', 'doughnut', nz(count(d, 'Jenis Engine')));
      drawChart('ov-c3', 'doughnut', nz(count(s, 'Jenis Sumber Air')));
      drawChart('ov-c4', 'doughnut', nz(count(ir, 'Status')), 12, { Terpasang: '#22c55e', Rusak: '#ef4444' });
    });
    const wil = count(d, altKey(RAW.detail?.headers || [], 'Wil') || 'Wil').filter(x => x[0] !== '(kosong)').slice(0, 10), mx = wil[0]?.[1] || 1;
    $('ov-wil').innerHTML = wil.map(([w, n]) => `<li><b>${esc(w)}</b><div class="bar"><span style="width:${n / mx * 100}%"></span></div><span>${n} unit</span></li>`).join('') || '<li class="empty">Belum ada data</li>';
    const lbl = { '(kosong)': 'Belum dinilai', A: 'Kondisi A — Baik', B: 'Kondisi B — Perlu Perhatian', C: 'Kondisi C — Perlu Perbaikan' };
    const li = (label, arr) => `<li class="sub"><b>${label}</b></li>` + count(arr, 'Kondisi Komponen').sort().map(([c, n]) => `<li><span class="chip ${c === 'A' ? 'chip-green' : c === 'B' ? 'chip-amber' : 'chip-red'}">${c}</span><span style="flex:1;margin-left:10px">${lbl[c] || c}</span><b>${n}</b></li>`).join('');
    $('ov-kondisi').innerHTML = li('⚙️ Mesin', m) + li('💦 Irrigator', ir);
    renderPipaResume();
    renderPendResume();
  }
  $('ov-kpis').addEventListener('click', e => { const c = e.target.closest('[data-t]'); if (c) switchTab(c.dataset.t); });


  /* ---------- SUMUR BOR: resume analisa ---------- */
  function renderSumurResume(rows) {
    const el = $('sumur-resume'); if (!el) return;
    const all = RAW.sumur.rows, meta = RAW.sumur.meta || {}, S = RAW.sumber && !RAW.sumber.error ? RAW.sumber.rows : [];
    if (!all.length) { el.innerHTML = '<h3>Resume Analisa Sumur Bor</h3><div class="empty">Belum ada data pada sheet Pompa Sumur</div>'; return; }
    const n = rows.length, aktif = rows.filter(x => x['Status Catatan'] === 'Aktif').length, hist = rows.filter(x => x['Status Catatan'] === 'Pompa sudah dipindah'), pipa = rows.map(x => parseFloat(String(x['Jumlah Pipa Kolom (Batang)'] || '').replace(',', '.'))).filter(v => isFinite(v)), baik = rows.filter(x => /baik/i.test(x['Kondisi Akhir Sumur'] || '')).length;
    const linked = rows.filter(x => x['Kode Sumur']), unlinked = rows.filter(x => !x['Kode Sumur']);
    const bekas = rows.filter(x => Number(x['Komponen Bekas/Repair']) > 0), over = rows.filter(x => Number(x['Hari Sejak Maintenance']) > 180).sort((a, b) => Number(b['Hari Sejak Maintenance']) - Number(a['Hari Sejak Maintenance']));
    const noPump = linked.filter(x => !/ada/i.test(x['Pompa (Sumber Air)'] || ''));
    const recorded = new Set(all.map(x => x[meta.lokH]));
    const saPumps = S.filter(r => /deep|sumur|bor/i.test(r['Jenis Sumber Air'] || '') && /ada/i.test(r['Pompa'] || ''));
    const saNoRecord = saPumps.filter(r => !lokTokens(r['Lokasi']).some(c => recorded.has(c)) && !lokTokens(r['Kedekatan Lokasi']).some(c => recorded.has(c)));
    const parts = sumurPartStats(rows).slice(0, 4);
    const wil = count(rows, 'Wilayah').filter(x => x[0] !== '(kosong)');
    const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
    const last = rows.filter(x => x[meta.tglH]).sort((a, b) => String(b[meta.tglH]).localeCompare(String(a[meta.tglH])))[0];
    const lokList = (arr, f) => arr.slice(0, 12).map(x => `<span class="chip chip-gray clickable" data-lok="${esc(x[meta.lokH] || x['Lokasi'] || '')}" title="Buka detail">${esc(f ? f(x) : x[meta.lokH])}</span>`).join(' ') + (arr.length > 12 ? ` <small>+${arr.length - 12} lagi</small>` : '');
    el.innerHTML = `<h3>Resume Analisa Sumur Bor <span class="blank-note">sheet Pompa Sumur · ${fmt(n)} dari ${fmt(all.length)} catatan</span></h3>
      <div class="sumur-grid">
        <div class="sr-block"><div class="big" style="color:#0ea5e9">${aktif}</div><div class="lbl">Pompa aktif · dari ${n} catatan</div><div class="sub">Jumlah pompa = catatan yang sumurnya berstatus <b>Ada Pompa</b> di Sumber Air.${hist.length ? ' <b>' + hist.length + '</b> catatan lama di lokasi yang pompanya sudah dipindah (riwayat, tidak dihitung): ' + lokList(hist, x => x[meta.lokH] + ' (' + (x['Pompa (Sumber Air)'] || 'kosong') + ')') : ''}</div></div>
        <div class="sr-block"><div class="big" style="color:#22c55e">${pipa.length ? (pipa.reduce((a, b) => a + b, 0) / pipa.length).toFixed(1) : '–'}</div><div class="lbl">Rata-rata pipa kolom (batang) · ${pipa.length}/${n} pompa terisi${pipa.length ? ', min ' + Math.min(...pipa) + ' · maks ' + Math.max(...pipa) + ' · total ' + fmt(pipa.reduce((a, b) => a + b, 0)) : ''}</div><div class="sub">Kondisi akhir sumur baik: <b>${baik}</b> · rata-rata kedalaman pompa <b>${avgStr(rows, 'Kedalaman pompa (m)')} m</b> · kedalaman sumur <b>${avgStr(rows, 'Kedalaman Sumur (m)')} m</b> · SWL <b>${avgStr(rows, 'Statistic Water Level (m)')} m</b>${last ? ' · maintenance terakhir <b>' + esc(last[meta.tglH]) + '</b> (' + esc(last[meta.lokH]) + ')' : ''}</div></div>
        <div class="sr-block"><div class="big" style="color:#f59e0b">${bekas.length}</div><div class="lbl">Pompa dengan komponen bekas / repair</div><div class="sub">${parts.length ? parts.map(([p, c]) => esc(p) + ' <b>' + c + '</b>').join(' · ') : 'Semua komponen tercatat baru'}</div></div>
        <div class="sr-block"><div class="big" style="color:${over.length ? '#ef4444' : '#22c55e'}">${over.length}</div><div class="lbl">Maintenance &gt; 180 hari</div><div class="sub">${over.length ? lokList(over, x => x[meta.lokH] + ' · ' + x['Hari Sejak Maintenance'] + ' hr') : 'Semua pompa dirawat dalam 6 bulan terakhir'}</div></div>
        <div class="sr-block"><div class="big" style="color:#38bdf8">${pct(linked.length, n)}</div><div class="lbl">Terhubung ke sheet Sumber Air (${linked.length}/${n})</div><div class="sub">${unlinked.length ? '⚠️ Lokasi tidak ditemukan di Sumber Air: ' + lokList(unlinked) : '✓ Semua lokasi dikenali'}${noPump.length ? '<br>⚠️ Tercatat di Pompa Sumur tetapi kolom Pompa di Sumber Air bukan "Ada Pompa": ' + lokList(noPump, x => x[meta.lokH] + ' (' + (x['Pompa (Sumber Air)'] || 'kosong') + ')') : ''}${saNoRecord.length ? '<br>ℹ️ Sumur "Ada Pompa" di Sumber Air tanpa catatan di Pompa Sumur: ' + saNoRecord.slice(0, 12).map(r => '<span class="chip chip-gray">' + esc(r['Kode Baru']) + ' · ' + esc(String(r['Lokasi']).trim()) + '</span>').join(' ') + (saNoRecord.length > 12 ? ' <small>+' + (saNoRecord.length - 12) + ' lagi</small>' : '') : ''}</div></div>
      </div>
      ${wil.length ? `<ul class="mini-list sr-wil">${wil.map(([w, c]) => `<li><b>${esc(w)}</b><div class="bar"><span style="width:${c / wil[0][1] * 100}%"></span></div><span>${c} pompa</span></li>`).join('')}</ul>` : ''}`;
    el.onclick = e => { const c = e.target.closest('[data-lok]'); if (!c) return; const r = RAW.sumur.rows.find(x => x[meta.lokH] === c.dataset.lok); if (r) showDetail('sumur', r._i); };
  }
  // dipakai tab lain (Pindah Pompa): deskripsi ringkas pompa sumur untuk sebuah lokasi / kode sumur
  function sumurInfo(lokOrKode) {
    const s = RAW.sumur; if (!s || s.error) return null; const meta = s.meta || {}; const q = String(lokOrKode || '').trim().toUpperCase().replace(/\s+/g, '');
    const r = s.rows.find(x => x[meta.lokH] === q || x['Kode Sumur'] === q); if (!r) return null;
    const parts = (r._sumurParts || []);
    const desc = ['Pompa sumur ' + r[meta.lokH], r['Jenis/Merk Pompa'] ? String(r['Jenis/Merk Pompa']).trim() : '', r['Jumlah Pipa Kolom (Batang)'] ? r['Jumlah Pipa Kolom (Batang)'] + ' pipa kolom' : '', r['Kedalaman pompa (m)'] ? 'kedalaman pompa ' + r['Kedalaman pompa (m)'] + ' m' : '', r['Kedalaman Sumur (m)'] ? 'sumur ' + r['Kedalaman Sumur (m)'] + ' m' : '', r['Statistic Water Level (m)'] ? 'SWL ' + r['Statistic Water Level (m)'] + ' m' : '', r[meta.tglH] ? 'maint. ' + r[meta.tglH] : '', parts.length ? 'bekas/repair: ' + parts.join(', ') : 'komponen baru'].filter(Boolean).join(' · ');
    return { row: r, lokasi: r[meta.lokH], desc };
  }

  /* ---------- PIPA (matriks ringkasan: Placement × jenis × kondisi) ---------- */
  const PIPA_COND = ['Good', 'Average', 'Poor', 'Reject'];
  const PIPA_COND_C = { Good: '#22c55e', Average: '#f59e0b', Poor: '#f97316', Reject: '#ef4444' };
  const PIPA_COND_ID = { Good: 'Baik', Average: 'Cukup', Poor: 'Buruk', Reject: 'Afkir' };
  const pipaState = { place: new Set(), jenis: new Set() };
  let pipaCache = null;

  // Bangun model dari header secara otomatis:
  //  "Total <Jenis>" → daftar jenis; "<Jenis> <Good|Average|Poor|Reject>" → kondisi; "<Jenis> <lainnya>" → kategori (mis. 100M, >50M)
  function pipaModel(force) {
    if (pipaCache && !force && pipaCache.src === RAW.pipa) return pipaCache;
    const sh = RAW.pipa, H = (sh && sh.headers) || [], rows = (sh && !sh.error && sh.rows) || [];
    const norm = h => h.replace(/\s+/g, ' ').trim();
    const placeCol = H.find(h => /placement|penempatan|lokasi|wilayah/i.test(h)) || H[0];
    const grandCol = H.find(h => /^grand\s*total/i.test(norm(h)));
    const jenis = [];
    H.forEach(h => { const m = norm(h).match(/^total\s+(.+)$/i); if (m) jenis.push({ name: m[1].trim(), totalCol: h, cols: [] }); });
    H.forEach(h => {
      if (h === placeCol || h === grandCol || jenis.some(j => j.totalCol === h)) return;
      const n = norm(h); const j = jenis.filter(j => n.toLowerCase().startsWith(j.name.toLowerCase() + ' ')).sort((a, b) => b.name.length - a.name.length)[0];
      if (!j) return;
      const sub = n.slice(j.name.length).trim();
      const cond = PIPA_COND.find(c => c.toLowerCase() === sub.toLowerCase());
      j.cols.push({ col: h, sub: cond || sub, cond: cond || null });
    });
    const places = rows.map(r => {
      const o = { name: String(r[placeCol] || '').trim() || '(kosong)', row: r, jenis: {}, total: 0, totalSheet: numv(r, grandCol), cond: { Good: 0, Average: 0, Poor: 0, Reject: 0 }, graded: 0 };
      jenis.forEach(j => {
        const parts = {}; let t = 0;
        j.cols.forEach(c => { const v = numv(r, c.col); const n = isNaN(v) ? 0 : v; parts[c.sub] = n; t += n; if (c.cond) { o.cond[c.cond] += n; o.graded += n; } });
        o.jenis[j.name] = { parts, total: t, totalSheet: numv(r, j.totalCol) };
        o.total += t;
      });
      return o;
    });
    const byJenis = {}; jenis.forEach(j => { byJenis[j.name] = { total: 0, parts: {} }; j.cols.forEach(c => byJenis[j.name].parts[c.sub] = 0); });
    const cond = { Good: 0, Average: 0, Poor: 0, Reject: 0 }; let grand = 0, graded = 0;
    places.forEach(p => { grand += p.total; graded += p.graded; PIPA_COND.forEach(c => cond[c] += p.cond[c]); jenis.forEach(j => { const x = p.jenis[j.name]; byJenis[j.name].total += x.total; Object.keys(x.parts).forEach(k => byJenis[j.name].parts[k] += x.parts[k]); }); });
    const gradedJenis = jenis.filter(j => j.cols.some(c => c.cond)).map(j => j.name), ungradedJenis = jenis.filter(j => !j.cols.some(c => c.cond)).map(j => j.name);
    // Cek silang total di sheet vs penjumlahan komponen → peringatan kualitas data
    const issues = [];
    places.forEach(p => {
      jenis.forEach(j => { const x = p.jenis[j.name]; if (!isNaN(x.totalSheet) && x.totalSheet !== x.total) issues.push({ row: (p.row._row || p.row._i + 2), col: j.totalCol, value: p.row[j.totalCol], level: 'warn', reason: `Total ${j.name} di sheet (${fmt(x.totalSheet)}) ≠ jumlah komponen (${fmt(x.total)}) pada ${p.name}`, suggest: 'Periksa rumus/isian kolom komponen; dashboard memakai jumlah komponen' }); });
      if (grandCol && !isNaN(p.totalSheet) && p.totalSheet !== p.total) issues.push({ row: (p.row._row || p.row._i + 2), col: grandCol, value: p.row[grandCol], level: 'warn', reason: `Grand Total di sheet (${fmt(p.totalSheet)}) ≠ jumlah komponen (${fmt(p.total)}) pada ${p.name}`, suggest: 'Periksa rumus Grand Total; dashboard memakai jumlah komponen' });
    });
    if (sh && !sh.error) { sh.issues = (sh.issues || []).filter(x => !x._calc); issues.forEach(x => { x._calc = true; x.id = x.row; x.sheet = sh.name; sh.issues.push(x); }); }
    pipaCache = { src: sh, placeCol, grandCol, jenis, places, byJenis, cond, grand, graded, gradedJenis, ungradedJenis, ok: !!(sh && !sh.error && rows.length && jenis.length) };
    return pipaCache;
  }
  const pipaPct = (n, d) => d ? (n / d * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + '%' : '–';

  function buildPipa() {
    const el = $('view-pipa');
    pipaModel(true); // hitung model + cek silang total SEBELUM panel peringatan diperbarui
    Object.keys(charts).forEach(id => { if (id.startsWith('pipa-')) { try { charts[id].destroy(); } catch (e) {} delete charts[id]; } });
    el.innerHTML = `
      <div class="kpis" id="pipa-kpis"></div>
      <div class="filters" id="pipa-filters"></div>
      <div class="active-filters" id="pipa-af"></div>
      <div class="charts">
        <div class="card"><h3>Pipa per Penempatan &amp; Jenis</h3><div class="chart-box"><canvas id="pipa-c1"></canvas></div></div>
        <div class="card"><h3>Komposisi Jenis Pipa</h3><div class="chart-box"><canvas id="pipa-c2"></canvas></div></div>
        <div class="card"><h3>Kondisi Pipa <span class="blank-note" id="pipa-c3-note"></span></h3><div class="chart-box"><canvas id="pipa-c3"></canvas></div></div>
        <div class="card"><h3>Kondisi per Penempatan <span class="blank-note" id="pipa-c4-note"></span></h3><div class="chart-box"><canvas id="pipa-c4"></canvas></div></div>
      </div>
      <div class="tbl-head"><h3>🔩 Matriks Inventaris Pipa <span class="blank-note">satuan: batang</span></h3><div class="tbl-tools"><span class="info" id="pipa-info"></span></div></div>
      <div class="tbl-wrap"><table class="pipa-tbl"><thead id="pipa-thead"></thead><tbody id="pipa-tbody"></tbody><tfoot id="pipa-tfoot"></tfoot></table></div>
      <div class="grid-2" style="margin-top:14px">
        <div class="card"><h3>Analisa per Jenis Pipa</h3><div id="pipa-jenis"></div></div>
        <div class="card"><h3>Analisa per Penempatan</h3><div id="pipa-place"></div></div>
      </div>`;
    el.onclick = e => { // satu handler saja (bukan addEventListener) agar tidak ganda saat view dibangun ulang setelah sinkron
      const b = e.target.closest('[data-pf]'); if (!b) return;
      if (b.dataset.pf === 'all') { pipaState.place.clear(); pipaState.jenis.clear(); return renderPipa(); }
      const set = pipaState[b.dataset.pf], v = b.dataset.v;
      if (v === '') set.clear(); else set.has(v) ? set.delete(v) : set.add(v);
      renderPipa();
    };
  }

  function pipaView() {
    const M = pipaModel();
    const places = M.places.filter(p => !pipaState.place.size || pipaState.place.has(p.name));
    const jenis = M.jenis.filter(j => !pipaState.jenis.size || pipaState.jenis.has(j.name));
    const cond = { Good: 0, Average: 0, Poor: 0, Reject: 0 }; let total = 0, graded = 0; const byJ = {}, byP = [];
    jenis.forEach(j => byJ[j.name] = { total: 0, parts: {}, cond: { Good: 0, Average: 0, Poor: 0, Reject: 0 }, graded: 0 });
    places.forEach(p => {
      const o = { name: p.name, total: 0, jenis: {}, cond: { Good: 0, Average: 0, Poor: 0, Reject: 0 }, graded: 0 };
      jenis.forEach(j => {
        const x = p.jenis[j.name]; o.jenis[j.name] = x.total; o.total += x.total; byJ[j.name].total += x.total;
        j.cols.forEach(c => { const n = x.parts[c.sub] || 0; byJ[j.name].parts[c.sub] = (byJ[j.name].parts[c.sub] || 0) + n; if (c.cond) { o.cond[c.cond] += n; o.graded += n; byJ[j.name].cond[c.cond] += n; byJ[j.name].graded += n; cond[c.cond] += n; graded += n; } });
      });
      total += o.total; byP.push(o);
    });
    return { M, places, jenis, cond, total, graded, byJ, byP };
  }

  function renderPipa() {
    const V = pipaView(), M = V.M; dirty.pipa = false;
    if (!M.ok) { $('pipa-kpis').innerHTML = '<div class="alert">⚠️ Struktur sheet "Pipa" tidak dikenali (butuh kolom Placement, "Total &lt;Jenis&gt;" dan "&lt;Jenis&gt; Good/Average/Poor/Reject").</div>'; return; }
    const bad = V.cond.Poor + V.cond.Reject;
    const kp = [
      { l: 'Total Pipa', v: fmt(V.total), i: '🔩', c: '#f97316' },
      ...V.jenis.map((j, i) => ({ l: j.name, v: fmt(V.byJ[j.name].total), i: ['🧲', '🧵', '♻️'][i] || '📦', c: PALETTE[(i + 1) % PALETTE.length] })),
      { l: 'Kondisi Baik (Good)', v: fmt(V.cond.Good), s: pipaPct(V.cond.Good, V.graded) + ' dari yang dinilai', i: '🟢', c: '#22c55e' },
      { l: 'Cukup (Average)', v: fmt(V.cond.Average), s: pipaPct(V.cond.Average, V.graded), i: '🟡', c: '#f59e0b' },
      { l: 'Buruk + Afkir (Poor/Reject)', v: fmt(bad), s: pipaPct(bad, V.graded), i: '🔴', c: '#ef4444' },
      { l: 'Penempatan', v: fmt(V.places.length), i: '📍', c: '#38bdf8' },
    ];
    $('pipa-kpis').innerHTML = kp.map(x => `<div class="kpi" style="--c:${mono(x.c)}"><div class="icon">${x.i}</div><div class="val">${x.v}</div><div class="lbl">${esc(x.l)}${x.s ? `<span class="kpi-sub">${esc(x.s)}</span>` : ''}</div></div>`).join('');
    const chipRow = (label, key, items) => `<div class="fgroup"><label>${label}</label><div class="pchips">${[['', 'Semua']].concat(items.map(x => [x, x])).map(([v, t]) => `<button type="button" class="pchip ${(v === '' ? !pipaState[key].size : pipaState[key].has(v)) ? 'on' : ''}" data-pf="${key}" data-v="${esc(v)}">${esc(t)}</button>`).join('')}</div></div>`;
    $('pipa-filters').innerHTML = chipRow('📍 Penempatan', 'place', M.places.map(p => p.name)) + chipRow('🔩 Jenis Pipa', 'jenis', M.jenis.map(j => j.name));
    $('pipa-af').innerHTML = (pipaState.place.size || pipaState.jenis.size) ? `<span class="chip chip-blue">Filter aktif: ${[...pipaState.place, ...pipaState.jenis].map(esc).join(', ')}</span> <button class="btn btn-outline btn-sm" data-pf="all" data-v="">✕ Reset</button>` : '';
    $('pipa-info').textContent = `${fmt(V.places.length)} penempatan · ${fmt(V.jenis.length)} jenis · ${fmt(V.total)} batang`;

    requestAnimationFrame(() => {
      drawStacked('pipa-c1', V.byP.map(p => p.name), V.jenis.map((j, i) => ({ label: j.name, data: V.byP.map(p => p.jenis[j.name]), backgroundColor: PALETTE[(i + 1) % PALETTE.length] })));
      drawChart('pipa-c2', 'doughnut', V.jenis.map(j => [j.name, V.byJ[j.name].total]).filter(x => x[1] > 0));
      drawChart('pipa-c3', 'doughnut', PIPA_COND.map(c => [c + ' — ' + PIPA_COND_ID[c], V.cond[c]]).filter(x => x[1] > 0), 12, Object.fromEntries(PIPA_COND.map(c => [c + ' — ' + PIPA_COND_ID[c], PIPA_COND_C[c]])));
      drawStacked('pipa-c4', V.byP.map(p => p.name), PIPA_COND.map(c => ({ label: c, data: V.byP.map(p => p.cond[c]), backgroundColor: PIPA_COND_C[c] })));
    });
    const ung = M.ungradedJenis.filter(n => V.jenis.some(j => j.name === n));
    const note = ung.length ? `${ung.join(', ')} tidak dinilai kondisi` : ''; $('pipa-c3-note').textContent = note; $('pipa-c4-note').textContent = note;

    // matriks (seperti sheet) + baris total (dihitung) + tanda bila total sheet berbeda
    const cols = []; V.jenis.forEach(j => { j.cols.forEach(c => cols.push({ j, c })); cols.push({ j, total: true }); });
    $('pipa-thead').innerHTML = `<tr><th rowspan="2">${esc(M.placeCol)}</th>${V.jenis.map(j => `<th colspan="${j.cols.length + 1}" class="grp">${esc(j.name)}</th>`).join('')}<th rowspan="2">Grand Total</th></tr><tr>${cols.map(x => x.total ? `<th class="tot">Total</th>` : `<th>${esc(x.c.sub)}</th>`).join('')}</tr>`;
    const cell = (n, cls = '') => `<td class="num ${cls}">${n ? fmt(n) : '<span class="dim">–</span>'}</td>`;
    const mism = (a, b) => !isNaN(b) && a !== b ? ` title="Di sheet tertulis ${fmt(b)}" class="num tot mismatch"` : ' class="num tot"';
    $('pipa-tbody').innerHTML = V.places.map(p => `<tr><td><b>${esc(p.name)}</b></td>${cols.map(x => x.total ? `<td${mism(p.jenis[x.j.name].total, p.jenis[x.j.name].totalSheet)}>${fmt(p.jenis[x.j.name].total)}</td>` : cell(p.jenis[x.j.name].parts[x.c.sub], x.c.cond ? 'cond-' + x.c.cond : '')).join('')}<td${mism(V.jenis.length === M.jenis.length ? p.total : NaN, p.totalSheet)}><b>${fmt(V.jenis.reduce((a, j) => a + p.jenis[j.name].total, 0))}</b></td></tr>`).join('');
    $('pipa-tfoot').innerHTML = `<tr><td><b>Total</b></td>${cols.map(x => x.total ? `<td class="num tot"><b>${fmt(V.byJ[x.j.name].total)}</b></td>` : cell(V.byJ[x.j.name].parts[x.c.sub])).join('')}<td class="num tot"><b>${fmt(V.total)}</b></td></tr>`;

    // analisa per jenis
    const bar = (parts, colors) => `<div class="pbar">${parts.filter(p => p[1] > 0).map(p => `<span style="width:${p[1] / Math.max(1, parts.reduce((a, b) => a + b[1], 0)) * 100}%;background:${colors[p[0]] || '#64748b'}" title="${esc(p[0])}: ${fmt(p[1])}"></span>`).join('')}</div>`;
    $('pipa-jenis').innerHTML = V.jenis.map(j => { const b = V.byJ[j.name], gr = j.cols.some(c => c.cond); return `<div class="prow"><div class="prow-h"><b>${esc(j.name)}</b><span>${fmt(b.total)} batang · ${pipaPct(b.total, V.total)} dari total</span></div>${bar(Object.entries(b.parts), gr ? PIPA_COND_C : Object.fromEntries(Object.keys(b.parts).map((k, i) => [k, PALETTE[(i + 5) % PALETTE.length]])))}<div class="plegend">${Object.entries(b.parts).map(([k, n]) => `<span><i style="background:${gr ? PIPA_COND_C[k] : PALETTE[(Object.keys(b.parts).indexOf(k) + 5) % PALETTE.length]}"></i>${esc(k)}${PIPA_COND_ID[k] ? ' (' + PIPA_COND_ID[k] + ')' : ''}: <b>${fmt(n)}</b> ${b.total ? '· ' + pipaPct(n, b.total) : ''}</span>`).join('')}</div>${gr ? `<div class="pnote">${b.cond.Poor + b.cond.Reject ? `⚠️ ${fmt(b.cond.Poor + b.cond.Reject)} batang (${pipaPct(b.cond.Poor + b.cond.Reject, b.graded)}) kondisi Poor/Reject — prioritas penggantian` : '✅ Tidak ada pipa Poor/Reject'}</div>` : `<div class="pnote">ℹ️ Kategori ukuran, tidak dinilai kondisi</div>`}</div>`; }).join('');
    // analisa per penempatan
    const mx = Math.max(1, ...V.byP.map(p => p.total));
    $('pipa-place').innerHTML = V.byP.slice().sort((a, b) => b.total - a.total).map(p => `<div class="prow"><div class="prow-h"><b>${esc(p.name)}</b><span>${fmt(p.total)} batang · ${pipaPct(p.total, V.total)}</span></div><div class="pbar one"><span style="width:${p.total / mx * 100}%;background:#f97316"></span></div><div class="plegend">${V.jenis.map(j => `<span>${esc(j.name)}: <b>${fmt(p.jenis[j.name])}</b></span>`).join('')}</div><div class="pnote">${p.graded ? `Baik ${pipaPct(p.cond.Good, p.graded)} · Cukup ${pipaPct(p.cond.Average, p.graded)} · Poor/Reject <b>${fmt(p.cond.Poor + p.cond.Reject)}</b> (${pipaPct(p.cond.Poor + p.cond.Reject, p.graded)})` : ''}</div></div>`).join('');
  }

  function renderPipaResume() {
    const el = $('ov-pipa'); if (!el) return;
    const M = pipaModel();
    if (!M.ok) { el.innerHTML = `<ul class="mini-list"><li class="empty">${RAW.pipa && RAW.pipa.error ? 'Sheet Pipa gagal dimuat' : 'Belum ada data pipa'}</li></ul>`; return; }
    const bad = M.cond.Poor + M.cond.Reject;
    el.innerHTML = `
      <div class="ov-pipa-top"><div><div class="big">${fmt(M.grand)}</div><div class="lbl">Total batang · ${M.places.length} penempatan</div></div>
        <div class="ov-pipa-cond">${PIPA_COND.map(c => `<span><i style="background:${PIPA_COND_C[c]}"></i>${PIPA_COND_ID[c]} <b>${fmt(M.cond[c])}</b></span>`).join('')}</div></div>
      <div class="pbar">${PIPA_COND.map(c => `<span style="width:${M.graded ? M.cond[c] / M.graded * 100 : 0}%;background:${PIPA_COND_C[c]}" title="${c}: ${fmt(M.cond[c])}"></span>`).join('')}</div>
      <div class="pnote" style="margin:4px 0 10px">${bad ? `⚠️ <b>${fmt(bad)}</b> batang (${pipaPct(bad, M.graded)} dari yang dinilai) kondisi Poor/Reject` : '✅ Tidak ada pipa Poor/Reject'}${M.ungradedJenis.length ? ` · ${M.ungradedJenis.join(', ')} tidak dinilai` : ''}</div>
      <div class="ov-pipa-grid"><div class="chart-box" style="height:220px"><canvas id="ov-pipa-chart"></canvas></div><div style="overflow:auto"><table class="mini-tbl"><thead><tr><th>${esc(M.placeCol)}</th>${M.jenis.map(j => `<th class="num">${esc(j.name)}</th>`).join('')}<th class="num">Total</th><th class="num">Poor/Rej.</th></tr></thead>
      <tbody>${M.places.map(p => `<tr><td><b>${esc(p.name)}</b></td>${M.jenis.map(j => `<td class="num">${fmt(p.jenis[j.name].total)}</td>`).join('')}<td class="num"><b>${fmt(p.total)}</b></td><td class="num ${p.cond.Poor + p.cond.Reject ? 'warn' : ''}">${fmt(p.cond.Poor + p.cond.Reject)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td><b>Total</b></td>${M.jenis.map(j => `<td class="num"><b>${fmt(M.byJenis[j.name].total)}</b></td>`).join('')}<td class="num"><b>${fmt(M.grand)}</b></td><td class="num"><b>${fmt(bad)}</b></td></tr></tfoot></table></div></div>
      <div style="text-align:right;margin-top:8px"><a href="#pipa" class="btn btn-outline btn-sm" onclick="switchTab('pipa');return false;">Buka analisa Pipa →</a></div>`;
    requestAnimationFrame(() => drawStacked('ov-pipa-chart', M.places.map(p => p.name), M.jenis.map((j, i) => ({ label: j.name, data: M.places.map(p => p.jenis[j.name].total), backgroundColor: PALETTE[(i + 1) % PALETTE.length] }))));
  }


  /* ---------- UNIT PENDUKUNG (tb_pendukung + tb_aktwilayah) ---------- */
  const pendState = { wil: new Set(), jenis: new Set(), akt: new Set(), q: '' };
  const AKT_C = { Herbi: '#a78bfa', Cor: '#f59e0b', 'Air Bersih': '#38bdf8' };
  let pendCache = null;
  function pendModel(force) {
    const P = RAW.pendukung, A = RAW.aktwil;
    if (pendCache && !force && pendCache.P === P && pendCache.A === A) return pendCache;
    const pRows = (P && !P.error && P.rows) || [], aRows = (A && !A.error && A.rows) || [];
    const ph = (P && P.headers) || [], ah = (A && A.headers) || [];
    const pWil = altKey(ph, 'Wilayah') || 'Wilayah', pJenis = altKey(ph, 'Aktivitas') || ph.find(h => /jenis|aktivitas|unit/i.test(h) && !/kode/i.test(h)) || 'Aktivitas', pKode = altKey(ph, 'Kode Unit') || ph.find(h => /kode/i.test(h)) || 'Kode Unit';
    const aWil = altKey(ah, 'Wilayah') || 'Wilayah', aAkt = altKey(ah, 'Aktivitas') || 'Aktivitas', aKode = altKey(ah, 'Kode') || 'Kode', aVol = ah.find(h => /volume|kapasitas/i.test(h)) || 'Volume';
    const wil = [...new Set([...pRows.map(r => r[pWil]), ...aRows.map(r => r[aWil])].filter(Boolean))].sort();
    const jenis = [...new Set(pRows.map(r => r[pJenis]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
    const akt = [...new Set(aRows.map(r => r[aAkt]).filter(Boolean))].sort();
    // Pemeriksaan kualitas: kode duplikat, kode placeholder 0000, prefix kode ≠ mayoritas jenis, volume jauh di bawah median aktivitas
    const issues = [];
    const byKode = new Map(); pRows.forEach(r => { const k = (r[pKode] || '').trim(); if (!k) return; byKode.set(k, (byKode.get(k) || []).concat(r)); });
    byKode.forEach((rs, k) => { if (/0{4}$/.test(k)) rs.forEach(r => issues.push({ row: (r._row || r._i + 2), col: pKode, value: k, level: 'info', reason: 'Kode unit placeholder (…0000) — unit belum diberi nomor', suggest: 'Isi kode unit sebenarnya' })); else if (rs.length > 1) rs.forEach(r => issues.push({ row: (r._row || r._i + 2), col: pKode, value: k, level: 'warn', reason: 'Kode unit duplikat (' + rs.length + '× : ' + rs.map(x => x[pWil]).join(', ') + ')', suggest: 'Pastikan satu kode untuk satu unit' })); });
    const pref = {}; pRows.forEach(r => { const m = (r[pKode] || '').match(/^[A-Z]+/); if (!m || !r[pJenis]) return; (pref[r[pJenis]] = pref[r[pJenis]] || {})[m[0]] = (pref[r[pJenis]][m[0]] || 0) + 1; });
    const major = {}; Object.keys(pref).forEach(j => { major[j] = Object.entries(pref[j]).sort((a, b) => b[1] - a[1])[0][0]; });
    // awalan kode yang menjadi mayoritas pada jenis lain → kemungkinan salah jenis / salah kode (info)
    const owner = {}; Object.keys(major).forEach(j => { const p = major[j]; if (!owner[p] || pref[j][p] > pref[owner[p]][p]) owner[p] = j; });
    pRows.forEach(r => { const m = (r[pKode] || '').match(/^[A-Z]+/); if (!m || !r[pJenis] || /0{4}$/.test(r[pKode])) return; const o = owner[m[0]]; if (o && o !== r[pJenis]) issues.push({ row: (r._row || r._i + 2), col: pKode, value: r[pKode], level: 'info', reason: 'Awalan kode "' + m[0] + '" umumnya dipakai jenis ' + o + ', tetapi unit ini tercatat sebagai ' + r[pJenis], suggest: 'Periksa apakah jenis unit atau kode yang keliru' }); });
    const medAkt = {}; akt.forEach(a => { const v = aRows.filter(r => r[aAkt] === a).map(r => numv(r, aVol)).filter(n => !isNaN(n) && n > 0).sort((x, y) => x - y); medAkt[a] = v.length ? v[Math.floor(v.length / 2)] : 0; });
    aRows.forEach(r => { const n = numv(r, aVol); if (!isNaN(n) && n > 0 && medAkt[r[aAkt]] && n < medAkt[r[aAkt]] * 0.4) issues.push({ row: (r._row || r._i + 2), col: aVol, value: r[aVol], level: 'info', reason: 'Volume jauh di bawah median aktivitas ' + r[aAkt] + ' (' + fmt(medAkt[r[aAkt]]) + ') — mungkin salah ketik', suggest: 'Periksa, mis. seharusnya ' + fmt(n * 10) + '?' }); });
    const dupA = new Map(); aRows.forEach(r => { const k = (r[aKode] || '').trim(); if (k) dupA.set(k, (dupA.get(k) || 0) + 1); }); aRows.forEach(r => { if (dupA.get((r[aKode] || '').trim()) > 1) issues.push({ row: (r._row || r._i + 2), col: aKode, value: r[aKode], level: 'warn', reason: 'Kode tangki duplikat', suggest: 'Pastikan satu kode untuk satu tangki' }); });
    if (P && !P.error) { P.issues = (P.issues || []).filter(x => !x._calc); issues.filter(x => x.col === pKode || x.col === pJenis).forEach(x => { x._calc = true; x.sheet = P.name + ' › tb_pendukung'; x.id = x.value; P.issues.push(x); }); }
    if (A && !A.error) { A.issues = (A.issues || []).filter(x => !x._calc); issues.filter(x => x.col === aVol || x.col === aKode).forEach(x => { x._calc = true; x.sheet = A.name + ' › tb_aktwilayah'; x.id = x.value; A.issues.push(x); }); }
    pendCache = { P, A, pRows, aRows, pWil, pJenis, pKode, aWil, aAkt, aKode, aVol, wil, jenis, akt, ok: !!(P && !P.error && pRows.length), okA: !!(A && !A.error && aRows.length) };
    return pendCache;
  }

  function buildPend() {
    const el = $('view-pendukung');
    pendModel(true);
    Object.keys(charts).forEach(id => { if (id.startsWith('pend-')) { try { charts[id].destroy(); } catch (e) {} delete charts[id]; } });
    el.innerHTML = `
      <div class="kpis" id="pendukung-kpis"></div>
      <div class="filters" id="pend-filters"></div>
      <div class="active-filters" id="pend-af"></div>
      <div class="charts">
        <div class="card"><h3>Unit Pendukung per Wilayah &amp; Jenis</h3><div class="chart-box"><canvas id="pend-c1"></canvas></div></div>
        <div class="card"><h3>Komposisi Jenis Unit</h3><div class="chart-box"><canvas id="pend-c2"></canvas></div></div>
        <div class="card"><h3>Tangki Aktivitas per Wilayah <span class="blank-note">tb_aktwilayah</span></h3><div class="chart-box"><canvas id="pend-c3"></canvas></div></div>
        <div class="card"><h3>Rata-rata Volume Tangki (L) per Wilayah &amp; Aktivitas</h3><div class="chart-box"><canvas id="pend-c4"></canvas></div></div>
      </div>
      <div class="grid-2">
        <div class="card"><h3>Matriks Jenis Unit × Wilayah <span class="blank-note">tb_pendukung</span></h3><div style="overflow:auto"><table class="pipa-tbl mini-tbl" id="pend-mx1"></table></div></div>
        <div class="card"><h3>Matriks Aktivitas × Wilayah <span class="blank-note">tb_aktwilayah · liter</span></h3><div style="overflow:auto"><table class="pipa-tbl mini-tbl" id="pend-mx2"></table></div></div>
      </div>
      <div class="tbl-head" style="margin-top:16px"><h3>🚜 Daftar Unit Pendukung <span class="blank-note">tb_pendukung</span></h3><div class="tbl-tools"><input type="text" id="pend-q" class="pend-q" placeholder="🔍 Cari kode / jenis / wilayah" autocomplete="off"><span class="info" id="pend-info"></span></div></div>
      <div class="tbl-wrap" style="max-height:420px"><table><thead id="pend-th"></thead><tbody id="pend-tb"></tbody></table></div>
      <div class="tbl-head" style="margin-top:16px"><h3>🛢️ Daftar Tangki Aktivitas <span class="blank-note">tb_aktwilayah</span></h3><div class="tbl-tools"><span class="info" id="pend-infoA"></span></div></div>
      <div class="tbl-wrap" style="max-height:420px"><table><thead id="pend-thA"></thead><tbody id="pend-tbA"></tbody></table></div>`;
    el.onclick = e => {
      const b = e.target.closest('[data-pf]'); if (!b) return;
      if (b.dataset.pf === 'all') { pendState.wil.clear(); pendState.jenis.clear(); pendState.akt.clear(); return renderPend(); }
      const set = pendState[b.dataset.pf], v = b.dataset.v;
      if (v === '') set.clear(); else set.has(v) ? set.delete(v) : set.add(v);
      renderPend();
    };
    $('pend-q').oninput = debounce(() => { pendState.q = $('pend-q').value.toLowerCase().trim(); renderPendList(); }, 200);
  }

  function pendView() {
    const M = pendModel();
    const p = M.pRows.filter(r => (!pendState.wil.size || pendState.wil.has(r[M.pWil])) && (!pendState.jenis.size || pendState.jenis.has(r[M.pJenis])));
    const a = M.aRows.filter(r => (!pendState.wil.size || pendState.wil.has(r[M.aWil])) && (!pendState.akt.size || pendState.akt.has(r[M.aAkt])));
    const wil = M.wil.filter(w => !pendState.wil.size || pendState.wil.has(w));
    const jenis = M.jenis.filter(j => !pendState.jenis.size || pendState.jenis.has(j));
    const akt = M.akt.filter(x => !pendState.akt.size || pendState.akt.has(x));
    return { M, p, a, wil, jenis, akt };
  }
  const avg = (rows, k) => { const v = rows.map(r => numv(r, k)).filter(n => !isNaN(n)); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0; };

  function renderPend() {
    const V = pendView(), M = V.M; dirty.pendukung = false;
    if (!M.ok) { $('pendukung-kpis').innerHTML = `<div class="alert">⚠️ Tabel tb_pendukung (kolom Wilayah / Aktivitas / Kode Unit) tidak ditemukan di sheet "Unit Pendukung".</div>`; return; }
    const volTot = sum(V.a, M.aVol), volAvg = avg(V.a, M.aVol);
    const kp = [
      { l: 'Total Unit Pendukung', v: fmt(V.p.length), i: '🚜', c: '#84cc16' },
      { l: 'Wilayah', v: fmt(V.wil.length), i: '📍', c: '#38bdf8' },
      { l: 'Jenis Unit', v: fmt(new Set(V.p.map(r => r[M.pJenis])).size), i: '🧩', c: '#a78bfa' },
      { l: 'Jenis Terbanyak', v: esc((count(V.p, M.pJenis).filter(x => x[0] !== '(kosong)')[0] || ['–'])[0]), s: (count(V.p, M.pJenis)[0] || [0, 0])[1] + ' unit', i: '🏆', c: '#f59e0b', small: true },
      { l: 'Tangki Aktivitas', v: fmt(V.a.length), s: M.okA ? V.akt.join(' · ') : 'tb_aktwilayah tidak terbaca', i: '🛢️', c: '#14b8a6' },
      { l: 'Kapasitas Total (L)', v: fmt(volTot), i: '💧', c: '#06b6d4' },
      { l: 'Rata-rata Volume (L)', v: fmt(volAvg), i: '📐', c: '#6366f1' },
      { l: 'Kode Belum Final (…0000)', v: fmt(V.p.filter(r => /0{4}$/.test(r[M.pKode] || '')).length), i: '🏷️', c: '#ef4444' },
    ];
    $('pendukung-kpis').innerHTML = kp.map(x => `<div class="kpi" style="--c:${mono(x.c)}"><div class="icon">${x.i}</div><div class="val${x.small ? ' small' : ''}">${x.v}</div><div class="lbl">${esc(x.l)}${x.s ? `<span class="kpi-sub">${esc(x.s)}</span>` : ''}</div></div>`).join('');
    const chipRow = (label, key, items) => `<div class="fgroup"><label>${label}</label><div class="pchips">${[['', 'Semua']].concat(items.map(x => [x, x])).map(([v, t]) => `<button type="button" class="pchip ${(v === '' ? !pendState[key].size : pendState[key].has(v)) ? 'on' : ''}" data-pf="${key}" data-v="${esc(v)}">${esc(t)}</button>`).join('')}</div></div>`;
    $('pend-filters').innerHTML = chipRow('📍 Wilayah', 'wil', M.wil) + chipRow('🧩 Jenis Unit', 'jenis', M.jenis) + (M.okA ? chipRow('🛢️ Aktivitas Tangki', 'akt', M.akt) : '');
    const act = [...pendState.wil, ...pendState.jenis, ...pendState.akt];
    $('pend-af').innerHTML = act.length ? `<span class="chip chip-blue">Filter aktif: ${act.map(esc).join(', ')}</span> <button class="btn btn-outline btn-sm" data-pf="all" data-v="">✕ Reset</button>` : '';

    const byWJ = w => j => V.p.filter(r => r[M.pWil] === w && r[M.pJenis] === j).length;
    requestAnimationFrame(() => {
      drawStacked('pend-c1', V.wil, V.jenis.map((j, i) => ({ label: j, data: V.wil.map(w => byWJ(w)(j)), backgroundColor: PALETTE[i % PALETTE.length] })), 'unit');
      drawChart('pend-c2', 'doughnut', count(V.p, M.pJenis).filter(x => x[0] !== '(kosong)'), 14);
      if (M.okA) {
        drawStacked('pend-c3', V.wil, V.akt.map((a, i) => ({ label: a, data: V.wil.map(w => V.a.filter(r => r[M.aWil] === w && r[M.aAkt] === a).length), backgroundColor: AKT_C[a] || PALETTE[(i + 3) % PALETTE.length] })), 'tangki');
        drawGrouped('pend-c4', V.wil, V.akt.map((a, i) => ({ label: a, data: V.wil.map(w => Math.round(avg(V.a.filter(r => r[M.aWil] === w && r[M.aAkt] === a), M.aVol))), backgroundColor: AKT_C[a] || PALETTE[(i + 3) % PALETTE.length] })), 'L');
      } else { noChart('pend-c3', 'tb_aktwilayah'); noChart('pend-c4', 'tb_aktwilayah'); }
    });

    // matriks jenis × wilayah
    const cellN = n => `<td class="num">${n ? fmt(n) : '<span class="dim">–</span>'}</td>`;
    $('pend-mx1').innerHTML = `<thead><tr><th>Jenis Unit</th>${V.wil.map(w => `<th class="num">${esc(w)}</th>`).join('')}<th class="num tot">Total</th></tr></thead><tbody>${V.jenis.map(j => `<tr><td><b>${esc(j)}</b></td>${V.wil.map(w => cellN(byWJ(w)(j))).join('')}<td class="num tot">${fmt(V.p.filter(r => r[M.pJenis] === j).length)}</td></tr>`).join('')}</tbody><tfoot><tr><td><b>Total</b></td>${V.wil.map(w => `<td class="num"><b>${fmt(V.p.filter(r => r[M.pWil] === w).length)}</b></td>`).join('')}<td class="num tot"><b>${fmt(V.p.length)}</b></td></tr></tfoot>`;
    // matriks aktivitas × wilayah (jumlah · rata-rata volume)
    if (M.okA) {
      const cellA = rows => rows.length ? `<td class="num"><b>${fmt(rows.length)}</b> <span class="dim2">· ${fmt(avg(rows, M.aVol))} L</span></td>` : '<td class="num"><span class="dim">–</span></td>';
      $('pend-mx2').innerHTML = `<thead><tr><th>Aktivitas</th>${V.wil.map(w => `<th class="num">${esc(w)}</th>`).join('')}<th class="num tot">Total</th></tr></thead><tbody>${V.akt.map(a => `<tr><td><b>${esc(a)}</b></td>${V.wil.map(w => cellA(V.a.filter(r => r[M.aWil] === w && r[M.aAkt] === a))).join('')}${cellA(V.a.filter(r => r[M.aAkt] === a)).replace('class="num"', 'class="num tot"')}</tr>`).join('')}</tbody><tfoot><tr><td><b>Total</b></td>${V.wil.map(w => cellA(V.a.filter(r => r[M.aWil] === w))).join('')}${cellA(V.a).replace('class="num"', 'class="num tot"')}</tr></tfoot><caption style="caption-side:bottom;text-align:left;font-size:11px;color:var(--muted);padding-top:6px">Format sel: jumlah tangki · rata-rata volume (liter)</caption>`;
    } else $('pend-mx2').innerHTML = '<tbody><tr><td class="empty">tb_aktwilayah tidak terbaca</td></tr></tbody>';
    renderPendList();
  }

  function renderPendList() {
    const V = pendView(), M = V.M, q = pendState.q;
    const ph = M.P.headers, rows = q ? V.p.filter(r => ph.some(h => String(r[h] || '').toLowerCase().includes(q))) : V.p;
    $('pend-th').innerHTML = '<tr><th>#</th>' + ph.map(h => `<th>${esc(h)}</th>`).join('') + '</tr>';
    $('pend-tb').innerHTML = rows.map((r, i) => `<tr>${[i + 1, ...ph.map(h => r[h])].map((v, j) => `<td class="${j === ph.length && /0{4}$/.test(v || '') ? 'cell-warn' : ''}">${esc(v ?? '')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${ph.length + 1}" class="empty">Tidak ada data</td></tr>`;
    $('pend-info').textContent = `${fmt(rows.length)} dari ${fmt(M.pRows.length)} unit`;
    if (M.okA) {
      const ah = M.A.headers, ar = q ? V.a.filter(r => ah.some(h => String(r[h] || '').toLowerCase().includes(q))) : V.a;
      $('pend-thA').innerHTML = '<tr>' + ah.map(h => `<th>${esc(h)}</th>`).join('') + '</tr>';
      $('pend-tbA').innerHTML = ar.map(r => `<tr>${ah.map(h => { const n = h === M.aVol ? numv(r, M.aVol) : NaN; const fl = r._flag && r._flag[h]; return `<td class="${h === M.aVol ? 'num' : ''}${fl ? ' bad' : ''}" ${fl ? `title="${esc(fl.reason)}"` : ''}>${h === M.aVol && !isNaN(n) ? fmt(n) : esc(r[h] ?? '')}</td>`; }).join('')}</tr>`).join('') || `<tr><td colspan="${ah.length}" class="empty">Tidak ada data</td></tr>`;
      $('pend-infoA').textContent = `${fmt(ar.length)} dari ${fmt(M.aRows.length)} tangki · total ${fmt(sum(ar, M.aVol))} L`;
    }
  }

  function renderPendResume() {
    const el = $('ov-pend'); if (!el) return;
    const M = pendModel();
    if (!M.ok) { el.innerHTML = `<ul class="mini-list"><li class="empty">${RAW.pendukung && RAW.pendukung.error ? 'Sheet Unit Pendukung gagal dimuat' : 'Belum ada data unit pendukung'}</li></ul>`; return; }
    const top = count(M.pRows, M.pJenis).filter(x => x[0] !== '(kosong)').slice(0, 5);
    el.innerHTML = `
      <div class="ov-pipa-top"><div><div class="big" style="color:#84cc16">${fmt(M.pRows.length)}</div><div class="lbl">Unit pendukung · ${M.wil.length} wilayah · ${M.jenis.length} jenis</div></div>
        <div><div class="big" style="color:#14b8a6;font-size:24px">${fmt(M.aRows.length)} <span style="font-size:12px;font-weight:600;color:var(--muted)">tangki</span></div><div class="lbl">Rata-rata ${fmt(avg(M.aRows, M.aVol))} L · total ${fmt(sum(M.aRows, M.aVol))} L</div></div></div>
      <div class="ov-pipa-grid"><div class="chart-box" style="height:220px"><canvas id="ov-pend-chart"></canvas></div><div style="overflow:auto">
      <table class="mini-tbl"><thead><tr><th>Wilayah</th><th class="num">Unit</th>${top.map(t => `<th class="num" title="${esc(t[0])}">${esc(t[0].replace(/^Tangki /, 'T. ').replace(/^Trailer /, 'Tr. ').replace(/^Bak Trailer /, 'Bak Tr. '))}</th>`).join('')}<th class="num">Tangki</th><th class="num">Ø Vol (L)</th></tr></thead>
      <tbody>${M.wil.map(w => { const pr = M.pRows.filter(r => r[M.pWil] === w), ar = M.aRows.filter(r => r[M.aWil] === w); return `<tr><td><b>${esc(w)}</b></td><td class="num"><b>${fmt(pr.length)}</b></td>${top.map(t => `<td class="num">${fmt(pr.filter(r => r[M.pJenis] === t[0]).length) || '<span class="dim">–</span>'}</td>`).join('')}<td class="num">${fmt(ar.length)}</td><td class="num">${ar.length ? fmt(avg(ar, M.aVol)) : '–'}</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td><b>Total</b></td><td class="num"><b>${fmt(M.pRows.length)}</b></td>${top.map(t => `<td class="num"><b>${fmt(t[1])}</b></td>`).join('')}<td class="num"><b>${fmt(M.aRows.length)}</b></td><td class="num"><b>${fmt(avg(M.aRows, M.aVol))}</b></td></tr></tfoot></table></div></div>
      <div style="text-align:right;margin-top:8px"><a href="#pendukung" class="btn btn-outline btn-sm" onclick="switchTab('pendukung');return false;">Buka analisa Unit Pendukung →</a></div>`;
    requestAnimationFrame(() => drawStacked('ov-pend-chart', M.wil, M.jenis.map((j, i) => ({ label: j, data: M.wil.map(w => M.pRows.filter(r => r[M.pWil] === w && r[M.pJenis] === j).length), backgroundColor: PALETTE[i % PALETTE.length] })), 'unit'));
  }

  // Chart batang berkelompok (grouped) dengan label nilai
  function drawGrouped(id, labels, datasets, unit) {
    const ctx = $(id); if (!ctx || typeof Chart === 'undefined') return;
    const tc = themeColors(); datasets = datasets.map(d => ({ ...d, borderRadius: 5, borderSkipped: false, maxBarThickness: 40 }));
    let ex = charts[id];
    if (ex && (ex.canvas !== ctx || !ctx.isConnected || ex._t !== 'grouped')) { try { ex.destroy(); } catch (e) {} delete charts[id]; ex = null; }
    if (ex) { ex.data.labels = labels; ex.data.datasets = datasets; ex.options.plugins.legend.labels.color = tc.text; ex.options.scales.x.ticks.color = ex.options.scales.y.ticks.color = tc.text; ex.options.scales.y.grid.color = tc.grid; ex.update(); return; }
    const groupValues = { id: 'groupValues', afterDatasetsDraw(c) { const g = c.ctx; g.save(); g.font = '700 10px Inter, system-ui, sans-serif'; g.fillStyle = themeColors().text; g.textAlign = 'center'; g.textBaseline = 'bottom'; c.data.datasets.forEach((d, di) => { if (!c.isDatasetVisible(di)) return; c.getDatasetMeta(di).data.forEach((bar, i) => { const v = d.data[i]; if (v) g.fillText(fmt(v), bar.x, bar.y - 3); }); }); g.restore(); } };
    const chart = new Chart(ctx, {
      type: 'bar', data: { labels, datasets }, plugins: [groupValues],
      options: {
        responsive: true, maintainAspectRatio: false, locale: 'id-ID', animation: { duration: 550, easing: 'easeOutQuart' }, layout: { padding: { top: 16 } },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { color: tc.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 11, weight: '600' } } },
          tooltip: { backgroundColor: 'rgba(15,23,42,.92)', padding: 10, cornerRadius: 10, titleFont: { weight: '700' }, callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)} ${unit || ''}` } }
        },
        scales: {
          x: { ticks: { color: tc.text, font: { size: 11 } }, grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, grace: '10%', ticks: { color: tc.text, precision: 0, font: { size: 11 } }, grid: { color: tc.grid }, border: { display: false } }
        }
      }
    });
    chart._t = 'grouped'; charts[id] = chart;
  }

  // Chart batang bertumpuk (stacked) dengan total di atas tiap batang
  const stackTotals = {
    id: 'stackTotals',
    afterDatasetsDraw(chart) {
      const g = chart.ctx, tot = chart.data.labels.map((_, i) => chart.data.datasets.reduce((a, d, di) => a + (chart.isDatasetVisible(di) ? (+d.data[i] || 0) : 0), 0));
      g.save(); g.font = '700 11px Inter, system-ui, sans-serif'; g.fillStyle = themeColors().text; g.textAlign = 'center'; g.textBaseline = 'bottom';
      const last = [...chart.data.datasets.keys()].reverse().find(di => chart.isDatasetVisible(di));
      if (last === undefined) { g.restore(); return; }
      chart.getDatasetMeta(last).data.forEach((bar, i) => { if (!tot[i]) return; let y = bar.y; chart.data.datasets.forEach((d, di) => { if (chart.isDatasetVisible(di)) y = Math.min(y, chart.getDatasetMeta(di).data[i].y); }); g.fillText(fmt(tot[i]), bar.x, y - 4); });
      g.restore();
    }
  };
  function drawStacked(id, labels, datasets, unit = 'batang') {
    const ctx = $(id); if (!ctx || typeof Chart === 'undefined') return;
    const tc = themeColors(); datasets = datasets.map(d => ({ ...d, borderRadius: 4, borderSkipped: false, maxBarThickness: 54 }));
    let ex = charts[id];
    if (ex && (ex.canvas !== ctx || !ctx.isConnected || ex._t !== 'stacked')) { try { ex.destroy(); } catch (e) {} delete charts[id]; ex = null; }
    if (ex) { ex.data.labels = labels; ex.data.datasets = datasets; ex.options.plugins.legend.labels.color = tc.text; ex.options.scales.x.ticks.color = ex.options.scales.y.ticks.color = tc.text; ex.options.scales.y.grid.color = tc.grid; ex.update(); return; }
    const chart = new Chart(ctx, {
      type: 'bar', data: { labels, datasets }, plugins: [stackTotals],
      options: {
        responsive: true, maintainAspectRatio: false, locale: 'id-ID', animation: { duration: 550, easing: 'easeOutQuart' }, layout: { padding: { top: 18 } },
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { color: tc.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'circle', padding: 10, font: { size: 11, weight: '600' } } },
          tooltip: { backgroundColor: 'rgba(15,23,42,.92)', padding: 10, cornerRadius: 10, titleFont: { weight: '700' }, callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)} ${unit}`, footer: it => 'Total: ' + fmt(it.reduce((a, c) => a + c.parsed.y, 0)) + ' ' + unit } }
        },
        scales: {
          x: { stacked: true, ticks: { color: tc.text, font: { size: 11 } }, grid: { display: false }, border: { display: false } },
          y: { stacked: true, beginAtZero: true, grace: '8%', ticks: { color: tc.text, precision: 0, font: { size: 11 } }, grid: { color: tc.grid }, border: { display: false } }
        }
      }
    });
    chart._t = 'stacked'; charts[id] = chart;
  }


  /* ---------- Pemeriksaan relasi antar sheet (titik irigasi ↔ engine ↔ irrigator ↔ sumber air) ---------- */
  function relationalChecks() {
    const D = RAW.detail, M = RAW.mesin, I = RAW.irrigator, S = RAW.sumber;
    const clear = sh => { if (sh && !sh.error) { sh.issues = (sh.issues || []).filter(x => !x._rel); sh.rows.forEach(r => { if (r._flag) { Object.keys(r._flag).forEach(k => { if (r._flag[k]._rel) delete r._flag[k]; }); if (!Object.keys(r._flag).length) r._flag = null; } }); } };
    [D, M, I, S].forEach(clear);
    if (!D || D.error || !D.rows.length) return;
    const h = D.headers, K = n => altKey(h, n) || n;
    const cLok = K('Lokasi'), cEng = K('Kode Engine'), cIrr = K('Kode Irigator'), cSrc = K('Sumber Air'), cAir = K('Kode Air'), cWil = K('Wil');
    const add = (sh, r, col, chk) => { const x = { row: (r._row || r._i + 2), col, value: r[col] || '(kosong)', id: r[cLok] || r[col] || '', sheet: sh.name, _rel: true, _calc: true, ...chk }; sh.issues.push(x); (r._flag || (r._flag = {}))[col] = { ...chk, _rel: true }; };
    const idLabel = r => (r[cLok] ? 'titik ' + r[cLok] : 'baris ' + ((r._row || r._i + 2))) + (r[cWil] ? ' (' + r[cWil] + ')' : '');
    const v = (r, c) => String(r[c] || '').trim();
    // kunci referensi dari sheet lain
    const mKey = M && !M.error ? (altKey(M.headers, 'Kode Unit') || 'Kode Unit') : null, mStat = M && !M.error ? (altKey(M.headers, 'Status') || 'Status') : null;
    const iKey = I && !I.error ? (altKey(I.headers, 'KODE UNIT') || altKey(I.headers, 'Kode Unit') || 'KODE UNIT') : null, iStat = I && !I.error ? (altKey(I.headers, 'Status') || 'Status') : null;
    const sKeys = S && !S.error ? S.headers.filter(x => /kode/i.test(x)) : [];
    const mSet = new Map(), iSet = new Map(), sSet = new Set();
    if (mKey) M.rows.forEach(r => { const k = v(r, mKey); if (k) mSet.set(k, r); });
    if (iKey) I.rows.forEach(r => { const k = v(r, iKey); if (k) iSet.set(k, r); });
    if (sKeys.length) S.rows.forEach(r => sKeys.forEach(c => { const k = v(r, c); if (k) sSet.add(k); }));
    // hitung pemakaian ganda
    const useEng = new Map(), useIrr = new Map(), useLok = new Map();
    D.rows.forEach(r => { const e = v(r, cEng), i = v(r, cIrr), l = v(r, cLok); if (e) useEng.set(e, (useEng.get(e) || []).concat(r)); if (i) useIrr.set(i, (useIrr.get(i) || []).concat(r)); if (l) useLok.set(l, (useLok.get(l) || []).concat(r)); });
    D.rows.forEach(r => {
      const e = v(r, cEng), i = v(r, cIrr), a = v(r, cAir), src = v(r, cSrc);
      // kelengkapan titik irigasi
      if (!e) add(D, r, cEng, { level: 'warn', reason: 'Titik irigasi tanpa engine — ' + idLabel(r), suggest: 'Isi Kode Engine yang terpasang di titik ini' });
      const drip = (APP_CONFIG.dripCommodities || []).some(c => { const re = new RegExp('\\b' + c + '\\b', 'i'); return re.test(v(r, cWil)) || re.test(v(r, K('Komoditi'))); });
      if (!i && !drip) add(D, r, cIrr, { level: 'warn', reason: 'Titik irigasi tanpa irrigator — ' + idLabel(r), suggest: 'Isi Kode Irigator (komoditi selain ' + (APP_CONFIG.dripCommodities || []).join('/') + ' memakai irrigator)' });
      if (i && drip) add(D, r, cIrr, { level: 'info', reason: 'Komoditi drip (' + v(r, cWil) + ') tercatat memakai irrigator ' + i + ' — ' + idLabel(r), suggest: 'Pastikan benar; komoditi ini biasanya memakai irigasi tetes tanpa irrigator' });
      if (!a && !src) add(D, r, cAir, { level: 'warn', reason: 'Titik irigasi tanpa sumber air — ' + idLabel(r), suggest: 'Isi Sumber Air dan Kode Air (kode lebung/deep well)' });
      else if (!a) add(D, r, cAir, { level: 'warn', reason: 'Kode Air kosong padahal Sumber Air terisi (' + src + ') — ' + idLabel(r), suggest: 'Isi Kode Air sesuai sheet Sumber Air' });
      else if (!src) add(D, r, cSrc, { level: 'warn', reason: 'Jenis Sumber Air kosong padahal Kode Air terisi (' + a + ') — ' + idLabel(r), suggest: 'Isi jenis sumber air' });
      // pemakaian ganda
      // engine/irrigator dipakai >1 baris: bedakan "baris duplikat" (lokasi sama) dari "dipakai di titik berbeda"
      const dupMsg = (what, code, list) => {
        const loks = list.map(x => x[cLok] || ('baris ' + ((x._row || x._i + 2)))), brs = list.map(x => 'baris ' + ((x._row || x._i + 2))).join(' & ');
        return new Set(loks).size === 1
          ? { reason: 'Baris duplikat: titik ' + loks[0] + ' dengan ' + what + ' ' + code + ' tercatat ' + list.length + ' kali (' + brs + ')', suggest: 'Hapus salah satu baris ganda di sheet Detail Terpasang' }
          : { reason: what.charAt(0).toUpperCase() + what.slice(1) + ' ' + code + ' dipakai di ' + list.length + ' titik irigasi: ' + loks.join(', ') + ' (' + brs + ')', suggest: 'Satu ' + what + ' hanya boleh terpasang di satu titik — periksa kode yang salah ketik atau baris lama yang belum dihapus' };
      };
      if (e && useEng.get(e).length > 1) add(D, r, cEng, { level: 'error', ...dupMsg('engine', e, useEng.get(e)) });
      if (i && useIrr.get(i).length > 1) add(D, r, cIrr, { level: 'error', ...dupMsg('irrigator', i, useIrr.get(i)) });
      // referensi silang ke sheet master
      if (e && mKey && !mSet.has(e)) add(D, r, cEng, { level: 'warn', reason: 'Kode Engine ' + e + ' tidak ditemukan di sheet Mesin — ' + idLabel(r), suggest: 'Periksa ejaan kode atau tambahkan unit ke sheet Mesin' });
      else if (e && mKey && mStat && v(mSet.get(e), mStat) && !/terpasang/i.test(v(mSet.get(e), mStat))) add(D, r, cEng, { level: 'warn', reason: 'Engine ' + e + ' terpasang di ' + idLabel(r) + ' tetapi di sheet Mesin berstatus "' + v(mSet.get(e), mStat) + '"', suggest: 'Samakan status di sheet Mesin atau perbarui titik irigasi' });
      if (i && iKey && !iSet.has(i)) add(D, r, cIrr, { level: 'warn', reason: 'Kode Irigator ' + i + ' tidak ditemukan di sheet Irrigator — ' + idLabel(r), suggest: 'Periksa ejaan kode atau tambahkan unit ke sheet Irrigator' });
      else if (i && iKey && iStat && v(iSet.get(i), iStat) && !/terpasang/i.test(v(iSet.get(i), iStat))) add(D, r, cIrr, { level: 'warn', reason: 'Irrigator ' + i + ' terpasang di ' + idLabel(r) + ' tetapi di sheet Irrigator berstatus "' + v(iSet.get(i), iStat) + '"', suggest: 'Samakan status di sheet Irrigator atau perbarui titik irigasi' });
      if (a && sKeys.length && !sSet.has(a)) add(D, r, cAir, { level: 'warn', reason: 'Kode Air ' + a + ' tidak ditemukan di sheet Sumber Air — ' + idLabel(r), suggest: 'Periksa kode (Kode Baru/Kode Lama) di sheet Sumber Air' });
    });
    // lokasi tercatat lebih dari sekali (bisa sah: 2 engine di 1 lokasi) → info
    useLok.forEach((rs, l) => { if (rs.length > 1) rs.forEach(r => add(D, r, cLok, { level: 'info', reason: 'Lokasi ' + l + ' tercatat ' + rs.length + ' kali (engine: ' + rs.map(x => x[cEng] || '-').join(', ') + ')', suggest: 'Pastikan memang ada ' + rs.length + ' unit di lokasi ini, bukan baris ganda' })); });
    // unit berstatus Terpasang di sheet master tetapi tidak tercatat di titik manapun
    if (mKey && mStat) M.rows.forEach(r => { const k = v(r, mKey); if (k && /terpasang/i.test(v(r, mStat)) && !useEng.has(k)) { M.issues.push({ row: (r._row || r._i + 2), col: mStat, value: r[mStat], id: k, sheet: M.name, level: 'warn', _rel: true, _calc: true, reason: 'Mesin ' + k + ' berstatus Terpasang tetapi tidak tercatat di titik irigasi manapun (Detail Terpasang)', suggest: 'Tambahkan ke Detail Terpasang atau ubah status menjadi Standby' }); (r._flag || (r._flag = {}))[mStat] = { level: 'warn', reason: 'Tidak tercatat di Detail Terpasang', _rel: true }; } });
    if (iKey && iStat) I.rows.forEach(r => { const k = v(r, iKey); if (k && /terpasang/i.test(v(r, iStat)) && !useIrr.has(k)) { I.issues.push({ row: (r._row || r._i + 2), col: iStat, value: r[iStat], id: k, sheet: I.name, level: 'warn', _rel: true, _calc: true, reason: 'Irrigator ' + k + ' berstatus Terpasang tetapi tidak tercatat di titik irigasi manapun (Detail Terpasang)', suggest: 'Tambahkan ke Detail Terpasang atau ubah status menjadi Standby' }); (r._flag || (r._flag = {}))[iStat] = { level: 'warn', reason: 'Tidak tercatat di Detail Terpasang', _rel: true }; } });
  }

  /* ---------- Peringatan kualitas data ---------- */
  let ISSUES = [], lastIssueSig = '';
  function updateIssues() {
    ISSUES = [];
    if (RAW.aktwil && !RAW.aktwil.error) (RAW.aktwil.issues || []).forEach(x => ISSUES.push({ ...x, key: 'pendukung' }));
    Object.keys(CONFIG).forEach(k => {
      (RAW[k].issues || []).forEach(x => ISSUES.push({ ...x, key: k }));
      // header kolom yang dipakai filter/chart/KPI tidak ditemukan → peringatan terlihat (bukan hanya console)
      if (RAW[k].headers && RAW[k].headers.length) {
        const need = new Set([...(CONFIG[k].filters || []), ...(CONFIG[k].charts || []).filter(c => c.key).map(c => c.key)]);
        need.forEach(f => { if (!altKey(RAW[k].headers, f)) ISSUES.push({ key: k, sheet: RAW[k].name, row: 1, col: f, value: '(header tidak ada)', level: 'warn', reason: 'Kolom "' + f + '" tidak ditemukan di baris header sheet — filter/chart terkait kosong', suggest: 'Kembalikan nama header menjadi "' + f + '" atau tambahkan sinonimnya di config.js' }); });
      }
    });
    const order = { error: 0, warn: 1, info: 2 };
    ISSUES.sort((a, b) => order[a.level] - order[b.level] || a.sheet.localeCompare(b.sheet) || a.row - b.row);
    const important = ISSUES.filter(x => x.level !== 'info');
    const btn = $('issuesBtn');
    btn.style.display = ISSUES.length ? '' : 'none';
    $('issuesCount').textContent = important.length || ISSUES.length;
    btn.classList.toggle('btn-warn', important.length > 0); btn.classList.toggle('btn-glass', important.length === 0);
    btn.innerHTML = important.length ? `⚠️ <span id="issuesCount">${important.length}</span> <span class="t">peringatan data</span>` : `ℹ️ <span id="issuesCount">${ISSUES.length}</span> <span class="t">info data</span>`;
    const sel = $('iss-sheet'); const cur = sel.value;
    sel.innerHTML = '<option value="">Semua sheet</option>' + [...new Set(ISSUES.map(x => x.sheet))].map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join(''); sel.value = cur;
    // notifikasi bila ada temuan baru dibanding sync sebelumnya
    const sig = important.map(x => x.sheet + x.row + x.col + x.value).join('|');
    if (important.length && sig !== lastIssueSig) {
      const nErr = important.filter(x => x.level === 'error').length;
      const nRel = important.filter(x => x._rel).length;
      setTimeout(() => toast(`⚠️ ${important.length} temuan data${nErr ? ` (${nErr} error)` : ''}${nRel ? ` · ${nRel} relasi titik irigasi/engine/irrigator/sumber air` : ''} — klik tombol "peringatan data" untuk detail`, true), 1200);
    }
    lastIssueSig = sig;
    if ($('issuesModal').classList.contains('show')) renderIssues();
  }
  function renderIssues() {
    const lv = { error: $('iss-err').checked, warn: $('iss-warn').checked, info: $('iss-info').checked }, sh = $('iss-sheet').value;
    const list = ISSUES.filter(x => lv[x.level] && (!sh || x.sheet === sh));
    const chip = l => l === 'error' ? '<span class="chip chip-red">Error</span>' : l === 'warn' ? '<span class="chip chip-amber">Peringatan</span>' : '<span class="chip chip-gray">Info</span>';
    $('issuesBody').innerHTML = list.length ? list.slice(0, 500).map(x => `<tr class="clickable" data-key="${x.key}" data-row="${x.row}"><td>${chip(x.level)}</td><td>${esc(x.sheet)}</td><td><b>${x.row}</b></td><td>${esc(x.id)}</td><td>${esc(x.col)}</td><td class="v">${esc(x.value)}</td><td>${esc(x.reason)}</td><td class="s">${esc(x.suggest)}</td></tr>`).join('') + (list.length > 500 ? `<tr><td colspan="8" class="empty">… ${list.length - 500} lainnya (export CSV untuk lengkap)</td></tr>` : '')
      : '<tr><td colspan="8" class="empty">✅ Tidak ada temuan untuk filter ini</td></tr>';
  }
  window.openIssues = () => { if (!ISSUES.some(x => x.level !== 'info')) $('iss-info').checked = true; $('issuesModal').classList.add('show'); renderIssues(); const n = ISSUES.filter(x => x.fix && x.fix.kind).length, b = $('iss-repair'); if (b) { b.textContent = '🛠 Perbaikan format' + (n ? ' (' + n + ')' : ''); b.disabled = false; b.classList.toggle('btn-primary', !!n); b.classList.toggle('btn-outline', !n); b.title = n ? n + ' sel salah format tanggal/angka/rumus bisa diperbaiki otomatis' : 'Saat ini tidak ada sel salah format — klik untuk melihat penjelasan'; } };
  window.repairIssues = () => { if (window.FSEdit && FSEdit.repairAll) FSEdit.repairAll(ISSUES); };
  window.closeIssues = () => $('issuesModal').classList.remove('show');
  window.exportIssues = () => {
    const h = ['Level', 'Sheet', 'Baris', 'Kode', 'Kolom', 'Nilai Terinput', 'Masalah', 'Saran'];
    const csv = [h.join(','), ...ISSUES.map(x => [x.level, x.sheet, x.row, x.id, x.col, x.value, x.reason, x.suggest].map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })); a.download = `peringatan_data_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  $('issuesBtn').addEventListener('click', openIssues);
  $('issuesModal').addEventListener('click', e => { if (e.target.id === 'issuesModal') closeIssues(); });
  ['iss-err', 'iss-warn', 'iss-info', 'iss-sheet'].forEach(id => $(id).addEventListener('change', renderIssues));
  // klik baris temuan → buka tab terkait, cari kode-nya, tampilkan detail
  $('issuesBody').addEventListener('click', e => {
    const tr = e.target.closest('tr[data-key]'); if (!tr) return;
    const k = tr.dataset.key, i = +tr.dataset.row - 2, id = tr.cells[3] ? tr.cells[3].textContent.trim() : ''; closeIssues(); switchTab(k);
    if (k === 'pendukung') { // view kustom: cari lewat kotak pencarian, lalu sorot baris
      pendState.wil.clear(); pendState.jenis.clear(); pendState.akt.clear(); pendState.q = id.toLowerCase();
      if ($("pend-q")) $("pend-q").value = id; renderPend();
      const row = [...document.querySelectorAll('#pend-tb tr, #pend-tbA tr')].find(x => [...x.cells].some(c => c.textContent.trim() === id));
      if (row) { row.classList.add('row-hl'); row.scrollIntoView({ block: 'center', behavior: 'smooth' }); setTimeout(() => row.classList.remove('row-hl'), 3000); }
      return;
    }
    if (k === 'pipa' || !RAW[k] || RAW[k].error || !state[k]) return; // view tanpa tabel baris/sheet gagal: cukup pindah tab
    const r = RAW[k].rows.find(x => (x._row || x._i + 2) === i + 2) || RAW[k].rows[i]; if (!r) return;
    const idc = RAW[k].meta.idCol; resetFilters(k); if ($(k + '-search')) $(k + '-search').value = r[idc] || ''; state[k].search = r[idc] || ''; renderView(k); showDetail(k, r._i);
  });

  /* ---------- export ---------- */
  window.exportCSV = function () {
    const k = currentTab === 'overview' ? 'detail' : currentTab; if (!RAW[k] || RAW[k].error) { toast('Tidak ada data untuk diekspor'); return; }
    const dl = (name, h, rows) => {
      const csv = [h.join(','), ...rows.map(r => h.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `${name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      return a.download;
    };
    if (k === 'pendukung') { // view kustom: ekspor sesuai filter aktif, dua berkas (unit + tangki aktivitas)
      const V = pendView(); if (!V.M.ok) { toast('Data unit pendukung belum siap'); return; }
      const f1 = dl(RAW.pendukung.name + '_tb_pendukung', V.M.P.headers, V.p);
      let msg = `Export ${fmt(V.p.length)} unit → ${f1}`;
      if (V.M.okA) { const f2 = dl(RAW.pendukung.name + '_tb_aktwilayah', V.M.A.headers, V.a); msg += ` · ${fmt(V.a.length)} tangki → ${f2}`; }
      toast(msg); return;
    }
    const h = RAW[k].headers, rows = (k === 'pipa' || !state[k]) ? RAW[k].rows : filtered(k);
    const f = dl(RAW[k].name, h, rows);
    toast(`Export ${fmt(rows.length)} baris → ${f}`);
  };

  /* ---------- init ---------- */
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('sheetLink').href = 'https://docs.google.com/spreadsheets/d/' + APP_CONFIG.spreadsheetId;
  window.addEventListener('hashchange', () => switchTab(location.hash.replace('#', '')));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && APP_CONFIG.autoRefreshMs) scheduleAuto(1500); });
  window.addEventListener('error', e => { if (/Chart/.test(e.message)) toast('Library grafik gagal dimuat — periksa koneksi internet', true); });
  if (typeof Chart === 'undefined') toast('Library grafik (Chart.js) tidak termuat — grafik disembunyikan', true);
  else Chart.defaults.font.family = 'Inter, system-ui, sans-serif';

  /* ---------- PWA install prompt ---------- */
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; const b = $('installBtn'); if (b) b.style.display = ''; });
  $('installBtn')?.addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('installBtn').style.display = 'none'; });
  window.addEventListener('appinstalled', () => { toast('Aplikasi berhasil dipasang ✔'); const b = $('installBtn'); if (b) b.style.display = 'none'; });

  /* ---------- jembatan untuk modul edit (edit.js) ---------- */
  window.__FS = { RAW, loadData, toast, esc, fmt, sumurInfo, showDetail, switchTab,
    refreshRow: (k, r) => { r._s = RAW[k].headers.map(h => r[h]).join(' \u0001 ').toLowerCase(); dirty[k] = true; closeModal(); renderView(k); },
    removeRow: (k, r) => { RAW[k].rows = RAW[k].rows.filter(x => x !== r); dirty[k] = true; closeModal(); renderView(k); $('badge-' + k).textContent = fmt(RAW[k].rows.length); } };

  /* ---------- Service worker: notifikasi versi baru ---------- */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (window.__swReloading) return; window.__swReloading = true; location.reload(); });
    navigator.serviceWorker.getRegistration && navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return;
      reg.addEventListener('updatefound', () => { const nw = reg.installing; nw && nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) toast('Versi baru dashboard tersedia — memuat ulang…'); }); });
    });
  }

  const h0 = location.hash.replace('#', '');
  // Tampilkan data sync terakhir secara instan (jika ada), lalu sinkron dari spreadsheet di latar
  const cached = loadCache();
  if (cached) {
    try {
      onData({ generatedAt: new Date(cached.at), sheets: cached.sheets });
      $('syncInfo').textContent = 'Data tersimpan ' + new Date(cached.at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' — menyinkronkan…';
      $('loader').classList.add('hide'); switchTab(h0 || 'overview'); window.__fromCache = true;
    } catch (e) { console.warn('cache rusak', e); localStorage.removeItem(CACHE_KEY); }
  }
  loadData(false).then(() => { if (!cached) switchTab(h0 || 'overview'); });
})();
