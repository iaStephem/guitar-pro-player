const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  onOpenScoreFile(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('open-score-file', listener);
    return () => ipcRenderer.removeListener('open-score-file', listener);
  },
});
