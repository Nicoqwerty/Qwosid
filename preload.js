const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onBeforeClose:  (cb) => ipcRenderer.on('before-close',  (_event) => cb()),
  onAutoBackup:   (cb) => ipcRenderer.on('auto-backup',   (_event) => cb()),
  confirmClose:  () => ipcRenderer.send('close-confirmed'),
  saveBackup:    (data) => ipcRenderer.invoke('save-backup', data),
});
