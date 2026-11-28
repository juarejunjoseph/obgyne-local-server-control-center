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
  // Google Drive sync
  uploadToGoogleDrive: (localPath, folderId) => ipcRenderer.invoke('backup:uploadToDrive', localPath, folderId),
  listBackupsOnDrive: (folderId) => ipcRenderer.invoke('backup:listOnDrive', folderId),
  configureGoogleDrive: (token, folderId) => ipcRenderer.invoke('gdrive:configure', token, folderId),
  getGoogleDriveConfig: () => ipcRenderer.invoke('gdrive:config'),
  // Seed
  seedDatabase: (backupFile) => ipcRenderer.invoke('database:seed', backupFile),
  // Auto-start
  getAutostart: () => ipcRenderer.invoke('autostart:get'),
  setAutostart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
  // Update
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  // Firewall
  getFirewallStatus: () => ipcRenderer.invoke('firewall:status'),
  // Prototype notice
  prototypeNotice: action => ipcRenderer.invoke('prototype:notice', action)
});