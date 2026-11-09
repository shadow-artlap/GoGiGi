'use strict';

// GoGiGi — Profile Manager core.
// Each profile is an isolated browser identity: own user-data-dir, optional
// proxy, platform account, tabs, fingerprint overrides, and extensions.
// Profiles launch through the fingerprint engine (puppeteer/CDP).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fingerprint = require('./fingerprint');
const extensions = require('./extensions');

let USERDATA = '';
let PROFILES_DIR = '';
let INDEX_FILE = '';

function init(app) {
  USERDATA = app.getPath('userData');
  PROFILES_DIR = path.join(USERDATA, 'profiles');
  INDEX_FILE = path.join(USERDATA, 'profiles.json');
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

// ---- storage --------------------------------------------------------------
function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch { return []; }
}
function writeIndex(list) {
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(list, null, 2));
}
function profileDir(id) { return path.join(PROFILES_DIR, id); }

function normalizeProxy(p) {
  if (!p || !p.host) return null;
  return {
    scheme: ['http', 'https', 'socks5', 'socks4'].includes(p.scheme) ? p.scheme : 'http',
    host: String(p.host).trim(),
    port: String(p.port || '').trim(),
    username: p.username || '',
    password: p.password || '',
  };
}
function normalizeFingerprint(f) {
  f = f || {};
  const scr = f.screen && f.screen.width ? { width: Number(f.screen.width), height: Number(f.screen.height) } : null;
  const geo = (f.geo && f.geo.lat !== '' && f.geo.lat != null) ? { lat: Number(f.geo.lat), lon: Number(f.geo.lon) } : null;
  return {
    userAgent: f.userAgent || '',
    uaPlatform: f.uaPlatform || '',
    timezone: f.timezone || '',
    locale: f.locale || '',
    geo,
    screen: scr,
    webrtc: ['real', 'disabled', 'proxy-udp'].includes(f.webrtc) ? f.webrtc : 'proxy-udp',
    hardwareConcurrency: f.hardwareConcurrency ? Number(f.hardwareConcurrency) : null,
    deviceMemory: f.deviceMemory ? Number(f.deviceMemory) : null,
    webglVendor: f.webglVendor || '',
    webglRenderer: f.webglRenderer || '',
    canvasNoise: f.canvasNoise !== false,
  };
}
function normalizePlatform(p) {
  if (!p || (!p.name && !p.account)) return null;
  return {
    name: p.name || '',
    account: p.account || '',
    password: p.password || '',
    twofa: p.twofa || '',
    note: p.note || '',
  };
}
function toArray(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') return v.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  return [];
}

function newProfile(d = {}) {
  return {
    id: crypto.randomBytes(6).toString('hex'),
    name: d.name || 'New Profile',
    group: d.group || '',
    browser: ['bundled', 'chrome', 'edge'].includes(d.browser) ? d.browser : 'bundled',
    proxy: normalizeProxy(d.proxy),
    platform: normalizePlatform(d.platform),
    tabs: toArray(d.tabs),
    fingerprint: normalizeFingerprint(d.fingerprint),
    extensions: toArray(d.extensions),
    tags: toArray(d.tags),
    remark: d.remark || '',
    proxyInfo: d.proxyInfo || null,
    createdAt: Date.now(),
    lastUsedAt: null,
  };
}

function withRunning(p) { return { ...p, running: fingerprint.isRunning(p.id) }; }

function list() { return readIndex().map(withRunning); }
function get(id) { return readIndex().find((x) => x.id === id); }

function create(d) {
  const items = readIndex();
  const p = newProfile(d);
  items.push(p);
  writeIndex(items);
  return withRunning(p);
}
function update(id, d) {
  const items = readIndex();
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return { ok: false, reason: 'not-found' };
  const cur = items[i];
  items[i] = {
    ...cur,
    name: d.name ?? cur.name,
    group: d.group ?? cur.group,
    browser: ['bundled', 'chrome', 'edge'].includes(d.browser) ? d.browser : cur.browser,
    proxy: d.proxy !== undefined ? normalizeProxy(d.proxy) : cur.proxy,
    platform: d.platform !== undefined ? normalizePlatform(d.platform) : cur.platform,
    tabs: d.tabs !== undefined ? toArray(d.tabs) : cur.tabs,
    fingerprint: d.fingerprint !== undefined ? normalizeFingerprint(d.fingerprint) : cur.fingerprint,
    extensions: d.extensions !== undefined ? toArray(d.extensions) : cur.extensions,
    tags: d.tags !== undefined ? toArray(d.tags) : cur.tags,
    remark: d.remark ?? cur.remark,
    proxyInfo: d.proxyInfo !== undefined ? d.proxyInfo : cur.proxyInfo,
  };
  writeIndex(items);
  return { ok: true, profile: withRunning(items[i]) };
}

