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
let allProfiles = [], allGroups = [], allExtensions = [], browsersList = [];
let selected = new Set();
let launching = new Set();
let lastProxyInfo = null;
let proxyUse = {};

const proxySummary = (p) => (!p || !p.host) ? '<span class="muted">ไม่มี</span>'
  : `<span class="mono">${esc(p.host)}:${esc(p.port)}</span>${p.username ? ' 🔒' : ''}`;
const proxyKey = (px) => (px && px.host) ? `${px.host}:${px.port}` : '';
const proxyCell = (p) => {
  let h = proxySummary(p.proxy);
  if (p.proxyInfo && p.proxyInfo.ip) {
    h += `<div class="sub"><span class="flag">${p.proxyInfo.flag || ''}</span> <span class="mono">${esc(p.proxyInfo.ip)}</span>${p.proxyInfo.country ? ' · ' + esc(p.proxyInfo.country) : ''}${p.proxyInfo.latency ? ' · ' + p.proxyInfo.latency + 'ms' : ''}</div>`;
  }
  const k = proxyKey(p.proxy);
  if (k && proxyUse[k] > 1) {
    h += `<div class="sub warn">⚠ ใช้ร่วม ${proxyUse[k]} โปรไฟล์</div>`;
  }
  return h;
};
const readProxyForm = () => {
  const host = $('f_phost').value.trim();
  return host ? { scheme: $('f_pscheme').value, host, port: $('f_pport').value.trim(), username: $('f_puser').value.trim(), password: $('f_ppass').value } : null;
};
const fpSummary = (f) => {
  if (!f) return '<span class="muted">-</span>';
  const bits = [];
  bits.push(`WebRTC:${f.webrtc || 'proxy-udp'}`);
  if (f.timezone) bits.push(f.timezone);
  if (f.locale) bits.push(f.locale);
  if (f.canvasNoise !== false) bits.push('canvas✓');
  return esc(bits.join(' · '));
};
const platformSub = (p) => {
  const plat = p.platform;
  if (!plat || (!plat.name && !plat.account)) return '';
  return ` · ${esc(plat.name || '')}${plat.account ? ' ' + esc(plat.account) : ''}`;
};

function currentFilterGroup() { return $('groupFilter').value; }

function visibleProfiles() {
  const q = ($('searchProfiles').value || '').toLowerCase();
  const g = currentFilterGroup();
  return allProfiles.filter((p) => {
    if (g === '__all__') { /* all */ }
    else if (g === '__ungrouped__') { if (p.group) return false; }
    else if (g && p.group !== g) return false;
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || (p.group || '').toLowerCase().includes(q)
      || (p.tags || []).join(',').toLowerCase().includes(q);
  });
}

