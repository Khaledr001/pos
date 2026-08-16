import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { closeDatabase, openDatabase } from "./db/sqlite.js";
import { registerHardwareHandlers } from "./hardware/index.js";
import { registerDataHandlers } from "./ipc/index.js";
import { registerSyncHandlers, stopSyncEngine } from "./sync/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Electron main process.
 *
 * Everything with real privilege lives here: the SQLite file, the sync engine,
 * the printer and cash drawer. The renderer is a plain React app with no Node
 * access at all — it reaches these through a narrow, explicitly enumerated IPC
 * surface defined in preload.ts.
 *
 * That split matters on a POS terminal. The renderer displays whatever comes
 * back from the server, and a compromised or buggy renderer with Node
 * integration could read the local database, mint print jobs, or open the cash
 * drawer. With `contextIsolation` on and `nodeIntegration` off, it can only
 * call the handlers registered below.
 */

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#0b0d10",
    title: "DevsFleet POS",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      // Non-negotiable on a terminal that handles money.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs `require` for the IPC bridge
      webSecurity: true,
      spellcheck: false,
    },
  });

  // Paint once, rather than showing a white rectangle then the app.
  mainWindow.once("ready-to-show", () => mainWindow?.show());

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(join(__dirname, "../dist/index.html"));
  }

  // A cashier must never be able to navigate the shell away from the app.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== devServerUrl) event.preventDefault();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * One terminal, one instance.
 *
 * Two windows sharing one SQLite file would each hold their own outbox cursor
 * and could push the same offline sale twice. The server's idempotency key
 * would catch it, but a second window is never what the operator wanted anyway.
 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    openDatabase();
    registerDataHandlers(ipcMain);
    registerSyncHandlers(ipcMain, () => mainWindow);
    registerHardwareHandlers(ipcMain);
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * Flush the outbox and close SQLite cleanly on shutdown. An unclean close can
 * leave the WAL unmerged, and the next boot would have to recover it — at the
 * counter, that is a terminal that takes thirty seconds to open.
 */
app.on("before-quit", () => {
  stopSyncEngine();
  closeDatabase();
});
