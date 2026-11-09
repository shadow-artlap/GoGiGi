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

  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    create: (data) => ipcRenderer.invoke('profiles:create', data),
    update: (id, data) => ipcRenderer.invoke('profiles:update', { id, data }),
    remove: (id) => ipcRenderer.invoke('profiles:remove', id),
    launch: (id) => ipcRenderer.invoke('profiles:launch', id),
    stop: (id) => ipcRenderer.invoke('profiles:stop', id),
    openDir: (id) => ipcRenderer.invoke('profiles:openDir', id),
    removeMany: (ids) => ipcRenderer.invoke('profiles:removeMany', ids),
    setGroupMany: (ids, group) => ipcRenderer.invoke('profiles:setGroupMany', { ids, group }),
    onChange: (cb) => {
      const h = () => typeof cb === 'function' && cb();
      ipcRenderer.on('profiles:changed', h);
      return () => ipcRenderer.removeListener('profiles:changed', h);
    },
  },

  browsers: {
    list: () => ipcRenderer.invoke('browsers:list'),
  },

  groups: {
    list: () => ipcRenderer.invoke('groups:list'),
    create: (name) => ipcRenderer.invoke('groups:create', name),
    rename: (id, name) => ipcRenderer.invoke('groups:rename', { id, name }),
    remove: (id) => ipcRenderer.invoke('groups:remove', id),
  },

  extensions: {
    list: () => ipcRenderer.invoke('extensions:list'),
    add: () => ipcRenderer.invoke('extensions:add'),
    remove: (id) => ipcRenderer.invoke('extensions:remove', id),
  },

  chromium: {
    status: () => ipcRenderer.invoke('chromium:status'),
    ensure: () => ipcRenderer.invoke('chromium:ensure'),
    remove: () => ipcRenderer.invoke('chromium:remove'),
    onProgress: (cb) => {
      const h = (_e, d) => typeof cb === 'function' && cb(d);
      ipcRenderer.on('chromium:progress', h);
      return () => ipcRenderer.removeListener('chromium:progress', h);
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
