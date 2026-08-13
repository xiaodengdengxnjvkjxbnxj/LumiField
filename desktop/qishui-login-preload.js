'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('LumiFieldQishuiLogin', Object.freeze({
  getOfficialClientStatus: () => ipcRenderer.invoke('qishui-official-status'),
  openOfficialClient: () => ipcRenderer.invoke('qishui-official-open'),
  importOfficialSession: () => ipcRenderer.invoke('qishui-official-import'),
}));
