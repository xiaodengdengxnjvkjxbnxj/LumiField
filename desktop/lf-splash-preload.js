'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const isTest = process.env.LF_MASTER_TEST === '1';
contextBridge.exposeInMainWorld('LumiFieldSplash', Object.freeze({
  isTest,
  forceGpuFallback: isTest && process.env.LF_SPLASH_FORCE_GPU_FALLBACK === '1',
  stageReady: () => ipcRenderer.send('lf-splash-stage-ready'),
  enter: () => ipcRenderer.invoke('lf-splash-enter'),
  windowAction: action => ipcRenderer.invoke('lf-splash-window-action', action),
  onWindowState: callback => {
    if (typeof callback !== 'function') return function () {};
    const handler = (_event, state) => callback(state || {});
    ipcRenderer.on('lf-splash-window-state', handler);
    return () => ipcRenderer.removeListener('lf-splash-window-state', handler);
  },
  getMainDebug: () => isTest ? ipcRenderer.invoke('lf-splash-debug') : Promise.resolve(null),
}));
