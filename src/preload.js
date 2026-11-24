const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controlCenter', {
  getStatus: () => ipcRenderer.invoke('server:status'),
  start: () => ipcRenderer.invoke('server:start'),
  stop: () => ipcRenderer.invoke('server:stop'),
  restart: () => ipcRenderer.invoke('server:restart'),
  openPortal: () => ipcRenderer.invoke('server:openPortal'),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  showBackupFolder: () => ipcRenderer.invoke('backup:showFolder'),
  prototypeNotice: action => ipcRenderer.invoke('prototype:notice', action)
});
