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

async function installedChromes() {
  try {
    const list = await bp.getInstalledBrowsers({ cacheDir });
    return list.filter((b) => b.browser === bp.Browser.CHROME);
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

module.exports = { init, status, ensure, getExecutable, remove };
