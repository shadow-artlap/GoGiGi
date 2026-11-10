'use strict';

const { app, BrowserWindow, ipcMain, shell, nativeTheme, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const profiles = require('./profiles');
const chromium = require('./chromium');
const groups = require('./groups');
const extensions = require('./extensions');
const proxytest = require('./proxytest');
const cookies = require('./cookies');

// --- Logging ---------------------------------------------------------------
log.transports.file.level = 'info';
autoUpdater.logger = log;
log.info(`GoGiGi starting — v${app.getVersion()}`);

const isDev = process.argv.includes('--dev') || !app.isPackaged;

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow = null;

// --- Tiny JSON settings store (userData/settings.json) ---------------------
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = { theme: 'system', displayName: '' };

function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function writeSettings(next) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2));
    return true;
  } catch (e) {
    log.warn('writeSettings failed', e);
    return false;
  }
}

function applyTheme(mode) {
  nativeTheme.themeSource = ['light', 'dark', 'system'].includes(mode) ? mode : 'system';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#0f1117',
    title: 'GoGiGi',
    icon: path.join(__dirname, 'renderer', 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// --- Relay updater events to the renderer ----------------------------------
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
autoUpdater.on('checking-for-update', () => send('update:status', { state: 'checking' }));
autoUpdater.on('update-available', (i) => send('update:status', { state: 'available', version: i.version }));
autoUpdater.on('update-not-available', (i) => send('update:status', { state: 'up-to-date', version: i.version }));
autoUpdater.on('download-progress', (p) => send('update:status', { state: 'downloading', percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (i) => send('update:status', { state: 'downloaded', version: i.version }));
autoUpdater.on('error', (e) => send('update:status', { state: 'error', message: String((e && e.message) || e) }));

// Notify renderer when the effective dark/light resolves (e.g. "system" mode).
nativeTheme.on('updated', () => {
  send('theme:changed', { source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors });
});

// --- IPC: app / system -----------------------------------------------------
ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('system:getInfo', () => {
  const mem = { total: os.totalmem(), free: os.freemem() };
  const cpus = os.cpus();
  return {
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    hostname: os.hostname(),
    cpuModel: cpus[0] ? cpus[0].model.trim() : 'unknown',
    cpuCores: cpus.length,
    memTotal: mem.total,
    memFree: mem.free,
    uptime: os.uptime(),
    userData: app.getPath('userData'),
    logsPath: path.dirname(log.transports.file.getFile().path),
  };
});

ipcMain.handle('app:openPath', (_e, which) => {
  const target = which === 'logs'
    ? path.dirname(log.transports.file.getFile().path)
    : app.getPath('userData');
  return shell.openPath(target);
});

ipcMain.handle('system:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

// --- IPC: settings ---------------------------------------------------------
ipcMain.handle('settings:getAll', () => readSettings());

ipcMain.handle('settings:set', (_e, { key, value }) => {
  const s = readSettings();
  s[key] = value;
  const ok = writeSettings(s);
  if (key === 'theme') applyTheme(value);
  return { ok, settings: s };
});

// --- IPC: theme ------------------------------------------------------------
ipcMain.handle('theme:get', () => ({
  source: nativeTheme.themeSource,
  dark: nativeTheme.shouldUseDarkColors,
}));

// --- IPC: profiles ---------------------------------------------------------
ipcMain.handle('profiles:list', () => profiles.list());
ipcMain.handle('profiles:create', (_e, data) => profiles.create(data));
ipcMain.handle('profiles:update', (_e, { id, data }) => profiles.update(id, data));
ipcMain.handle('profiles:remove', (_e, id) => profiles.remove(id));
// Bundled profiles need the downloaded Chromium path; others resolve their own.
async function exeFor(profile) {
  if (profile && profile.browser === 'bundled') {
    const r = await chromium.ensure((dl, total) => send('chromium:progress', { dl, total }));
    if (!r.ok) throw new Error('chromium: ' + r.reason);
    return r.path;
  }
  return undefined;
}
ipcMain.handle('profiles:launch', async (_e, id) => {
  try { return await profiles.launch(id, await exeFor(profiles.get(id))); }
  catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
ipcMain.handle('profiles:listTrash', () => profiles.listTrash());
ipcMain.handle('profiles:restore', (_e, ids) => profiles.restore(ids));
ipcMain.handle('profiles:purge', (_e, ids) => profiles.purge(ids));
ipcMain.handle('profiles:emptyTrash', () => profiles.emptyTrash());
ipcMain.handle('profiles:clone', (_e, id) => profiles.clone(id));
ipcMain.handle('fp:preview', (_e, seed) => profiles.fpPreview(seed));

// --- IPC: cookies ----------------------------------------------------------
ipcMain.handle('cookies:import', async (_e, id) => {
  const p = profiles.get(id);
  if (!p) return { ok: false, reason: 'not-found' };
  const pick = await dialog.showOpenDialog(mainWindow, {
    title: `นำเข้า cookie — ${p.name}`,
    filters: [{ name: 'Cookies', extensions: ['json', 'txt'] }, { name: 'All files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (pick.canceled || !pick.filePaths[0]) return { ok: false, reason: 'canceled' };
  let list;
  try { list = cookies.parse(fs.readFileSync(pick.filePaths[0], 'utf8')); }
  catch (e) { return { ok: false, reason: 'อ่านไฟล์ไม่ได้: ' + e.message }; }
  if (!list.length) return { ok: false, reason: 'ไม่พบ cookie ในไฟล์ (รองรับ JSON และ cookies.txt)' };
  try {
    const r = await profiles.importCookies(id, list, await exeFor(p));
    if (!r.ok) return r;
    if (!r.imported) return { ok: false, reason: `cookie ทั้ง ${list.length} รายการไม่ถูกต้อง (ตรวจ domain/วันหมดอายุในไฟล์)` };
    return { ok: true, imported: r.imported, failed: r.failed || [], total: list.length };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
ipcMain.handle('cookies:export', async (_e, id) => {
  const p = profiles.get(id);
  if (!p) return { ok: false, reason: 'not-found' };
  let r;
  try { r = await profiles.exportCookies(id, await exeFor(p)); }
  catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
  if (!r.ok) return r;
  const safe = String(p.name || id).replace(/[\\/:*?"<>|]+/g, '_');
  const save = await dialog.showSaveDialog(mainWindow, {
    title: `ส่งออก cookie — ${p.name}`,
    defaultPath: `${safe}-cookies.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (save.canceled || !save.filePath) return { ok: false, reason: 'canceled' };
  fs.writeFileSync(save.filePath, JSON.stringify(r.cookies.map(cookies.fromCdp), null, 2));
  return { ok: true, count: r.cookies.length, path: save.filePath };
});
ipcMain.handle('profiles:stop', (_e, id) => profiles.stop(id));
ipcMain.handle('profiles:openDir', (_e, id) => {
  const dir = profiles.openDir(id);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  return shell.openPath(dir);
});
ipcMain.handle('profiles:removeMany', (_e, ids) => profiles.removeMany(ids));
ipcMain.handle('profiles:setGroupMany', (_e, { ids, group }) => profiles.setGroupMany(ids, group));
ipcMain.handle('browsers:list', () => profiles.browsers());

// --- IPC: proxy test -------------------------------------------------------
ipcMain.handle('proxy:test', (_e, proxy) => proxytest.test(proxy));
ipcMain.handle('proxy:testProfile', async (_e, id) => {
  const p = profiles.get(id);
  if (!p) return { ok: false, reason: 'not-found' };
  const r = await proxytest.test(p.proxy);
  if (r.ok) profiles.setProxyInfo(id, {
    ip: r.ip, country: r.country, countryCode: r.countryCode, flag: r.flag,
    timezone: r.timezone, lat: r.lat, lon: r.lon, latency: r.latency, testedAt: r.testedAt,
  });
  return r;
});

// --- IPC: groups -----------------------------------------------------------
ipcMain.handle('groups:list', () => groups.list());
ipcMain.handle('groups:create', (_e, name) => groups.create(name));
ipcMain.handle('groups:rename', (_e, { id, name }) => groups.rename(id, name));
ipcMain.handle('groups:remove', (_e, id) => groups.remove(id));

// --- IPC: extensions -------------------------------------------------------
ipcMain.handle('extensions:list', () => extensions.list());
ipcMain.handle('extensions:add', async () => {
  const r = await dialog.showOpenDialog({
    title: 'เลือกโฟลเดอร์ extension (ที่แตกแล้ว)',
    properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, reason: 'canceled' };
  return extensions.add(r.filePaths[0]);
});
ipcMain.handle('extensions:remove', (_e, id) => extensions.remove(id));

// --- IPC: bundled Chromium -------------------------------------------------
ipcMain.handle('chromium:status', () => chromium.status());
ipcMain.handle('chromium:ensure', () =>
  chromium.ensure((dl, total) => send('chromium:progress', { dl, total })));
ipcMain.handle('chromium:remove', () => chromium.remove());

// --- IPC: updates ----------------------------------------------------------
ipcMain.handle('update:check', async () => {
  if (isDev) return { ok: false, reason: 'dev-mode' };
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, version: r && r.updateInfo && r.updateInfo.version };
  } catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
ipcMain.handle('update:download', async () => {
  try { await autoUpdater.downloadUpdate(); return { ok: true }; }
  catch (e) { return { ok: false, reason: String((e && e.message) || e) }; }
});
ipcMain.handle('update:install', () => { autoUpdater.quitAndInstall(); return { ok: true }; });

// --- App lifecycle ---------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    applyTheme(readSettings().theme);
    profiles.init(app);
    chromium.init(app.getPath('userData'));
    groups.init(app.getPath('userData'));
    extensions.init(app.getPath('userData'));
    profiles.setOnChange(() => send('profiles:changed'));
    createWindow();

    if (!isDev) {
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((e) => log.warn('auto-check failed', e));
      }, 3000);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Close profile browsers (and their local proxy forwarders) before exiting,
  // so they don't linger as orphans that keep the profile folder locked.
  let quitting = false;
  app.on('before-quit', (e) => {
    if (quitting || !profiles.anyRunning()) return;
    e.preventDefault();
    quitting = true;
    const done = () => app.quit();
    Promise.race([profiles.stopAll(), new Promise((r) => setTimeout(r, 5000))]).then(done, done);
  });
}
