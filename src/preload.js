const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('controlCenter', {
  getStatus: () => ipcRenderer.invoke('server:status'),
  start: () => ipcRenderer.invoke('server:start'),
  stop: () => ipcRenderer.invoke('server:stop'),
  restart: () => ipcRenderer.invoke('server:restart'),
  openPortal: () => ipcRenderer.invoke('server:openPortal'),
  // Database controls
  startDatabase: () => ipcRenderer.invoke('database:start'),
  stopDatabase: () => ipcRenderer.invoke('database:stop'),
  getDatabaseStats: () => ipcRenderer.invoke('database:stats'),
  // Backup/Restore
  createBackup: () => ipcRenderer.invoke('backup:create'),
  createTestBackup: () => ipcRenderer.invoke('backup:createTest'),
  showBackupFolder: () => ipcRenderer.invoke('backup:showFolder'),
  restoreBackup: (file) => ipcRenderer.invoke('backup:restore', file),
  listBackups: () => ipcRenderer.invoke('backup:list'),
  // Seed
  seedDatabase: (backupFile) => ipcRenderer.invoke('database:seed', backupFile),
  // Auto-start
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
  // Firewall
  getFirewallStatus: () => ipcRenderer.invoke('firewall:status'),
  // Prototype notice
  prototypeNotice: action => ipcRenderer.invoke('prototype:notice', action)
});