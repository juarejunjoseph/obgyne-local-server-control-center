const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const { ServerManager } = require('./server-manager');

let mainWindow;
let manager;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'OB-Gyne Server Control Center — TEST',
    backgroundColor: '#f4f7f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  manager = new ServerManager({
    portalPort: 8787,
    databasePort: 5432,
    dataDirectory: app.getPath('userData')
  });
  createWindow();
  try { await manager.startPortal(); } catch (error) { manager.log('Error', error.message); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', async () => {
  if (manager) await manager.stopPortal();
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('server:status', () => manager.status());
ipcMain.handle('server:start', () => manager.startPortal());
ipcMain.handle('server:stop', () => manager.stopPortal());
ipcMain.handle('server:restart', () => manager.restartPortal());
ipcMain.handle('server:openPortal', async () => {
  await shell.openExternal('http://127.0.0.1:' + manager.portalPort);
  return true;
});
ipcMain.handle('backup:create', () => manager.createTestBackup());
ipcMain.handle('backup:showFolder', async () => {
  const folder = path.join(app.getPath('userData'), 'backups');
  await shell.openPath(folder);
  return folder;
});
ipcMain.handle('prototype:notice', async (_event, action) => {
  await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Test prototype',
    message: action + ' is intentionally disabled in this prototype.',
    detail: 'No SQL data, Supabase project, firewall rule, or production record will be changed.'
  });
  return true;
});
