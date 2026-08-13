const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('LFMonitor', Object.freeze({
  login: payload => ipcRenderer.invoke('monitor-auth-login', payload || {}),
  authStatus: () => ipcRenderer.invoke('monitor-auth-status'),
  logout: () => ipcRenderer.invoke('monitor-auth-logout'),
  close: () => ipcRenderer.invoke('monitor-window-close'),
  backendStatus: () => ipcRenderer.invoke('monitor-backend-status'),
  dashboard: () => ipcRenderer.invoke('monitor-dashboard'),
  openAttachment: attachmentId => ipcRenderer.invoke('monitor-open-attachment', attachmentId || ''),
  setAttachmentStatus: payload => ipcRenderer.invoke('monitor-attachment-status', payload || {}),
  setUserFlag: payload => ipcRenderer.invoke('monitor-set-user-flag', payload || {}),
  createRelease: payload => ipcRenderer.invoke('monitor-create-release', payload || {}),
  decideRelease: payload => ipcRenderer.invoke('monitor-decide-release', payload || {}),
  retryNotifications: () => ipcRenderer.invoke('monitor-retry-notifications'),
  testLoginService: payload => ipcRenderer.invoke('monitor-test-login-service', payload || {}),
}));
