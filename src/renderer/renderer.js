'use strict';

const $ = (id) => document.getElementById(id);
const REPO_URL = 'https://github.com/shadow-artlap/GoGiGi/releases';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- helpers --------------------------------------------------------------
const fmtBytes = (n) => {
  if (!n && n !== 0) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
};
const fmtUptime = (s) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
};

// ---- tabs -----------------------------------------------------------------
document.querySelectorAll('nav.tabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    $(`view-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'profiles') loadProfiles();
    if (btn.dataset.tab === 'dashboard') loadSystem();
  });
});

// ======================= PROFILES =========================================
let allProfiles = [];
let browsersList = [];

function proxySummary(p) {
  if (!p || !p.host) return 'ไม่มี proxy';
  return `${p.scheme}://${p.host}:${p.port}${p.username ? ' 🔒' : ''}`;
}

function renderProfiles() {
  const q = ($('searchProfiles').value || '').toLowerCase();
  const items = allProfiles.filter((p) =>
    !q || p.name.toLowerCase().includes(q) || (p.group || '').toLowerCase().includes(q));

  $('profileCount').textContent = `${allProfiles.length} โปรไฟล์`;
  $('profileEmpty').style.display = allProfiles.length ? 'none' : 'block';

  $('profileList').innerHTML = items.map((p) => `
    <div class="pcard ${p.running ? 'running' : ''}">
      <span class="dot"></span>
      <div class="pinfo">
        <div class="pname">${esc(p.name)} ${p.group ? `<span class="tag">${esc(p.group)}</span>` : ''}</div>
        <div class="pmeta">${p.browser === 'edge' ? 'Edge' : 'Chrome'} · ${esc(proxySummary(p.proxy))}${p.notes ? ' · ' + esc(p.notes) : ''}</div>
      </div>
      <div class="pactions">
        ${p.running
          ? `<button class="btn sm" data-act="stop" data-id="${p.id}">หยุด</button>`
          : `<button class="btn sm primary" data-act="launch" data-id="${p.id}">เปิด</button>`}
        <button class="btn sm" data-act="edit" data-id="${p.id}">แก้ไข</button>
        <button class="btn sm" data-act="dir" data-id="${p.id}">📁</button>
        <button class="btn sm danger" data-act="del" data-id="${p.id}">ลบ</button>
      </div>
    </div>`).join('');

  $('profileList').querySelectorAll('button[data-act]').forEach((b) => {
    b.addEventListener('click', () => onProfileAction(b.dataset.act, b.dataset.id));
  });
}

async function onProfileAction(act, id) {
  const p = allProfiles.find((x) => x.id === id);
  if (act === 'launch') {
    const r = await window.gogigi.profiles.launch(id);
    if (!r.ok) alert('เปิดไม่สำเร็จ: ' + r.reason);
    await loadProfiles();
  } else if (act === 'stop') {
    await window.gogigi.profiles.stop(id);
    await loadProfiles();
  } else if (act === 'edit') {
    openModal(p);
  } else if (act === 'dir') {
    window.gogigi.profiles.openDir(id);
  } else if (act === 'del') {
    if (p.running) { alert('ปิดโปรไฟล์ก่อนจึงจะลบได้'); return; }
    if (confirm(`ลบโปรไฟล์ "${p.name}" และข้อมูลทั้งหมด?`)) {
      await window.gogigi.profiles.remove(id);
      await loadProfiles();
    }
  }
}

async function loadProfiles() {
  allProfiles = await window.gogigi.profiles.list();
  renderProfiles();
}

// ---- modal ----------------------------------------------------------------
async function ensureBrowsers() {
  if (browsersList.length) return;
  browsersList = await window.gogigi.browsers.list();
  const sel = $('f_browser');
  sel.innerHTML = browsersList.length
    ? browsersList.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')
    : '<option value="chrome">Chrome (ไม่พบในเครื่อง)</option>';
}

