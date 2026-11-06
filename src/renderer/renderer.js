'use strict';

const $ = (id) => document.getElementById(id);
const REPO_URL = 'https://github.com/shadow-artlap/GoGiGi/releases';

// ---- helpers --------------------------------------------------------------
const fmtBytes = (n) => {
  if (!n && n !== 0) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
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
  });
});

// ---- dashboard ------------------------------------------------------------
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
    `<div class="card"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  const used = info.memTotal - info.memFree;
  const pct = Math.round((used / info.memTotal) * 100);
  $('memBar').style.width = pct + '%';
  $('memText').textContent = `${fmtBytes(used)} / ${fmtBytes(info.memTotal)} (${pct}%)`;

  const t = new Date();
  $('refreshedAt').textContent = 'อัปเดตเมื่อ ' + t.toLocaleTimeString();
}
$('btnRefresh').addEventListener('click', loadSystem);

// ---- settings -------------------------------------------------------------
function markTheme(mode) {
  document.querySelectorAll('#themeSeg button').forEach((b) =>
    b.classList.toggle('active', b.dataset.themeMode === mode));
}
function applyThemeAttr(info) {
  // info: { source, dark }
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
      const mode = b.dataset.themeMode;
      markTheme(mode);
      await window.gogigi.theme.set(mode);
      applyThemeAttr(await window.gogigi.theme.get());
    });
  });

  let saveTimer = null;
  $('displayName').addEventListener('input', (e) => {
    clearTimeout(saveTimer);
    const val = e.target.value;
    saveTimer = setTimeout(() => window.gogigi.settings.set('displayName', val), 400);
  });

  // React to OS theme flips while in "system" mode.
  window.gogigi.theme.onChange((d) => applyThemeAttr(d));
}

$('btnOpenData').addEventListener('click', () => window.gogigi.system.openPath('userData'));
$('btnOpenLogs').addEventListener('click', () => window.gogigi.system.openPath('logs'));

// ---- updates --------------------------------------------------------------
const setStatus = (t) => { $('status').textContent = t; };
const showUpBar = (b) => { $('upBar').style.display = b ? 'block' : 'none'; };

function initUpdates() {
  $('repoLink').addEventListener('click', (e) => { e.preventDefault(); window.gogigi.openExternal(REPO_URL); });

  $('btnCheck').addEventListener('click', async () => {
    $('btnCheck').disabled = true;
    setStatus('กำลังตรวจหาอัปเดต…');
    const r = await window.gogigi.update.check();
    if (!r.ok && r.reason === 'dev-mode') {
      setStatus('โหมด dev: auto-update ทำงานเฉพาะเวอร์ชันที่ติดตั้งแล้ว');
      $('btnCheck').disabled = false;
    } else if (!r.ok) {
      setStatus('ตรวจอัปเดตไม่สำเร็จ: ' + r.reason);
      $('btnCheck').disabled = false;
    }
  });

  $('btnDownload').addEventListener('click', async () => {
    $('btnDownload').disabled = true;
    setStatus('กำลังเริ่มดาวน์โหลด…'); showUpBar(true);
    const r = await window.gogigi.update.download();
    if (!r.ok) { setStatus('ดาวน์โหลดไม่สำเร็จ: ' + r.reason); showUpBar(false); }
  });

  $('btnInstall').addEventListener('click', () => {
    setStatus('กำลังติดตั้งและรีสตาร์ท…');
    window.gogigi.update.install();
  });

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

// ---- boot -----------------------------------------------------------------
async function init() {
  try {
    const v = await window.gogigi.getVersion();
    $('version').textContent = v;
    $('curVer').textContent = v;
  } catch { $('version').textContent = '?'; }
  await initSettings();
  initUpdates();
  await loadSystem();
}
init();
