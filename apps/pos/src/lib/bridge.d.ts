import type { PrintFormat, SyncStatusSnapshot } from "@devsfleet/shared-types";
import type {
  PosCashier,
  PosHeldCart,
  PosCashSession,
  PosCustomer,
  PosProduct,
  PosQuotationDraft,
  PosQuotationReceipt,
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
  auth: {
    /**
     * The PIN crosses into the main process and no further. The refresh token
     * it earns is stored there, outside the window, so a compromised renderer
     * cannot walk off with a terminal's long-lived credentials.
     */
    pinLogin(pin: string): Promise<PosCashier>;
    /** A supervisor's PIN, checked against a specific permission. Returns their name. */
    managerOverride(pin: string, requiredPermission: string): Promise<string>;
  };
  catalog: {
    search(query: string, limit?: number): Promise<PosProduct[]>;
    byBarcode(barcode: string): Promise<PosProduct | null>;
  };
  customers: {
    search(query: string): Promise<PosCustomer[]>;
    createCustomer?(input: {
      name: string;
      phone?: string;
      company?: string;
      trn?: string;
      email?: string;
      creditLimit?: string;
    }): Promise<PosCustomer>;
    /** Settle an old credit invoice. Folded into the drawer when cash and a session are given. */
    payment(input: {
      customerId: string;
      cashSessionId: string | null;
      amount: string;
      method: string;
      reference: string | null;
      notes: string | null;
      occurredAt: string;
    }): Promise<unknown>;
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
  carts: {
    /** Parked carts live on the terminal — parking one must work offline. */
    hold(cart: {
      label: string | null;
      lineCount: number;
      total: string;
      customerName: string | null;
      cartData: unknown;
    }): Promise<PosHeldCart>;
    list(): Promise<PosHeldCart[]>;
    restore(id: string): Promise<unknown>;
    discard(id: string): Promise<void>;
  };
  sales: {
    commit(draft: PosSaleDraft): Promise<PosSaleReceipt>;
    recent(limit?: number): Promise<PosSaleReceipt[]>;
    find(reference: string): Promise<PosSaleReceipt | null>;
  };
  quotations: {
    save(draft: PosQuotationDraft): Promise<PosQuotationReceipt>;
    list(): Promise<PosQuotationReceipt[]>;
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
    info(): Promise<{
      deviceId: string | null;
      branchId: string | null;
      apiUrl: string | null;
      hardwareId: string;
      version: string;
    }>;
    activate(activationCode: string, apiUrl: string): Promise<{ deviceId: string }>;
  };
}

declare global {
  interface Window {
    devsfleet: DevsfleetBridge;
  }
}
