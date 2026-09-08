const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const scoreExtensionPattern = /\.(gp|gp3|gp4|gp5|gp6|gp7|gpx|musicxml|xml)$/i;

let mainWindow = null;
let pendingFilePath = null;

function findScorePath(commandLine) {
  for (const argument of commandLine) {
    const candidate = String(argument).replace(/^"|"$/g, '');
    if (scoreExtensionPattern.test(candidate) && fs.existsSync(candidate)) {
      return path.resolve(candidate);
    }
  }
  return null;
}

async function sendScoreFile(filePath) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingFilePath = filePath;
    return;
  }

  try {
    const file = await fs.promises.readFile(filePath);
    const data = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    mainWindow.webContents.send('open-score-file', {
      name: path.basename(filePath),
      path: filePath,
      data,
    });
    mainWindow.setTitle(`${path.basename(filePath)} - Guitar Pro Player`);
  } catch (error) {
    dialog.showErrorBox('Не удалось открыть файл', error.message);
  }
}

function openScoreFile(filePath) {
  if (!filePath) return;

  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) {
    pendingFilePath = filePath;
    return;
  }

  sendScoreFile(filePath);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createWindow(filePath = null) {
  pendingFilePath = filePath || pendingFilePath;
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'Guitar Pro Player',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor: '#f5f7f7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (!pendingFilePath) return;
    const fileToOpen = pendingFilePath;
    pendingFilePath = null;
    sendScoreFile(fileToOpen);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, commandLine) => {
    const filePath = findScorePath(commandLine);
    if (filePath) openScoreFile(filePath);
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    openScoreFile(filePath);
  });

  app.whenReady().then(() => createWindow(findScorePath(process.argv)));

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
