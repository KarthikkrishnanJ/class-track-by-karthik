/**
 * ClassTrack — Electron main process
 *
 * Features:
 * - System tray (app stays running when window is "closed")
 * - Native OS notifications via IPC bridge
 * - Auto-updater (electron-updater) — checks for updates on launch + every 4 hours
 * - Single-instance lock
 * - Start on login option
 */

const {
  app, BrowserWindow, Tray, Menu, Notification,
  nativeImage, ipcMain, shell,
} = require("electron");
const path  = require("path");

// ── Single-instance lock ──────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); process.exit(0); }

// ── State ─────────────────────────────────────────────────────────────────────
let mainWindow = null;
let tray       = null;
let isQuitting = false;

const isDev    = !app.isPackaged;
const APP_URL  = isDev
  ? "http://localhost:5173"
  : `file://${path.join(__dirname, "dist", "index.html")}`;

// Use a simple PNG or ICO in production; fall back gracefully in dev
const ICON_PATH = path.join(__dirname, isDev ? "public" : "dist", "icon.png");
const TRAY_ICON = path.join(__dirname, isDev ? "public" : "dist", "icon.png");

// ── Auto-updater ──────────────────────────────────────────────────────────────
// Only initialise auto-updater in packaged builds; skip in dev
let autoUpdater = null;
if (!isDev) {
  try {
    const { autoUpdater: au } = require("electron-updater");
    autoUpdater = au;

    autoUpdater.autoDownload = true;   // download silently in background
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-available", info => {
      notify("ClassTrack — Update Available",
        `Version ${info.version} is downloading in the background. It will install on next restart.`,
        "update-available");
    });

    autoUpdater.on("update-downloaded", () => {
      notify("ClassTrack — Ready to Update",
        "The update has been downloaded. Restart ClassTrack to install it.",
        "update-ready");
    });

    autoUpdater.on("error", err => {
      console.error("Auto-updater error:", err.message);
    });

    // Check on launch (after a short delay to let the window settle)
    app.whenReady().then(() => {
      setTimeout(() => autoUpdater.checkForUpdatesAndNotify(), 10_000);
      // Re-check every 4 hours
      setInterval(() => autoUpdater.checkForUpdatesAndNotify(), 4 * 60 * 60 * 1000);
    });
  } catch (e) {
    // electron-updater not installed — graceful no-op
    console.warn("electron-updater not available:", e.message);
  }
}

// ── Helper: fire an OS notification (also called by auto-updater) ─────────────
function notify(title, body, tag) {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title,
    body,
    silent: false,
    icon: ICON_PATH,
    tag,
  });
  n.on("click", () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
  n.show();
}

// ── Window creation ───────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:  1280,
    height: 820,
    minWidth:  900,
    minHeight: 600,
    title:  "ClassTrack",
    icon:   ICON_PATH,
    backgroundColor: "#08111f",
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      preload: path.join(__dirname, "electron-preload.js"),
    },
  });

  mainWindow.loadURL(APP_URL);

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
  });

  // Intercept close → hide to tray (keeps notifications alive)
  mainWindow.on("close", e => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      // One-time tip on first hide
      if (!app.notificationShown) {
        app.notificationShown = true;
        notify(
          "ClassTrack is still running",
          "Notifications will keep coming in the background. Right-click the tray icon to quit.",
          "tray-tip"
        );
      }
    }
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// ── System tray ───────────────────────────────────────────────────────────────
function createTray() {
  let icon;
  try {
    icon = nativeImage.createFromPath(TRAY_ICON);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip("ClassTrack");

  const buildMenu = () => Menu.buildFromTemplate([
    {
      label: "Open ClassTrack",
      click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } },
    },
    { type: "separator" },
    {
      label: "Check for Updates",
      enabled: !!autoUpdater,
      click: () => autoUpdater?.checkForUpdatesAndNotify(),
    },
    { type: "separator" },
    {
      label: "Start on Login",
      type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: item => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: "separator" },
    {
      label: "Quit ClassTrack",
      click: () => { isQuitting = true; app.quit(); },
    },
  ]);

  tray.setContextMenu(buildMenu());

  // Double-click tray icon → show window
  tray.on("double-click", () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

// ── IPC: renderer → OS notification ──────────────────────────────────────────
ipcMain.on("ct-notify", (_, { title, body, tag }) => notify(title, body, tag));

// IPC: open URL in system browser
ipcMain.on("ct-open-external", (_, url) => shell.openExternal(url));

// IPC: query Electron flag
ipcMain.handle("ct-is-electron", () => true);

// ── Second instance → focus existing window ───────────────────────────────────
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
});

app.on("before-quit", () => { isQuitting = true; });

// Keep app alive when all windows are closed (tray maintains it)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !tray) app.quit();
});
