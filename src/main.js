'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');

// --- Logging ---------------------------------------------------------------
log.transports.file.level = 'info';
autoUpdater.logger = log;
log.info(`GoGiGi starting — v${app.getVersion()}`);

const isDev = process.argv.includes('--dev') || !app.isPackaged;

// Don't download updates automatically; let the user decide from the UI.
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#0f1117',
    title: 'GoGiGi',
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Relay updater events to the renderer ----------------------------------
function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

autoUpdater.on('checking-for-update', () => send('update:status', { state: 'checking' }));
autoUpdater.on('update-available', (info) =>
  send('update:status', { state: 'available', version: info.version }));
autoUpdater.on('update-not-available', (info) =>
  send('update:status', { state: 'up-to-date', version: info.version }));
autoUpdater.on('download-progress', (p) =>
  send('update:status', { state: 'downloading', percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (info) =>
  send('update:status', { state: 'downloaded', version: info.version }));
autoUpdater.on('error', (err) =>
  send('update:status', { state: 'error', message: String(err && err.message || err) }));

// --- IPC handlers exposed to the renderer ----------------------------------
ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('update:check', async () => {
  if (isDev) {
    // electron-updater refuses to run in an unpackaged app unless forced.
    return { ok: false, reason: 'dev-mode' };
  }
  try {
    const r = await autoUpdater.checkForUpdates();
    return { ok: true, version: r && r.updateInfo && r.updateInfo.version };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
});

ipcMain.handle('update:download', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
});

ipcMain.handle('update:install', () => {
  // Quits and installs the downloaded update, then relaunches.
  autoUpdater.quitAndInstall();
  return { ok: true };
});

ipcMain.handle('system:openExternal', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
});

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
    createWindow();

    // Auto-check shortly after launch (packaged builds only).
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
}
