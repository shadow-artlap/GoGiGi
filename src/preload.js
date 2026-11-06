'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// A small, whitelisted bridge — no raw ipcRenderer is exposed to the page.
contextBridge.exposeInMainWorld('gogigi', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),

  system: {
    getInfo: () => ipcRenderer.invoke('system:getInfo'),
    openPath: (which) => ipcRenderer.invoke('app:openPath', which),
  },

  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    set: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
  },

  theme: {
    get: () => ipcRenderer.invoke('theme:get'),
    set: (mode) => ipcRenderer.invoke('settings:set', { key: 'theme', value: mode }),
    onChange: (cb) => {
      const h = (_e, d) => typeof cb === 'function' && cb(d);
      ipcRenderer.on('theme:changed', h);
      return () => ipcRenderer.removeListener('theme:changed', h);
    },
  },

  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (cb) => {
      const h = (_e, d) => typeof cb === 'function' && cb(d);
      ipcRenderer.on('update:status', h);
      return () => ipcRenderer.removeListener('update:status', h);
    },
  },
});
