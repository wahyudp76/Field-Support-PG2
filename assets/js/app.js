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
  const PALETTE = ['#22c55e', '#38bdf8', '#a78bfa', '#f59e0b', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#06b6d4', '#e11d48', '#eab308', '#10b981', '#8b5cf6'];

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
        { label: 'Total Unit', icon: '🚜', c: '#22c55e', fn: r => r.length },
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
      filters: ['Wilayah', 'PG', 'Jenis Sumber Air', 'Sumber Air Alami/Buatan', 'Keterangan (Aktif Irigasi/Tidak)', 'Keterangan Ukur', 'Kondisi Sumur', 'Status', 'Tahun'],
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
        { id: 'c3', title: 'Status Pengukuran', type: 'doughnut', key: 'Keterangan Ukur', colors: { 'Ukur': '#38bdf8', 'Belum Ukur': '#f59e0b' } },
        { id: 'c4', title: 'Status Operasional', type: 'doughnut', key: 'Status' },
      ],
      chips: {
        'Keterangan (Aktif Irigasi/Tidak)': v => /tidak|non/i.test(v) ? 'chip-red' : 'chip-green',
        'Keterangan Ukur': v => /belum/i.test(v) ? 'chip-amber' : 'chip-blue',
        'Jenis Sumber Air': v => /deep|sumur/i.test(v) ? 'chip-purple' : 'chip-blue',
        'Status': v => /siap/i.test(v) ? 'chip-green' : /kosong/i.test(v) ? 'chip-amber' : 'chip-gray',
        'Kondisi Sumur': v => /baik/i.test(v) ? 'chip-green' : /rusak/i.test(v) ? 'chip-red' : /perbaikan/i.test(v) ? 'chip-amber' : 'chip-gray'
      },
      numCols: ['Luas Badan Air', 'Volume Real Ukur (Overflow Terbuka)', 'Volume Potensi Maksimal (Overflow Terbuka)']
    },
    mesin: {
      title: 'Inventaris Mesin / Engine', icon: '⚙️',
      freezeUntil: 'Asal Mesin',   // kolom paling kiri s.d. kolom ini dibekukan saat scroll horizontal
      filters: ['Asal Mesin', 'Komoditi', 'Jenis', 'Spec', 'Pompa', 'Power', 'Category', 'Status', 'Kondisi'],
      kpis: [
        { label: 'Total Mesin', icon: '⚙️', c: '#f59e0b', fn: r => r.length },
        { label: 'Asal Mesin', icon: '🏭', c: '#38bdf8', fn: r => uniq(r, 'Asal Mesin').length },
        { label: 'Terpasang', icon: '✅', c: '#22c55e', fn: r => r.filter(x => isTrue(x['Status'], /terpasang/i)).length },
        { label: 'Standby', icon: '⏸️', c: '#a78bfa', fn: r => r.filter(x => isTrue(x['Status'], /standby/i)).length },
        { label: 'Rusak', icon: '🛠️', c: '#ef4444', fn: r => r.filter(x => isTrue(x['Status'], /rusak/i)).length },
        { label: 'Komponen B/C', icon: '🟠', c: '#f59e0b', fn: r => r.filter(x => x['Kondisi'] && x['Kondisi'] !== 'A').length },
        { label: 'Ada Catatan', icon: '📝', c: '#f97316', fn: r => r.filter(x => x['Keterangan']).length },
      ],
      charts: [
        { id: 'c1', title: 'Mesin per Komoditi', type: 'bar', key: 'Komoditi' },
        { id: 'c2', title: 'Asal Mesin', type: 'doughnut', key: 'Asal Mesin' },
        { id: 'c3', title: 'Kondisi Keseluruhan', type: 'doughnut', key: 'Kondisi', colors: { A: '#22c55e', B: '#f59e0b', C: '#ef4444' } },
        { id: 'c4', title: 'Komponen Paling Sering Bermasalah', type: 'hbar', custom: 'components' },
      ],
      chips: {
        'Kondisi': v => v === 'A' ? 'chip-green' : v === 'B' ? 'chip-amber' : 'chip-red',
        'Category': v => v === 'A' ? 'chip-green' : v === 'B' ? 'chip-amber' : 'chip-red',
        'Status': v => /terpasang|siap|aktif/i.test(v) ? 'chip-green' : /rusak/i.test(v) ? 'chip-red' : /standby/i.test(v) ? 'chip-amber' : 'chip-gray',
        'Pompa': v => /sumur/i.test(v) ? 'chip-blue' : 'chip-purple',
        'Jenis': () => 'chip-gray',
        'Keterangan': () => 'chip-red',
        'Komponen Bermasalah': () => 'chip-red'
      }
    },
    pipa: { title: 'Inventaris Pipa', icon: '🔩', custom: 'pipa', filters: [], kpis: [], charts: [] },
    irrigator: {
      title: 'Inventaris Irrigator', icon: '💦',
      freezeUntil: 'WILAYAH',
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
        { id: 'c3', title: 'Status', type: 'doughnut', key: 'Status', colors: { Terpasang: '#22c55e', Rusak: '#ef4444' } },
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
  const RAW = {}, state = {}, charts = {}, dirty = {};
  let currentTab = 'overview', timer = null, loading = false;
  const newState = () => ({ filters: {}, search: '', sort: null, dir: 1, page: 1, size: Number(localStorage.getItem('fs_pagesize')) || 25 });

  /* ---------- theme ---------- */
  function applyTheme(t) { document.body.setAttribute('data-theme', t); $('themeBtn').innerHTML = (t === 'light' ? '☀️' : '🌙') + ' <span class="t">Tema</span>'; localStorage.setItem('fs_theme', t); }
  window.toggleTheme = () => { applyTheme(document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light'); rerenderAll(); };
  applyTheme(localStorage.getItem('fs_theme') || 'dark');

  /* ---------- load ---------- */
  const CACHE_KEY = 'fs_pg2_data_v1';
  function saveCache(d) {
    try { const slim = {}; Object.keys(d.sheets).forEach(k => { const s = d.sheets[k]; if (!s.error) slim[k] = { key: k, name: s.name, headers: s.headers, issues: s.issues, meta: s.meta, rows: s.rows.map(r => { const o = {}; for (const h in r) if (h !== '_s') o[h] = r[h]; return o; }) }; });
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), sheets: slim })); } catch (e) { /* kuota penuh → abaikan */ }
  }
  function loadCache() {
    try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); if (!c || !c.sheets || Date.now() - c.at > 7 * 864e5) return null; return c; } catch (e) { return null; }
  }
  window.loadData = async function (manual) {
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
      if (APP_CONFIG.autoRefreshMs) { clearTimeout(timer); timer = setTimeout(() => document.hidden ? loadData(false) : loadData(false), APP_CONFIG.autoRefreshMs); }
    }
  };

  function onData(d) {
    const errs = [], kept = [];
    Object.keys(CONFIG).forEach(k => {
      let s = d.sheets[k] || { headers: [], rows: [] };
      if (s.error && RAW[k] && RAW[k].rows.length) {
        // gagal ambil sheet ini → pertahankan data lama (jangan kosongkan dashboard)
        kept.push(RAW[k].name); RAW[k].stale = true; dirty[k] = true; return;
      }
      // pre-compute string pencarian per baris (performa)
      s.rows.forEach(r => { r._s = s.headers.map(h => r[h]).join(' \u0001 ').toLowerCase(); });
      s.stale = false; RAW[k] = s;
      if (s.error) errs.push(s.name + ': ' + s.error);
      if (!state[k]) state[k] = newState();
      $('badge-' + k).textContent = fmt(s.rows.length);
      buildView(k);
      dirty[k] = true;
    });
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
      <div class="charts">${cfg.charts.map(c => `<div class="card"><h3>${esc(c.title)}</h3><div class="chart-box"><canvas id="${k}-${c.id}"></canvas></div></div>`).join('')}</div>
      <div class="tbl-head">
        <h3>${cfg.icon} ${esc(cfg.title)}</h3>
        <div class="tbl-tools">
          <span class="info" id="${k}-info"></span>
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
  function resetFilters(k) { const size = state[k].size; state[k] = newState(); state[k].size = size; $(k + '-search').value = ''; syncMsButtons(k); renderView(k); }
  function sortBy(k, c) { const s = state[k]; if (s.sort === c) s.dir *= -1; else { s.sort = c; s.dir = 1; } renderView(k); }

  /* ---------- render tab ---------- */
  function renderView(k) {
    if (!RAW[k] || RAW[k].error || !$(k + '-kpis')) return;
    dirty[k] = false;
    if (CONFIG[k].custom === 'pipa') return renderPipa();
    const cfg = CONFIG[k], rows = filtered(k), s = state[k], headers = RAW[k].headers;

    $(k + '-kpis').innerHTML = cfg.kpis.map(x => `<div class="kpi" style="--c:${x.c}"><div class="icon">${x.icon}</div><div class="val">${x.fn(rows)}</div><div class="lbl">${x.label}</div></div>`).join('');

    // chip filter aktif
    const af = [];
    Object.entries(s.filters).forEach(([f, set]) => set && set.size && (set.size <= 3
      ? [...set].forEach(v => af.push(`<span class="chip chip-blue" data-f="${esc(f)}" data-v="${esc(v)}" title="Hapus">${esc(f)}: <b>${esc(v)}</b> ✕</span>`))
      : af.push(`<span class="chip chip-blue" data-f="${esc(f)}" title="Hapus semua">${esc(f)}: <b>${set.size} nilai</b> ✕</span>`)));
    if (s.search) af.push(`<span class="chip chip-purple">🔍 "${esc(s.search)}"</span>`);
    $(k + '-af').innerHTML = af.join('');

    requestAnimationFrame(() => cfg.charts.forEach(c => {
      if (c.custom === 'components') { drawChart(k + '-' + c.id, 'hbar', componentStats(k, rows), 10); return; }
      const key = altKey(headers, c.key);
      if (!key) { noChart(k + '-' + c.id, c.key); return; }
      const all = count(rows, key), blank = all.find(x => x[0] === '(kosong)');
      let e = all.filter(x => x[0] !== '(kosong)');
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
    const title = r['Kode Unit'] || r['KODE UNIT'] || r['Kode Engine'] || r['Kode Baru'] || CONFIG[k].title;
    $('modalTitle').textContent = CONFIG[k].icon + ' ' + title;
    $('modalBody').innerHTML = RAW[k].headers.map(h => { const fl = r._flag && r._flag[h]; return `<div class="kv" ${fl ? 'style="outline:1px solid #f59e0b"' : ''}><b>${esc(h)}${fl ? ' ⚠️' : ''}</b>${cell(k, h, r[h], r)}${fl ? `<div style="font-size:11px;color:#f59e0b;margin-top:4px">${esc(fl.reason)}<br>${esc(fl.suggest)}</div>` : ''}</div>`; }).join('');
    $('modal').classList.add('show');
  }
  window.closeModal = () => $('modal').classList.remove('show');

  /* ---------- charts ---------- */
  function themeColors() { const l = document.body.getAttribute('data-theme') === 'light'; return { text: l ? '#475569' : '#94a3b8', grid: l ? '#e2e8f0' : '#243049', border: l ? '#ffffff' : '#18233a' }; }
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
      data, fill: true, tension: .4, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2.5, borderColor: '#38bdf8', pointBackgroundColor: '#38bdf8',
      backgroundColor: c => { const { ctx: g, chartArea } = c.chart; if (!chartArea) return 'rgba(56,189,248,.15)'; const gr = g.createLinearGradient(0, chartArea.top, 0, chartArea.bottom); gr.addColorStop(0, 'rgba(56,189,248,.35)'); gr.addColorStop(1, 'rgba(56,189,248,0)'); return gr; }
    } : {
      data, backgroundColor: type === 'hbar' ? 'rgba(239,68,68,.85)' : 'rgba(34,197,94,.9)', hoverBackgroundColor: type === 'hbar' ? '#ef4444' : '#22c55e',
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
      { l: 'Unit Terpasang', v: fmt(d.length), i: '🚜', c: '#22c55e', t: 'detail' },
      { l: 'Wilayah Aktif', v: uniq(d, altKey(RAW.detail?.headers || [], 'Wil') || 'Wil').length, i: '📍', c: '#38bdf8', t: 'detail' },
      { l: 'Total Sumber Air', v: fmt(s.length), i: '🌊', c: '#a78bfa', t: 'sumber' },
      { l: 'Lebung', v: fmt(s.filter(x => isTrue(x['Jenis Sumber Air'], /reservoir|lebung/i)).length), i: '🏞️', c: '#14b8a6', t: 'sumber' },
      { l: 'Deep Well', v: fmt(s.filter(x => isTrue(x['Jenis Sumber Air'], /deep|sumur/i)).length), i: '🕳️', c: '#f59e0b', t: 'sumber' },
      { l: 'Total Mesin', v: fmt(m.length), i: '⚙️', c: '#ec4899', t: 'mesin' },
      { l: 'Total Irrigator', v: fmt(ir.length), i: '💦', c: '#06b6d4', t: 'irrigator' },
      { l: 'Volume Air Real (m³)', v: fmt(sum(s, 'Volume Real Ukur (Overflow Terbuka)')), i: '📏', c: '#6366f1', t: 'sumber' },
      { l: 'Total Pipa (batang)', v: fmt(pipaModel().grand), i: '🔩', c: '#f97316', t: 'pipa' },
    ];
    $('ov-kpis').innerHTML = k.map(x => `<div class="kpi link" style="--c:${x.c}" data-t="${x.t}" title="Buka tab"><div class="icon">${x.i}</div><div class="val">${x.v}</div><div class="lbl">${x.l}</div></div>`).join('');
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
    const li = (label, arr) => `<li class="sub"><b>${label}</b></li>` + count(arr, 'Kondisi').sort().map(([c, n]) => `<li><span class="chip ${c === 'A' ? 'chip-green' : c === 'B' ? 'chip-amber' : 'chip-red'}">${c}</span><span style="flex:1;margin-left:10px">${lbl[c] || c}</span><b>${n}</b></li>`).join('');
    $('ov-kondisi').innerHTML = li('⚙️ Mesin', m) + li('💦 Irrigator', ir);
    renderPipaResume();
  }
  $('ov-kpis').addEventListener('click', e => { const c = e.target.closest('[data-t]'); if (c) switchTab(c.dataset.t); });


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
      jenis.forEach(j => { const x = p.jenis[j.name]; if (!isNaN(x.totalSheet) && x.totalSheet !== x.total) issues.push({ row: p.row._i + 2, col: j.totalCol, value: p.row[j.totalCol], level: 'warn', reason: `Total ${j.name} di sheet (${fmt(x.totalSheet)}) ≠ jumlah komponen (${fmt(x.total)}) pada ${p.name}`, suggest: 'Periksa rumus/isian kolom komponen; dashboard memakai jumlah komponen' }); });
      if (grandCol && !isNaN(p.totalSheet) && p.totalSheet !== p.total) issues.push({ row: p.row._i + 2, col: grandCol, value: p.row[grandCol], level: 'warn', reason: `Grand Total di sheet (${fmt(p.totalSheet)}) ≠ jumlah komponen (${fmt(p.total)}) pada ${p.name}`, suggest: 'Periksa rumus Grand Total; dashboard memakai jumlah komponen' });
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
    $('pipa-kpis').innerHTML = kp.map(x => `<div class="kpi" style="--c:${x.c}"><div class="icon">${x.i}</div><div class="val">${x.v}</div><div class="lbl">${esc(x.l)}${x.s ? `<span class="kpi-sub">${esc(x.s)}</span>` : ''}</div></div>`).join('');
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
  function drawStacked(id, labels, datasets) {
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
          tooltip: { backgroundColor: 'rgba(15,23,42,.92)', padding: 10, cornerRadius: 10, titleFont: { weight: '700' }, callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)} batang`, footer: it => 'Total: ' + fmt(it.reduce((a, c) => a + c.parsed.y, 0)) + ' batang' } }
        },
        scales: {
          x: { stacked: true, ticks: { color: tc.text, font: { size: 11 } }, grid: { display: false }, border: { display: false } },
          y: { stacked: true, beginAtZero: true, grace: '8%', ticks: { color: tc.text, precision: 0, font: { size: 11 } }, grid: { color: tc.grid }, border: { display: false } }
        }
      }
    });
    chart._t = 'stacked'; charts[id] = chart;
  }

  /* ---------- Peringatan kualitas data ---------- */
  let ISSUES = [], lastIssueSig = '';
  function updateIssues() {
    ISSUES = [];
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
      setTimeout(() => toast(`⚠️ ${important.length} nilai di spreadsheet tidak sesuai format${nErr ? ` (${nErr} error)` : ''} — klik tombol "peringatan data" untuk detail`, true), 1200);
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
  window.openIssues = () => { $('issuesModal').classList.add('show'); renderIssues(); };
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
    const k = tr.dataset.key, i = +tr.dataset.row - 2; closeIssues(); switchTab(k);
    const r = RAW[k].rows[i]; if (!r) return;
    const idc = RAW[k].meta.idCol; resetFilters(k); $(k + '-search').value = r[idc] || ''; state[k].search = r[idc] || ''; renderView(k); showDetail(k, r._i);
  });

  /* ---------- export ---------- */
  window.exportCSV = function () {
    const k = currentTab === 'overview' ? 'detail' : currentTab; if (!RAW[k] || RAW[k].error) return;
    const h = RAW[k].headers, rows = filtered(k);
    const csv = [h.join(','), ...rows.map(r => h.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${RAW[k].name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`Export ${fmt(rows.length)} baris → ${a.download}`);
  };

  /* ---------- init ---------- */
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('sheetLink').href = 'https://docs.google.com/spreadsheets/d/' + APP_CONFIG.spreadsheetId;
  window.addEventListener('hashchange', () => switchTab(location.hash.replace('#', '')));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && APP_CONFIG.autoRefreshMs) { clearTimeout(timer); timer = setTimeout(() => loadData(false), 1500); } });
  window.addEventListener('error', e => { if (/Chart/.test(e.message)) toast('Library grafik gagal dimuat — periksa koneksi internet', true); });
  if (typeof Chart === 'undefined') toast('Library grafik (Chart.js) tidak termuat — grafik disembunyikan', true);
  else Chart.defaults.font.family = 'Inter, system-ui, sans-serif';

  /* ---------- PWA install prompt ---------- */
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; const b = $('installBtn'); if (b) b.style.display = ''; });
  $('installBtn')?.addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('installBtn').style.display = 'none'; });
  window.addEventListener('appinstalled', () => { toast('Aplikasi berhasil dipasang ✔'); const b = $('installBtn'); if (b) b.style.display = 'none'; });

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
