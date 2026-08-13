'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function onState(callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload || {});
  ipcRenderer.on('lumifield-voice-assistant-overlay-state', listener);
  return () => ipcRenderer.removeListener('lumifield-voice-assistant-overlay-state', listener);
}

contextBridge.exposeInMainWorld('lfVoiceOverlay', Object.freeze({
  ready: () => ipcRenderer.invoke('lumifield-voice-assistant-overlay-ready'),
  onState,
  play: () => ipcRenderer.invoke('lumifield-voice-assistant-overlay-action', 'play'),
  pause: () => ipcRenderer.invoke('lumifield-voice-assistant-overlay-action', 'pause'),
  previous: () => ipcRenderer.invoke('lumifield-voice-assistant-overlay-action', 'previous'),
  next: () => ipcRenderer.invoke('lumifield-voice-assistant-overlay-action', 'next'),
}));
