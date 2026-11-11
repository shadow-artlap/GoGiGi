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
const fpgen = require('./fpgen');
const proxytest = require('./proxytest');

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
    fpSeed: d.fpSeed || null,
    createdAt: Date.now(),
    lastUsedAt: null,
    deletedAt: null,
  };
}

// Summary of the effective (generated + user) device, for the table and form.
function deviceOf(p) {
  const e = fpgen.effective(p.fpSeed || p.id, p.fingerprint || {});
  return {
    screen: e.screen, cores: e.hardwareConcurrency, mem: e.deviceMemory, gpu: e.webglRenderer,
    tz: e.timezone || (p.proxyInfo && p.proxyInfo.timezone) || '', webrtc: e.webrtc,
  };
}
function withRunning(p) { return { ...p, running: fingerprint.isRunning(p.id), device: deviceOf(p) }; }

function list() { return readIndex().filter((p) => !p.deletedAt).map(withRunning); }
function listTrash() { return readIndex().filter((p) => p.deletedAt).map(withRunning); }
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
    fpSeed: d.fpSeed !== undefined ? d.fpSeed : cur.fpSeed,
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
// Delete = move to trash (recoverable). Purge removes the record and its data.
function remove(id) { return removeMany([id]); }
function removeMany(ids) {
  const set = new Set(ids);
  const items = readIndex();
  let moved = 0, busy = 0;
  for (const p of items) {
    if (!set.has(p.id) || p.deletedAt) continue;
    if (fingerprint.isRunning(p.id)) { busy++; continue; }
    p.deletedAt = Date.now(); moved++;
  }
  writeIndex(items);
  if (!moved && busy) return { ok: false, reason: 'running' };
  return { ok: true, moved, busy };
}
function restore(ids) {
  const set = new Set(ids);
  const items = readIndex();
  for (const p of items) if (set.has(p.id)) p.deletedAt = null;
  writeIndex(items);
  return { ok: true };
}
function purge(ids) {
  const set = new Set(ids);
  const keep = readIndex().filter((p) => {
    if (set.has(p.id) && p.deletedAt) {
      try { fs.rmSync(profileDir(p.id), { recursive: true, force: true }); } catch {}
      return false;
    }
    return true;
  });
  writeIndex(keep);
  return { ok: true };
}
function emptyTrash() { return purge(readIndex().filter((p) => p.deletedAt).map((p) => p.id)); }

// Clone = same settings, new identity: new id, new fingerprint, empty browser data.
function clone(id) {
  const items = readIndex();
  const src = items.find((x) => x.id === id);
  if (!src) return { ok: false, reason: 'not-found' };
  const c = JSON.parse(JSON.stringify(src));
  c.id = crypto.randomBytes(6).toString('hex');
  c.name = `${src.name} (สำเนา)`;
  c.createdAt = Date.now(); c.lastUsedAt = null; c.deletedAt = null; c.fpSeed = null;
  items.push(c);
  writeIndex(items);
  return { ok: true, profile: withRunning(c) };
}

