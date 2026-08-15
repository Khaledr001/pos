import type { PrintFormat, SyncStatusSnapshot } from "@devsfleet/shared-types";
import { contextBridge, ipcRenderer } from "electron";

/**
 * The entire privileged surface available to the renderer.
 *
 * Deliberately a hand-written allowlist, not a generic `invoke(channel, args)`
 * passthrough. A generic bridge re-opens everything `contextIsolation` was
 * meant to close: the renderer could then call any registered handler with any
 * payload. Every capability the UI needs gets an explicit method here, and
 * nothing else is reachable.
 */

const api = {
  sync: {
    /** Force a sync cycle now — the "Sync" button on the status bar. */
    now: (): Promise<SyncStatusSnapshot> => ipcRenderer.invoke("sync:now"),
    status: (): Promise<SyncStatusSnapshot> => ipcRenderer.invoke("sync:status"),
    /** Push-based status updates, so the UI does not poll. */
    onStatusChange: (callback: (status: SyncStatusSnapshot) => void) => {
      const listener = (_: unknown, status: SyncStatusSnapshot) => callback(status);
      ipcRenderer.on("sync:status-changed", listener);
      return () => ipcRenderer.removeListener("sync:status-changed", listener);
    },
  },

  printer: {
    /** Thermal 58mm/80mm or A4. Rendering happens in the main process. */
    printReceipt: (saleId: string, format: PrintFormat): Promise<void> =>
      ipcRenderer.invoke("printer:receipt", saleId, format),
    printTest: (format: PrintFormat): Promise<void> =>
      ipcRenderer.invoke("printer:test", format),
    list: (): Promise<Array<{ name: string; isDefault: boolean }>> =>
      ipcRenderer.invoke("printer:list"),
  },

  cashDrawer: {
    /**
     * Fires the ESC/POS kick pulse. Requires a reason so an unexplained drawer
     * opening is traceable — an unaudited "open drawer" button is a shrinkage
     * hole, not a feature.
     */
    open: (reason: string): Promise<void> => ipcRenderer.invoke("cash-drawer:open", reason),
  },

  scanner: {
    /**
     * USB HID scanners type their payload like a keyboard, so the renderer can
     * usually just listen for keypresses. This channel is for scanners in
     * serial mode, which the renderer cannot see at all.
     */
    onScan: (callback: (barcode: string) => void) => {
      const listener = (_: unknown, barcode: string) => callback(barcode);
      ipcRenderer.on("scanner:scan", listener);
      return () => ipcRenderer.removeListener("scanner:scan", listener);
    },
  },

  device: {
    /** Hardware fingerprint + registration state, shown on the settings screen. */
    info: (): Promise<{ deviceId: string | null; hardwareId: string; version: string }> =>
      ipcRenderer.invoke("device:info"),
    /** Bind this installation to a device row using a one-time activation code. */
    activate: (activationCode: string, apiUrl: string): Promise<{ deviceId: string }> =>
      ipcRenderer.invoke("device:activate", activationCode, apiUrl),
  },
} as const;

contextBridge.exposeInMainWorld("devsfleet", api);

export type DevsfleetBridge = typeof api;
