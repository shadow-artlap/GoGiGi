'use strict';

const $ = (id) => document.getElementById(id);
const REPO_URL = 'https://github.com/shadow-artlap/GoGiGi/releases';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtBytes = (n) => { if (!n && n !== 0) return '-'; const u = ['B','KB','MB','GB','TB']; let i=0,v=n; while(v>=1024&&i<u.length-1){v/=1024;i++;} return `${v.toFixed(v<10&&i>0?1:0)} ${u[i]}`; };
const fmtUptime = (s) => { const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60); return [d&&`${d}d`,h&&`${h}h`,`${m}m`].filter(Boolean).join(' '); };
const fmtDate = (t) => t ? new Date(t).toLocaleDateString() + ' ' + new Date(t).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '-';

// ---- toast ----------------------------------------------------------------
function toast(title, sub, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = `<span class="bar-i"></span><div class="tx"><div class="tt"></div>${sub ? '<div class="ts"></div>' : ''}</div>`;
  el.querySelector('.tt').textContent = title;
  if (sub) el.querySelector('.ts').textContent = sub;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; setTimeout(() => el.remove(), 250); }, kind === 'err' ? 5200 : 3400);
}

// ---- nav ------------------------------------------------------------------
const TITLES = { profiles: 'โปรไฟล์', extensions: 'Extensions', dashboard: 'ภาพรวม', settings: 'ตั้งค่า', updates: 'อัปเดต' };
document.querySelectorAll('.side-nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.side-nav button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $(`view-${btn.dataset.tab}`).classList.add('active');
    $('pageTitle').textContent = TITLES[btn.dataset.tab] || '';
    if (btn.dataset.tab === 'profiles') loadProfiles();
    if (btn.dataset.tab === 'extensions') loadExtensions();
    if (btn.dataset.tab === 'dashboard') loadSystem();
  });
});

// ======================= PROFILES =========================================
let allProfiles = [], trashProfiles = [], allGroups = [], allExtensions = [], browsersList = [];
let selected = new Set();
let launching = new Set();
let lastProxyInfo = null;
let proxyUse = {};
let viewMode = 'all';            // 'all' | 'trash'
let sortKey = 'createdAt', sortDir = -1;
let page = 0, pageSize = 50;
let modalSeed = '';

