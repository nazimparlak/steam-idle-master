const { app, BrowserWindow, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');

let mainWindow = null;
let logFile = null;
let backendServer = null;
let backendPort = 0;

function isDev() {
  return !app.isPackaged;
}

function initLogging() {
  try {
    const userData = app.getPath('userData');
    fs.mkdirSync(userData, { recursive: true });
    logFile = path.join(userData, 'steam-idler.log');
    fs.appendFileSync(logFile, `\n\n=== Steam Idler start ${new Date().toISOString()} ===\n`);
  } catch (e) {
    // ignore
  }
}

function log(msg) {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    if (logFile) fs.appendFileSync(logFile, line);
  } catch (e) {
    // ignore
  }
}

function waitForBackend(url, timeoutMs = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) return resolve();
        if (Date.now() - started > timeoutMs) return reject(new Error(`Backend status ${res.statusCode}`));
        setTimeout(tick, 300);
      });
      req.on('error', (err) => {
        if (Date.now() - started > timeoutMs) return reject(err);
        setTimeout(tick, 300);
      });
    };
    tick();
  });
}

function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

async function pickPort({ start = 38123, tries = 200 } = {}) {
  for (let i = 0; i < tries; i++) {
    const p = start + i;
    // avoid privileged ports, keep within valid range
    if (p < 1024 || p > 65535) continue;
    // eslint-disable-next-line no-await-in-loop
    const free = await isPortFree(p);
    if (free) return p;
  }
  throw new Error(`No free port found starting at ${start}`);
}

function createWindow() {
  const defaultW = 1280;
  const defaultH = 1000;
  const minW = 1280;
  const minH = 1000;

  mainWindow = new BrowserWindow({
    width: defaultW,
    height: defaultH,
    // Sabit minimum: bu boyutun altına küçültülemez.
    minWidth: minW,
    minHeight: minH,
    backgroundColor: '#0b1020',
    icon: path.join(__dirname, '..', 'steamidlelogo.png'),
    show: false,
    // false: Görünüm / Uygulama menüsü her zaman üstte görünsün (Alt ile aramak zorunda kalınmasın).
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Bazı Windows temalarında option minWidth/minHeight tam uygulanmayabiliyor;
  // runtime'da da zorlayalım.
  try { mainWindow.setMinimumSize(minW, minH); } catch (e) { }

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // App içinden açılan dış linkleri yeni Electron penceresi yerine varsayılan tarayıcıda aç.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, validatedURL) => {
    log(`did-fail-load code=${code} desc=${desc} url=${validatedURL}`);
    // Show something even if backend is down
    try { mainWindow.show(); } catch (e) { }
  });

  const url = isDev()
    ? 'http://localhost:5173'
    : `http://localhost:${backendPort}`;

  mainWindow.loadURL(url);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startBackend() {
  // server.js kendi içinde dinlemeye başlıyor.
  // EXE paketinde dist UI da aynı porttan servis edilecek.
  if (!isDev()) {
    backendPort = await pickPort({ start: 38123, tries: 200 });
  } else {
    backendPort = 3001;
  }

  process.env.PORT = String(backendPort);
  process.env.STEAM_IDLER_DATA_DIR = process.env.STEAM_IDLER_DATA_DIR || app.getPath('userData');
  log(`Starting backend PORT=${process.env.PORT} DATA_DIR=${process.env.STEAM_IDLER_DATA_DIR}`);
  const { startServer } = require(path.join(__dirname, '..', 'server.js'));
  backendServer = startServer(parseInt(process.env.PORT, 10));
}

function setupMenu() {
  const viewSubmenu = [
    ...(isDev()
      ? [
          { role: 'reload', label: 'Yenile' },
          { role: 'toggleDevTools', label: 'Geliştirici Araçları' },
          { type: 'separator' },
        ]
      : [
          { label: 'Yenile', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents?.reload() },
          { type: 'separator' },
        ]),
    { label: 'Tam Ekran', accelerator: 'F11', click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()) },
  ];

  const template = [
    {
      label: 'Görünüm',
      submenu: viewSubmenu,
    },
    {
      label: 'Uygulama',
      submenu: [
        { label: 'Çıkış', accelerator: 'Alt+F4', click: () => app.quit() },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    initLogging();
    process.on('uncaughtException', (err) => log(`uncaughtException: ${err?.stack || err}`));
    process.on('unhandledRejection', (reason) => log(`unhandledRejection: ${reason?.stack || reason}`));

    await startBackend();
    setupMenu();
    if (!isDev()) {
      try {
        await waitForBackend(`http://localhost:${backendPort}/api/state`, 15000);
        log('Backend ready');
      } catch (e) {
        log(`Backend not ready: ${e?.message || e}`);
      }
    }
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    try {
      if (backendServer) backendServer.close();
      backendServer = null;
    } catch (e) {
      // ignore
    }
  });
}

