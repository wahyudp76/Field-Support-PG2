/* =====================================================================
 *  Pindah Unit / Tarik ke Bengkel / Pasang Unit — tulis-balik unit di sheet "Detail Terpasang"
 *  Menulis lewat Apps Script Web App (lihat apps-script/Code.gs).
 *  Bergantung pada window.__FS yang diekspor app.js: { RAW, loadData, toast, esc, fmt, refreshRow }
 * ===================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const F = () => window.__FS || {};
  const LS_URL = 'fs_write_url', LS_PIN = 'fs_write_pin', LS_USER = 'fs_write_user';

  const apiUrl = () => (localStorage.getItem(LS_URL) || (APP_CONFIG.writeApi && APP_CONFIG.writeApi.url) || '').trim();
  const sumberCols = { kode: 'Kode Baru', wil: 'Wilayah', lok: 'Lokasi', dekat: 'Kedekatan Lokasi', jenis: 'Jenis Sumber Air', x: 'Koordinat X', y: 'Koordinat Y', vol: 'Volume Real Ukur (Overflow Terbuka)', status: 'Status', aktif: 'Keterangan (Aktif Irigasi/Tidak)', kondisi: 'Kondisi Sumur' };

  /* ---------- parsing kode lokasi: "303M", "109D1", "110 C F", "001A C 006C C1 G" ---------- */
  const parseLok = s => { const m = /^(\d{3})\s*([A-Z]\d*)?$/i.exec(String(s || '').trim().toUpperCase()); return m ? { num: m[1], sub: m[2] || '', code: m[1] + (m[2] || '') } : null; };
  function tokens(s) {
    const out = []; let num = null;
    for (const t of String(s || '').toUpperCase().replace(/[,;/]+/g, ' ').split(/\s+/)) {
      const m = /^(\d{3})([A-Z]\d*)?$/.exec(t);
      if (m) { num = m[1]; out.push({ num, sub: m[2] || '', code: num + (m[2] || '') }); }
      else if (/^[A-Z]\d*$/.test(t) && num) out.push({ num, sub: t, code: num + t });
    }
    return out;
  }
  const num = v => { const s = String(v ?? '').trim(); if (!s) return NaN; return /^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s) ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s.replace(',', '.')); };
  const wilToW = w => { const m = /^A?W?(\d{2})$/i.exec(String(w || '').trim()); return m ? 'W' + m[1] : null; };
  const dist = (a, b) => { const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180, s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };

  /* ---------- indeks sumber air (dibangun sekali per data) ---------- */
  let IDX = null, IDX_SRC = null;
  function index() {
    const S = F().RAW && F().RAW.sumber; if (!S || S.error) return null;
    if (IDX && IDX_SRC === S.rows) return IDX;
    const c = sumberCols, list = [];
    for (const r of S.rows) {
      const kode = String(r[c.kode] || '').trim(); if (!kode) continue;
      const lon = num(r[c.x]), lat = num(r[c.y]);
      const toks = tokens(r[c.lok]).concat(tokens(r[c.dekat]));
      list.push({ r, kode, wil: String(r[c.wil] || '').trim().toUpperCase(), lok: String(r[c.lok] || '').trim(), jenis: String(r[c.jenis] || '').trim(), vol: num(r[c.vol]), status: String(r[c.status] || '').trim(), aktif: String(r[c.aktif] || '').trim(), kondisi: String(r[c.kondisi] || '').trim(),
        pt: isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null, codes: new Set(toks.map(t => t.code)), nums: new Set(toks.map(t => t.num)) });
    }
    // centroid per nomor blok (untuk acuan jarak bila blok tujuan belum punya sumber air)
    const cent = {};
    for (const s of list) if (s.pt) for (const n of s.nums) { (cent[n] = cent[n] || []).push(s.pt); }
    Object.keys(cent).forEach(n => { const a = cent[n]; cent[n] = { lat: a.reduce((x, p) => x + p.lat, 0) / a.length, lon: a.reduce((x, p) => x + p.lon, 0) / a.length }; });
    IDX = { list, cent }; IDX_SRC = S.rows; return IDX;
  }

  /* ---------- Master Lokasi: kode lokasi → wilayah (Plantation code) ---------- */
  const MASTER_SHEET = 'Master Lokasi', LS_MASTER = 'fs_master_lokasi';
  let MASTER = null, masterP = null;
  function masterFromRows(rows) { const m = {}; rows.forEach(r => { const k = String(r.lok || '').trim().toUpperCase(), w = String(r.wil || '').trim().toUpperCase(); if (k && w && !m[k]) m[k] = w; }); return m; }
  function loadMaster() {
    if (MASTER) return Promise.resolve(MASTER);
    if (masterP) return masterP;
    try { const c = JSON.parse(localStorage.getItem(LS_MASTER) || 'null'); if (c && c.rows && Date.now() - c.at < 864e5) MASTER = masterFromRows(c.rows); } catch (e) { /* abaikan */ }
    masterP = fetch(APP_CONFIG.csvUrl(MASTER_SHEET)).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }).then(t => {
      const raw = (window.DataLayer && DataLayer.parseCSV) ? DataLayer.parseCSV(t) : t.split('\n').map(l => l.split(','));
      const h = (raw[0] || []).map(x => String(x || '').trim().toLowerCase());
      const iw = h.findIndex(x => /plantation|wil/.test(x)), il = h.findIndex(x => x === 'lokasi' || /^kode\s*lokasi/.test(x));
      if (iw < 0 || il < 0) throw new Error('Kolom "Plantation code"/"Lokasi" tidak ditemukan di sheet ' + MASTER_SHEET);
      const rows = raw.slice(1).map(r => ({ lok: r[il], wil: r[iw] })).filter(r => r.lok && r.wil);
      MASTER = masterFromRows(rows); try { localStorage.setItem(LS_MASTER, JSON.stringify({ at: Date.now(), rows })); } catch (e) { /* kuota */ }
      return MASTER;
    }).catch(e => { console.warn('Master Lokasi gagal dimuat', e); masterP = null; if (MASTER) return MASTER; throw e; });
    return MASTER ? Promise.resolve(MASTER) : masterP;
  }
  const masterWil = lok => { const m = MASTER || {}; const L = String(lok || '').trim().toUpperCase(); return m[L] || m[L.replace(/\s+/g, '')] || ''; };
  // sinkronkan select Wil dari Master Lokasi; tulis petunjuk di elemen hint
  function syncWil(lokId, wilId, hintId) {
    const lok = $(lokId).value.trim().toUpperCase(), el = $(hintId), sel = $(wilId); if (!el || !sel) return;
    if (!lok) { el.textContent = ''; el.className = 'edit-hint'; sel.disabled = false; return; }
    if (!MASTER) { el.textContent = '… memuat Master Lokasi'; el.className = 'edit-hint'; return; }
    const w = masterWil(lok);
    if (w) {
      if (![...sel.options].some(o => o.value === w)) sel.add(new Option(w, w));
      sel.value = w; el.textContent = '✓ Wil ' + w + ' (Master Lokasi)'; el.className = 'edit-hint';
    } else { el.textContent = '⚠ ' + lok + ' tidak ada di Master Lokasi — pilih Wil manual'; el.className = 'edit-hint warn'; }
  }
  const lokDatalist = id => `<datalist id="${id}">${Object.keys(MASTER || {}).sort().map(k => `<option value="${esc(k)}">${esc(MASTER[k])}</option>`).join('')}</datalist>`;

  /* ---------- rekomendasi sumber air untuk lokasi baru ---------- */
  function suggest(lokasi, wil, limit = 8) {
    const ix = index(); if (!ix) return { exact: [], near: [], note: 'Sheet Sumber Air belum termuat' };
    const L = parseLok(lokasi); if (!L) return { exact: [], near: [], note: 'Format lokasi belum dikenali (contoh: 303M, 109D1)' };
    const W = wilToW(wil);
    const exact = ix.list.filter(s => s.codes.has(L.code));
    const sameNum = ix.list.filter(s => !s.codes.has(L.code) && s.nums.has(L.num));
    // acuan titik: centroid blok tujuan; bila tidak ada → centroid blok bernomor terdekat di wilayah yang sama
    let ref = ix.cent[L.num], refNote = ref ? 'jarak dari blok ' + L.num : '';
    if (!ref) {
      const cands = Object.keys(ix.cent).filter(n => !W || ix.list.some(s => s.wil === W && s.nums.has(n))).map(n => ({ n, d: Math.abs(+n - +L.num) })).sort((a, b) => a.d - b.d);
      if (cands.length) { ref = ix.cent[cands[0].n]; refNote = 'acuan blok ' + cands[0].n + ' (blok ' + L.num + ' belum memiliki sumber air terdata)'; }
    }
    let pool = ix.list.filter(s => !s.codes.has(L.code) && !s.nums.has(L.num));
    if (W && pool.some(s => s.wil === W)) pool = pool.filter(s => s.wil === W);
    pool.forEach(s => { s._d = ref && s.pt ? dist(ref, s.pt) : NaN; s._dn = Math.min(...[...s.nums].map(n => Math.abs(+n - +L.num)), 999); });
    pool.sort((a, b) => (isNaN(a._d) ? 1 : 0) - (isNaN(b._d) ? 1 : 0) || (a._d - b._d) || (a._dn - b._dn));
    sameNum.forEach(s => { s._d = ref && s.pt ? dist(ref, s.pt) : NaN; }); sameNum.sort((a, b) => (isNaN(a._d) ? 1 : 0) - (isNaN(b._d) ? 1 : 0) || a._d - b._d);
    const near = sameNum.concat(pool).slice(0, limit);
    return { exact, near, note: refNote, ref };
  }

  /* ---------- UI ---------- */
  function ensureModal() {
    if ($('editModal')) return;
    const d = document.createElement('div'); d.className = 'modal-bg'; d.id = 'editModal';
    d.innerHTML = `<div class="modal edit-modal"><header><h3 id="editTitle">✏️ Pindah Unit</h3><button class="btn btn-outline" id="editClose">✕</button></header><div class="body edit-body" id="editBody"></div></div>`;
    document.body.appendChild(d);
    d.addEventListener('click', e => { if (e.target.id === 'editModal') close(); });
    $('editClose').onclick = close;
  }
  const close = () => { const m = $('editModal'); if (m) m.classList.remove('show'); };
  const esc = s => (F().esc || (x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))))(s);
  const fmt = n => (F().fmt || (x => x))(n);
  const toast = (m, e) => (F().toast || alert)(m, e);

  function open(rowIndex) {
    ensureModal();
    const D = F().RAW && F().RAW.detail; if (!D || D.error) return toast('Data Detail Terpasang belum siap', true);
    const r = D.rows.find(x => x._i === rowIndex); if (!r) return;
    if (!apiUrl()) return setup(() => open(rowIndex));
    const wils = [...new Set(D.rows.map(x => String(x['Wil'] || '').trim()).filter(Boolean))].sort();
    const jenis = [...new Set((F().RAW.sumber && !F().RAW.sumber.error ? F().RAW.sumber.rows : []).map(x => String(x[sumberCols.jenis] || '').trim()).filter(Boolean))].sort();
    const today = new Date(), iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    $('editTitle').textContent = '✏️ Pindah Unit — ' + (r['Kode Engine'] || r['Lokasi']);
    $('editBody').innerHTML = `
      <div class="edit-cur"><b>Posisi sekarang</b>
        <div class="edit-grid4"><div><span>Lokasi</span>${esc(r['Lokasi'])}</div><div><span>Wil</span>${esc(r['Wil'])}</div><div><span>Engine</span>${esc(r['Kode Engine'] || '–')}</div><div><span>Irigator</span>${esc(r['Kode Irigator'] || '–')}</div><div><span>Sumber Air</span>${esc(r['Sumber Air'] || '–')}</div><div><span>Kode Air</span>${esc(r['Kode Air'] || '–')}</div><div><span>Tanggal</span>${esc(r['Tanggal'] || '–')}</div><div><span>Baris sheet</span>${(r._row || r._i + 2)}</div></div>
        ${r['Keterangan'] ? `<div class="edit-ket">📝 ${esc(r['Keterangan'])}</div>` : ''}</div>
      <form id="editForm" class="edit-form" autocomplete="off">
        <label>Lokasi baru <input id="ed-lok" list="ed-lok-l" required placeholder="mis. 303M / 109D1 — Wil otomatis dari Master Lokasi" value="">${lokDatalist('ed-lok-l')}<small class="edit-hint" id="ed-lok-i"></small></label>
        <label>Wil <small class="edit-cnt" title="Diisi otomatis dari sheet Master Lokasi">auto</small><select id="ed-wil">${wils.map(w => `<option ${w === r['Wil'] ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label>
        <label>Tanggal pindah <input id="ed-tgl" type="date" value="${iso}"></label>
        <label>Sumber Air <select id="ed-sa"><option value="">(pilih / otomatis dari kode)</option>${jenis.map(j => `<option ${j === r['Sumber Air'] ? 'selected' : ''}>${esc(j)}</option>`).join('')}</select></label>
        <label>Kode Air <input id="ed-ka" placeholder="mis. LW08027 — atau pilih rekomendasi di bawah" value=""></label>
        <label class="wide">Keterangan (opsional) <input id="ed-ket" placeholder="alasan / catatan perpindahan"></label>
        <div class="wide edit-sug" id="ed-sug"><div class="empty">Ketik lokasi baru untuk melihat rekomendasi sumber air.</div></div>
        <label>PIN <input id="ed-pin" type="password" inputmode="numeric" placeholder="PIN" value="${esc(localStorage.getItem(LS_PIN) || '')}"></label>
        <label>Nama pengisi <input id="ed-user" placeholder="opsional" value="${esc(localStorage.getItem(LS_USER) || '')}"></label>
        <div class="wide edit-actions"><button type="button" class="btn btn-outline" id="ed-setup">⚙ Atur URL Web App</button><button type="button" class="btn btn-danger" id="ed-withdraw">🔧 Tarik ke Bengkel</button><span class="grow"></span><button type="button" class="btn btn-outline" id="ed-cancel">Batal</button><button type="submit" class="btn btn-primary" id="ed-save">💾 Simpan Perpindahan</button></div>
        <div class="wide edit-msg" id="ed-msg"></div>
      </form>`;
    $('editModal').classList.add('show');
    $('ed-cancel').onclick = close; $('ed-setup').onclick = () => setup(() => open(rowIndex)); $('ed-withdraw').onclick = () => withdraw(r);
    let t; const upd = () => { clearTimeout(t); t = setTimeout(() => renderSug(r), 180); };
    const wilSync = () => syncWil('ed-lok', 'ed-wil', 'ed-lok-i');
    $('ed-lok').oninput = () => { wilSync(); upd(); }; $('ed-wil').onchange = upd;
    loadMaster().then(() => { if (!$('ed-lok-l')) return; $('ed-lok-l').outerHTML = lokDatalist('ed-lok-l'); wilSync(); }).catch(() => {});
    $('ed-sug').onclick = e => { const b = e.target.closest('[data-kode]'); if (!b) return; $('ed-ka').value = b.dataset.kode; if (b.dataset.jenis) $('ed-sa').value = b.dataset.jenis; [...$('ed-sug').querySelectorAll('.sug')].forEach(x => x.classList.toggle('on', x === b)); };
    $('ed-ka').oninput = () => { const ix = index(); const s = ix && ix.list.find(x => x.kode === $('ed-ka').value.trim().toUpperCase()); if (s && s.jenis) $('ed-sa').value = s.jenis; };
    $('editForm').onsubmit = e => { e.preventDefault(); submit(r); };
    setTimeout(() => $('ed-lok').focus(), 50);
  }

  function card(s, tag) {
    const vol = isFinite(s.vol) ? fmt(Math.round(s.vol)) + ' m³' : 'vol. –';
    const d = isFinite(s._d) ? ' · ' + (s._d < 1 ? Math.round(s._d * 1000) + ' m' : s._d.toFixed(1) + ' km') : '';
    const st = [s.status, s.aktif, s.kondisi].filter(Boolean).join(' · ');
    return `<button type="button" class="sug" data-kode="${esc(s.kode)}" data-jenis="${esc(s.jenis)}"><b>${esc(s.kode)}</b> <em>${esc(tag)}${d}</em><div>${esc(s.jenis)} · ${esc(s.wil)} · blok ${esc(s.lok)}</div><small>${vol}${st ? ' · ' + esc(st) : ''}</small></button>`;
  }
  function renderSug(r) {
    const lok = $('ed-lok').value.trim().toUpperCase(), wil = $('ed-wil').value, box = $('ed-sug');
    if (!lok) { box.innerHTML = '<div class="empty">Ketik lokasi baru untuk melihat rekomendasi sumber air.</div>'; return; }
    const g = suggest(lok, wil);
    let h = '';
    if (g.exact.length) h += `<div class="sug-h">✅ Sumber air yang melayani blok <b>${esc(lok)}</b> <span>— rumus Kode Air di sheet akan tetap dipakai (otomatis)</span></div><div class="sug-row">${g.exact.map(s => card(s, 'sesuai lokasi')).join('')}</div>`;
    else h += `<div class="sug-h">ℹ️ Belum ada sumber air berkode untuk blok <b>${esc(lok)}</b> di sheet Sumber Air — pilih yang terdekat <span>(ditulis sebagai teks, tanpa rumus)</span>:</div>`;
    if (g.near.length) h += `<div class="sug-h sub">📍 Terdekat${g.note ? ' <span>(' + esc(g.note) + ')</span>' : ''}</div><div class="sug-row">${g.near.map(s => card(s, s.nums.has(parseLok(lok).num) ? 'blok sama' : 'terdekat')).join('')}</div>`;
    if (!g.exact.length && !g.near.length) h += `<div class="empty">${esc(g.note || 'Tidak ada kandidat')}</div>`;
    const used = (F().RAW.detail.rows || []).filter(x => (!r || x !== r) && x['Lokasi'] === lok);
    if (used.length) h = `<div class="sug-warn">⚠️ Lokasi ${esc(lok)} sudah dipakai unit lain: ${used.map(x => esc(x['Kode Engine'] || ('baris ' + ((x._row || x._i + 2))))).join(', ')}</div>` + h;
    box.innerHTML = h;
  }

  async function post(body) {
    const url = apiUrl(); if (!url) throw new Error('URL Web App belum diatur');
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow', signal: ctrl.signal });
      const txt = await res.text(); let j; try { j = JSON.parse(txt); } catch { throw new Error('Respons bukan JSON — pastikan deployment Web App "Who has access: Anyone" dan URL berakhiran /exec'); }
      return j;
    } finally { clearTimeout(to); }
  }

  async function submit(r) {
    const lok = $('ed-lok').value.trim().toUpperCase(), pin = $('ed-pin').value.trim(), msg = $('ed-msg'), btn = $('ed-save');
    if (!parseLok(lok)) { msg.textContent = 'Format lokasi tidak dikenali (contoh 303M, 109D1).'; msg.className = 'wide edit-msg err'; return; }
    if (!pin) { msg.textContent = 'PIN wajib diisi.'; msg.className = 'wide edit-msg err'; return; }
    const ka = $('ed-ka').value.trim().toUpperCase(), ix = index();
    if (ka && ix && !ix.list.some(s => s.kode === ka) && !confirm('Kode Air "' + ka + '" tidak ada di sheet Sumber Air. Tetap simpan?')) return;
    if (!ka && !confirm('Kode Air kosong — unit akan tercatat tanpa sumber air. Lanjutkan?')) return;
    const body = { action: 'move', pin, user: $('ed-user').value.trim(), row: (r._row || r._i + 2),
      from: { lokasi: r['Lokasi'] || '', kodeEngine: r['Kode Engine'] || '', kodeIrigator: r['Kode Irigator'] || '' },
      to: { lokasi: lok, wil: $('ed-wil').value, tanggal: $('ed-tgl').value, sumberAir: $('ed-sa').value, kodeAir: ka, keterangan: $('ed-ket').value.trim() } };
    btn.disabled = true; msg.className = 'wide edit-msg'; msg.textContent = 'Menyimpan ke spreadsheet…';
    try {
      const j = await post(body);
      if (!j.ok) { if (j.code === 'PIN') localStorage.removeItem(LS_PIN); throw new Error(j.error || 'Gagal'); }
      localStorage.setItem(LS_PIN, pin); localStorage.setItem(LS_USER, $('ed-user').value.trim());
      // perbarui tampilan lokal segera, lalu sinkron ulang dari sheet
      const kaFinal = j.kodeAir !== undefined ? j.kodeAir : ka, saFinal = j.sumberAir !== undefined && j.sumberAir !== '' ? j.sumberAir : ($('ed-sa').value || r['Sumber Air']);
      Object.assign(r, { Lokasi: lok, Wil: $('ed-wil').value, 'Sumber Air': saFinal, 'Kode Air': kaFinal, Tanggal: $('ed-tgl').value || r['Tanggal'], Keterangan: j.keterangan || r['Keterangan'] });
      if (F().refreshRow) F().refreshRow('detail', r);
      const how = j.kodeAirMode === 'formula' ? 'Kode Air ' + kaFinal + ' dari rumus sheet' + (ka && ka !== kaFinal ? ' (pilihan ' + ka + ' tidak dipakai karena lokasi sudah punya sumber air)' : '') : j.kodeAirMode === 'value' ? 'Kode Air ' + kaFinal + ' ditulis sebagai teks (lokasi belum punya sumber air di sheet)' : j.kodeAirMode ? 'Kode Air kosong' : '';
      msg.className = 'wide edit-msg ok'; msg.textContent = '✔ Tersimpan di baris ' + j.row + (how ? ' · ' + how : '') + '. Menyinkronkan ulang…';
      toast('Unit ' + (r['Kode Engine'] || '') + ' dipindah ke ' + lok + ' ✔');
      setTimeout(() => { close(); F().loadData && F().loadData(false); }, 1200);
    } catch (e) {
      msg.className = 'wide edit-msg err'; msg.textContent = '✖ ' + (e.name === 'AbortError' ? 'Waktu habis (30 dtk) — periksa koneksi / URL Web App' : e.message);
    } finally { btn.disabled = false; }
  }

  /* ---------- tarik ke bengkel: hapus baris unit di sheet ---------- */
  function withdraw(r) {
    const stOpts = ['', 'Standby', 'Rusak', 'Perbaikan'];
    $('editTitle').textContent = '🔧 Tarik ke Bengkel — ' + (r['Kode Engine'] || r['Lokasi']);
    $('editBody').innerHTML = `
      <div class="edit-cur"><b>Unit yang ditarik</b>
        <div class="edit-grid4"><div><span>Lokasi</span>${esc(r['Lokasi'])}</div><div><span>Wil</span>${esc(r['Wil'])}</div><div><span>Engine</span>${esc(r['Kode Engine'] || '–')}</div><div><span>Irigator</span>${esc(r['Kode Irigator'] || '–')}</div><div><span>Kode Air</span>${esc(r['Kode Air'] || '–')}</div><div><span>Baris sheet</span>${(r._row || r._i + 2)}</div></div></div>
      <div class="sug-warn">⚠️ Baris unit ini akan <b>DIHAPUS</b> dari sheet <b>Detail Terpasang</b> (tidak bisa dibatalkan dari dashboard). Riwayatnya tetap tercatat di sheet <b>Log Perpindahan</b>.</div>
      <form id="wdForm" class="edit-form" autocomplete="off">
        <label>Status baru di sheet Mesin ${r['Kode Engine'] ? '(' + esc(r['Kode Engine']) + ')' : ''}<select id="wd-sm" ${r['Kode Engine'] ? '' : 'disabled'}>${stOpts.map(o => `<option value="${o}" ${o === 'Standby' && r['Kode Engine'] ? 'selected' : ''}>${o || '(tidak diubah)'}</option>`).join('')}</select></label>
        <label>Status baru di sheet Irrigator ${r['Kode Irigator'] ? '(' + esc(r['Kode Irigator']) + ')' : ''}<select id="wd-si" ${r['Kode Irigator'] ? '' : 'disabled'}>${stOpts.map(o => `<option value="${o}" ${o === 'Standby' && r['Kode Irigator'] ? 'selected' : ''}>${o || '(tidak diubah)'}</option>`).join('')}</select></label>
        <label class="wide">Alasan / keterangan <input id="wd-ket" placeholder="mis. overhaul, ganti pompa, musim selesai"></label>
        <label>PIN <input id="wd-pin" type="password" inputmode="numeric" placeholder="PIN" value="${esc(localStorage.getItem(LS_PIN) || '')}"></label>
        <label>Nama pengisi <input id="wd-user" placeholder="opsional" value="${esc(localStorage.getItem(LS_USER) || '')}"></label>
        <label class="wide chk"><input type="checkbox" id="wd-ok"> Saya yakin ingin menghapus baris unit <b>${esc(r['Kode Engine'] || r['Lokasi'])}</b> di lokasi <b>${esc(r['Lokasi'])}</b></label>
        <div class="wide edit-actions"><button type="button" class="btn btn-outline" id="wd-back">← Kembali</button><span class="grow"></span><button type="button" class="btn btn-outline" id="wd-cancel">Batal</button><button type="submit" class="btn btn-danger" id="wd-save" disabled>🔧 Tarik ke Bengkel & Hapus Baris</button></div>
        <div class="wide edit-msg" id="wd-msg"></div>
      </form>`;
    $('wd-back').onclick = () => open(r._i); $('wd-cancel').onclick = close;
    $('wd-ok').onchange = () => { $('wd-save').disabled = !$('wd-ok').checked; };
    $('wdForm').onsubmit = async e => {
      e.preventDefault();
      const pin = $('wd-pin').value.trim(), msg = $('wd-msg'), btn = $('wd-save');
      if (!pin) { msg.textContent = 'PIN wajib diisi.'; msg.className = 'wide edit-msg err'; return; }
      btn.disabled = true; msg.className = 'wide edit-msg'; msg.textContent = 'Menghapus baris di spreadsheet…';
      try {
        const j = await post({ action: 'withdraw', pin, user: $('wd-user').value.trim(), row: (r._row || r._i + 2), from: { lokasi: r['Lokasi'] || '', kodeEngine: r['Kode Engine'] || '', kodeIrigator: r['Kode Irigator'] || '' },
          statusMesin: $('wd-sm').value, statusIrrigator: $('wd-si').value, keterangan: $('wd-ket').value.trim() });
        if (!j.ok) { if (j.code === 'PIN') localStorage.removeItem(LS_PIN); throw new Error(j.error || 'Gagal'); }
        localStorage.setItem(LS_PIN, pin); localStorage.setItem(LS_USER, $('wd-user').value.trim());
        if (F().removeRow) F().removeRow('detail', r);
        const st = [j.status && j.status.mesin ? 'Mesin → ' + j.status.mesin : '', j.status && j.status.irrigator ? 'Irrigator → ' + j.status.irrigator : ''].filter(Boolean).join(', ');
        msg.className = 'wide edit-msg ok'; msg.textContent = '✔ Baris ' + j.row + ' dihapus' + (st ? ' · ' + st : '') + (j.noFixed ? ' · rumus kolom No diperbaiki (' + j.noFixed + ' sel)' : '') + '. Menyinkronkan ulang…';
        toast('Unit ' + (r['Kode Engine'] || r['Lokasi']) + ' ditarik ke bengkel ✔');
        setTimeout(() => { close(); F().loadData && F().loadData(false); }, 1200);
      } catch (err) {
        msg.className = 'wide edit-msg err'; msg.textContent = '✖ ' + (err.name === 'AbortError' ? 'Waktu habis (30 dtk) — periksa koneksi / URL Web App' : err.message); btn.disabled = false;
      }
    };
  }

  /* ---------- pasang unit baru: sisipkan baris di wilayah yang sesuai ---------- */
  function install() {
    ensureModal();
    const D = F().RAW && F().RAW.detail; if (!D || D.error) return toast('Data Detail Terpasang belum siap', true);
    if (!apiUrl()) return setup(() => install());
    const R = F().RAW, mesin = R.mesin && !R.mesin.error ? R.mesin.rows : [], irr = R.irrigator && !R.irrigator.error ? R.irrigator.rows : [];
    const usedE = new Set(D.rows.map(x => String(x['Kode Engine'] || '').trim().toUpperCase()).filter(Boolean)), usedI = new Set(D.rows.map(x => String(x['Kode Irigator'] || '').trim().toUpperCase()).filter(Boolean));
    const wils = [...new Set(D.rows.map(x => String(x['Wil'] || '').trim()).concat(Object.values(MASTER || {})).filter(Boolean))].sort();
    const bCnt = {}; D.rows.forEach(x => { const b = String(x['Bengkel'] || '').trim(); if (b) bCnt[b] = (bCnt[b] || 0) + 1; }); const bkl = Object.keys(bCnt).sort((a, b) => bCnt[b] - bCnt[a]);
    const jenis = [...new Set((R.sumber && !R.sumber.error ? R.sumber.rows : []).map(x => String(x[sumberCols.jenis] || '').trim()).filter(Boolean))].sort();
    const today = new Date(), iso = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const optE = mesin.map(x => ({ k: String(x['Kode Unit'] || '').trim().toUpperCase(), st: String(x['Status'] || '').trim(), p: x['Power'] || '', sp: x['Spec'] || '', asal: String(x['Asal Mesin'] || '').trim() })).filter(x => x.k)
      .sort((a, b) => a.k.localeCompare(b.k));
    const optI = irr.map(x => ({ k: String(x['KODE UNIT'] || '').trim().toUpperCase(), st: String(x['Status'] || '').trim(), w: String(x['WILAYAH'] || '').trim() })).filter(x => x.k).sort((a, b) => a.k.localeCompare(b.k));
    // daftar pilihan: hanya unit berstatus Standby (di sheet Mesin / Irrigator) dan belum tercatat terpasang
    const isStandby = st => /^standby$/i.test(st);
    const listE = optE.filter(x => isStandby(x.st) && !usedE.has(x.k)), listI = optI.filter(x => isStandby(x.st) && !usedI.has(x.k));
    const stOpts = ['Terpasang', ''];
    $('editTitle').textContent = '➕ Pasang Unit Irigasi (baris baru)';
    $('editBody').innerHTML = `
      <div class="edit-cur"><b>Baris baru akan disisipkan di sheet <i>Detail Terpasang</i> tepat di bawah baris terakhir wilayah yang dipilih.</b>
        <div class="edit-ket">Kolom <b>No, Jenis Engine, Terpasang, Power, Sumber Air, Kode Air</b> otomatis meniru rumus kolom yang sudah ada; bila kolom tidak berumus (atau rumusnya kosong) dipakai nilai usulan di bawah.</div></div>
      <form id="insForm" class="edit-form" autocomplete="off">
        <label>Tanggal pasang <input id="in-tgl" type="date" value="${iso}" required></label>
        <label>Bengkel <small class="edit-cnt" title="Diisi otomatis dari kolom Asal Mesin engine yang dipilih">auto</small><input id="in-bkl" list="in-bkl-l" placeholder="otomatis dari Asal Mesin engine" required value="${esc(bkl[0] || '')}"><datalist id="in-bkl-l">${bkl.map(b => `<option value="${esc(b)}">`).join('')}</datalist><small class="edit-hint" id="in-bkl-i"></small></label>
        <label>Lokasi <input id="ed-lok" list="in-lok-l" required placeholder="mis. 303M / 109D1 — Wil otomatis dari Master Lokasi">${lokDatalist('in-lok-l')}<small class="edit-hint" id="in-lok-i"></small></label>
        <label>Wil <small class="edit-cnt" title="Diisi otomatis dari sheet Master Lokasi">auto</small><select id="ed-wil">${wils.map(w => `<option>${esc(w)}</option>`).join('')}</select></label>
        <label>Kode Engine <span class="edit-cnt">${listE.length} standby</span><select id="in-eng"><option value="">— tanpa engine —</option>${listE.map(x => `<option value="${esc(x.k)}">${esc(x.k + (x.p ? ' · ' + x.p + ' HP' : '') + (x.sp ? ' · ' + x.sp : '') + (x.asal ? ' · ' + x.asal : ''))}</option>`).join('')}<option value="__m">✏️ Ketik kode lain…</option></select><input id="in-eng-m" placeholder="ketik kode engine" style="display:none;margin-top:6px"><small id="in-eng-i" class="edit-hint"></small></label>
        <label>Kode Irigator <span class="edit-cnt">${listI.length} standby</span><select id="in-irr"><option value="">— tanpa irigator (drip) —</option>${listI.map(x => `<option value="${esc(x.k)}">${esc(x.k + (x.w ? ' · ' + x.w : ''))}</option>`).join('')}<option value="__m">✏️ Ketik kode lain…</option></select><input id="in-irr-m" placeholder="ketik kode irigator" style="display:none;margin-top:6px"><small id="in-irr-i" class="edit-hint"></small></label>
        <label>Sumber Air <select id="ed-sa"><option value="">(pilih / otomatis dari kode)</option>${jenis.map(j => `<option>${esc(j)}</option>`).join('')}</select></label>
        <label>Kode Air <input id="ed-ka" placeholder="pilih rekomendasi di bawah"></label>
        <label class="wide">Keterangan (opsional) <input id="in-ket" placeholder="catatan pemasangan"></label>
        <div class="wide edit-sug" id="ed-sug"><div class="empty">Ketik lokasi untuk melihat rekomendasi sumber air.</div></div>
        <label>Status di sheet Mesin <select id="in-sm">${stOpts.map(o => `<option value="${o}">${o || '(tidak diubah)'}</option>`).join('')}</select></label>
        <label>Status di sheet Irrigator <select id="in-si">${stOpts.map(o => `<option value="${o}">${o || '(tidak diubah)'}</option>`).join('')}</select></label>
        <label>PIN <input id="in-pin" type="password" inputmode="numeric" placeholder="PIN" value="${esc(localStorage.getItem(LS_PIN) || '')}"></label>
        <label>Nama pengisi <input id="in-user" placeholder="opsional" value="${esc(localStorage.getItem(LS_USER) || '')}"></label>
        <div class="wide edit-actions"><button type="button" class="btn btn-outline" id="in-setup">⚙ Atur URL Web App</button><span class="grow"></span><button type="button" class="btn btn-outline" id="in-cancel">Batal</button><button type="submit" class="btn btn-primary" id="in-save">➕ Pasang & Tambah Baris</button></div>
        <div class="wide edit-msg" id="in-msg"></div>
      </form>`;
    $('editModal').classList.add('show');
    $('in-cancel').onclick = close; $('in-setup').onclick = () => setup(() => install());
    let t; const upd = () => { clearTimeout(t); t = setTimeout(() => renderSug(null), 180); };
    const wilSync = () => syncWil('ed-lok', 'ed-wil', 'in-lok-i');
    $('ed-lok').oninput = () => { wilSync(); upd(); }; $('ed-wil').onchange = upd;
    loadMaster().then(() => { if (!$('in-lok-l')) return; $('in-lok-l').outerHTML = lokDatalist('in-lok-l'); wilSync(); upd(); }).catch(() => { if ($('in-lok-i')) { $('in-lok-i').textContent = '⚠ Master Lokasi tidak termuat — pilih Wil manual'; $('in-lok-i').className = 'edit-hint warn'; } });
    $('ed-sug').onclick = e => { const b = e.target.closest('[data-kode]'); if (!b) return; $('ed-ka').value = b.dataset.kode; if (b.dataset.jenis) $('ed-sa').value = b.dataset.jenis; [...$('ed-sug').querySelectorAll('.sug')].forEach(x => x.classList.toggle('on', x === b)); };
    $('ed-ka').oninput = () => { const ix = index(); const s = ix && ix.list.find(x => x.kode === $('ed-ka').value.trim().toUpperCase()); if (s && s.jenis) $('ed-sa').value = s.jenis; };
    const pick = (selId, inpId) => { const sel = $(selId), inp = $(inpId); inp.style.display = sel.value === '__m' ? '' : 'none'; return (sel.value === '__m' ? inp.value : sel.value).trim().toUpperCase(); };
    const engVal = () => pick('in-eng', 'in-eng-m'), irrVal = () => pick('in-irr', 'in-irr-m');
    const engInfo = () => { const k = engVal(), m = optE.find(x => x.k === k), el = $('in-eng-i'); el.textContent = !k ? '' : !m ? '⚠ kode tidak ada di sheet Mesin' : (usedE.has(k) ? '⚠ sudah terpasang di ' + (D.rows.find(x => String(x['Kode Engine']).toUpperCase() === k) || {})['Lokasi'] : !isStandby(m.st) ? '⚠ status di sheet Mesin: ' + (m.st || 'kosong') + ' (bukan Standby)' : '✓ Standby' + (m.p ? ' · Power ' + m.p : '') + ' · Jenis ' + k.replace(/\d+$/, '')); el.className = 'edit-hint' + (el.textContent.startsWith('⚠') ? ' warn' : ''); };
    const irrInfo = () => { const k = irrVal(), m = optI.find(x => x.k === k), el = $('in-irr-i'); el.textContent = !k ? '' : !m ? '⚠ kode tidak ada di sheet Irrigator' : (usedI.has(k) ? '⚠ sudah terpasang di ' + (D.rows.find(x => String(x['Kode Irigator']).toUpperCase() === k) || {})['Lokasi'] : !isStandby(m.st) ? '⚠ status di sheet Irrigator: ' + (m.st || 'kosong') + ' (bukan Standby)' : '✓ Standby'); el.className = 'edit-hint' + (el.textContent.startsWith('⚠') ? ' warn' : ''); };
    // Bengkel/wilayah asal mengikuti kolom "Asal Mesin" engine yang dipilih (bisa ditimpa manual)
    const bklSync = () => { const m = optE.find(x => x.k === engVal()), el = $('in-bkl-i'); if (m && m.asal) { $('in-bkl').value = m.asal; el.textContent = '✓ Bengkel ' + m.asal + ' (Asal Mesin ' + m.k + ')'; el.className = 'edit-hint'; } else if (engVal() && !m) { el.textContent = '⚠ Asal Mesin tidak diketahui — isi Bengkel manual'; el.className = 'edit-hint warn'; } else if (!engVal()) { el.textContent = ''; } };
    $('in-eng').onchange = () => { engInfo(); bklSync(); if ($('in-eng').value === '__m') $('in-eng-m').focus(); }; $('in-eng-m').oninput = () => { engInfo(); bklSync(); };
    $('in-bkl').oninput = () => { const el = $('in-bkl-i'); if (el.textContent.startsWith('✓')) { el.textContent = 'diubah manual'; el.className = 'edit-hint'; } };
    $('in-irr').onchange = () => { irrInfo(); if ($('in-irr').value === '__m') $('in-irr-m').focus(); }; $('in-irr-m').oninput = irrInfo;
    $('insForm').onsubmit = async e => {
      e.preventDefault();
      const lok = $('ed-lok').value.trim().toUpperCase(), wil = $('ed-wil').value, eng = engVal(), ir = irrVal(), pin = $('in-pin').value.trim(), ka = $('ed-ka').value.trim().toUpperCase(), msg = $('in-msg'), btn = $('in-save');
      const err = m => { msg.textContent = m; msg.className = 'wide edit-msg err'; };
      if (!parseLok(lok)) return err('Format lokasi tidak dikenali (contoh 303M, 109D1).');
      if (!eng && !ir) return err('Isi minimal Kode Engine atau Kode Irigator.');
      if (!pin) return err('PIN wajib diisi.');
      if (usedE.has(eng) || usedI.has(ir)) return err('Unit tersebut masih tercatat terpasang di lokasi lain — gunakan Pindah Unit atau Tarik ke Bengkel dulu.');
      const mE = optE.find(x => x.k === eng);
      if (eng && !mE && !confirm('Kode Engine "' + eng + '" tidak ada di sheet Mesin. Tetap simpan?')) return;
      if (mE && !isStandby(mE.st) && !confirm('Kode Engine ' + eng + ' berstatus "' + (mE.st || 'kosong') + '" (bukan Standby) di sheet Mesin. Tetap pasang?')) return;
      const mI = optI.find(x => x.k === ir);
      if (mI && !isStandby(mI.st) && !confirm('Kode Irigator ' + ir + ' berstatus "' + (mI.st || 'kosong') + '" (bukan Standby) di sheet Irrigator. Tetap pasang?')) return;
      if (ir && !optI.some(x => x.k === ir) && !confirm('Kode Irigator "' + ir + '" tidak ada di sheet Irrigator. Tetap simpan?')) return;
      if (D.rows.some(x => x['Lokasi'] === lok) && !confirm('Lokasi ' + lok + ' sudah dipakai unit lain. Tetap tambahkan?')) return;
      if (!ka && !confirm('Kode Air kosong — bila rumus sheet tidak menemukan sumber air, kolom akan kosong. Lanjutkan?')) return;
      const body = { action: 'install', pin, user: $('in-user').value.trim(),
        manual: { tanggal: $('in-tgl').value, bengkel: $('in-bkl').value.trim(), lokasi: lok, wil, kodeEngine: eng, kodeIrigator: ir, keterangan: $('in-ket').value.trim() },
        values: { 'Jenis Engine': eng ? eng.replace(/\d+$/, '') : '', 'Terpasang': 'Terpasang', 'Power': mE ? String(mE.p || '') : '', 'Sumber Air': $('ed-sa').value, 'Kode Air': ka },
        statusMesin: eng ? $('in-sm').value : '', statusIrrigator: ir ? $('in-si').value : '' };
      btn.disabled = true; msg.className = 'wide edit-msg'; msg.textContent = 'Menambah baris di spreadsheet…';
      try {
        const j = await post(body);
        if (!j.ok) { if (j.code === 'PIN') localStorage.removeItem(LS_PIN); throw new Error(j.error || 'Gagal'); }
        localStorage.setItem(LS_PIN, pin); localStorage.setItem(LS_USER, $('in-user').value.trim());
        const md = j.modes || {}, rumus = Object.keys(md).filter(h => md[h] === 'formula'), teks = Object.keys(md).filter(h => md[h] === 'value');
        const st = [j.status && j.status.mesin ? 'Mesin → ' + j.status.mesin : '', j.status && j.status.irrigator ? 'Irrigator → ' + j.status.irrigator : ''].filter(Boolean).join(', ');
        msg.className = 'wide edit-msg ok';
        msg.textContent = '✔ Baris ' + j.row + ' ditambahkan' + (j.placed === 'wil' ? ' (di bawah baris terakhir ' + wil + ')' : ' (di akhir sheet — wilayah ' + wil + ' belum ada)') + (rumus.length ? ' · rumus: ' + rumus.join(', ') : '') + (teks.length ? ' · teks: ' + teks.join(', ') : '') + (st ? ' · ' + st : '') + '. Menyinkronkan ulang…';
        toast('Unit ' + (eng || ir) + ' dipasang di ' + lok + ' ✔');
        setTimeout(() => { close(); F().loadData && F().loadData(false); }, 1800);
      } catch (ex) {
        msg.className = 'wide edit-msg err'; msg.textContent = '✖ ' + (ex.name === 'AbortError' ? 'Waktu habis (30 dtk) — periksa koneksi / URL Web App' : ex.message); btn.disabled = false;
      }
    };
    setTimeout(() => $('ed-lok').focus(), 50);
  }

  /* ---------- pompa sumur bor: pindah / ubah kondisi kolom "Pompa" di sheet Sumber Air ---------- */
  const POMPA = ['Ada Pompa', 'Kosong', 'Rusak'];
  const isDW = r => /deep|sumur|bor/i.test(String(r[sumberCols.jenis] || ''));
  function wellLabel(r) { return r['Kode Baru'] + ' · ' + String(r['Lokasi'] || '').trim() + ' · ' + String(r['Wilayah'] || '').trim() + (r['Pompa'] ? ' · ' + r['Pompa'] : ' · (Pompa belum diisi)'); }
  function pump(kode) {
    ensureModal();
    const S = F().RAW && F().RAW.sumber; if (!S || S.error) return toast('Data Sumber Air belum siap', true);
    if (!apiUrl()) return setup(() => pump(kode));
    if (!S.headers.includes('Pompa')) return toast('Kolom "Pompa" tidak ada di sheet Sumber Air', true);
    const wells = S.rows.filter(isDW).sort((a, b) => String(a['Kode Baru']).localeCompare(String(b['Kode Baru'])));
    const wilsAll = [...new Set(wells.map(r => String(r['Wilayah'] || '').trim()).filter(Boolean))].sort();
    const sel = wells.find(r => r['Kode Baru'] === kode);
    const withPump = wells.filter(r => /ada/i.test(r['Pompa'] || '')), noPump = wells.filter(r => !/ada/i.test(r['Pompa'] || ''));
    const cnt = { ada: withPump.length, kosong: wells.filter(r => /kosong/i.test(r['Pompa'] || '')).length, rusak: wells.filter(r => /rusak/i.test(r['Pompa'] || '')).length, blank: wells.filter(r => !r['Pompa']).length };
    const opt = (list, cur) => list.map(r => `<option value="${esc(r['Kode Baru'])}" ${r['Kode Baru'] === cur ? 'selected' : ''}>${esc(wellLabel(r))}</option>`).join('');
    const defFrom = sel && /ada/i.test(sel['Pompa'] || '') ? sel['Kode Baru'] : '', defTo = sel && !/ada/i.test(sel['Pompa'] || '') ? sel['Kode Baru'] : '';
    $('editTitle').textContent = '🔄 Pindah Pompa Sumur Bor';
    $('editBody').innerHTML = `
      <div class="edit-cur"><b>Ketersediaan pompa sumur bor</b>
        <div class="edit-grid4"><div><span>Ada Pompa</span>${cnt.ada}</div><div><span>Kosong</span>${cnt.kosong}</div><div><span>Rusak</span>${cnt.rusak}</div><div><span>Belum diisi</span>${cnt.blank}</div></div>
        <div class="edit-ket">Perubahan langsung ditulis ke kolom <b>Pompa</b> sheet <b>Sumber Air</b> (nilai: Ada Pompa / Kosong / Rusak) dan dicatat di sheet <b>Log Pompa Sumur</b>. Kolom Status/Update tidak disentuh.</div></div>
      <div class="edit-tabs"><button type="button" class="btn ${defTo && !defFrom ? 'btn-outline' : 'btn-primary'}" id="pp-mode-move">🔄 Pindah pompa antar sumur</button><button type="button" class="btn ${defTo && !defFrom ? 'btn-primary' : 'btn-outline'}" id="pp-mode-set">✏️ Ubah kondisi pompa satu sumur</button></div>
      <form id="ppForm" class="edit-form" autocomplete="off">
        <label class="wide">Filter wilayah <select id="pp-wil"><option value="">Semua wilayah</option>${wilsAll.map(w => `<option ${sel && w === String(sel['Wilayah']).trim() ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label>
        <div class="wide pp-move">
          <label>Sumur asal (pompa diambil) <select id="pp-from" required><option value="">— pilih sumur yang ada pompanya —</option>${opt(withPump, defFrom)}</select><small class="edit-hint" id="pp-from-i"></small></label>
          <label>Sumur tujuan (pompa dipasang) <select id="pp-to" required><option value="">— pilih sumur kosong / rusak —</option>${opt(noPump, defTo)}</select><small class="edit-hint" id="pp-to-i"></small></label>
          <label>Kondisi sumur asal setelah pompa diambil <select id="pp-from-val"><option>Kosong</option><option>Rusak</option></select></label>
        </div>
        <div class="wide pp-set" style="display:none">
          <label>Sumur <select id="pp-one"><option value="">— pilih sumur —</option>${opt(wells, sel ? sel['Kode Baru'] : '')}</select><small class="edit-hint" id="pp-one-i"></small></label>
          <label>Kondisi pompa baru <select id="pp-one-val">${POMPA.map(v => `<option ${sel && v === sel['Pompa'] ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        </div>
        <label class="wide">Keterangan (opsional) <input id="pp-ket" placeholder="mis. pompa dipindah karena sumur asal non irigasi"></label>
        <label>PIN <input id="pp-pin" type="password" inputmode="numeric" placeholder="PIN" value="${esc(localStorage.getItem(LS_PIN) || '')}"></label>
        <label>Nama pengisi <input id="pp-user" placeholder="opsional" value="${esc(localStorage.getItem(LS_USER) || '')}"></label>
        <div class="wide edit-actions"><button type="button" class="btn btn-outline" id="pp-setup">⚙ Atur URL Web App</button><span class="grow"></span><button type="button" class="btn btn-outline" id="pp-cancel">Batal</button><button type="submit" class="btn btn-primary" id="pp-save">💾 Simpan ke Sheet</button></div>
        <div class="wide edit-msg" id="pp-msg"></div>
      </form>`;
    $('editModal').classList.add('show');
    $('pp-cancel').onclick = close; $('pp-setup').onclick = () => setup(() => pump(kode));
    let mode = defTo && !defFrom ? 'set' : 'move';
    const setMode = m => { mode = m; $('pp-mode-move').className = 'btn ' + (m === 'move' ? 'btn-primary' : 'btn-outline'); $('pp-mode-set').className = 'btn ' + (m === 'set' ? 'btn-primary' : 'btn-outline'); document.querySelector('.pp-move').style.display = m === 'move' ? '' : 'none'; document.querySelector('.pp-set').style.display = m === 'set' ? '' : 'none'; $('pp-from').required = $('pp-to').required = m === 'move'; };
    $('pp-mode-move').onclick = () => setMode('move'); $('pp-mode-set').onclick = () => setMode('set'); setMode(mode);
    const byKode = k => wells.find(r => r['Kode Baru'] === k);
    const info = (id, hint) => { const r = byKode($(id).value), el = $(hint); if (!r) { el.textContent = ''; return; } const parts = [r[sumberCols.jenis], 'Kondisi sumur: ' + (String(r['Kondisi Sumur'] || '–').trim()), r['Status'] ? 'Status: ' + r['Status'] : '', r['Update'] ? 'Update: ' + r['Update'] : '', r[sumberCols.aktif] ? String(r[sumberCols.aktif]).trim() : '']; el.textContent = parts.filter(Boolean).join(' · '); el.className = 'edit-hint' + (/rusak/i.test(r['Kondisi Sumur'] || '') ? ' warn' : ''); };
    const applyWil = () => { const w = $('pp-wil').value; [['pp-from', withPump], ['pp-to', noPump], ['pp-one', wells]].forEach(([id, list]) => { const cur = $(id).value; const first = $(id).options[0].outerHTML; $(id).innerHTML = first + opt(list.filter(r => !w || String(r['Wilayah']).trim() === w), cur); }); info('pp-from', 'pp-from-i'); info('pp-to', 'pp-to-i'); info('pp-one', 'pp-one-i'); };
    $('pp-wil').onchange = applyWil; applyWil();
    $('pp-from').onchange = () => info('pp-from', 'pp-from-i'); $('pp-to').onchange = () => info('pp-to', 'pp-to-i'); $('pp-one').onchange = () => { info('pp-one', 'pp-one-i'); const r = byKode($('pp-one').value); if (r && POMPA.includes(r['Pompa'])) $('pp-one-val').value = r['Pompa']; };
    $('ppForm').onsubmit = async e => {
      e.preventDefault();
      const pin = $('pp-pin').value.trim(), msg = $('pp-msg'), btn = $('pp-save'), err = m => { msg.textContent = m; msg.className = 'wide edit-msg err'; };
      if (!pin) return err('PIN wajib diisi.');
      let changes = [];
      if (mode === 'move') {
        const a = byKode($('pp-from').value), b = byKode($('pp-to').value);
        if (!a || !b) return err('Pilih sumur asal dan sumur tujuan.');
        if (a === b) return err('Sumur asal dan tujuan sama.');
        if (/rusak/i.test(b['Kondisi Sumur'] || '') && !confirm('Kondisi sumur tujuan ' + b['Kode Baru'] + ' tercatat RUSAK. Tetap pasang pompa di sana?')) return;
        changes = [{ kode: a['Kode Baru'], pompa: $('pp-from-val').value, expect: a['Pompa'] || '' }, { kode: b['Kode Baru'], pompa: 'Ada Pompa', expect: b['Pompa'] || '' }];
      } else {
        const r = byKode($('pp-one').value); if (!r) return err('Pilih sumur.');
        if ((r['Pompa'] || '') === $('pp-one-val').value) return err('Kondisi pompa tidak berubah.');
        changes = [{ kode: r['Kode Baru'], pompa: $('pp-one-val').value, expect: r['Pompa'] || '' }];
      }
      btn.disabled = true; msg.className = 'wide edit-msg'; msg.textContent = 'Menyimpan ke spreadsheet…';
      try {
        const j = await post({ action: 'pump', pin, user: $('pp-user').value.trim(), mode: mode === 'move' ? 'PINDAH POMPA' : 'UBAH POMPA', changes, keterangan: $('pp-ket').value.trim() });
        if (!j.ok) { if (j.code === 'PIN') localStorage.removeItem(LS_PIN); throw new Error(j.error || 'Gagal'); }
        localStorage.setItem(LS_PIN, pin); localStorage.setItem(LS_USER, $('pp-user').value.trim());
        (j.results || []).forEach(x => { const r = byKode(x.kode); if (!r) return; r['Pompa'] = x.to; if (x.status !== undefined && x.status !== '') r['Status'] = x.status; if (x.update !== undefined && x.update !== '') r['Update'] = x.update; if (F().refreshRow) F().refreshRow('sumber', r); });
        msg.className = 'wide edit-msg ok'; msg.textContent = '✔ Tersimpan: ' + (j.results || []).map(x => x.kode + ' ' + (x.from || '(kosong)') + ' → ' + x.to + ' (baris ' + x.row + ')').join(' ; ') + '. Menyinkronkan ulang…';
        toast(mode === 'move' ? 'Pompa dipindah ' + changes[0].kode + ' → ' + changes[1].kode + ' ✔' : 'Pompa ' + changes[0].kode + ' → ' + changes[0].pompa + ' ✔');
        setTimeout(() => { close(); F().loadData && F().loadData(false); }, 1800);
      } catch (ex) {
        msg.className = 'wide edit-msg err'; msg.textContent = '✖ ' + (ex.name === 'AbortError' ? 'Waktu habis (30 dtk) — periksa koneksi / URL Web App' : ex.message); btn.disabled = false;
      }
    };
  }

  /* ---------- pengaturan URL Web App ---------- */
  function setup(after) {
    ensureModal();
    $('editTitle').textContent = '⚙ Pengaturan tulis ke Spreadsheet';
    $('editBody').innerHTML = `
      <div class="edit-cur"><b>Langkah pemasangan (sekali saja, oleh pemilik spreadsheet)</b>
        <ol class="edit-steps">
          <li>Buka spreadsheet → <b>Extensions → Apps Script</b>, tempel isi file <code>apps-script/Code.gs</code> dari repo, simpan.</li>
          <li>Project Settings → <b>Script Properties</b> → tambah <code>PIN</code> = PIN yang diinginkan.</li>
          <li><b>Deploy → New deployment → Web app</b>: Execute as <i>Me</i>, Who has access <i>Anyone</i> → Deploy → salin <b>Web app URL</b>.</li>
          <li>Tempel URL di bawah (disimpan di perangkat ini) — atau isi <code>writeApi.url</code> di <code>assets/js/config.js</code> agar berlaku untuk semua pengguna.</li>
        </ol></div>
      <form id="setupForm" class="edit-form"><label class="wide">URL Web App (…/exec) <input id="su-url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(apiUrl())}"></label>
        <div class="wide edit-actions"><button type="button" class="btn btn-outline" id="su-test">🔌 Uji koneksi</button><span class="grow"></span><button type="button" class="btn btn-outline" id="su-cancel">Tutup</button><button type="submit" class="btn btn-primary">Simpan</button></div><div class="wide edit-msg" id="su-msg"></div></form>`;
    $('editModal').classList.add('show');
    $('su-cancel').onclick = close;
    $('su-test').onclick = async () => { const u = $('su-url').value.trim(), m = $('su-msg'); m.className = 'wide edit-msg'; m.textContent = 'Menguji…'; try { const res = await fetch(u + (u.includes('?') ? '&' : '?') + 'action=ping', { redirect: 'follow' }); const j = await res.json(); m.className = 'wide edit-msg ' + (j.ok ? 'ok' : 'err'); m.textContent = j.ok ? '✔ Terhubung: ' + j.app + ' v' + j.version : '✖ ' + (j.error || 'gagal'); } catch (e) { m.className = 'wide edit-msg err'; m.textContent = '✖ Tidak terhubung: ' + e.message; } };
    $('setupForm').onsubmit = e => { e.preventDefault(); const u = $('su-url').value.trim(); if (u && !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(u) && !confirm('URL tidak tampak seperti Web App Apps Script (…/exec). Simpan juga?')) return; if (u) localStorage.setItem(LS_URL, u); else localStorage.removeItem(LS_URL); toast(u ? 'URL Web App disimpan' : 'URL Web App dihapus'); close(); if (u && after) after(); };
  }

  window.FSEdit = { open, install, pump, setup, suggest, enabled: () => true, apiUrl };
})();
