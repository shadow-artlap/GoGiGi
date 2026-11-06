'use strict';

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const barEl = $('bar');
const barFill = $('barFill');
const btnCheck = $('btnCheck');
const btnDownload = $('btnDownload');
const btnInstall = $('btnInstall');

const REPO_URL = 'https://github.com/OWNER_PLACEHOLDER/GoGiGi/releases';

function setStatus(text) { statusEl.textContent = text; }
function showBar(show) { barEl.style.display = show ? 'block' : 'none'; }

async function init() {
  try {
    const v = await window.gogigi.getVersion();
    $('version').textContent = v;
  } catch { $('version').textContent = '?'; }

  $('repoLink').addEventListener('click', (e) => {
    e.preventDefault();
    window.gogigi.openExternal(REPO_URL);
  });

  btnCheck.addEventListener('click', async () => {
    btnCheck.disabled = true;
    setStatus('กำลังตรวจหาอัปเดต…');
    const r = await window.gogigi.update.check();
    if (!r.ok && r.reason === 'dev-mode') {
      setStatus('โหมด dev: auto-update ทำงานเฉพาะเวอร์ชันที่ build/ติดตั้งแล้ว');
      btnCheck.disabled = false;
    } else if (!r.ok) {
      setStatus('ตรวจอัปเดตไม่สำเร็จ: ' + r.reason);
      btnCheck.disabled = false;
    }
    // success → UI continues via update:status events
  });

  btnDownload.addEventListener('click', async () => {
    btnDownload.disabled = true;
    setStatus('กำลังเริ่มดาวน์โหลด…');
    showBar(true);
    const r = await window.gogigi.update.download();
    if (!r.ok) { setStatus('ดาวน์โหลดไม่สำเร็จ: ' + r.reason); showBar(false); }
  });

  btnInstall.addEventListener('click', () => {
    setStatus('กำลังติดตั้งและรีสตาร์ท…');
    window.gogigi.update.install();
  });

  // Live status from the main process / electron-updater
  window.gogigi.update.onStatus((s) => {
    switch (s.state) {
      case 'checking':
        setStatus('กำลังตรวจหาอัปเดต…'); break;
      case 'up-to-date':
        setStatus(`เป็นเวอร์ชันล่าสุดแล้ว (v${s.version})`);
        btnCheck.disabled = false; break;
      case 'available':
        setStatus(`มีเวอร์ชันใหม่: v${s.version}`);
        btnDownload.disabled = false; btnCheck.disabled = false; break;
      case 'downloading':
        showBar(true); barFill.style.width = (s.percent || 0) + '%';
        setStatus(`กำลังดาวน์โหลด… ${s.percent || 0}%`); break;
      case 'downloaded':
        showBar(false); setStatus(`ดาวน์โหลดเสร็จ (v${s.version}) — พร้อมติดตั้ง`);
        btnInstall.disabled = false; break;
      case 'error':
        showBar(false); setStatus('ข้อผิดพลาด: ' + s.message);
        btnCheck.disabled = false; break;
      default: break;
    }
  });
}

init();