function renderTable() {
  const items = visibleProfiles();
  proxyUse = {};
  for (const p of allProfiles) { const k = proxyKey(p.proxy); if (k) proxyUse[k] = (proxyUse[k] || 0) + 1; }
  $('profileCount').textContent = `${items.length}/${allProfiles.length}`;
  const has = allProfiles.length > 0;
  $('profileEmpty').style.display = has ? 'none' : 'block';
  $('tablewrap').style.display = has ? '' : 'none';
  $('profileRows').innerHTML = items.map((p) => {
    const isLaunching = launching.has(p.id);
    const dot = p.running ? 'on' : (isLaunching ? 'loading' : '');
    const primary = isLaunching
      ? `<button class="btn sm" disabled>กำลังเปิด…</button>`
      : (p.running
        ? `<button class="btn sm" data-act="stop" data-id="${p.id}">หยุด</button>`
        : `<button class="btn sm primary" data-act="launch" data-id="${p.id}">เปิด</button>`);
    return `
    <tr>
      <td><input type="checkbox" class="rowchk" data-id="${p.id}" ${selected.has(p.id) ? 'checked' : ''} /></td>
      <td>
        <div class="pname"><span class="dot ${dot}"></span>${esc(p.name)}</div>
        <div class="sub"><span class="id-chip">${esc(p.id)}</span>${platformSub(p)}</div>
      </td>
      <td>${p.group ? `<span class="tag">${esc(p.group)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="small">${proxyCell(p)}</td>
      <td class="small">${fpSummary(p.fingerprint)}</td>
      <td class="small">${(p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join(' ') || '<span class="muted">—</span>'}</td>
      <td class="small">${fmtDate(p.createdAt)}</td>
      <td class="acts">
        ${primary}
        <span class="rowbtns">
          <button class="btn sm ghost" data-act="iptest" data-id="${p.id}" title="ทดสอบ proxy" ${p.proxy ? '' : 'disabled'}>🌐</button>
          <button class="btn sm ghost" data-act="edit" data-id="${p.id}">แก้ไข</button>
          <button class="btn sm ghost" data-act="dir" data-id="${p.id}" title="เปิดโฟลเดอร์">📁</button>
          <button class="btn sm danger" data-act="del" data-id="${p.id}" title="ลบ">ลบ</button>
        </span>
      </td>
    </tr>`;
  }).join('');
  updateLive();
  $('profileRows').querySelectorAll('button[data-act]').forEach((b) => b.addEventListener('click', () => onAction(b.dataset.act, b.dataset.id)));
  $('profileRows').querySelectorAll('.rowchk').forEach((c) => c.addEventListener('change', () => {
    if (c.checked) selected.add(c.dataset.id); else selected.delete(c.dataset.id);
    updateBulk();
  }));
  updateBulk();
}

function updateBulk() {
  // prune selections no longer visible
  const vis = new Set(visibleProfiles().map((p) => p.id));
  for (const id of [...selected]) if (!vis.has(id)) selected.delete(id);
  $('bulkbar').style.display = selected.size ? 'flex' : 'none';
  $('bulkCount').textContent = `เลือก ${selected.size} รายการ`;
}

function updateLive() {
  const n = allProfiles.filter((p) => p.running).length;
  $('livePill').classList.toggle('on', n > 0);
  $('liveCount').textContent = n > 0 ? `${n} โปรไฟล์กำลังเปิดอยู่` : 'ไม่มีโปรไฟล์ที่เปิดอยู่';
  $('btnCloseAll').style.display = n > 0 ? '' : 'none';
}

async function onAction(act, id) {
  const p = allProfiles.find((x) => x.id === id);
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
  else if (act === 'del') {
    if (p.running) { toast('ปิดโปรไฟล์ก่อน', 'ต้องหยุดโปรไฟล์ก่อนจึงจะลบได้', 'err'); return; }
    if (confirm(`ลบโปรไฟล์ "${p.name}"?`)) { await window.gogigi.profiles.remove(id); await loadProfiles(); toast('ลบแล้ว', p.name); }
  }
}

async function loadProfiles() {
  allProfiles = await window.gogigi.profiles.list();
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

async function openModal(p) {
  await ensureBrowsers();
  const ed = !!p;
  $('modalTitle').textContent = ed ? 'แก้ไขโปรไฟล์' : 'โปรไฟล์ใหม่';
  $('f_id').value = ed ? p.id : '';
  $('f_name').value = ed ? p.name : '';
  $('f_group').value = ed ? (p.group || '') : '';
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
  $('modal').style.display = 'flex';
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
  };
}
async function saveModal() {
  const data = readModal(); const id = $('f_id').value;
  if (id) await window.gogigi.profiles.update(id, data); else await window.gogigi.profiles.create(data);
  closeModal(); await loadProfiles();
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
  $('searchProfiles').addEventListener('input', renderTable);
  $('groupFilter').addEventListener('change', () => { selected.clear(); renderTable(); });
  $('btnManageGroups').addEventListener('click', openGroups);
  $('checkAll').addEventListener('change', (e) => {
    const vis = visibleProfiles();
    if (e.target.checked) vis.forEach((p) => selected.add(p.id)); else selected.clear();
    renderTable();
  });
  $('bulkMove').addEventListener('click', async () => {
    const n = selected.size;
    await window.gogigi.profiles.setGroupMany([...selected], $('bulkGroup').value);
    selected.clear(); await loadProfiles(); toast('ย้ายกลุ่มแล้ว', `${n} โปรไฟล์`);
  });
  $('bulkDelete').addEventListener('click', async () => {
    if (confirm(`ลบ ${selected.size} โปรไฟล์ที่เลือก?`)) { const n = selected.size; await window.gogigi.profiles.removeMany([...selected]); selected.clear(); await loadProfiles(); toast('ลบแล้ว', `${n} โปรไฟล์`); }
  });
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
    lastProxyInfo = { ip: r.ip, country: r.country, countryCode: r.countryCode, flag: r.flag, timezone: r.timezone, latency: r.latency, testedAt: r.testedAt };
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
