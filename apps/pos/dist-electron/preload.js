"use strict";
const electron = require("electron");
const api = {
  sync: {
    /** Force a sync cycle now — the "Sync" button on the status bar. */
    now: () => electron.ipcRenderer.invoke("sync:now"),
    status: () => electron.ipcRenderer.invoke("sync:status"),
    /** Push-based status updates, so the UI does not poll. */
    onStatusChange: (callback) => {
      const listener = (_, status) => callback(status);
      electron.ipcRenderer.on("sync:status-changed", listener);
      return () => electron.ipcRenderer.removeListener("sync:status-changed", listener);
    }
  },
  printer: {
    /** Thermal 58mm/80mm or A4. Rendering happens in the main process. */
    printReceipt: (saleId, format) => electron.ipcRenderer.invoke("printer:receipt", saleId, format),
    printTest: (format) => electron.ipcRenderer.invoke("printer:test", format),
    list: () => electron.ipcRenderer.invoke("printer:list")
  },
  cashDrawer: {
    /**
     * Fires the ESC/POS kick pulse. Requires a reason so an unexplained drawer
     * opening is traceable — an unaudited "open drawer" button is a shrinkage
     * hole, not a feature.
     */
    open: (reason) => electron.ipcRenderer.invoke("cash-drawer:open", reason)
  },
  scanner: {
    /**
     * USB HID scanners type their payload like a keyboard, so the renderer can
     * usually just listen for keypresses. This channel is for scanners in
     * serial mode, which the renderer cannot see at all.
     */
    onScan: (callback) => {
      const listener = (_, barcode) => callback(barcode);
      electron.ipcRenderer.on("scanner:scan", listener);
      return () => electron.ipcRenderer.removeListener("scanner:scan", listener);
    }
  },
  device: {
    /** Hardware fingerprint + registration state, shown on the settings screen. */
    info: () => electron.ipcRenderer.invoke("device:info"),
    /** Bind this installation to a device row using a one-time activation code. */
    activate: (activationCode, apiUrl) => electron.ipcRenderer.invoke("device:activate", activationCode, apiUrl)
  }
};
electron.contextBridge.exposeInMainWorld("devsfleet", api);
