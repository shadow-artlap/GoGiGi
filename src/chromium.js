'use strict';

// Bundled Chromium manager — downloads an official "Chrome for Testing" build
// into userData on first use and caches it, so profiles can run on a
// self-contained browser that does not depend on the user's installed Chrome.

const fs = require('fs');
const path = require('path');
const bp = require('@puppeteer/browsers');

let cacheDir = '';

function init(userData) {
  cacheDir = path.join(userData, 'chromium');
  fs.mkdirSync(cacheDir, { recursive: true });
}

// "131.0.6778.85" vs "131.0.6778.108" — numeric, part by part.
function cmpBuild(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Installed builds, oldest first (so the last one is the newest).
async function installedChromes() {
  try {
    const list = await bp.getInstalledBrowsers({ cacheDir });
    return list.filter((b) => b.browser === bp.Browser.CHROME).sort((a, b) => cmpBuild(a.buildId, b.buildId));
  } catch {
    return [];
  }
}

// Offline status — does not hit the network.
async function status() {
  const list = await installedChromes();
  if (list.length) {
    const b = list[list.length - 1];
    return { installed: true, buildId: b.buildId, path: b.executablePath, platform: b.platform };
  }
  return { installed: false };
}

// Ensure a Chromium is present; downloads the latest stable if missing.
// progress: (downloadedBytes, totalBytes) => void
// Concurrent callers (Settings button + a bundled profile launch) share one
// download instead of racing two installs into the same folder.
let inflight = null;
const listeners = new Set();
function ensure(progress) {
  if (progress) listeners.add(progress);
  if (!inflight) {
    inflight = ensureOnce((dl, total) => { for (const l of listeners) { try { l(dl, total); } catch (e) {} } })
      .finally(() => { inflight = null; listeners.clear(); });
  }
  return inflight;
}

async function ensureOnce(progress) {
  const existing = await installedChromes();
  if (existing.length) {
    const b = existing[existing.length - 1];
    return { ok: true, path: b.executablePath, buildId: b.buildId };
  }
  try {
    const platform = bp.detectBrowserPlatform();
    if (!platform) return { ok: false, reason: 'unsupported-platform' };
    const buildId = await bp.resolveBuildId(bp.Browser.CHROME, platform, 'stable');
    const inst = await bp.install({
      browser: bp.Browser.CHROME,
      buildId,
      cacheDir,
      downloadProgressCallback: (dl, total) => { try { progress && progress(dl, total); } catch { /* ignore */ } },
    });
    return { ok: true, path: inst.executablePath, buildId };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}

// Keep the bundled engine on the current stable release: an old Chrome
// version is itself a fingerprint (real users auto-update within days).
// Downloads the new build next to the old one, so running profiles keep
// working; older builds are deleted once nothing runs on them.
// inUse: executable paths of browsers that are running right now.
let checking = null;
function checkUpdate(progress, inUse = []) {
  if (!checking) checking = checkUpdateOnce(progress, inUse).finally(() => { checking = null; });
  return checking;
}
async function checkUpdateOnce(progress, inUse) {
  const list = await installedChromes();
  if (!list.length) return { ok: true, updated: false, installed: false };
  const cur = list[list.length - 1];
  let latest;
  try {
    latest = await bp.resolveBuildId(bp.Browser.CHROME, bp.detectBrowserPlatform(), 'stable');
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
  let updated = false;
  if (cmpBuild(latest, cur.buildId) > 0) {
    if (inflight) await inflight.catch(() => {});
    try {
      await bp.install({
        browser: bp.Browser.CHROME, buildId: latest, cacheDir,
        downloadProgressCallback: (dl, total) => { try { progress && progress(dl, total); } catch { /* ignore */ } },
      });
      updated = true;
    } catch (e) { return { ok: false, reason: String((e && e.message) || e), current: cur.buildId, latest }; }
  }
  await prune(inUse);
  return { ok: true, updated, from: cur.buildId, current: updated ? latest : cur.buildId, latest };
}
// Remove every build except the newest one and any build still running.
async function prune(inUse = []) {
  const list = await installedChromes();
  const norm = (p) => path.resolve(String(p || '')).toLowerCase();
  const busy = new Set(inUse.map(norm));
  for (const b of list.slice(0, -1)) {
    if (busy.has(norm(b.executablePath))) continue;
    try { await bp.uninstall({ browser: bp.Browser.CHROME, buildId: b.buildId, cacheDir }); } catch (e) { /* locked: next time */ }
  }
}

async function getExecutable() {
  const s = await status();
  return s.installed ? s.path : null;
}

async function remove() {
  try {
    const list = await installedChromes();
    for (const b of list) {
      await bp.uninstall({ browser: bp.Browser.CHROME, buildId: b.buildId, cacheDir });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}

module.exports = { init, status, ensure, getExecutable, remove, checkUpdate, prune, cmpBuild };
