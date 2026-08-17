"use strict";
const electron = require("electron");
const api = {
  /**
   * Catalogue, read from the local SQLite mirror.
   *
   * Read-only by design: a terminal never edits a product. The catalogue
   * arrives by sync and leaves by sync, so there is no path by which one till
   * can disagree with another about what something costs.
   */
  catalog: {
    search: (query, limit) => electron.ipcRenderer.invoke("catalog:search", query, limit),
    byBarcode: (barcode) => electron.ipcRenderer.invoke("catalog:by-barcode", barcode)
  },
  customers: {
    search: (query) => electron.ipcRenderer.invoke("customers:search", query)
  },
  cash: {
    current: () => electron.ipcRenderer.invoke("cash:current"),
    open: (openingAmount) => electron.ipcRenderer.invoke("cash:open", openingAmount),
    close: (countedAmount, notes) => electron.ipcRenderer.invoke("cash:close", countedAmount, notes),
    movement: (type, amount, reason) => electron.ipcRenderer.invoke("cash:movement", type, amount, reason)
  },
  carts: {
    /** Parked carts live on the terminal — parking one must work offline. */
    hold: (cart) => electron.ipcRenderer.invoke("carts:hold", cart),
    list: () => electron.ipcRenderer.invoke("carts:list"),
    restore: (id) => electron.ipcRenderer.invoke("carts:restore", id),
    discard: (id) => electron.ipcRenderer.invoke("carts:discard", id)
  },
  sales: {
    /**
     * Writes the sale to local SQLite and queues it in the outbox, then
     * returns. It deliberately does not wait for the network: the customer is
     * standing at the counter, and the sale is already real.
     */
    commit: (draft) => electron.ipcRenderer.invoke("sales:commit", draft),
    recent: (limit) => electron.ipcRenderer.invoke("sales:recent", limit),
    find: (reference) => electron.ipcRenderer.invoke("sales:find", reference)
  },
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
  auth: {
    /**
     * The PIN goes to the main process, never to the renderer's own fetch. The
     * refresh token then lives outside the window, so a compromised renderer
     * cannot walk off with a terminal's long-lived credentials.
     */
    pinLogin: (pin) => electron.ipcRenderer.invoke("auth:pin-login", pin)
  },
  device: {
    /** Hardware fingerprint + registration state, shown on the settings screen. */
    info: () => electron.ipcRenderer.invoke("device:info"),
    /** Bind this installation to a device row using a one-time activation code. */
    activate: (activationCode, apiUrl) => electron.ipcRenderer.invoke("device:activate", activationCode, apiUrl)
  }
};
electron.contextBridge.exposeInMainWorld("devsfleet", api);
