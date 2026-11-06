'use strict';

// GoGiGi — Profile Manager core.
// Each profile is an isolated browser identity: its own user-data-dir
// (cookies/storage/history), optional proxy, and user-agent. Profiles are
// launched using the user's installed Chrome/Edge.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');

let USERDATA = '';
let PROFILES_DIR = '';
let INDEX_FILE = '';

// profileId -> { pid }
const running = new Map();

function init(app) {
  USERDATA = app.getPath('userData');
  PROFILES_DIR = path.join(USERDATA, 'profiles');
  INDEX_FILE = path.join(USERDATA, 'profiles.json');
  fs.mkdirSync(PROFILES_DIR, { recursive: true });
}

// ---- storage --------------------------------------------------------------
function readIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); }
  catch { return []; }
}
function writeIndex(list) {
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(list, null, 2));
}
function profileDir(id) { return path.join(PROFILES_DIR, id); }

function newProfile(data = {}) {
  const id = crypto.randomBytes(6).toString('hex');
  return {
    id,
    name: data.name || 'New Profile',
    group: data.group || '',
    browser: data.browser === 'edge' ? 'edge' : 'chrome',
    proxy: normalizeProxy(data.proxy),
    userAgent: data.userAgent || '',
    startUrl: data.startUrl || '',
    notes: data.notes || '',
    createdAt: Date.now(),
    lastUsedAt: null,
  };
}
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

function list() {
  const items = readIndex();
  return items.map((p) => ({ ...p, running: running.has(p.id) }));
}
function create(data) {
  const items = readIndex();
  const p = newProfile(data);
  items.push(p);
  writeIndex(items);
  return { ...p, running: false };
}
function update(id, data) {
  const items = readIndex();
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return { ok: false, reason: 'not-found' };
  items[i] = {
    ...items[i],
    name: data.name ?? items[i].name,
    group: data.group ?? items[i].group,
    browser: data.browser === 'edge' ? 'edge' : (data.browser === 'chrome' ? 'chrome' : items[i].browser),
    proxy: data.proxy !== undefined ? normalizeProxy(data.proxy) : items[i].proxy,
    userAgent: data.userAgent ?? items[i].userAgent,
    startUrl: data.startUrl ?? items[i].startUrl,
    notes: data.notes ?? items[i].notes,
  };
  writeIndex(items);
  return { ok: true, profile: { ...items[i], running: running.has(id) } };
}
function remove(id) {
  if (running.has(id)) return { ok: false, reason: 'running' };
  const items = readIndex().filter((x) => x.id !== id);
  writeIndex(items);
  try { fs.rmSync(profileDir(id), { recursive: true, force: true }); } catch { /* ignore */ }
  return { ok: true };
}

// ---- browser detection ----------------------------------------------------
function candidatePaths() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');
  return {
    chrome: [
      path.join(pf, 'Google/Chrome/Application/chrome.exe'),
      path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
      path.join(local, 'Google/Chrome/Application/chrome.exe'),
    ],
    edge: [
      path.join(pf86, 'Microsoft/Edge/Application/msedge.exe'),
      path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    ],
  };
}
function resolveBrowser(which) {
  const cands = candidatePaths()[which] || [];
  for (const c of cands) { if (fs.existsSync(c)) return c; }
  return null;
}
function browsers() {
  const out = [];
  const c = resolveBrowser('chrome');
  const e = resolveBrowser('edge');
  if (c) out.push({ id: 'chrome', name: 'Google Chrome', path: c });
  if (e) out.push({ id: 'edge', name: 'Microsoft Edge', path: e });
  return out;
}

// ---- proxy auth helper extension (MV3) ------------------------------------
function writeProxyAuthExtension(dir, proxy) {
  const extDir = path.join(dir, '__gogigi_proxyauth__');
  fs.mkdirSync(extDir, { recursive: true });
  const manifest = {
    manifest_version: 3,
    name: 'GoGiGi Proxy Auth',
    version: '1.0.0',
    permissions: ['webRequest', 'webRequestAuthProvider'],
    host_permissions: ['<all_urls>'],
    background: { service_worker: 'bg.js' },
  };
  const bg =
    `const CRED = ${JSON.stringify({ username: proxy.username, password: proxy.password })};\n` +
    `chrome.webRequest.onAuthRequired.addListener(\n` +
    `  (details, cb) => { cb({ authCredentials: CRED }); },\n` +
    `  { urls: ['<all_urls>'] },\n` +
    `  ['asyncBlocking']\n` +
    `);\n`;
  fs.writeFileSync(path.join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(extDir, 'bg.js'), bg);
  return extDir;
}

// ---- launch / stop --------------------------------------------------------
function buildArgs(profile) {
  const dir = profileDir(profile.id);
  fs.mkdirSync(dir, { recursive: true });
  const args = [
    `--user-data-dir=${dir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-first-run',
  ];
  const p = profile.proxy;
  if (p && p.host && p.port) {
    args.push(`--proxy-server=${p.scheme}://${p.host}:${p.port}`);
    if (p.username) {
      const extDir = writeProxyAuthExtension(dir, p);
      args.push(`--load-extension=${extDir}`);
    }
  }
  if (profile.userAgent) args.push(`--user-agent=${profile.userAgent}`);
  args.push(profile.startUrl || 'about:blank');
  return args;
}

function launch(id) {
  if (running.has(id)) return { ok: false, reason: 'already-running' };
  const items = readIndex();
  const profile = items.find((x) => x.id === id);
  if (!profile) return { ok: false, reason: 'not-found' };
  const exe = resolveBrowser(profile.browser);
  if (!exe) return { ok: false, reason: `browser-not-found: ${profile.browser}` };

  const args = buildArgs(profile);
  let child;
  try {
    child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
  running.set(id, { pid: child.pid });
  child.unref();
  child.on('exit', () => { running.delete(id); if (onChange) onChange(); });

  // mark lastUsed
  profile.lastUsedAt = Date.now();
  writeIndex(items);
  return { ok: true, pid: child.pid };
}

function stop(id) {
  const r = running.get(id);
  if (!r) return { ok: false, reason: 'not-running' };
  try {
    if (process.platform === 'win32') {
      execFile('taskkill', ['/PID', String(r.pid), '/T', '/F'], () => {});
    } else {
      process.kill(-r.pid, 'SIGTERM');
    }
  } catch { /* ignore */ }
  running.delete(id);
  if (onChange) onChange();
  return { ok: true };
}

function openDir(id) {
  return profileDir(id);
}

// optional change callback (to push status to renderer)
let onChange = null;
function setOnChange(fn) { onChange = fn; }

module.exports = {
  init, list, create, update, remove,
  browsers, launch, stop, openDir, setOnChange,
};
