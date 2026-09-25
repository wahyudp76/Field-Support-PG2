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
  const sum = (rows, k) => rows.reduce((a, r) => { const n = toNumber(r[k]); return a + (isNaN(n) ? 0 : n); }, 0);
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
      filters: ['Wil', 'Bengkel', 'Jenis Engine', 'Sumber Air', 'Siram', 'Power', 'Tanggal'],
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
        { id: 'c3', title: 'Sumber Air', type: 'doughnut', key: 'Sumber Air' },
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
        'Kondisi Sumur': v => /baik/i.test(v) ? 'chip-green' : /rusak/i.test(v) ? 'chip-red' : 'chip-gray'
      },
      numCols: ['Luas Badan Air', 'Volume Real Ukur (Overflow Terbuka)', 'Volume Potensi Maksimal (Overflow Terbuka)']
    },
    mesin: {
      title: 'Inventaris Mesin / Engine', icon: '⚙️',
      freezeUntil: 'Asal Mesin',   // kolom paling kiri s.d. kolom ini dibekukan saat scroll horizontal
      filters: ['Asal Mesin', 'Komoditi', 'Jenis', 'Spec', 'Pompa', 'HP', 'Category', 'Status', 'Kondisi'],
      kpis: [
        { label: 'Total Mesin', icon: '⚙️', c: '#f59e0b', fn: r => r.length },
        { label: 'Asal Mesin', icon: '🏭', c: '#38bdf8', fn: r => uniq(r, 'Asal Mesin').length },
        { label: 'Komoditi / Wilayah', icon: '📍', c: '#a78bfa', fn: r => uniq(r, 'Komoditi').length },
        { label: 'Kondisi A — Baik', icon: '🟢', c: '#22c55e', fn: r => r.filter(x => x['Kondisi'] === 'A').length },
        { label: 'Kondisi B — Perhatian', icon: '🟡', c: '#f59e0b', fn: r => r.filter(x => x['Kondisi'] === 'B').length },
        { label: 'Kondisi C — Perbaikan', icon: '🔴', c: '#ef4444', fn: r => r.filter(x => x['Kondisi'] === 'C').length },
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
        'Status': v => /terpasang|siap|aktif/i.test(v) ? 'chip-green' : /rusak/i.test(v) ? 'chip-red' : 'chip-gray',
        'Pompa': v => /sumur/i.test(v) ? 'chip-blue' : 'chip-purple',
        'Jenis': () => 'chip-gray',
        'Komponen Bermasalah': () => 'chip-red'
      }
    },
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
  const RAW = {}, state = {}, charts = {}, dirty = {}, compCache = {};
  let currentTab = 'overview', timer = null, loading = false;
  const newState = () => ({ filters: {}, search: '', sort: null, dir: 1, page: 1, size: Number(localStorage.getItem('fs_pagesize')) || 25 });

  /* ---------- theme ---------- */
  function applyTheme(t) { document.body.setAttribute('data-theme', t); $('themeBtn').innerHTML = (t === 'light' ? '☀️' : '🌙') + ' <span class="t">Tema</span>'; localStorage.setItem('fs_theme', t); }
  window.toggleTheme = () => { applyTheme(document.body.getAttribute('data-theme') === 'light' ? 'dark' : 'light'); rerenderAll(); };
  applyTheme(localStorage.getItem('fs_theme') || 'dark');

  /* ---------- load ---------- */
  window.loadData = async function (manual) {
    if (loading) return; loading = true;
    const btn = $('refreshBtn'); btn.disabled = true; $('syncInfo').textContent = 'Sinkron…'; $('syncDot').className = 'dot';
    try {
      const d = await DataLayer.fetchAll();
      onData(d);
      if (manual) toast('Data berhasil disinkronkan ✔');
    } catch (e) {
      $('syncDot').className = 'dot err'; $('syncInfo').textContent = 'Gagal sinkron';
      toast('Gagal memuat data: ' + e.message, true);
    } finally {
      loading = false; btn.disabled = false; $('loader').classList.add('hide');
      if (APP_CONFIG.autoRefreshMs) { clearTimeout(timer); timer = setTimeout(() => document.hidden ? loadData(false) : loadData(false), APP_CONFIG.autoRefreshMs); }
    }
  };

  function onData(d) {
    const errs = [];
    Object.keys(CONFIG).forEach(k => {
      const s = d.sheets[k] || { headers: [], rows: [] };
      // pre-compute string pencarian per baris (performa)
      s.rows.forEach(r => { r._s = s.headers.map(h => r[h]).join(' \u0001 ').toLowerCase(); });
      RAW[k] = s;
      Object.keys(numCache).forEach(x => { if (x.startsWith(k + '\u0001')) delete numCache[x]; });
      delete compCache[k];
      if (s.error) errs.push(s.name + ': ' + s.error);
      if (!state[k]) state[k] = newState();
      $('badge-' + k).textContent = fmt(s.rows.length);
      buildView(k);
      dirty[k] = true;
    });
    renderOverview();
    if (currentTab !== 'overview') renderView(currentTab);
    const t = d.generatedAt;
    $('syncInfo').textContent = 'Update ' + t.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    $('ftime').textContent = 'Terakhir sinkron: ' + t.toLocaleString('id-ID');
    if (errs.length) toast('Sebagian sheet gagal dimuat: ' + errs.join(' | '), true);
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
    // hancurkan chart lama milik tab ini (canvas akan dibuat ulang)
    Object.keys(charts).forEach(id => { if (id.startsWith(k + '-')) { try { charts[id].destroy(); } catch (e) {} delete charts[id]; } });
    const filters = cfg.filters.filter(f => data.headers.includes(f));
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeAllDropdowns(); closeModal(); } });

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
        return (numeric ? toNumber(x) - toNumber(y) : String(x).localeCompare(String(y), 'id', { numeric: true })) * d;
      });
    }
    return rows;
  }
  const numCache = {};
  function isNumericCol(k, c) {
    const key = k + '\u0001' + c;
    if (key in numCache) return numCache[key];
    let any = false;
    const ok = RAW[k].rows.every(r => { const v = r[c]; if (v === '') return true; any = true; return !isNaN(toNumber(v)); });
    return numCache[key] = ok && any;
  }
  function resetFilters(k) { const size = state[k].size; state[k] = newState(); state[k].size = size; $(k + '-search').value = ''; syncMsButtons(k); renderView(k); }
  function sortBy(k, c) { const s = state[k]; if (s.sort === c) s.dir *= -1; else { s.sort = c; s.dir = 1; } renderView(k); }

  /* ---------- render tab ---------- */
  function renderView(k) {
    if (!RAW[k] || RAW[k].error || !$(k + '-kpis')) return;
    dirty[k] = false;
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
      if (!headers.includes(c.key)) { const alt = altKey(headers, c.key); if (!alt) { noChart(k + '-' + c.id, c.key); return; } c.key = alt; }
      let e = count(rows, c.key).filter(x => x[0] !== '(kosong)');
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
    for (let i = 0; i < slice.length; i++) { const r = slice[i]; let t = `<tr class="clickable" data-i="${r._i}">`; for (let j = 0; j < headers.length; j++) { const h = headers[j]; t += j < nFreeze ? `<td class="fz${j === nFreeze - 1 ? ' fz-last' : ''}">${cell(k, h, r[h])}</td>` : `<td>${cell(k, h, r[h])}</td>`; } cells[i] = t + '</tr>'; }
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
    const idx = RAW[k].headers.findIndex(h => h.toLowerCase() === cfg.freezeUntil.toLowerCase());
    return idx < 0 ? 0 : idx + 1;
  }
  function applyFreeze(k) {
    const wrap = document.querySelector(`#view-${k} .tbl-wrap`); if (!wrap) return;
    const n = freezeCount(k), ths = wrap.querySelectorAll('thead th');
    wrap.classList.toggle('frozen', n > 0);
    if (!n) { wrap.querySelectorAll('.fz').forEach(el => { el.classList.remove('fz', 'fz-last'); el.style.left = ''; }); return; }
    // hitung offset kiri kumulatif dari lebar header
    const lefts = []; let acc = 0;
    for (let i = 0; i < n; i++) { lefts.push(acc); acc += ths[i] ? ths[i].getBoundingClientRect().width : 0; }
    wrap.querySelectorAll('tr').forEach(tr => {
      const cells = tr.children;
      for (let i = 0; i < n && i < cells.length; i++) { cells[i].classList.add('fz'); cells[i].classList.toggle('fz-last', i === n - 1); cells[i].style.left = lefts[i] + 'px'; }
    });
    wrap.style.setProperty('--fz-w', acc + 'px');
  }
  let rzT; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (currentTab !== 'overview') applyFreeze(currentTab); }, 150); });

  // cari nama kolom alternatif (case-insensitive / sinonim) jika header sheet berubah
  const SYN = { 'Divisi': ['Asal Mesin'], 'Asal Mesin': ['Divisi'], 'Komoditi': ['Wil', 'Wilayah', 'WILAYAH'], 'Wil': ['Wilayah', 'WILAYAH', 'Komoditi'] };
  function altKey(headers, key) {
    const low = headers.find(h => h.toLowerCase() === String(key).toLowerCase()); if (low) return low;
    return (SYN[key] || []).find(a => headers.includes(a)) || null;
  }
  function noChart(id, key) {
    const c = $(id); if (!c) return;
    if (charts[id]) { try { charts[id].destroy(); } catch (e) {} delete charts[id]; }
    const box = c.parentElement; box.innerHTML = `<div class="empty" style="padding:70px 10px 0;font-size:12.5px">Kolom "<b>${esc(key)}</b>" tidak ditemukan di sheet</div>`;
  }
  function componentCols(k) {
    if (compCache[k]) return compCache[k];
    const skip = new Set((APP_CONFIG.nonComponentCols[k] || []).map(s => s.toLowerCase()).concat(['kondisi', 'komponen bermasalah']));
    return compCache[k] = RAW[k].headers.filter(h => !skip.has(h.toLowerCase()));
  }
  function componentStats(k, rows) {
    const comp = componentCols(k), m = new Map();
    for (const r of rows) for (const h of comp) { const v = r[h]; if (v === 'B' || v === 'C' || v === 'b' || v === 'c') m.set(h, (m.get(h) || 0) + 1); }
    const e = [...m.entries()].sort((a, b) => b[1] - a[1]);
    return e.length ? e : [['Semua komponen kondisi A', 0]];
  }

  function cell(k, h, v) {
    if (v === '' || v == null) return '<span class="dash">—</span>';
    const cfg = CONFIG[k];
    if (cfg.numCols && cfg.numCols.includes(h)) { const n = toNumber(v); if (!isNaN(n)) return `<span class="num">${fmt(n, 2)}</span>`; }
    if (cfg.chips && cfg.chips[h]) return `<span class="chip ${cfg.chips[h](String(v))}">${esc(v)}</span>`;
    if ((k === 'mesin' || k === 'irrigator') && v.length === 1) { const sv = v.toUpperCase(); if (sv === 'A' || sv === 'B' || sv === 'C') return `<span class="cond cond-${sv}">${sv}</span>`; }
    return esc(v);
  }

  /* ---------- detail modal ---------- */
  function showDetail(k, i) {
    const r = RAW[k].rows.find(x => x._i === i); if (!r) return;
    const title = r['Kode Unit'] || r['KODE UNIT'] || r['Kode Engine'] || r['Kode Baru'] || CONFIG[k].title;
    $('modalTitle').textContent = CONFIG[k].icon + ' ' + title;
    $('modalBody').innerHTML = RAW[k].headers.map(h => `<div class="kv"><b>${esc(h)}</b>${cell(k, h, r[h])}</div>`).join('');
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
  function drawChart(id, type, entries, limit = 12, colorMap) {
    const ctx = $(id); if (!ctx || typeof Chart === 'undefined') return;
    entries = entries.slice(0, limit); const tc = themeColors();
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
      plugins: isPie ? [centerText] : [],
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 550, easing: 'easeOutQuart' },
        indexAxis: type === 'hbar' ? 'y' : 'x',
        cutout: isPie ? '64%' : undefined,
        layout: { padding: isPie ? 6 : 0 },
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
          x: { ticks: { color: tc.text, maxRotation: 45, autoSkip: true, precision: 0, font: { size: 11 } }, grid: { display: type === 'hbar', color: tc.grid }, border: { display: false } },
          y: { beginAtZero: true, ticks: { color: tc.text, precision: 0, font: { size: 11 } }, grid: { display: type !== 'hbar', color: tc.grid }, border: { display: false } }
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
      { l: 'Wilayah Aktif', v: uniq(d, 'Wil').length, i: '📍', c: '#38bdf8', t: 'detail' },
      { l: 'Total Sumber Air', v: fmt(s.length), i: '🌊', c: '#a78bfa', t: 'sumber' },
      { l: 'Lebung', v: fmt(s.filter(x => isTrue(x['Jenis Sumber Air'], /reservoir|lebung/i)).length), i: '🏞️', c: '#14b8a6', t: 'sumber' },
      { l: 'Deep Well', v: fmt(s.filter(x => isTrue(x['Jenis Sumber Air'], /deep|sumur/i)).length), i: '🕳️', c: '#f59e0b', t: 'sumber' },
      { l: 'Total Mesin', v: fmt(m.length), i: '⚙️', c: '#ec4899', t: 'mesin' },
      { l: 'Total Irrigator', v: fmt(ir.length), i: '💦', c: '#06b6d4', t: 'irrigator' },
      { l: 'Volume Air Real (m³)', v: fmt(sum(s, 'Volume Real Ukur (Overflow Terbuka)')), i: '📏', c: '#6366f1', t: 'sumber' },
    ];
    $('ov-kpis').innerHTML = k.map(x => `<div class="kpi link" style="--c:${x.c}" data-t="${x.t}" title="Buka tab"><div class="icon">${x.i}</div><div class="val">${x.v}</div><div class="lbl">${x.l}</div></div>`).join('');
    requestAnimationFrame(() => {
      const nz = a => a.filter(x => x[0] !== '(kosong)');
      drawChart('ov-c1', 'bar', nz(count(d, 'Wil')).sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'id', { numeric: true })));
      drawChart('ov-c2', 'doughnut', nz(count(d, 'Jenis Engine')));
      drawChart('ov-c3', 'doughnut', nz(count(s, 'Jenis Sumber Air')));
      drawChart('ov-c4', 'doughnut', nz(count(ir, 'Status')), 12, { Terpasang: '#22c55e', Rusak: '#ef4444' });
    });
    const wil = count(d, 'Wil').slice(0, 10), mx = wil[0]?.[1] || 1;
    $('ov-wil').innerHTML = wil.map(([w, n]) => `<li><b>${esc(w)}</b><div class="bar"><span style="width:${n / mx * 100}%"></span></div><span>${n} unit</span></li>`).join('') || '<li class="empty">Belum ada data</li>';
    const lbl = { A: 'Kondisi A — Baik', B: 'Kondisi B — Perlu Perhatian', C: 'Kondisi C — Perlu Perbaikan' };
    const li = (label, arr) => `<li class="sub"><b>${label}</b></li>` + count(arr, 'Kondisi').sort().map(([c, n]) => `<li><span class="chip ${c === 'A' ? 'chip-green' : c === 'B' ? 'chip-amber' : 'chip-red'}">${c}</span><span style="flex:1;margin-left:10px">${lbl[c] || c}</span><b>${n}</b></li>`).join('');
    $('ov-kondisi').innerHTML = li('⚙️ Mesin', m) + li('💦 Irrigator', ir);
  }
  $('ov-kpis').addEventListener('click', e => { const c = e.target.closest('[data-t]'); if (c) switchTab(c.dataset.t); });

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

  const h0 = location.hash.replace('#', '');
  loadData(false).then(() => switchTab(h0 || 'overview'));
})();
