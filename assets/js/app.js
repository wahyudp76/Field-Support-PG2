/* =====================================================================
 *  APP — Dashboard Field Support Irigasi PG 2
 * ===================================================================== */
(function () {
  'use strict';
  const { toNumber } = DataLayer;
  const PAGE_SIZE = APP_CONFIG.pageSize || 25;
  const PALETTE = ['#22c55e', '#38bdf8', '#a78bfa', '#f59e0b', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#e11d48', '#eab308', '#10b981', '#8b5cf6'];

  /* ---------- helper ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const cssId = s => String(s).replace(/[^a-z0-9]/gi, '_');
  const uniq = (rows, k) => [...new Set(rows.map(r => r[k]).filter(v => v !== '' && v != null))];
  const sum = (rows, k) => rows.reduce((a, r) => { const n = toNumber(r[k]); return a + (isNaN(n) ? 0 : n); }, 0);
  const fmt = (n, d = 0) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n || 0);
  const count = (rows, k) => { const m = {}; rows.forEach(r => { const v = r[k] || '(kosong)'; m[v] = (m[v] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
  const isTrue = (v, re) => re.test(String(v || ''));

  function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(t._t); t._t = setTimeout(() => t.className = 'toast', 3500); }

  /* ---------- konfigurasi per tab ---------- */
  const CONFIG = {
    detail: {
      title: 'Detail Unit Terpasang', icon: '🚜',
      filters: ['Wil', 'Bengkel', 'Jenis Engine', 'Sumber Air', 'Siram', 'Power'],
      kpis: [
        { label: 'Total Unit', icon: '🚜', c: '#22c55e', fn: r => r.length },
        { label: 'Terpasang', icon: '✅', c: '#38bdf8', fn: r => r.filter(x => isTrue(x['Siram'], /terpasang/i) || isTrue(x['Keterangan'], /terpasang/i)).length },
        { label: 'Wilayah', icon: '📍', c: '#a78bfa', fn: r => uniq(r, 'Wil').length },
        { label: 'Engine Unik', icon: '⚙️', c: '#f59e0b', fn: r => uniq(r, 'Kode Engine').length },
        { label: 'Irigator Unik', icon: '💦', c: '#ec4899', fn: r => uniq(r, 'Kode Irigator').length },
        { label: 'Ada Catatan', icon: '📝', c: '#ef4444', fn: r => r.filter(x => x['Keterangan']).length },
      ],
      charts: [
        { id: 'c1', title: 'Unit per Wilayah', type: 'bar', key: 'Wil' },
        { id: 'c2', title: 'Jenis Engine', type: 'doughnut', key: 'Jenis Engine' },
        { id: 'c3', title: 'Sumber Air', type: 'pie', key: 'Sumber Air' },
        { id: 'c4', title: 'Pemasangan per Tanggal', type: 'line', key: 'Tanggal' },
      ],
      chips: {
        'Siram': v => /terpasang/i.test(v) ? 'chip-green' : 'chip-amber',
        'Sumber Air': v => /deep|sumur/i.test(v) ? 'chip-blue' : 'chip-purple',
        'Jenis Engine': () => 'chip-gray',
        'Keterangan': () => 'chip-red'
      }
    },
    sumber: {
      title: 'Inventaris Sumber Air', icon: '🌊',
      filters: ['Wilayah', 'PG', 'Jenis Sumber Air', 'Sumber Air Alami/Buatan', 'Keterangan (Aktif Irigasi/Tidak)', 'Keterangan Ukur', 'Status'],
      kpis: [
        { label: 'Total Sumber Air', icon: '🌊', c: '#38bdf8', fn: r => r.length },
        { label: 'Lebung / Reservoir', icon: '🏞️', c: '#22c55e', fn: r => r.filter(x => isTrue(x['Jenis Sumber Air'], /reservoir|lebung/i)).length },
        { label: 'Deep Well', icon: '🕳️', c: '#a78bfa', fn: r => r.filter(x => isTrue(x['Jenis Sumber Air'], /deep|sumur/i)).length },
        { label: 'Aktif Irigasi', icon: '✅', c: '#f59e0b', fn: r => r.filter(x => isTrue(x['Keterangan (Aktif Irigasi/Tidak)'], /aktif/i) && !isTrue(x['Keterangan (Aktif Irigasi/Tidak)'], /tidak|non/i)).length },
        { label: 'Sudah Diukur', icon: '📐', c: '#14b8a6', fn: r => r.filter(x => isTrue(x['Keterangan Ukur'], /^ukur/i)).length },
        { label: 'Vol. Real (m³)', icon: '📏', c: '#ec4899', fn: r => fmt(sum(r, 'Volume Real Ukur (Overflow Terbuka)')) },
        { label: 'Vol. Potensi (m³)', icon: '📈', c: '#6366f1', fn: r => fmt(sum(r, 'Volume Potensi Maksimal (Overflow Terbuka)')) },
      ],
      charts: [
        { id: 'c1', title: 'Sumber Air per Wilayah', type: 'bar', key: 'Wilayah', limit: 30 },
        { id: 'c2', title: 'Jenis Sumber Air', type: 'doughnut', key: 'Jenis Sumber Air' },
        { id: 'c3', title: 'Status Pengukuran', type: 'pie', key: 'Keterangan Ukur' },
        { id: 'c4', title: 'Status Operasional', type: 'doughnut', key: 'Status' },
      ],
      chips: {
        'Keterangan (Aktif Irigasi/Tidak)': v => /tidak|non/i.test(v) ? 'chip-red' : 'chip-green',
        'Keterangan Ukur': v => /belum/i.test(v) ? 'chip-amber' : 'chip-blue',
        'Jenis Sumber Air': v => /deep|sumur/i.test(v) ? 'chip-purple' : 'chip-blue',
        'Status': v => /siap/i.test(v) ? 'chip-green' : /kosong/i.test(v) ? 'chip-amber' : 'chip-gray'
      },
      numCols: ['Luas Badan Air', 'Volume Real Ukur (Overflow Terbuka)', 'Volume Potensi Maksimal (Overflow Terbuka)']
    },
    mesin: {
      title: 'Inventaris Mesin / Engine', icon: '⚙️',
      filters: ['Divisi', 'Spec', 'Jenis', 'Category', 'Prodo', 'Kondisi'],
      kpis: [
        { label: 'Total Mesin', icon: '⚙️', c: '#f59e0b', fn: r => r.length },
        { label: 'Divisi', icon: '🏭', c: '#38bdf8', fn: r => uniq(r, 'Divisi').length },
        { label: 'Tipe Spec', icon: '🔧', c: '#a78bfa', fn: r => uniq(r, 'Spec').length },
        { label: 'Kondisi A — Baik', icon: '🟢', c: '#22c55e', fn: r => r.filter(x => x['Kondisi'] === 'A').length },
        { label: 'Kondisi B — Perhatian', icon: '🟡', c: '#f59e0b', fn: r => r.filter(x => x['Kondisi'] === 'B').length },
        { label: 'Kondisi C — Perbaikan', icon: '🔴', c: '#ef4444', fn: r => r.filter(x => x['Kondisi'] === 'C').length },
      ],
      charts: [
        { id: 'c1', title: 'Mesin per Divisi', type: 'bar', key: 'Divisi' },
        { id: 'c2', title: 'Spec Engine', type: 'doughnut', key: 'Spec' },
        { id: 'c3', title: 'Kondisi Keseluruhan', type: 'pie', key: 'Kondisi', colors: { A: '#22c55e', B: '#f59e0b', C: '#ef4444' } },
        { id: 'c4', title: 'Komponen Paling Sering Bermasalah', type: 'hbar', custom: 'components' },
      ],
      chips: { 'Kondisi': v => v === 'A' ? 'chip-green' : v === 'B' ? 'chip-amber' : 'chip-red', 'Komponen Bermasalah': () => 'chip-red' }
    },
    irrigator: {
      title: 'Inventaris Irrigator', icon: '💦',
      filters: ['WILAYAH', 'Unit', 'Category', 'Status', 'Nozzle', 'Kondisi'],
      kpis: [
        { label: 'Total Irrigator', icon: '💦', c: '#38bdf8', fn: r => r.length },
        { label: 'Terpasang', icon: '✅', c: '#22c55e', fn: r => r.filter(x => isTrue(x['Status'], /terpasang/i)).length },
        { label: 'Rusak', icon: '🛠️', c: '#ef4444', fn: r => r.filter(x => isTrue(x['Status'], /rusak/i)).length },
        { label: 'Wilayah', icon: '📍', c: '#a78bfa', fn: r => uniq(r, 'WILAYAH').length },
        { label: 'Kondisi A — Baik', icon: '🟢', c: '#22c55e', fn: r => r.filter(x => x['Kondisi'] === 'A').length },
        { label: 'Ada Komponen B/C', icon: '🟠', c: '#f59e0b', fn: r => r.filter(x => x['Kondisi'] !== 'A').length },
      ],
      charts: [
        { id: 'c1', title: 'Irrigator per Wilayah', type: 'bar', key: 'WILAYAH' },
        { id: 'c2', title: 'Tipe Unit', type: 'doughnut', key: 'Unit' },
        { id: 'c3', title: 'Status', type: 'pie', key: 'Status', colors: { Terpasang: '#22c55e', Rusak: '#ef4444' } },
        { id: 'c4', title: 'Komponen Paling Sering Bermasalah', type: 'hbar', custom: 'components' },
      ],
      chips: {
        'Status': v => /terpasang/i.test(v) ? 'chip-green' : /rusak/i.test(v) ? 'chip-red' : 'chip-gray',
        'Kondisi': v => v === 'A' ? 'chip-green' : v === 'B' ? 'chip-amber' : 'chip-red',
        'Category': v => v === 'A' ? 'chip-green' : v === 'B' ? 'chip-amber' : 'chip-red',
        'Komponen Bermasalah': () => 'chip-red'
      }
    }
  };

  /* ---------- state ---------- */
  let RAW = {}, state = {}, charts = {}, currentTab = 'overview', timer = null;

  /* ---------- theme ---------- */
  function applyTheme(t) { document.body.setAttribute('data-theme', t); $('themeBtn').innerHTML = (t === 'light' ? '☀️' : '🌙') + ' <span class="t">Tema</span>'; localStorage.setItem('fs_theme', t); }
  window.toggleTheme = () => { applyTheme(document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light'); rerenderAll(); };
  applyTheme(localStorage.getItem('fs_theme') || 'dark');

  /* ---------- load ---------- */
  window.loadData = async function (manual) {
    const btn = $('refreshBtn'); btn.disabled = true; $('syncInfo').textContent = 'Sinkron…'; $('syncDot').className = 'dot';
    try {
      const d = await DataLayer.fetchAll();
      onData(d);
      if (manual) toast('Data berhasil disinkronkan ✔');
    } catch (e) {
      $('syncDot').className = 'dot err'; $('syncInfo').textContent = 'Gagal sinkron';
      toast('Gagal memuat data: ' + e.message, true);
    } finally {
      btn.disabled = false; $('loader').classList.add('hide');
      if (APP_CONFIG.autoRefreshMs) { clearTimeout(timer); timer = setTimeout(() => loadData(false), APP_CONFIG.autoRefreshMs); }
    }
  };

  function onData(d) {
    const errs = [];
    Object.keys(CONFIG).forEach(k => {
      RAW[k] = d.sheets[k] || { headers: [], rows: [] };
      if (RAW[k].error) errs.push(RAW[k].name + ': ' + RAW[k].error);
      if (!state[k]) state[k] = { filters: {}, search: '', sort: null, dir: 1, page: 1 };
      $('badge-' + k).textContent = RAW[k].rows.length;
      buildView(k);
    });
    renderOverview();
    const t = d.generatedAt;
    $('syncInfo').textContent = 'Update ' + t.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    $('ftime').textContent = 'Terakhir sinkron: ' + t.toLocaleString('id-ID');
    if (errs.length) toast('Sebagian sheet gagal dimuat: ' + errs.join(' | '), true);
  }

  /* ---------- tabs ---------- */
  window.switchTab = function (t) {
    currentTab = t; location.hash = t;
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === t));
    document.querySelectorAll('.view').forEach(x => x.classList.toggle('active', x.id === 'view-' + t));
    if (t !== 'overview' && RAW[t]) renderView(t);
  };
  function rerenderAll() { renderOverview(); Object.keys(CONFIG).forEach(k => RAW[k] && !RAW[k].error && renderView(k)); }

  /* ---------- build view ---------- */
  function buildView(k) {
    const cfg = CONFIG[k], data = RAW[k], el = $('view-' + k);
    if (data.error) { el.innerHTML = `<div class="alert">⚠️ Sheet "<b>${esc(data.name)}</b>" gagal dimuat: ${esc(data.error)}</div>`; return; }
    const filters = cfg.filters.filter(f => data.headers.includes(f));
    el.innerHTML = `
      <div class="kpis" id="${k}-kpis"></div>
      <div class="filters">
        <div class="fgroup search"><label>🔍 Cari</label><input type="text" id="${k}-search" placeholder="Cari kode, lokasi, keterangan…"></div>
        ${filters.map(f => `<div class="fgroup"><label title="${esc(f)}">${esc(f)}</label><select id="${k}-f-${cssId(f)}" data-f="${esc(f)}"><option value="">Semua</option>${uniq(data.rows, f).sort((a, b) => String(a).localeCompare(String(b), 'id', { numeric: true })).map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select></div>`).join('')}
        <div class="fgroup" style="flex:0;min-width:auto"><label>&nbsp;</label><button class="btn btn-outline" id="${k}-reset">✕ Reset</button></div>
      </div>
      <div class="active-filters" id="${k}-af"></div>
      <div class="charts">${cfg.charts.map(c => `<div class="card"><h3>${esc(c.title)}</h3><div class="chart-box"><canvas id="${k}-${c.id}"></canvas></div></div>`).join('')}</div>
      <div class="tbl-head"><h3>${cfg.icon} ${esc(cfg.title)}</h3><span class="info" id="${k}-info"></span></div>
      <div class="tbl-wrap"><table><thead id="${k}-thead"></thead><tbody id="${k}-tbody"></tbody></table></div>
      <div class="pager"><span id="${k}-pinfo"></span><div class="pg" id="${k}-pg"></div></div>`;

    // events
    $(k + '-search').addEventListener('input', e => { state[k].search = e.target.value; state[k].page = 1; renderView(k); });
    el.querySelectorAll('select[data-f]').forEach(s => s.addEventListener('change', e => { state[k].filters[e.target.dataset.f] = e.target.value; state[k].page = 1; renderView(k); }));
    $(k + '-reset').addEventListener('click', () => resetFilters(k));
    $(k + '-thead').addEventListener('click', e => { const th = e.target.closest('th'); if (th) sortBy(k, th.dataset.h); });
    $(k + '-tbody').addEventListener('click', e => { const tr = e.target.closest('tr[data-i]'); if (tr) showDetail(k, +tr.dataset.i); });
    $(k + '-pg').addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (b) { state[k].page = +b.dataset.p; renderView(k); el.querySelector('.tbl-wrap').scrollTop = 0; } });
    $(k + '-af').addEventListener('click', e => { const c = e.target.closest('[data-f]'); if (c) { state[k].filters[c.dataset.f] = ''; const s = $(k + '-f-' + cssId(c.dataset.f)); if (s) s.value = ''; renderView(k); } });

    // preserve state on refresh
    $(k + '-search').value = state[k].search;
    Object.entries(state[k].filters).forEach(([f, v]) => { const s = $(k + '-f-' + cssId(f)); if (s) s.value = v; });
    renderView(k);
  }

  function filtered(k) {
    const s = state[k], q = s.search.toLowerCase().trim();
    let rows = RAW[k].rows.filter(r => {
      for (const f in s.filters) if (s.filters[f] && String(r[f]) !== s.filters[f]) return false;
      if (q) return Object.keys(r).some(h => h[0] !== '_' && String(r[h]).toLowerCase().includes(q));
      return true;
    });
    if (s.sort) {
      const c = s.sort, d = s.dir;
      rows = [...rows].sort((a, b) => {
        const x = a[c], y = b[c], nx = toNumber(x), ny = toNumber(y);
        if (x === '' && y !== '') return 1; if (y === '' && x !== '') return -1;
        if (!isNaN(nx) && !isNaN(ny)) return (nx - ny) * d;
        return String(x).localeCompare(String(y), 'id', { numeric: true }) * d;
      });
    }
    return rows;
  }
  function resetFilters(k) { state[k] = { filters: {}, search: '', sort: null, dir: 1, page: 1 }; $(k + '-search').value = ''; document.querySelectorAll(`#view-${k} select[data-f]`).forEach(s => s.value = ''); renderView(k); }
  function sortBy(k, c) { const s = state[k]; if (s.sort === c) s.dir *= -1; else { s.sort = c; s.dir = 1; } renderView(k); }

  function renderView(k) {
    if (!RAW[k] || RAW[k].error || !$(k + '-kpis')) return;
    const cfg = CONFIG[k], rows = filtered(k), s = state[k], headers = RAW[k].headers;

    $(k + '-kpis').innerHTML = cfg.kpis.map(x => `<div class="kpi" style="--c:${x.c}"><div class="icon">${x.icon}</div><div class="val">${x.fn(rows)}</div><div class="lbl">${x.label}</div></div>`).join('');

    // active filter chips
    const af = Object.entries(s.filters).filter(([, v]) => v);
    $(k + '-af').innerHTML = af.map(([f, v]) => `<span class="chip chip-blue" data-f="${esc(f)}" title="Hapus filter">${esc(f)}: <b>${esc(v)}</b> ✕</span>`).join('');

    cfg.charts.forEach(c => {
      if (c.custom === 'components') { drawChart(k + '-' + c.id, 'hbar', componentStats(k, rows), 10); return; }
      if (!headers.includes(c.key)) return;
      let e = count(rows, c.key);
      if (c.type === 'line') e = e.filter(x => x[0] !== '(kosong)').sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      drawChart(k + '-' + c.id, c.type, e, c.type === 'line' ? 90 : (c.limit || 12), c.colors);
    });

    $(k + '-info').textContent = `${fmt(rows.length)} dari ${fmt(RAW[k].rows.length)} baris`;
    $(k + '-thead').innerHTML = '<tr>' + headers.map(h => `<th data-h="${esc(h)}">${esc(h)}<span class="arrow">${s.sort === h ? (s.dir > 0 ? '▲' : '▼') : '⇅'}</span></th>`).join('') + '</tr>';
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); if (s.page > pages) s.page = pages;
    const slice = rows.slice((s.page - 1) * PAGE_SIZE, s.page * PAGE_SIZE);
    $(k + '-tbody').innerHTML = slice.length
      ? slice.map(r => `<tr class="clickable" data-i="${r._i}" title="Klik untuk detail">` + headers.map(h => `<td>${cell(k, h, r[h])}</td>`).join('') + '</tr>').join('')
      : `<tr><td colspan="${headers.length}" class="empty">Tidak ada data yang cocok</td></tr>`;
    $(k + '-pinfo').textContent = `Halaman ${s.page} / ${pages}`;
    let pg = ''; const btn = (p, l, cur) => `<button class="btn btn-outline ${cur ? 'cur' : ''}" data-p="${p}">${l}</button>`;
    if (s.page > 1) pg += btn(1, '«') + btn(s.page - 1, '‹');
    for (let p = Math.max(1, s.page - 2); p <= Math.min(pages, s.page + 2); p++) pg += btn(p, p, p === s.page);
    if (s.page < pages) pg += btn(s.page + 1, '›') + btn(pages, '»');
    $(k + '-pg').innerHTML = pg;
  }

  function componentStats(k, rows) {
    const skip = new Set((APP_CONFIG.nonComponentCols[k] || []).map(s => s.toLowerCase()).concat(['kondisi', 'komponen bermasalah']));
    const comp = RAW[k].headers.filter(h => !skip.has(h.toLowerCase()));
    const m = {};
    rows.forEach(r => comp.forEach(h => { const v = String(r[h]).toUpperCase(); if (v === 'B' || v === 'C') m[h] = (m[h] || 0) + 1; }));
    const e = Object.entries(m).sort((a, b) => b[1] - a[1]);
    return e.length ? e : [['Semua komponen kondisi A', 0]];
  }

  function cell(k, h, v) {
    if (v === '' || v == null) return '<span style="color:var(--muted)">—</span>';
    const cfg = CONFIG[k];
    if ((cfg.numCols || []).includes(h)) { const n = toNumber(v); if (!isNaN(n)) return `<span class="num">${fmt(n, 2)}</span>`; }
    if (cfg.chips && cfg.chips[h]) return `<span class="chip ${cfg.chips[h](String(v))}">${esc(v)}</span>`;
    const sv = String(v).trim().toUpperCase();
    if ((k === 'mesin' || k === 'irrigator') && ['A', 'B', 'C'].includes(sv) && sv.length === 1) return `<span class="cond cond-${sv}">${sv}</span>`;
    return esc(v);
  }

  /* ---------- detail modal ---------- */
  function showDetail(k, i) {
    const r = RAW[k].rows.find(x => x._i === i); if (!r) return;
    const hs = RAW[k].headers;
    const title = r['Kode Unit'] || r['KODE UNIT'] || r['Kode Engine'] || r['Kode Baru'] || CONFIG[k].title;
    $('modalTitle').textContent = CONFIG[k].icon + ' ' + title;
    $('modalBody').innerHTML = hs.map(h => `<div class="kv"><b>${esc(h)}</b>${cell(k, h, r[h])}</div>`).join('');
    $('modal').classList.add('show');
  }
  window.closeModal = () => $('modal').classList.remove('show');
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  /* ---------- charts ---------- */
  function themeColors() { const l = document.body.getAttribute('data-theme') === 'light'; return { text: l ? '#475569' : '#94a3b8', grid: l ? '#e2e8f0' : '#243049', border: l ? '#fff' : '#111a2e' }; }
  function drawChart(id, type, entries, limit = 12, colorMap) {
    const ctx = $(id); if (!ctx) return;
    if (charts[id]) charts[id].destroy();
    entries = entries.slice(0, limit); const tc = themeColors();
    const isBar = type === 'bar' || type === 'hbar', isLine = type === 'line';
    const colors = colorMap ? entries.map((e, i) => colorMap[e[0]] || PALETTE[i % PALETTE.length]) : PALETTE;
    charts[id] = new Chart(ctx, {
      type: isBar ? 'bar' : type,
      data: {
        labels: entries.map(e => e[0]),
        datasets: [{
          data: entries.map(e => e[1]), fill: isLine, tension: .35, pointRadius: 3,
          backgroundColor: type === 'bar' ? '#22c55e' : type === 'hbar' ? '#ef4444' : isLine ? 'rgba(56,189,248,.18)' : colors,
          borderRadius: isBar ? 7 : 0, borderWidth: isBar ? 0 : 2,
          borderColor: isLine ? '#38bdf8' : tc.border, hoverOffset: 8
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
        indexAxis: type === 'hbar' ? 'y' : 'x',
        plugins: {
          legend: { display: !isBar && !isLine, position: 'right', labels: { color: tc.text, boxWidth: 12, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => ' ' + fmt(c.parsed.y ?? c.parsed.x ?? c.parsed) + ' unit' } }
        },
        scales: (isBar || isLine) ? {
          x: { ticks: { color: tc.text, maxRotation: 45, autoSkip: true, precision: 0 }, grid: { display: type !== 'hbar', color: tc.grid } },
          y: { beginAtZero: true, ticks: { color: tc.text, precision: 0 }, grid: { display: type === 'hbar' ? false : true, color: tc.grid } }
        } : {}
      }
    });
  }

  /* ---------- overview ---------- */
  function renderOverview() {
    const d = RAW.detail?.rows || [], s = RAW.sumber?.rows || [], m = RAW.mesin?.rows || [], ir = RAW.irrigator?.rows || [];
    const k = [
      { l: 'Unit Terpasang', v: fmt(d.length), i: '🚜', c: '#22c55e' },
      { l: 'Wilayah Aktif', v: uniq(d, 'Wil').length, i: '📍', c: '#38bdf8' },
      { l: 'Total Sumber Air', v: fmt(s.length), i: '🌊', c: '#a78bfa' },
      { l: 'Lebung', v: fmt(s.filter(x => isTrue(x['Jenis Sumber Air'], /reservoir|lebung/i)).length), i: '🏞️', c: '#14b8a6' },
      { l: 'Deep Well', v: fmt(s.filter(x => isTrue(x['Jenis Sumber Air'], /deep|sumur/i)).length), i: '🕳️', c: '#f59e0b' },
      { l: 'Total Mesin', v: fmt(m.length), i: '⚙️', c: '#ec4899' },
      { l: 'Total Irrigator', v: fmt(ir.length), i: '💦', c: '#06b6d4' },
      { l: 'Volume Air Real (m³)', v: fmt(sum(s, 'Volume Real Ukur (Overflow Terbuka)')), i: '📏', c: '#6366f1' },
    ];
    $('ov-kpis').innerHTML = k.map(x => `<div class="kpi" style="--c:${x.c}"><div class="icon">${x.i}</div><div class="val">${x.v}</div><div class="lbl">${x.l}</div></div>`).join('');
    drawChart('ov-c1', 'bar', count(d, 'Wil'));
    drawChart('ov-c2', 'doughnut', count(d, 'Jenis Engine'));
    drawChart('ov-c3', 'pie', count(s, 'Jenis Sumber Air'));
    drawChart('ov-c4', 'doughnut', count(ir, 'Status'), 12, { Terpasang: '#22c55e', Rusak: '#ef4444' });
    const wil = count(d, 'Wil').slice(0, 10), mx = wil[0]?.[1] || 1;
    $('ov-wil').innerHTML = wil.map(([w, n]) => `<li><b>${esc(w)}</b><div class="bar"><span style="width:${n / mx * 100}%"></span></div><span>${n} unit</span></li>`).join('') || '<li class="empty">Belum ada data</li>';
    const lbl = { A: 'Kondisi A — Baik', B: 'Kondisi B — Perlu Perhatian', C: 'Kondisi C — Perlu Perbaikan' };
    const li = (label, arr) => `<li style="background:transparent;border:none;padding:4px 0 0"><b style="font-size:12px;color:var(--muted)">${label}</b></li>` +
      count(arr, 'Kondisi').sort().map(([c, n]) => `<li><span class="chip ${c === 'A' ? 'chip-green' : c === 'B' ? 'chip-amber' : 'chip-red'}">${c}</span><span style="flex:1;margin-left:10px">${lbl[c] || c}</span><b>${n}</b></li>`).join('');
    $('ov-kondisi').innerHTML = li('⚙️ Mesin', m) + li('💦 Irrigator', ir);
  }

  /* ---------- export ---------- */
  window.exportCSV = function () {
    const k = currentTab === 'overview' ? 'detail' : currentTab; if (!RAW[k] || RAW[k].error) return;
    const h = RAW[k].headers, rows = filtered(k);
    const csv = [h.join(','), ...rows.map(r => h.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${RAW[k].name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    toast(`Export ${rows.length} baris → ${a.download}`);
  };

  /* ---------- init ---------- */
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('sheetLink').href = 'https://docs.google.com/spreadsheets/d/' + APP_CONFIG.spreadsheetId;
  const h = location.hash.replace('#', '');
  loadData(false).then(() => { if (h && CONFIG[h]) switchTab(h); });
})();