function setProxyInfo(id, info) {
  const items = readIndex();
  const p = items.find((x) => x.id === id);
  if (!p) return { ok: false, reason: 'not-found' };
  p.proxyInfo = info;
  writeIndex(items);
  return { ok: true };
}
function remove(id) {
  if (fingerprint.isRunning(id)) return { ok: false, reason: 'running' };
  writeIndex(readIndex().filter((x) => x.id !== id));
  try { fs.rmSync(profileDir(id), { recursive: true, force: true }); } catch {}
  return { ok: true };
}
function removeMany(ids) {
  const set = new Set(ids);
  const keep = readIndex().filter((x) => {
    if (set.has(x.id) && !fingerprint.isRunning(x.id)) {
      try { fs.rmSync(profileDir(x.id), { recursive: true, force: true }); } catch {}
      return false;
    }
    return true;
  });
  writeIndex(keep);
  return { ok: true };
}
function setGroupMany(ids, group) {
  const set = new Set(ids);
  const items = readIndex();
  for (const p of items) if (set.has(p.id)) p.group = group;
  writeIndex(items);
  return { ok: true };
}

// ---- browser detection ----------------------------------------------------
function candidatePaths() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  return {
    chrome: [
      path.join(pf, 'Google/Chrome/Application/chrome.exe'),
      path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
      local && path.join(local, 'Google/Chrome/Application/chrome.exe'),
    ].filter(Boolean),
    edge: [
      path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
      path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    ],
  };
}
function resolveBrowser(which) {
  for (const c of (candidatePaths()[which] || [])) if (fs.existsSync(c)) return c;
  return null;
}
function browsers() {
  const out = [{ id: 'bundled', name: 'GoGiGi Chromium (bundled)', path: null }];
  const c = resolveBrowser('chrome'); if (c) out.push({ id: 'chrome', name: 'Google Chrome', path: c });
  const e = resolveBrowser('edge'); if (e) out.push({ id: 'edge', name: 'Microsoft Edge', path: e });
  return out;
}

// ---- launch / stop (via fingerprint engine) -------------------------------
async function launch(id, exeOverride) {
  if (fingerprint.isRunning(id)) return { ok: false, reason: 'already-running' };
  const items = readIndex();
  const profile = items.find((x) => x.id === id);
  if (!profile) return { ok: false, reason: 'not-found' };
  const exe = exeOverride || resolveBrowser(profile.browser);
  if (!exe) return { ok: false, reason: `browser-not-found: ${profile.browser}` };

  const dir = profileDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const extraArgs = [];
  const extPaths = extensions.resolvePaths(profile.extensions || []);
  if (extPaths.length) {
    extraArgs.push(`--disable-extensions-except=${extPaths.join(',')}`);
    extraArgs.push(`--load-extension=${extPaths.join(',')}`);
  }

  const r = await fingerprint.launch({
    id,
    exePath: exe,
    userDataDir: dir,
    extraArgs,
    proxy: profile.proxy,
    fp: profile.fingerprint || {},
    tabs: profile.tabs || [],
    startUrl: (profile.tabs && profile.tabs[0]) || '',
  });
  if (r.ok) {
    profile.lastUsedAt = Date.now();
    writeIndex(items);
  }
  return r;
}
function stop(id) { return fingerprint.stop(id); }
function openDir(id) { return profileDir(id); }
function setOnChange(fn) { fingerprint.setOnChange(fn); }

module.exports = {
  init, list, get, create, update, remove, removeMany, setGroupMany, setProxyInfo,
  browsers, launch, stop, openDir, setOnChange,
};