async function openModal(p) {
  await ensureBrowsers();
  const editing = !!p;
  $('modalTitle').textContent = editing ? 'แก้ไขโปรไฟล์' : 'โปรไฟล์ใหม่';
  $('f_id').value = editing ? p.id : '';
  $('f_name').value = editing ? p.name : '';
  $('f_group').value = editing ? (p.group || '') : '';
  $('f_browser').value = editing ? p.browser : (browsersList[0] ? browsersList[0].id : 'chrome');
  $('f_startUrl').value = editing ? (p.startUrl || '') : '';
  $('f_ua').value = editing ? (p.userAgent || '') : '';
  const px = (editing && p.proxy) || {};
  $('f_pscheme').value = px.scheme || 'http';
  $('f_phost').value = px.host || '';
  $('f_pport').value = px.port || '';
  $('f_puser').value = px.username || '';
  $('f_ppass').value = px.password || '';
  $('f_notes').value = editing ? (p.notes || '') : '';
  $('modal').style.display = 'flex';
}
function closeModal() { $('modal').style.display = 'none'; }

function readModal() {
  const host = $('f_phost').value.trim();
  return {
    name: $('f_name').value.trim() || 'New Profile',
    group: $('f_group').value.trim(),
    browser: $('f_browser').value,
    startUrl: $('f_startUrl').value.trim(),
    userAgent: $('f_ua').value.trim(),
    notes: $('f_notes').value.trim(),
    proxy: host ? {
      scheme: $('f_pscheme').value,
      host,
      port: $('f_pport').value.trim(),
      username: $('f_puser').value.trim(),
      password: $('f_ppass').value,
    } : null,
  };
}

async function saveModal() {
  const data = readModal();
  const id = $('f_id').value;
  if (id) await window.gogigi.profiles.update(id, data);
  else await window.gogigi.profiles.create(data);
  closeModal();
  await loadProfiles();
}

function initProfilesUI() {
  $('btnNewProfile').addEventListener('click', () => openModal(null));
  $('searchProfiles').addEventListener('input', renderProfiles);
  $('modalClose').addEventListener('click', closeModal);
  $('modalCancel').addEventListener('click', closeModal);
  $('modalSave').addEventListener('click', saveModal);
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  window.gogigi.profiles.onChange(() => loadProfiles());
}

// ======================= DASHBOARD ========================================
async function loadSystem() {
  const info = await window.gogigi.system.getInfo();
  const rows = [
    ['ระบบปฏิบัติการ', `${info.platform} ${info.arch} (${info.osRelease})`],
    ['ชื่อเครื่อง', info.hostname],
    ['CPU', info.cpuModel],
    ['จำนวนคอร์', String(info.cpuCores)],
    ['RAM ทั้งหมด', fmtBytes(info.memTotal)],
    ['เปิดเครื่องมา', fmtUptime(info.uptime)],
    ['Electron', info.electron],
    ['Chromium', info.chrome],
    ['Node.js', info.node],
    ['V8', info.v8],
  ];
  $('sysGrid').innerHTML = rows.map(([k, v]) =>
    `<div class="card"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`).join('');
  const used = info.memTotal - info.memFree;
  const pct = Math.round((used / info.memTotal) * 100);
  $('memBar').style.width = pct + '%';
  $('memText').textContent = `${fmtBytes(used)} / ${fmtBytes(info.memTotal)} (${pct}%)`;
  $('refreshedAt').textContent = 'อัปเดตเมื่อ ' + new Date().toLocaleTimeString();
}

