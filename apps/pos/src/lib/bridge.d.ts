import type { PrintFormat, SyncStatusSnapshot } from "@devsfleet/shared-types";
import type {
  PosCashSession,
  PosCustomer,
  PosProduct,
  PosSaleDraft,
  PosSaleReceipt,
} from "./pos-data.js";

/**
 * The privileged surface the preload script exposes on `window`.
 *
 * Typed here, in the renderer's own terms, rather than by importing
 * electron/preload.ts — that file lives in the main process's bundle and
 * importing it would pull Electron types into the browser build.
 *
 * `window.devsfleet` is UNDEFINED when the renderer runs in a plain browser
 * tab (`pnpm --filter @devsfleet/pos dev` without Electron). Nothing may assume
 * it exists; go through `posData` in ./pos-data.ts, which picks the right
 * adapter.
 */
export interface DevsfleetBridge {
  catalog: {
    search(query: string, limit?: number): Promise<PosProduct[]>;
    byBarcode(barcode: string): Promise<PosProduct | null>;
  };
  customers: {
    search(query: string): Promise<PosCustomer[]>;
  };
  cash: {
    current(): Promise<PosCashSession | null>;
    open(openingAmount: string): Promise<PosCashSession>;
    close(countedAmount: string, notes?: string): Promise<void>;
    movement(
      type: "cash_in" | "cash_out",
      amount: string,
      reason: string,
    ): Promise<void>;
  };
  sales: {
    commit(draft: PosSaleDraft): Promise<PosSaleReceipt>;
    recent(limit?: number): Promise<PosSaleReceipt[]>;
    find(reference: string): Promise<PosSaleReceipt | null>;
  };
  sync: {
    now(): Promise<SyncStatusSnapshot>;
    status(): Promise<SyncStatusSnapshot>;
    onStatusChange(callback: (status: SyncStatusSnapshot) => void): () => void;
  };
  printer: {
    printReceipt(saleId: string, format: PrintFormat): Promise<void>;
    printTest(format: PrintFormat): Promise<void>;
    list(): Promise<Array<{ name: string; isDefault: boolean }>>;
  };
  cashDrawer: {
    open(reason: string): Promise<void>;
  };
  scanner: {
    onScan(callback: (barcode: string) => void): () => void;
  };
  device: {
    info(): Promise<{ deviceId: string | null; hardwareId: string; version: string }>;
    activate(activationCode: string, apiUrl: string): Promise<{ deviceId: string }>;
  };
}

declare global {
  interface Window {
    devsfleet: DevsfleetBridge;
  }
}
