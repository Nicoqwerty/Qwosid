const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs   = require('fs');

let win;

// Backups live next to the exe when packaged, or in the project root during dev
const backupsRoot = app.isPackaged
  ? path.join(path.dirname(process.execPath), 'backups')
  : path.join(__dirname, 'backups');

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 800, minHeight: 600,
    title: 'Qwosid',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  win.setMenuBarVisibility(false);

  win.on('close', (e) => {
    e.preventDefault();
    win.webContents.send('before-close');
  });

  // Auto-backup every 30 minutes
  setInterval(() => {
    if (!win.isDestroyed()) win.webContents.send('auto-backup');
  }, 30 * 60 * 1000);
}

ipcMain.on('close-confirmed', () => {
  win.destroy();
});

ipcMain.handle('save-backup', (_event, data) => {
  try {
    const now  = new Date();
    const date = now.toISOString().slice(0, 10);                          // YYYY-MM-DD
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '-');       // HH-MM-SS
    const ms   = String(now.getMilliseconds()).padStart(3, '0');
    const dir  = path.join(backupsRoot, date);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `backup-${time}-${ms}.json`);
    fs.writeFileSync(filePath, data, 'utf8');
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