const randomHex = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join('');
const shortGpu = (r) => {
  if (!r) return '';
  const m = String(r).match(/ANGLE \([^,]+, (.+?) (Direct3D|OpenGL|Vulkan|\()/);
  return (m ? m[1] : String(r)).replace(/\(R\)|\(TM\)/g, '').trim();
};

const proxySummary = (p) => (!p || !p.host) ? '<span class="muted">ไม่มี</span>'
  : `<span class="mono">${esc(p.host)}:${esc(p.port)}</span>${p.username ? ' 🔒' : ''}`;
const proxyKey = (px) => (px && px.host) ? `${px.host}:${px.port}` : '';
const proxyCell = (p) => {
  let h = proxySummary(p.proxy);
  if (p.proxyInfo && p.proxyInfo.ip) {
    h += `<div class="sub"><span class="flag">${p.proxyInfo.flag || ''}</span> <span class="mono">${esc(p.proxyInfo.ip)}</span>${p.proxyInfo.country ? ' · ' + esc(p.proxyInfo.country) : ''}${p.proxyInfo.latency ? ' · ' + p.proxyInfo.latency + 'ms' : ''}</div>`;
  }
  const k = proxyKey(p.proxy);
  if (k && proxyUse[k] > 1) h += `<div class="sub warn">⚠ ใช้ร่วม ${proxyUse[k]} โปรไฟล์</div>`;
  return h;
};
const readProxyForm = () => {
  const host = $('f_phost').value.trim();
  return host ? { scheme: $('f_pscheme').value, host, port: $('f_pport').value.trim(), username: $('f_puser').value.trim(), password: $('f_ppass').value } : null;
};
// What the profile looks like to websites (generated device + user overrides).
const deviceCell = (p) => {
  const d = p.device;
  if (!d) return '<span class="muted">—</span>';
  const top = `<span class="mono">${d.screen ? d.screen.width + '×' + d.screen.height : ''}</span> · ${d.cores || '?'}C · ${d.mem || '?'}GB`;
  const sub = [shortGpu(d.gpu), d.tz].filter(Boolean).map(esc).join(' · ');
  return `${top}${sub ? `<div class="sub">${sub}</div>` : ''}`;
};
const platformSub = (p) => {
  const plat = p.platform;
  if (!plat || (!plat.name && !plat.account)) return '';
  return ` · ${esc(plat.name || '')}${plat.account ? ' ' + esc(plat.account) : ''}`;
};

function currentFilterGroup() { return $('groupFilter').value; }

function sortList(list) {
  const k = sortKey, d = sortDir;
  return list.slice().sort((a, b) => {
    if (k === 'name' || k === 'group') {
      const x = String(a[k] || ''), y = String(b[k] || '');
      if (!x && y) return 1; if (x && !y) return -1; // empties last
      return x.localeCompare(y, 'th', { numeric: true, sensitivity: 'base' }) * d;
    }
    return ((a[k] || 0) - (b[k] || 0)) * d;
  });
}

function visibleProfiles() {
  const q = ($('searchProfiles').value || '').toLowerCase();
  const g = currentFilterGroup();
  const src = viewMode === 'trash' ? trashProfiles : allProfiles;
  return sortList(src.filter((p) => {
    if (g === '__ungrouped__') { if (p.group) return false; }
    else if (g && g !== '__all__' && p.group !== g) return false;
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || (p.group || '').toLowerCase().includes(q)
      || (p.tags || []).join(',').toLowerCase().includes(q) || p.id.includes(q);
  }));
}

function renderTable() {
  const trash = viewMode === 'trash';
  const items = visibleProfiles();
  proxyUse = {};
  for (const p of allProfiles) { const k = proxyKey(p.proxy); if (k) proxyUse[k] = (proxyUse[k] || 0) + 1; }

  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (page > pages - 1) page = pages - 1;
  const from = page * pageSize;
  const pageItems = items.slice(from, from + pageSize);

  $('trashCount').textContent = trashProfiles.length ? `(${trashProfiles.length})` : '';
  $('trashbar').style.display = trash && trashProfiles.length ? 'flex' : 'none';
  const srcLen = trash ? trashProfiles.length : allProfiles.length;
  $('tablewrap').style.display = srcLen ? '' : 'none';
  $('profileEmpty').style.display = srcLen ? 'none' : 'block';
  $('profileEmpty').querySelector('.big').textContent = trash ? 'ถังขยะว่าง' : 'ยังไม่มีโปรไฟล์';
  $('profileEmpty').querySelector('p').textContent = trash ? 'โปรไฟล์ที่ย้ายไปถังขยะจะอยู่ที่นี่ และกู้คืนได้' : 'สร้างตัวตนเบราว์เซอร์แรก พร้อม proxy และ fingerprint ของมันเอง';
  $('btnNewProfile2').style.display = trash ? 'none' : '';

  $('pager').style.display = total > 25 || page > 0 ? 'flex' : 'none';
  $('pageInfo').textContent = total ? `${from + 1}–${Math.min(from + pageSize, total)} จาก ${total}` : '0';
  $('pagePrev').disabled = page <= 0;
  $('pageNext').disabled = page >= pages - 1;

  $('profileRows').innerHTML = pageItems.map((p) => {
    let actions;
    if (trash) {
      actions = `<button class="btn sm" data-act="restore" data-id="${p.id}">กู้คืน</button>
        <button class="btn sm danger" data-act="purge" data-id="${p.id}">ลบถาวร</button>`;
    } else {
      const isLaunching = launching.has(p.id);
      const primary = isLaunching
        ? `<button class="btn sm" disabled>กำลังเปิด…</button>`
        : (p.running
          ? `<button class="btn sm" data-act="stop" data-id="${p.id}">หยุด</button>`
          : `<button class="btn sm primary" data-act="launch" data-id="${p.id}">เปิด</button>`);
      actions = `${primary}
        <button class="btn sm ghost" data-act="edit" data-id="${p.id}">แก้ไข</button>
        <button class="btn sm ghost" data-act="menu" data-id="${p.id}" aria-label="ตัวเลือกเพิ่มเติม" aria-haspopup="menu">⋯</button>`;
    }
    const dot = p.running ? 'on' : (launching.has(p.id) ? 'loading' : '');
    const when = trash ? `ลบ ${fmtDate(p.deletedAt)}` : fmtDate(p.createdAt);
    return `
    <tr class="${trash ? 'trash' : ''}">
      <td><input type="checkbox" class="rowchk" data-id="${p.id}" ${selected.has(p.id) ? 'checked' : ''} /></td>
      <td>
        <div class="pname"><span class="dot ${dot}"></span>${esc(p.name)}</div>
        <div class="sub"><span class="id-chip">${esc(p.id)}</span>${platformSub(p)}</div>
      </td>
      <td>${p.group ? `<span class="tag">${esc(p.group)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="small">${proxyCell(p)}</td>
      <td class="small">${deviceCell(p)}</td>
      <td class="small">${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ') || '<span class="muted">—</span>'}</td>
      <td class="small">${when}</td>
      <td class="acts">${actions}</td>
    </tr>`;
  }).join('');

  $('checkAll').checked = pageItems.length > 0 && pageItems.every((p) => selected.has(p.id));
  updateLive();
  $('profileRows').querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', (e) => onAction(b.dataset.act, b.dataset.id, e)));
  $('profileRows').querySelectorAll('.rowchk').forEach((c) => c.addEventListener('change', () => {
    if (c.checked) selected.add(c.dataset.id); else selected.delete(c.dataset.id);
    updateBulk();
  }));
  updateBulk();
}

function updateBulk() {
  const vis = new Set(visibleProfiles().map((p) => p.id));
  for (const id of [...selected]) if (!vis.has(id)) selected.delete(id);
  const trash = viewMode === 'trash';
  $('bulkbar').style.display = selected.size ? 'flex' : 'none';
  $('bulkCount').textContent = `เลือก ${selected.size} รายการ`;
  $('bulkGroup').style.display = trash ? 'none' : '';
  $('bulkMove').style.display = trash ? 'none' : '';
  $('bulkDelete').style.display = trash ? 'none' : '';
  $('bulkRestore').style.display = trash ? '' : 'none';
  $('bulkPurge').style.display = trash ? '' : 'none';
}

function updateLive() {
  const n = allProfiles.filter((p) => p.running).length;
  $('livePill').classList.toggle('on', n > 0);
  $('liveCount').textContent = n > 0 ? `${n} โปรไฟล์กำลังเปิดอยู่` : 'ไม่มีโปรไฟล์ที่เปิดอยู่';
  $('btnCloseAll').style.display = n > 0 && viewMode === 'all' ? '' : 'none';
}

// ---- row "more" menu --------------------------------------------------------
function closeMenu() { $('rowMenu').style.display = 'none'; }
function openMenu(id, anchor) {
  const p = allProfiles.find((x) => x.id === id);
  if (!p) return;
  const m = $('rowMenu');
  m.innerHTML = `
    <button data-mact="iptest" ${p.proxy ? '' : 'disabled'}>ทดสอบ proxy</button>
    <button data-mact="clone">คัดลอกเป็นโปรไฟล์ใหม่</button>
    <hr />
    <button data-mact="ckimport">นำเข้า cookie…</button>
    <button data-mact="ckexport">ส่งออก cookie…</button>
    <button data-mact="dir">เปิดโฟลเดอร์ข้อมูล</button>
    <hr />
    <button data-mact="del" class="danger">ย้ายไปถังขยะ</button>`;
  m.style.display = 'block';
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
  m.style.top = (r.bottom + h + 8 > window.innerHeight ? r.top - h - 4 : r.bottom + 4) + 'px';
  m.querySelectorAll('button[data-mact]').forEach((b) => b.addEventListener('click', () => { closeMenu(); onAction(b.dataset.mact, id); }));
  const first = m.querySelector('button:not([disabled])'); if (first) first.focus();
}

async function onAction(act, id, ev) {
  const p = allProfiles.find((x) => x.id === id) || trashProfiles.find((x) => x.id === id);
  if (act === 'menu') { openMenu(id, ev.currentTarget || ev.target); return; }
  if (act === 'launch') {
    if (launching.has(id)) return;
    launching.add(id); renderTable();
    if (p && p.browser === 'bundled' && !chromiumInstalled) toast('กำลังเตรียม Chromium', 'ครั้งแรกจะดาวน์โหลด ~150MB — ดูความคืบหน้าที่ ตั้งค่า');
    let r;
    try { r = await window.gogigi.profiles.launch(id); }
    catch (e) { r = { ok: false, reason: String((e && e.message) || e) }; }
    finally { launching.delete(id); }
    if (!r.ok) toast('เปิดไม่สำเร็จ', r.reason, 'err');
    else toast('เปิดโปรไฟล์แล้ว', p.name, 'ok');
    await Promise.all([loadProfiles(), refreshChromium()]);
  } else if (act === 'iptest') {
    toast('กำลังทดสอบ proxy', p.name);
    const r = await window.gogigi.proxy.testProfile(id);
    if (!r.ok) toast('ทดสอบ proxy ไม่สำเร็จ', r.reason, 'err');
    else toast(`${r.flag || ''} ${r.ip}`, `${r.country}${r.city ? ' · ' + r.city : ''} · ${r.latency}ms`, 'ok');
    await loadProfiles();
  } else if (act === 'stop') { await window.gogigi.profiles.stop(id); await loadProfiles(); }
  else if (act === 'edit') { openModal(p); }
  else if (act === 'dir') { window.gogigi.profiles.openDir(id); }
  else if (act === 'clone') {
    const r = await window.gogigi.profiles.clone(id);
    if (r.ok) { toast('คัดลอกแล้ว', `${r.profile.name} — เครื่องใหม่ ข้อมูลเบราว์เซอร์ว่าง`, 'ok'); await loadProfiles(); }
    else toast('คัดลอกไม่ได้', r.reason, 'err');
  } else if (act === 'ckimport') {
    toast('นำเข้า cookie', `เลือกไฟล์ JSON หรือ cookies.txt ของ ${p.name}`);
    const r = await window.gogigi.cookies.import(id);
    if (r.ok) toast('นำเข้า cookie แล้ว', `${r.imported}/${r.total} รายการ${r.failed && r.failed.length ? ` · ข้าม ${r.failed.length} ที่ไม่ถูกต้อง` : ''}`, 'ok');
    else if (r.reason !== 'canceled') toast('นำเข้า cookie ไม่ได้', r.reason, 'err');
  } else if (act === 'ckexport') {
    toast('กำลังอ่าน cookie', p.name);
    const r = await window.gogigi.cookies.export(id);
    if (r.ok) toast('ส่งออก cookie แล้ว', `${r.count} รายการ`, 'ok');
    else if (r.reason !== 'canceled') toast('ส่งออก cookie ไม่ได้', r.reason, 'err');
  } else if (act === 'del') {
    if (p.running) { toast('ปิดโปรไฟล์ก่อน', 'ต้องหยุดโปรไฟล์ก่อนจึงจะย้ายไปถังขยะได้', 'err'); return; }
    await window.gogigi.profiles.remove(id); await loadProfiles();
    toast('ย้ายไปถังขยะแล้ว', `${p.name} — กู้คืนได้ที่แท็บถังขยะ`);
  } else if (act === 'restore') {
    await window.gogigi.profiles.restore([id]); await loadProfiles(); toast('กู้คืนแล้ว', p.name, 'ok');
  } else if (act === 'purge') {
    if (!confirm(`ลบ "${p.name}" ถาวร? ข้อมูลเบราว์เซอร์ (cookie, การล็อกอิน) จะหายและกู้คืนไม่ได้`)) return;
    await window.gogigi.profiles.purge([id]); await loadProfiles(); toast('ลบถาวรแล้ว', p.name);
  }
}

async function loadProfiles() {
  [allProfiles, trashProfiles] = await Promise.all([window.gogigi.profiles.list(), window.gogigi.profiles.listTrash()]);
  renderTable();
}

// ---- groups ---------------------------------------------------------------
async function loadGroups() {
  allGroups = await window.gogigi.groups.list();
  const opts = (withAll) => {
    let h = '';
    if (withAll) h += `<option value="__all__">ทุกกลุ่ม</option><option value="__ungrouped__">ไม่มีกลุ่ม</option>`;
    h += allGroups.map((g) => `<option value="${esc(g.name)}">${esc(g.name)}</option>`).join('');
    return h;
  };
  const gf = $('groupFilter'); const keep = gf.value; gf.innerHTML = opts(true); gf.value = [...gf.options].some(o=>o.value===keep)?keep:'__all__';
  $('bulkGroup').innerHTML = `<option value="">— ไม่มีกลุ่ม —</option>` + opts(false);
  $('f_group').innerHTML = `<option value="">— ไม่มีกลุ่ม —</option>` + opts(false);
}

function openGroups() { renderGroupsModal(); $('gmodal').style.display = 'flex'; }
function renderGroupsModal() {
  $('g_list').innerHTML = allGroups.map((g) => `
    <div class="grow-row">
      <input type="text" value="${esc(g.name)}" data-id="${g.id}" class="gname" />
      <button class="btn sm danger" data-gdel="${g.id}">ลบ</button>
    </div>`).join('') || '<div class="muted">ยังไม่มีกลุ่ม</div>';
  $('g_list').querySelectorAll('.gname').forEach((inp) => inp.addEventListener('change', async () => {
    await window.gogigi.groups.rename(inp.dataset.id, inp.value); await loadGroups();
  }));
  $('g_list').querySelectorAll('[data-gdel]').forEach((b) => b.addEventListener('click', async () => {
    await window.gogigi.groups.remove(b.dataset.gdel); await loadGroups(); renderGroupsModal();
  }));
}

// ---- modal ----------------------------------------------------------------
async function ensureBrowsers() {
  if (browsersList.length) return;
  browsersList = await window.gogigi.browsers.list();
  $('f_browser').innerHTML = browsersList.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')
    || '<option value="bundled">GoGiGi Chromium</option>';
}
function setWebrtc(mode) {
  document.querySelectorAll('#f_webrtc button').forEach((b) => b.classList.toggle('active', b.dataset.webrtc === mode));
}
function getWebrtc() { const a = document.querySelector('#f_webrtc button.active'); return a ? a.dataset.webrtc : 'proxy-udp'; }

function renderExtPicker(selectedIds) {
  const set = new Set(selectedIds || []);
  $('f_extList').innerHTML = allExtensions.length
    ? allExtensions.map((e) => `<label class="chk"><input type="checkbox" class="extchk" value="${e.id}" ${set.has(e.id)?'checked':''} ${e.exists?'':'disabled'} /> ${esc(e.name)}${e.exists?'':' <span class="muted">(หาย)</span>'}</label>`).join('')
    : '<div class="muted">ยังไม่มี extension — เพิ่มได้ที่แท็บ Extensions</div>';
}

// Show the generated device and use it as placeholders for the empty fields.
async function renderFpPreview() {
  const g = await window.gogigi.profiles.fpPreview(modalSeed);
  if (!g) return;
  $('fpPreview').textContent = `${g.screen.width}×${g.screen.height} · ${g.hardwareConcurrency} cores · ${g.deviceMemory} GB · ${shortGpu(g.webglRenderer)}`;
  $('f_scrw').placeholder = String(g.screen.width); $('f_scrh').placeholder = String(g.screen.height);
  $('f_hc').placeholder = String(g.hardwareConcurrency); $('f_dm').placeholder = String(g.deviceMemory);
  $('f_glv').placeholder = g.webglVendor; $('f_glr').placeholder = g.webglRenderer;
  $('f_uaplat').placeholder = g.uaPlatform;
  $('f_tz').placeholder = 'ตาม proxy อัตโนมัติ'; $('f_locale').placeholder = 'ตาม proxy อัตโนมัติ';
  $('f_ua').placeholder = 'อิงเวอร์ชันเบราว์เซอร์จริง (อัตโนมัติ)';
}

async function openModal(p) {
  await ensureBrowsers();
  const ed = !!p;
  $('modalTitle').textContent = ed ? 'แก้ไขโปรไฟล์' : 'โปรไฟล์ใหม่';
  $('f_id').value = ed ? p.id : '';
  $('f_name').value = ed ? p.name : '';
  $('f_group').value = ed ? (p.group || '') : (['__all__', '__ungrouped__'].includes(currentFilterGroup()) ? '' : currentFilterGroup());
  $('f_browser').value = ed ? p.browser : (browsersList[0] ? browsersList[0].id : 'bundled');
  const pf = (ed && p.platform) || {};
  $('f_pfname').value = pf.name || ''; $('f_pfacct').value = pf.account || ''; $('f_pfpass').value = pf.password || ''; $('f_pf2fa').value = pf.twofa || '';
  $('f_tabs').value = ed ? (p.tabs || []).join('\n') : '';
  const px = (ed && p.proxy) || {};
  $('f_pscheme').value = px.scheme || 'http'; $('f_phost').value = px.host || ''; $('f_pport').value = px.port || '';
  $('f_puser').value = px.username || ''; $('f_ppass').value = px.password || '';
  lastProxyInfo = ed ? (p.proxyInfo || null) : null;
  $('f_proxyResult').textContent = lastProxyInfo ? `✓ ${lastProxyInfo.flag || ''} ${lastProxyInfo.ip}${lastProxyInfo.country ? ' · ' + lastProxyInfo.country : ''}` : '';
  $('f_autofp').checked = true;
  const f = (ed && p.fingerprint) || {};
  setWebrtc(f.webrtc || 'proxy-udp');
  $('f_ua').value = f.userAgent || ''; $('f_uaplat').value = f.uaPlatform || '';
  $('f_tz').value = f.timezone || ''; $('f_locale').value = f.locale || '';
  $('f_scrw').value = f.screen ? f.screen.width : ''; $('f_scrh').value = f.screen ? f.screen.height : '';
  $('f_geolat').value = f.geo ? f.geo.lat : ''; $('f_geolon').value = f.geo ? f.geo.lon : '';
  $('f_hc').value = f.hardwareConcurrency || ''; $('f_dm').value = f.deviceMemory || '';
  $('f_glv').value = f.webglVendor || ''; $('f_glr').value = f.webglRenderer || '';
  $('f_canvas').checked = f.canvasNoise !== false;
  renderExtPicker(ed ? (p.extensions || []) : []);
  $('f_tags').value = ed ? (p.tags || []).join(', ') : '';
  $('f_remark').value = ed ? (p.remark || '') : '';
  modalSeed = ed ? (p.fpSeed || p.id) : randomHex();
  await renderFpPreview();
  $('modal').style.display = 'flex';
  $('f_name').focus();
}
function closeModal() { $('modal').style.display = 'none'; }

function readModal() {
  const host = $('f_phost').value.trim();
  const selExt = [...document.querySelectorAll('.extchk:checked')].map((c) => c.value);
  return {
    name: $('f_name').value.trim() || 'New Profile',
    group: $('f_group').value,
    browser: $('f_browser').value,
    platform: { name: $('f_pfname').value.trim(), account: $('f_pfacct').value.trim(), password: $('f_pfpass').value, twofa: $('f_pf2fa').value.trim() },
    tabs: $('f_tabs').value,
    proxy: host ? { scheme: $('f_pscheme').value, host, port: $('f_pport').value.trim(), username: $('f_puser').value.trim(), password: $('f_ppass').value } : null,
    fingerprint: {
      webrtc: getWebrtc(),
      userAgent: $('f_ua').value.trim(), uaPlatform: $('f_uaplat').value.trim(),
      timezone: $('f_tz').value.trim(), locale: $('f_locale').value.trim(),
      screen: $('f_scrw').value.trim() ? { width: $('f_scrw').value.trim(), height: $('f_scrh').value.trim() } : null,
      geo: $('f_geolat').value.trim() ? { lat: $('f_geolat').value.trim(), lon: $('f_geolon').value.trim() } : null,
      hardwareConcurrency: $('f_hc').value.trim(), deviceMemory: $('f_dm').value.trim(),
      webglVendor: $('f_glv').value.trim(), webglRenderer: $('f_glr').value.trim(),
      canvasNoise: $('f_canvas').checked,
    },
    extensions: selExt,
    tags: $('f_tags').value,
    remark: $('f_remark').value.trim(),
    proxyInfo: host ? lastProxyInfo : null,
    fpSeed: modalSeed,
  };
}
async function saveModal() {
  const data = readModal(); const id = $('f_id').value;
  if (id) await window.gogigi.profiles.update(id, data); else await window.gogigi.profiles.create(data);
  closeModal(); await loadProfiles();
  toast(id ? 'บันทึกแล้ว' : 'สร้างโปรไฟล์แล้ว', data.name, 'ok');
}

function initProfilesUI() {
  $('btnNewProfile').addEventListener('click', () => openModal(null));
  $('btnNewProfile2').addEventListener('click', () => openModal(null));
  $('btnCloseAll').addEventListener('click', async () => {
    const run = allProfiles.filter((p) => p.running);
    for (const p of run) await window.gogigi.profiles.stop(p.id);
    toast('ปิดทั้งหมดแล้ว', `${run.length} โปรไฟล์`);
    await loadProfiles();
  });
  $('searchProfiles').addEventListener('input', () => { page = 0; renderTable(); });
  $('groupFilter').addEventListener('change', () => { selected.clear(); page = 0; renderTable(); });
  $('sortBy').addEventListener('change', (e) => { const [k, d] = e.target.value.split(':'); sortKey = k; sortDir = Number(d); page = 0; renderTable(); });
  $('pageSize').addEventListener('change', (e) => { pageSize = Number(e.target.value); page = 0; renderTable(); });
  $('pagePrev').addEventListener('click', () => { if (page > 0) { page--; renderTable(); } });
  $('pageNext').addEventListener('click', () => { page++; renderTable(); });
  document.querySelectorAll('#viewSeg button').forEach((b) => b.addEventListener('click', () => {
    viewMode = b.dataset.view;
    document.querySelectorAll('#viewSeg button').forEach((x) => x.classList.toggle('active', x === b));
    selected.clear(); page = 0; renderTable();
  }));
  $('btnManageGroups').addEventListener('click', openGroups);
  $('checkAll').addEventListener('change', (e) => {
    const items = visibleProfiles().slice(page * pageSize, page * pageSize + pageSize);
    items.forEach((p) => (e.target.checked ? selected.add(p.id) : selected.delete(p.id)));
    renderTable();
  });
  $('bulkMove').addEventListener('click', async () => {
    const n = selected.size;
    await window.gogigi.profiles.setGroupMany([...selected], $('bulkGroup').value);
    selected.clear(); await loadProfiles(); toast('ย้ายกลุ่มแล้ว', `${n} โปรไฟล์`);
  });
  $('bulkDelete').addEventListener('click', async () => {
    const ids = [...selected];
    const r = await window.gogigi.profiles.removeMany(ids);
    selected.clear(); await loadProfiles();
    if (r.ok) toast('ย้ายไปถังขยะแล้ว', `${r.moved} โปรไฟล์${r.busy ? ` · ข้าม ${r.busy} ที่เปิดอยู่` : ''}`);
    else toast('ย้ายไม่ได้', 'โปรไฟล์ที่เลือกเปิดอยู่ทั้งหมด — ปิดก่อน', 'err');
  });
  $('bulkRestore').addEventListener('click', async () => {
    const n = selected.size; await window.gogigi.profiles.restore([...selected]);
    selected.clear(); await loadProfiles(); toast('กู้คืนแล้ว', `${n} โปรไฟล์`, 'ok');
  });
  $('bulkPurge').addEventListener('click', async () => {
    const n = selected.size;
    if (!confirm(`ลบ ${n} โปรไฟล์ถาวร? ข้อมูลเบราว์เซอร์จะหายและกู้คืนไม่ได้`)) return;
    await window.gogigi.profiles.purge([...selected]); selected.clear(); await loadProfiles(); toast('ลบถาวรแล้ว', `${n} โปรไฟล์`);
  });
  $('btnEmptyTrash').addEventListener('click', async () => {
    const n = trashProfiles.length;
    if (!confirm(`ล้างถังขยะ ${n} โปรไฟล์? ลบถาวรและกู้คืนไม่ได้`)) return;
    await window.gogigi.profiles.emptyTrash(); selected.clear(); await loadProfiles(); toast('ล้างถังขยะแล้ว', `${n} โปรไฟล์`);
  });
  $('btnReroll').addEventListener('click', async () => {
    if ($('f_id').value && !confirm('เปลี่ยนเป็นเครื่องใหม่? บัญชีที่ล็อกอินไว้อาจถูกขอยืนยันตัวตนเพราะอุปกรณ์เปลี่ยน')) return;
    modalSeed = randomHex(); await renderFpPreview();
  });
  // menu dismissal
  document.addEventListener('click', (e) => { if (!e.target.closest('#rowMenu') && !e.target.closest('[data-act="menu"]')) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  const scroller = document.querySelector('.content'); if (scroller) scroller.addEventListener('scroll', closeMenu, { passive: true });
  window.addEventListener('resize', closeMenu);

  $('modalClose').addEventListener('click', closeModal);
  $('modalCancel').addEventListener('click', closeModal);
  $('modalSave').addEventListener('click', saveModal);
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  document.querySelectorAll('#f_webrtc button').forEach((b) => b.addEventListener('click', () => setWebrtc(b.dataset.webrtc)));
  $('f_proxyTest').addEventListener('click', async () => {
    const proxy = readProxyForm();
    if (!proxy) { $('f_proxyResult').textContent = 'ใส่ host/port ก่อน'; return; }
    $('f_proxyResult').textContent = 'กำลังทดสอบ…';
    const r = await window.gogigi.proxy.test(proxy);
    if (!r.ok) { $('f_proxyResult').textContent = '❌ ' + r.reason; lastProxyInfo = null; return; }
    $('f_proxyResult').textContent = `✓ ${r.flag || ''} ${r.ip} · ${r.country} · ${r.latency}ms`;
    lastProxyInfo = { ip: r.ip, country: r.country, countryCode: r.countryCode, flag: r.flag, timezone: r.timezone, lat: r.lat, lon: r.lon, latency: r.latency, testedAt: r.testedAt };
    if ($('f_autofp').checked) {
      if (r.timezone) $('f_tz').value = r.timezone;
      if (r.locale) $('f_locale').value = r.locale;
      if (r.lat != null) { $('f_geolat').value = r.lat; $('f_geolon').value = r.lon; }
    }
  });
  // Editing proxy invalidates the cached IP result.
  ['f_phost', 'f_pport', 'f_pscheme', 'f_puser', 'f_ppass'].forEach((id) => {
    const el = $(id);
    if (el) ['input', 'change'].forEach((ev) => el.addEventListener(ev, () => { lastProxyInfo = null; $('f_proxyResult').textContent = ''; }));
  });
  $('gmodalClose').addEventListener('click', () => $('gmodal').style.display = 'none');
  $('gmodalDone').addEventListener('click', () => $('gmodal').style.display = 'none');
  $('g_add').addEventListener('click', async () => {
    const r = await window.gogigi.groups.create($('g_newname').value);
    if (!r.ok) { toast('เพิ่มกลุ่มไม่ได้', r.reason === 'duplicate' ? 'มีกลุ่มชื่อนี้แล้ว' : r.reason, 'err'); return; }
    $('g_newname').value = ''; await loadGroups(); renderGroupsModal();
  });
  window.gogigi.profiles.onChange(() => loadProfiles());
}

// ======================= EXTENSIONS =======================================
async function loadExtensions() {
  allExtensions = await window.gogigi.extensions.list();
  $('extEmpty').style.display = allExtensions.length ? 'none' : 'block';
  $('extList').innerHTML = allExtensions.map((e) => `
    <div class="row">
      <div style="min-width:0;">
        <div class="label">${esc(e.name)} ${e.exists ? '' : '<span class="muted">(โฟลเดอร์หาย)</span>'}</div>
        <div class="desc">${esc(e.path)}</div>
      </div>
      <div class="grow"></div>
      <button class="btn sm danger" data-extdel="${e.id}">ลบ</button>
    </div>`).join('');
  $('extList').querySelectorAll('[data-extdel]').forEach((b) => b.addEventListener('click', async () => {
    await window.gogigi.extensions.remove(b.dataset.extdel); await loadExtensions();
  }));
}
function initExtensionsUI() {
  $('btnAddExt').addEventListener('click', async () => {
    const r = await window.gogigi.extensions.add();
    if (!r.ok && r.reason !== 'canceled') toast('เพิ่ม extension ไม่ได้', r.reason, 'err');
    else if (r.ok) toast('เพิ่ม extension แล้ว', r.extension.name, 'ok');
    allExtensions = await window.gogigi.extensions.list();
    await loadExtensions();
  });
}

// ======================= DASHBOARD ========================================
async function loadSystem() {
  const info = await window.gogigi.system.getInfo();
  const rows = [
    ['ระบบปฏิบัติการ', `${info.platform} ${info.arch} (${info.osRelease})`], ['ชื่อเครื่อง', info.hostname],
    ['CPU', info.cpuModel], ['จำนวนคอร์', String(info.cpuCores)], ['RAM ทั้งหมด', fmtBytes(info.memTotal)],
    ['เปิดเครื่องมา', fmtUptime(info.uptime)], ['Electron', info.electron], ['Chromium', info.chrome],
    ['Node.js', info.node], ['V8', info.v8],
  ];
  $('sysGrid').innerHTML = rows.map(([k, v]) => `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('');
  const used = info.memTotal - info.memFree, pct = Math.round((used / info.memTotal) * 100);
  $('memBar').style.width = pct + '%';
  $('memText').textContent = `${fmtBytes(used)} / ${fmtBytes(info.memTotal)} (${pct}%)`;
  $('refreshedAt').textContent = 'อัปเดตเมื่อ ' + new Date().toLocaleTimeString();
}

// ======================= SETTINGS =========================================
function markTheme(mode) { document.querySelectorAll('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.themeMode === mode)); }
function applyThemeAttr(info) { document.documentElement.setAttribute('data-theme', info.source === 'system' ? (info.dark ? 'dark' : 'light') : info.source); }
async function initSettings() {
  const s = await window.gogigi.settings.getAll();
  markTheme(s.theme || 'system'); $('displayName').value = s.displayName || '';
  applyThemeAttr(await window.gogigi.theme.get());
  document.querySelectorAll('#themeSeg button').forEach((b) => b.addEventListener('click', async () => {
    markTheme(b.dataset.themeMode); await window.gogigi.theme.set(b.dataset.themeMode); applyThemeAttr(await window.gogigi.theme.get());
  }));
  let t = null;
  $('displayName').addEventListener('input', (e) => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => window.gogigi.settings.set('displayName', v), 400); });
  window.gogigi.theme.onChange((d) => applyThemeAttr(d));
  $('btnOpenData').addEventListener('click', () => window.gogigi.system.openPath('userData'));
  $('btnOpenLogs').addEventListener('click', () => window.gogigi.system.openPath('logs'));
  $('themeToggle').addEventListener('click', async () => {
    const cur = await window.gogigi.theme.get();
    const isDark = cur.source === 'dark' || (cur.source === 'system' && cur.dark);
    const next = isDark ? 'light' : 'dark';
    markTheme(next); await window.gogigi.theme.set(next); applyThemeAttr(await window.gogigi.theme.get());
  });
}

// ======================= BUNDLED CHROMIUM =================================
let chromiumInstalled = false;
async function refreshChromium() {
  const s = await window.gogigi.chromium.status(); chromiumInstalled = !!s.installed;
  const btn = $('btnChromium'); btn.disabled = false;
  if (s.installed) { $('chromiumDesc').textContent = `ติดตั้งแล้ว (build ${s.buildId})`; btn.textContent = 'ลบ'; btn.classList.add('danger'); }
  else { $('chromiumDesc').textContent = 'ยังไม่ได้ดาวน์โหลด (~150MB ครั้งเดียว)'; btn.textContent = 'ดาวน์โหลด'; btn.classList.remove('danger'); }
}
function initChromium() {
  window.gogigi.chromium.onProgress(({ dl, total }) => {
    if (total) { const pct = Math.round((dl / total) * 100); $('chrBar').style.display = 'block'; $('chrBarFill').style.width = pct + '%'; $('chromiumDesc').textContent = `กำลังดาวน์โหลด Chromium… ${pct}%`; }
  });
  $('btnChromium').addEventListener('click', async () => {
    if (chromiumInstalled) { if (confirm('ลบ Chromium ที่ดาวน์โหลดไว้?')) { await window.gogigi.chromium.remove(); await refreshChromium(); } }
    else { $('btnChromium').disabled = true; $('chrBar').style.display = 'block'; $('chromiumDesc').textContent = 'กำลังเริ่มดาวน์โหลด…'; const r = await window.gogigi.chromium.ensure(); $('chrBar').style.display = 'none'; if (!r.ok) $('chromiumDesc').textContent = 'ไม่สำเร็จ: ' + r.reason; await refreshChromium(); }
  });
  refreshChromium();
}

// ======================= UPDATES ==========================================
const setStatus = (t) => { $('status').textContent = t; };
const showUpBar = (b) => { $('upBar').style.display = b ? 'block' : 'none'; };
function showUpdateNow(v) { const b = $('btnUpdateNow'); b.textContent = v ? `อัปเดตเป็น v${v}` : 'อัปเดตเลย'; b.style.display = ''; b.disabled = false; $('btnCheck').style.display = 'none'; $('btnRetry').style.display = 'none'; }
function resetUpdateButtons() { $('btnUpdateNow').style.display = 'none'; $('btnRetry').style.display = 'none'; $('btnCheck').style.display = ''; $('btnCheck').disabled = false; }
function initUpdates() {
  $('btnRefresh').addEventListener('click', loadSystem);
  $('repoLink').addEventListener('click', (e) => { e.preventDefault(); window.gogigi.openExternal(REPO_URL); });
  $('btnCheck').addEventListener('click', async () => {
    $('btnCheck').disabled = true; setStatus('กำลังตรวจหาอัปเดต…');
    const r = await window.gogigi.update.check();
    if (!r.ok && r.reason === 'dev-mode') { setStatus('โหมด dev: อัปเดตใช้ได้เฉพาะแอปที่ติดตั้งจริง'); $('btnCheck').disabled = false; }
    else if (!r.ok) { setStatus('ตรวจอัปเดตไม่สำเร็จ: ' + r.reason); $('btnCheck').disabled = false; }
  });
  $('btnUpdateNow').addEventListener('click', async () => {
    $('btnUpdateNow').disabled = true; showUpBar(true); setStatus('กำลังดาวน์โหลดอัปเดต…');
    const r = await window.gogigi.update.download();
    if (!r.ok) { showUpBar(false); setStatus('ดาวน์โหลดไม่สำเร็จ: ' + r.reason); $('btnUpdateNow').disabled = false; }
  });
  $('btnRetry').addEventListener('click', () => { resetUpdateButtons(); setStatus('พร้อมใช้งาน'); });
  window.gogigi.update.onStatus((s) => {
    switch (s.state) {
      case 'checking': setStatus('กำลังตรวจหาอัปเดต…'); break;
      case 'up-to-date': resetUpdateButtons(); setStatus(`เป็นเวอร์ชันล่าสุดแล้ว (v${s.version}) ✓`); break;
      case 'available': setStatus(`มีเวอร์ชันใหม่: v${s.version}`); showUpdateNow(s.version); break;
      case 'downloading': showUpBar(true); $('upBarFill').style.width = (s.percent || 0) + '%'; setStatus(`กำลังดาวน์โหลด… ${s.percent || 0}%`); break;
      case 'downloaded': showUpBar(false); setStatus(`ดาวน์โหลดเสร็จ (v${s.version}) — กำลังติดตั้งและรีสตาร์ท…`); setTimeout(() => window.gogigi.update.install(), 800); break;
      case 'error': showUpBar(false); setStatus('ข้อผิดพลาด: ' + s.message); $('btnUpdateNow').style.display = 'none'; $('btnRetry').style.display = ''; $('btnCheck').style.display = ''; $('btnCheck').disabled = false; break;
    }
  });
}

// ======================= BOOT =============================================
async function init() {
  try { const v = await window.gogigi.getVersion(); $('version').textContent = v; $('curVer').textContent = v; } catch { $('version').textContent = '?'; }
  initProfilesUI(); initExtensionsUI(); await initSettings(); initChromium(); initUpdates();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeModal(); $('gmodal').style.display = 'none'; } });
  await loadGroups();
  allExtensions = await window.gogigi.extensions.list();
  await loadProfiles();
}
init();