// ======================= SETTINGS =========================================
function markTheme(mode) {
  document.querySelectorAll('#themeSeg button').forEach((b) =>
    b.classList.toggle('active', b.dataset.themeMode === mode));
}
function applyThemeAttr(info) {
  const attr = info.source === 'system' ? (info.dark ? 'dark' : 'light') : info.source;
  document.documentElement.setAttribute('data-theme', attr);
}
async function initSettings() {
  const s = await window.gogigi.settings.getAll();
  markTheme(s.theme || 'system');
  $('displayName').value = s.displayName || '';
  applyThemeAttr(await window.gogigi.theme.get());
  document.querySelectorAll('#themeSeg button').forEach((b) => {
    b.addEventListener('click', async () => {
      markTheme(b.dataset.themeMode);
      await window.gogigi.theme.set(b.dataset.themeMode);
      applyThemeAttr(await window.gogigi.theme.get());
    });
  });
  let t = null;
  $('displayName').addEventListener('input', (e) => {
    clearTimeout(t); const v = e.target.value;
    t = setTimeout(() => window.gogigi.settings.set('displayName', v), 400);
  });
  window.gogigi.theme.onChange((d) => applyThemeAttr(d));
}
$('btnOpenData').addEventListener('click', () => window.gogigi.system.openPath('userData'));
$('btnOpenLogs').addEventListener('click', () => window.gogigi.system.openPath('logs'));

// ======================= UPDATES ==========================================
const setStatus = (t) => { $('status').textContent = t; };
const showUpBar = (b) => { $('upBar').style.display = b ? 'block' : 'none'; };
function initUpdates() {
  $('btnRefresh').addEventListener('click', loadSystem);
  $('repoLink').addEventListener('click', (e) => { e.preventDefault(); window.gogigi.openExternal(REPO_URL); });
  $('btnCheck').addEventListener('click', async () => {
    $('btnCheck').disabled = true; setStatus('กำลังตรวจหาอัปเดต…');
    const r = await window.gogigi.update.check();
    if (!r.ok && r.reason === 'dev-mode') { setStatus('โหมด dev: auto-update ทำงานเฉพาะเวอร์ชันที่ติดตั้งแล้ว'); $('btnCheck').disabled = false; }
    else if (!r.ok) { setStatus('ตรวจอัปเดตไม่สำเร็จ: ' + r.reason); $('btnCheck').disabled = false; }
  });
  $('btnDownload').addEventListener('click', async () => {
    $('btnDownload').disabled = true; setStatus('กำลังเริ่มดาวน์โหลด…'); showUpBar(true);
    const r = await window.gogigi.update.download();
    if (!r.ok) { setStatus('ดาวน์โหลดไม่สำเร็จ: ' + r.reason); showUpBar(false); }
  });
  $('btnInstall').addEventListener('click', () => { setStatus('กำลังติดตั้งและรีสตาร์ท…'); window.gogigi.update.install(); });
  window.gogigi.update.onStatus((s) => {
    switch (s.state) {
      case 'checking': setStatus('กำลังตรวจหาอัปเดต…'); break;
      case 'up-to-date': setStatus(`เป็นเวอร์ชันล่าสุดแล้ว (v${s.version})`); $('btnCheck').disabled = false; break;
      case 'available': setStatus(`มีเวอร์ชันใหม่: v${s.version}`); $('btnDownload').disabled = false; $('btnCheck').disabled = false; break;
      case 'downloading': showUpBar(true); $('upBarFill').style.width = (s.percent || 0) + '%'; setStatus(`กำลังดาวน์โหลด… ${s.percent || 0}%`); break;
      case 'downloaded': showUpBar(false); setStatus(`ดาวน์โหลดเสร็จ (v${s.version}) — พร้อมติดตั้ง`); $('btnInstall').disabled = false; break;
      case 'error': showUpBar(false); setStatus('ข้อผิดพลาด: ' + s.message); $('btnCheck').disabled = false; break;
    }
  });
}

// ======================= BOOT =============================================
async function init() {
  try {
    const v = await window.gogigi.getVersion();
    $('version').textContent = v; $('curVer').textContent = v;
  } catch { $('version').textContent = '?'; }
  initProfilesUI();
  await initSettings();
  initUpdates();
  await loadProfiles();
}
init();
