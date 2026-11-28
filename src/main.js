const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { ServerManager } = require('./server-manager');

let mainWindow;
let manager;
let tray = null;
let isQuitting = false;

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
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', async (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      updateTrayMenu();
    }
  });
}

function createTray() {
  // Create a simple tray icon
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    // Create a simple fallback icon
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('OB-Gyne Server Control Center — TEST');
  updateTrayMenu();

  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });
}

function updateTrayMenu() {
  if (!tray || !manager) return;

  const status = manager.statusSync ? manager.statusSync() : {
    portal: { running: false },
    database: { connected: false }
  };

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Dashboard',
      click: () => {
        if (mainWindow) mainWindow.show();
      }
    },
    { type: 'separator' },
    {
      label: status.portal.running ? 'Stop Portal' : 'Start Portal',
      click: async () => {
        if (status.portal.running) {
          await manager.stopPortal();
        } else {
          await manager.startPostgreSQL();
          await manager.startPortal();
        }
        updateTrayMenu();
      }
    },
    {
      label: status.database.connected ? 'Stop Database' : 'Start Database',
      click: async () => {
        if (status.database.connected) {
          await manager.stopPostgreSQL();
        } else {
          await manager.startPostgreSQL();
        }
        updateTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: 'Open Portal',
      click: () => {
        shell.openExternal('http://127.0.0.1:' + manager.portalPort);
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

app.whenReady().then(async () => {
  manager = new ServerManager({
    portalPort: 8787,
    databasePort: 5432,
    dataDirectory: app.getPath('userData')
  });

  createWindow();
  createTray();

  // Start PostgreSQL first, then portal
  try {
    await manager.startPostgreSQL();
    await manager.startPortal();
    updateTrayMenu();
  } catch (error) {
    manager.log('Error', error.message);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  // Don't quit - keep running in background
  // Only stop the portal, keep PostgreSQL running
  if (manager) await manager.stopPortal();
  // Don't call app.quit() - keep the tray running
});

app.on('before-quit', async () => {
  isQuitting = true;
  if (manager) {
    await manager.stopPortal();
    await manager.stopPostgreSQL();
  }
});

// IPC handlers
ipcMain.handle('server:status', () => manager.status());
ipcMain.handle('server:start', async () => {
  await manager.startPostgreSQL();
  const result = await manager.startPortal();
  updateTrayMenu();
  return result;
});
ipcMain.handle('server:stop', async () => {
  const result = await manager.stopPortal();
  updateTrayMenu();
  return result;
});
ipcMain.handle('server:restart', async () => {
  await manager.stopPortal();
  const result = await manager.startPortal();
  updateTrayMenu();
  return result;
});
ipcMain.handle('server:openPortal', async () => {
  await shell.openExternal('http://127.0.0.1:' + manager.portalPort);
  return true;
});

// PostgreSQL controls
ipcMain.handle('database:start', async () => {
  const result = await manager.startPostgreSQL();
  updateTrayMenu();
  return result;
});
ipcMain.handle('database:stop', async () => {
  const result = await manager.stopPostgreSQL();
  updateTrayMenu();
  return result;
});
ipcMain.handle('database:stats', () => manager.getDatabaseStats());

// Backup/Restore
ipcMain.handle('backup:create', () => manager.createBackup());
ipcMain.handle('backup:createTest', () => manager.createTestBackup());
ipcMain.handle('backup:showFolder', async () => {
  const folder = path.join(app.getPath('userData'), 'backups');
  await shell.openPath(folder);
  return folder;
});
ipcMain.handle('backup:restore', async (_event, backupFile) => {
  return manager.restoreBackup(backupFile);
});
ipcMain.handle('backup:list', async () => {
  const folder = path.join(app.getPath('userData'), 'backups');
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder)
    .filter(f => f.endsWith('.sql') || f.endsWith('.json'))
    .map(f => ({ name: f, path: path.join(folder, f), mtime: fs.statSync(path.join(folder, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime);
});

// Google Drive upload
ipcMain.handle('backup:uploadToDrive', async (_event, localPath, folderId) => {
  return manager.uploadToGoogleDrive(localPath, folderId);
});
ipcMain.handle('backup:listOnDrive', async (_event, folderId) => {
  return manager.listGoogleDriveBackups(folderId);
});

// Save Google Drive configuration
ipcMain.handle('gdrive:configure', async (_event, token, folderId) => {
  const config = { accessToken: token, folderId, updatedAt: new Date().toISOString() };
  const configPath = path.join(app.getPath('userData'), 'gdrive-config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { ok: true, configured: true };
});
ipcMain.handle('gdrive:config', async () => {
  const configPath = path.join(app.getPath('userData'), 'gdrive-config.json');
  if (!fs.existsSync(configPath)) return { configured: false };
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
});

// Seed data
ipcMain.handle('database:seed', async (_event, backupFile) => {
  const seedScript = path.join(__dirname, '..', '..', 'obgyne-supabase', 'scripts', 'seed-backup.mjs');
  if (!fs.existsSync(seedScript)) throw new Error('Seed script not found');
  if (!backupFile || !fs.existsSync(backupFile)) throw new Error('Backup file not found');

  const { spawn } = require('child_process');
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [seedScript, backupFile, '--apply'], {
      env: { ...process.env, DATABASE_URL: `postgresql://postgres@127.0.0.1:${manager.databasePort}/obgyne` },
      stdio: 'pipe'
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => {
      if (code === 0) {
        manager.log('Seed', 'Database seeded from backup');
        resolve({ ok: true, output: stdout });
      } else {
        reject(new Error(stderr || stdout || `Seed failed with code ${code}`));
      }
    });
  });
});

// Auto-start settings
ipcMain.handle('autostart:get', () => {
  return app.getLoginItemSettings();
});

ipcMain.handle('autostart:set', async (_event, enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: ['--hidden']
  });
  return app.getLoginItemSettings();
});

// Firewall status (placeholder for Windows)
ipcMain.handle('firewall:status', () => {
  return { configured: false, message: 'Firewall configuration requires Windows administrator privileges' });
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