// Generated (automatic) fingerprint for a seed — shown in the edit form.
function fpPreview(seedKey) { return fpgen.effective(String(seedKey || 'x'), {}); }

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
async function launch(id, exeOverride, opts = {}) {
  try {
    if (fingerprint.isRunning(id)) return { ok: false, reason: 'already-running' };
    const items = readIndex();
    const profile = items.find((x) => x.id === id);
    if (!profile) return { ok: false, reason: 'not-found' };
    const exe = exeOverride || resolveBrowser(profile.browser);
    if (!exe) return { ok: false, reason: `ไม่พบเบราว์เซอร์: ${profile.browser}` };

    const dir = profileDir(id);
    fs.mkdirSync(dir, { recursive: true });

    const extraArgs = [];
    const extPaths = extensions.resolvePaths(profile.extensions || []);
    if (extPaths.length) {
      extraArgs.push(`--disable-extensions-except=${extPaths.join(',')}`);
      extraArgs.push(`--load-extension=${extPaths.join(',')}`);
      // Chrome 137+ ignores --load-extension unless this escape hatch is set.
      extraArgs.push('--disable-features=DisableLoadExtensionCommandLineSwitch');
    }

    // Effective fingerprint: distinct per profile (even behind the same proxy).
    const seedKey = profile.fpSeed || id;
    const eff = fpgen.effective(seedKey, profile.fingerprint || {});

    // Keep the clock/language consistent with the proxy's exit country when the
    // user hasn't set them — a system timezone that contradicts the IP is one of
    // the strongest detection signals.
    // Checked LIVE on every launch: rotating/residential proxies change exit
    // country between sessions, and a stale timezone is worse than none.
    let proxyWarn = '';
    if (profile.proxy && profile.proxy.host) {
      const t = await proxytest.test(profile.proxy, 10000);
      let info = null;
      if (t.ok) {
        info = t;
        const prev = profile.proxyInfo;
        if (prev && prev.countryCode && t.countryCode && prev.countryCode !== t.countryCode) {
          proxyWarn = `IP ของ proxy เปลี่ยนประเทศ (${prev.countryCode} → ${t.countryCode}) — ปรับเวลา/ภาษาให้ตรงแล้ว`;
        }
        profile.proxyInfo = {
          ip: t.ip, country: t.country, countryCode: t.countryCode, flag: t.flag,
          timezone: t.timezone, lat: t.lat, lon: t.lon, latency: t.latency, testedAt: t.testedAt,
        };
      } else if (t.kind === 'proxy') {
        // Never open a profile on a dead proxy: every site would fail, and the
        // user may "fix" it by switching networks with the account logged in.
        return { ok: false, reason: `proxy ใช้งานไม่ได้ (${t.reason}) — ตรวจ host/port/รหัสผ่าน แล้วลองใหม่` };
      } else if (profile.proxyInfo && profile.proxyInfo.timezone) {
        info = profile.proxyInfo; // lookup services busy: last known location
        proxyWarn = 'ตรวจตำแหน่ง proxy ไม่ได้ชั่วคราว — ใช้ข้อมูลล่าสุดที่บันทึกไว้';
      } else {
        proxyWarn = 'ตรวจตำแหน่ง proxy ไม่ได้ — เวลา/ภาษาอาจไม่ตรงกับ IP (ตั้งเองในแท็บลายนิ้วมือได้)';
      }
      if (info) {
        if (!eff.timezone && info.timezone) eff.timezone = info.timezone;
        if (!eff.locale && info.countryCode) eff.locale = proxytest.localeForCountry(info.countryCode);
        if (!eff.geo && info.lat != null && info.lon != null) eff.geo = { lat: info.lat, lon: info.lon };
      }
    }

    const meta = {
      name: profile.name, id, profileNo: profile.id, group: profile.group,
      platform: profile.platform, remark: profile.remark, tags: profile.tags,
      proxyType: profile.proxy ? `${profile.proxy.scheme}://${profile.proxy.host}:${profile.proxy.port}` : 'No Proxy',
    };
    const r = await fingerprint.launch({
      id, exePath: exe, userDataDir: dir, extraArgs,
      proxy: profile.proxy, fp: eff, meta, tabs: profile.tabs || [],
      headless: !!opts.headless, seedKey,
    });
    if (r.ok) profile.lastUsedAt = Date.now();
    writeIndex(items); // persists lastUsedAt and any freshly detected proxyInfo
    if (r.ok && proxyWarn) r.warning = proxyWarn;
    return r;
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}
function stop(id) { return fingerprint.stop(id); }
async function exportCookies(id, exeOverride) {
  const p = get(id); if (!p) return { ok: false, reason: 'not-found' };
  const exe = exeOverride || resolveBrowser(p.browser);
  if (!exe) return { ok: false, reason: `ไม่พบเบราว์เซอร์: ${p.browser}` };
  try { return { ok: true, cookies: await fingerprint.getCookies(id, exe, profileDir(id)) }; }
  catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
}
async function importCookies(id, cdpCookies, exeOverride) {
  const p = get(id); if (!p) return { ok: false, reason: 'not-found' };
  const exe = exeOverride || resolveBrowser(p.browser);
  if (!exe) return { ok: false, reason: `ไม่พบเบราว์เซอร์: ${p.browser}` };
  fs.mkdirSync(profileDir(id), { recursive: true });
  try { const r = await fingerprint.setCookies(id, exe, profileDir(id), cdpCookies); return { ok: true, imported: r.imported, failed: r.failed }; }
  catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
}
function openDir(id) { return profileDir(id); }
function setOnChange(fn) { fingerprint.setOnChange(fn); }
function stopAll() { return fingerprint.stopAll(); }
function anyRunning() { return fingerprint.anyRunning(); }

module.exports = {
  init, list, listTrash, get, create, update, remove, removeMany, restore, purge, emptyTrash, clone, fpPreview,
  exportCookies, importCookies, setGroupMany, setProxyInfo,
  browsers, launch, stop, stopAll, anyRunning, openDir, setOnChange,
};
