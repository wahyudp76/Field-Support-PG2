/* =====================================================================
 *  Pindah Unit — edit perpindahan unit existing di sheet "Detail Terpasang"
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
        <div class="edit-grid4"><div><span>Lokasi</span>${esc(r['Lokasi'])}</div><div><span>Wil</span>${esc(r['Wil'])}</div><div><span>Engine</span>${esc(r['Kode Engine'] || '–')}</div><div><span>Irigator</span>${esc(r['Kode Irigator'] || '–')}</div><div><span>Sumber Air</span>${esc(r['Sumber Air'] || '–')}</div><div><span>Kode Air</span>${esc(r['Kode Air'] || '–')}</div><div><span>Tanggal</span>${esc(r['Tanggal'] || '–')}</div><div><span>Baris sheet</span>${r._i + 2}</div></div>
        ${r['Keterangan'] ? `<div class="edit-ket">📝 ${esc(r['Keterangan'])}</div>` : ''}</div>
      <form id="editForm" class="edit-form" autocomplete="off">
        <label>Lokasi baru <input id="ed-lok" required placeholder="mis. 303M / 109D1" value=""></label>
        <label>Wil <select id="ed-wil">${wils.map(w => `<option ${w === r['Wil'] ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label>
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
    $('ed-lok').oninput = upd; $('ed-wil').onchange = upd;
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
    if (g.exact.length) h += `<div class="sug-h">✅ Sumber air yang melayani blok <b>${esc(lok)}</b></div><div class="sug-row">${g.exact.map(s => card(s, 'sesuai lokasi')).join('')}</div>`;
    else h += `<div class="sug-h">ℹ️ Belum ada sumber air berkode untuk blok <b>${esc(lok)}</b> di sheet Sumber Air — pilih yang terdekat:</div>`;
    if (g.near.length) h += `<div class="sug-h sub">📍 Terdekat${g.note ? ' <span>(' + esc(g.note) + ')</span>' : ''}</div><div class="sug-row">${g.near.map(s => card(s, s.nums.has(parseLok(lok).num) ? 'blok sama' : 'terdekat')).join('')}</div>`;
    if (!g.exact.length && !g.near.length) h += `<div class="empty">${esc(g.note || 'Tidak ada kandidat')}</div>`;
    const used = (F().RAW.detail.rows || []).filter(x => x !== r && x['Lokasi'] === lok);
    if (used.length) h = `<div class="sug-warn">⚠️ Lokasi ${esc(lok)} sudah dipakai unit lain: ${used.map(x => esc(x['Kode Engine'] || ('baris ' + (x._i + 2)))).join(', ')}</div>` + h;
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
    const body = { action: 'move', pin, user: $('ed-user').value.trim(), row: r._i + 2,
      from: { lokasi: r['Lokasi'] || '', kodeEngine: r['Kode Engine'] || '', kodeIrigator: r['Kode Irigator'] || '' },
      to: { lokasi: lok, wil: $('ed-wil').value, tanggal: $('ed-tgl').value, sumberAir: $('ed-sa').value, kodeAir: ka, keterangan: $('ed-ket').value.trim() } };
    btn.disabled = true; msg.className = 'wide edit-msg'; msg.textContent = 'Menyimpan ke spreadsheet…';
    try {
      const j = await post(body);
      if (!j.ok) { if (j.code === 'PIN') localStorage.removeItem(LS_PIN); throw new Error(j.error || 'Gagal'); }
      localStorage.setItem(LS_PIN, pin); localStorage.setItem(LS_USER, $('ed-user').value.trim());
      // perbarui tampilan lokal segera, lalu sinkron ulang dari sheet
      Object.assign(r, { Lokasi: lok, Wil: $('ed-wil').value, 'Sumber Air': $('ed-sa').value || r['Sumber Air'], 'Kode Air': ka, Tanggal: $('ed-tgl').value || r['Tanggal'], Keterangan: j.keterangan || r['Keterangan'] });
      if (F().refreshRow) F().refreshRow('detail', r);
      msg.className = 'wide edit-msg ok'; msg.textContent = '✔ Tersimpan di baris ' + j.row + '. Menyinkronkan ulang…';
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
        <div class="edit-grid4"><div><span>Lokasi</span>${esc(r['Lokasi'])}</div><div><span>Wil</span>${esc(r['Wil'])}</div><div><span>Engine</span>${esc(r['Kode Engine'] || '–')}</div><div><span>Irigator</span>${esc(r['Kode Irigator'] || '–')}</div><div><span>Kode Air</span>${esc(r['Kode Air'] || '–')}</div><div><span>Baris sheet</span>${r._i + 2}</div></div></div>
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
        const j = await post({ action: 'withdraw', pin, user: $('wd-user').value.trim(), row: r._i + 2, from: { lokasi: r['Lokasi'] || '', kodeEngine: r['Kode Engine'] || '', kodeIrigator: r['Kode Irigator'] || '' },
          statusMesin: $('wd-sm').value, statusIrrigator: $('wd-si').value, keterangan: $('wd-ket').value.trim() });
        if (!j.ok) { if (j.code === 'PIN') localStorage.removeItem(LS_PIN); throw new Error(j.error || 'Gagal'); }
        localStorage.setItem(LS_PIN, pin); localStorage.setItem(LS_USER, $('wd-user').value.trim());
        if (F().removeRow) F().removeRow('detail', r);
        const st = [j.status && j.status.mesin ? 'Mesin → ' + j.status.mesin : '', j.status && j.status.irrigator ? 'Irrigator → ' + j.status.irrigator : ''].filter(Boolean).join(', ');
        msg.className = 'wide edit-msg ok'; msg.textContent = '✔ Baris ' + j.row + ' dihapus' + (st ? ' · ' + st : '') + '. Menyinkronkan ulang…';
        toast('Unit ' + (r['Kode Engine'] || r['Lokasi']) + ' ditarik ke bengkel ✔');
        setTimeout(() => { close(); F().loadData && F().loadData(false); }, 1200);
      } catch (err) {
        msg.className = 'wide edit-msg err'; msg.textContent = '✖ ' + (err.name === 'AbortError' ? 'Waktu habis (30 dtk) — periksa koneksi / URL Web App' : err.message); btn.disabled = false;
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

  window.FSEdit = { open, setup, suggest, enabled: () => true, apiUrl };
})();
