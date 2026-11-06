'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// A small, whitelisted bridge — no raw ipcRenderer is exposed to the page.
contextBridge.exposeInMainWorld('gogigi', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (callback) => {
      const handler = (_event, data) => {
        if (typeof callback === 'function') callback(data);
      };
      ipcRenderer.on('update:status', handler);
      return () => ipcRenderer.removeListener('update:status', handler);
    },
  },
});
