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

/**
 * Shapes are re-declared here rather than imported from the renderer's
 * src/lib/pos-data.ts. The preload script is a separate bundle in the main
 * process's world; importing renderer code into it would drag renderer
 * dependencies across the isolation boundary that this file exists to defend.
 */
interface BridgeProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  unitAbbr: string;
  sellingPrice: string;
  minSellingPrice: string | null;
  taxPercent: string;
  stock: string;
  categoryName: string | null;
}

interface BridgeCustomer {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  trn: string | null;
  priceListId: string | null;
  creditLimit: string;
  creditBalance: string;
  creditOnHold: boolean;
}

interface BridgeCashSession {
  id: string;
  openingAmount: string;
  openedAt: string;
  status: "open" | "closed";
  cashIn: string;
  cashOut: string;
  cashSales: string;
}

const api = {
  /**
   * Catalogue, read from the local SQLite mirror.
   *
   * Read-only by design: a terminal never edits a product. The catalogue
   * arrives by sync and leaves by sync, so there is no path by which one till
   * can disagree with another about what something costs.
   */
  catalog: {
    search: (query: string, limit?: number): Promise<BridgeProduct[]> =>
      ipcRenderer.invoke("catalog:search", query, limit),
    byBarcode: (barcode: string): Promise<BridgeProduct | null> =>
      ipcRenderer.invoke("catalog:by-barcode", barcode),
  },

  customers: {
    search: (query: string): Promise<BridgeCustomer[]> =>
      ipcRenderer.invoke("customers:search", query),
  },

  cash: {
    current: (): Promise<BridgeCashSession | null> => ipcRenderer.invoke("cash:current"),
    open: (openingAmount: string): Promise<BridgeCashSession> =>
      ipcRenderer.invoke("cash:open", openingAmount),
    close: (countedAmount: string, notes?: string): Promise<void> =>
      ipcRenderer.invoke("cash:close", countedAmount, notes),
    movement: (
      type: "cash_in" | "cash_out",
      amount: string,
      reason: string,
    ): Promise<void> => ipcRenderer.invoke("cash:movement", type, amount, reason),
  },

  sales: {
    /**
     * Writes the sale to local SQLite and queues it in the outbox, then
     * returns. It deliberately does not wait for the network: the customer is
     * standing at the counter, and the sale is already real.
     */
    commit: (draft: unknown): Promise<unknown> => ipcRenderer.invoke("sales:commit", draft),
    recent: (limit?: number): Promise<unknown[]> =>
      ipcRenderer.invoke("sales:recent", limit),
    find: (reference: string): Promise<unknown> =>
      ipcRenderer.invoke("sales:find", reference),
  },

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
