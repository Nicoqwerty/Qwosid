const { app, BrowserWindow, ipcMain, Menu, MenuItem } = require('electron');
const path = require('path');
const fs   = require('fs');

let win;

// Backups go to Documents\Qwosid Backups — next-to-exe locations get wiped:
// electron-builder empties release\win-unpacked on every rebuild, and portable
// builds extract to a throwaway %TEMP% folder.
const backupsRoot = () => path.join(app.getPath('documents'), 'Qwosid Backups');

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

  win.webContents.on('context-menu', (_e, params) => {
    // Only handle editable areas — link chip spans (contenteditable=false) are excluded
    if (!params.isEditable) return;

    const menu = new Menu();

    // Spell-check suggestions at the top
    if (params.dictionarySuggestions?.length > 0) {
      for (const s of params.dictionarySuggestions) {
        menu.append(new MenuItem({ label: s, click: () => win.webContents.replaceMisspelling(s) }));
      }
      menu.append(new MenuItem({ type: 'separator' }));
    }

    if (params.misspelledWord) {
      menu.append(new MenuItem({
        label: 'Add to Dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    // Standard edit actions
    if (params.editFlags.canCut)       menu.append(new MenuItem({ label: 'Cut',        role: 'cut' }));
    if (params.editFlags.canCopy)      menu.append(new MenuItem({ label: 'Copy',       role: 'copy' }));
    if (params.editFlags.canPaste)     menu.append(new MenuItem({ label: 'Paste',      role: 'paste' }));
    if (params.editFlags.canSelectAll) menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));

    if (menu.items.length > 0) menu.popup({ window: win });
  });

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

const MAX_BACKUPS = 30;

// Delete the oldest backups beyond MAX_BACKUPS and clean out emptied date folders.
// Filenames sort chronologically (YYYY-MM-DD dirs + HH-MM-SS-ms names).
function pruneBackups() {
  const root = backupsRoot();
  const all = [];
  for (const dir of fs.readdirSync(root)) {
    const dirPath = path.join(root, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;
    for (const f of fs.readdirSync(dirPath)) {
      if (f.endsWith('.json')) all.push({ key: `${dir}/${f}`, path: path.join(dirPath, f), dir: dirPath });
    }
  }
  all.sort((a, b) => a.key.localeCompare(b.key));
  for (const old of all.slice(0, Math.max(0, all.length - MAX_BACKUPS))) {
    fs.unlinkSync(old.path);
    if (fs.readdirSync(old.dir).length === 0) fs.rmdirSync(old.dir);
  }
}

ipcMain.handle('save-backup', (_event, data) => {
  try {
    const now  = new Date();
    const date = now.toISOString().slice(0, 10);                          // YYYY-MM-DD
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '-');       // HH-MM-SS
    const ms   = String(now.getMilliseconds()).padStart(3, '0');
    const dir  = path.join(backupsRoot(), date);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `backup-${time}-${ms}.json`);
    fs.writeFileSync(filePath, data, 'utf8');
    try { pruneBackups(); } catch (err) { console.error('Backup pruning failed:', err); }
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ── primary data store: JSON file in userData ─────────────────────────────────
const dataFile = () => path.join(app.getPath('userData'), 'qwosid-data.json');

ipcMain.handle('load-data', () => {
  try {
    const p = dataFile();
    if (!fs.existsSync(p)) return { ok: true, data: null };
    return { ok: true, data: fs.readFileSync(p, 'utf8') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('save-data', (_event, json) => {
  try {
    const p = dataFile();
    // Write-then-rename so a crash mid-write can't corrupt the existing file
    fs.writeFileSync(p + '.tmp', json, 'utf8');
    fs.renameSync(p + '.tmp', p);
    return { ok: true };
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
