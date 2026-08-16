import {
  DEFAULT_ROLE_PERMISSIONS,
  type PaymentMethod,
  type PermissionGrant,
} from "@devsfleet/shared-types";

/**
 * The renderer's only route to data.
 *
 * The POS is offline-first, so the UI must NEVER call the API directly — a
 * terminal with no network still has to sell. Everything here reads from the
 * local SQLite mirror through the preload bridge, and anything it creates goes
 * into the local outbox for the sync engine to push later.
 *
 * Two implementations:
 *
 *   electronAdapter  the real one, over IPC.
 *   browserAdapter   an in-memory stand-in so `pnpm --filter @devsfleet/pos dev`
 *                    renders in a plain browser tab. It carries the same five
 *                    products as `pnpm db:seed`, so what you see developing
 *                    matches what you see on a real terminal.
 *
 * The UI cannot tell them apart, which is the point: screens stay testable
 * without Electron, and no screen grows a hidden dependency on Node.
 */

export interface PosProduct {
  /**
   * The VARIANT id — the sellable unit, and what a sale line carries.
   *
   * A 1" elbow and a 3/4" elbow are one catalogue entry with two barcodes, two
   * prices and two stock figures. The cashier scans the variant, so that is
   * what the till holds and what the server is told was sold.
   */
  id: string;
  /** The catalogue entry this variant belongs to. Display and grouping only. */
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  /** e.g. '1 inch' — null when the product has a single variant. */
  variantName: string | null;
  unitAbbr: string;
  /** Decimal string, never a float. Feed it to Money.toMinor. */
  sellingPrice: string;
  /** Floor. Selling below it needs `price:override_floor`. */
  minSellingPrice: string | null;
  /** Per-product override of the tenant VAT rate. */
  taxPercent: string;
  /** Available = on hand minus reserved, at this branch. */
  stock: string;
  categoryName: string | null;
}

export interface PosCustomer {
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

export interface PosSaleLine {
  variantId: string;
  productName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  total: string;
}

export interface PosSaleDraft {
  /** Minted in the renderer. The server's idempotency key — never regenerated. */
  clientId: string;
  customerId: string | null;
  cashSessionId: string | null;
  lines: PosSaleLine[];
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  payments: Array<{ method: PaymentMethod; amount: string; reference?: string }>;
  occurredAt: string;
}

export interface PosSaleReceipt extends PosSaleDraft {
  /** Assigned by the server on sync; null while the sale is still local. */
  saleNumber: string | null;
  synced: boolean;
}

export interface PosCashSession {
  id: string;
  openingAmount: string;
  openedAt: string;
  status: "open" | "closed";
  /** Cash movements so far, for the expected-drawer calculation. */
  cashIn: string;
  cashOut: string;
  cashSales: string;
}

export interface PosCashier {
  id: string;
  name: string;
  roleName: string;
  permissions: PermissionGrant[];
  branchId: string | null;
  branchName: string | null;
  tenantName: string | null;
}

export interface PosDataAdapter {
  /**
   * Verify a cashier PIN.
   *
   * The one call that genuinely needs the network — a PIN cannot be checked
   * against a mirror without storing something equivalent to the PIN on the
   * terminal, and a stolen till would then hand over every cashier's
   * credentials. A shift change therefore requires connectivity; a sale does
   * not.
   */
  signIn(pin: string): Promise<PosCashier>;

  searchProducts(query: string, limit?: number): Promise<PosProduct[]>;
  findByBarcode(barcode: string): Promise<PosProduct | null>;
  searchCustomers(query: string): Promise<PosCustomer[]>;

  getOpenCashSession(): Promise<PosCashSession | null>;
  openCashSession(openingAmount: string): Promise<PosCashSession>;
  closeCashSession(countedAmount: string, notes?: string): Promise<void>;
  recordCashMovement(
    type: "cash_in" | "cash_out",
    amount: string,
    reason: string,
  ): Promise<void>;

  /** Writes to the local outbox and returns immediately. Never blocks on network. */
  commitSale(draft: PosSaleDraft): Promise<PosSaleReceipt>;
  recentSales(limit?: number): Promise<PosSaleReceipt[]>;
  findSale(saleNumberOrClientId: string): Promise<PosSaleReceipt | null>;
}

// -----------------------------------------------------------------------------
// Electron
// -----------------------------------------------------------------------------

/** True when running inside Electron with the preload bridge attached. */
export const hasBridge = (): boolean =>
  typeof window !== "undefined" && typeof window.devsfleet !== "undefined";

const electronAdapter: PosDataAdapter = {
  signIn: (pin) => window.devsfleet.auth.pinLogin(pin) as Promise<PosCashier>,
  searchProducts: (query, limit) => window.devsfleet.catalog.search(query, limit),
  findByBarcode: (barcode) => window.devsfleet.catalog.byBarcode(barcode),
  searchCustomers: (query) => window.devsfleet.customers.search(query),
  getOpenCashSession: () => window.devsfleet.cash.current(),
  openCashSession: (amount) => window.devsfleet.cash.open(amount),
  closeCashSession: (amount, notes) => window.devsfleet.cash.close(amount, notes),
  recordCashMovement: (type, amount, reason) =>
    window.devsfleet.cash.movement(type, amount, reason),
  commitSale: (draft) => window.devsfleet.sales.commit(draft),
  recentSales: (limit) => window.devsfleet.sales.recent(limit),
  findSale: (ref) => window.devsfleet.sales.find(ref),
};

// -----------------------------------------------------------------------------
// Browser stand-in
// -----------------------------------------------------------------------------

/** Mirrors `pnpm db:seed`, so the dev catalogue is the real seeded catalogue. */
const SEED_PRODUCTS: PosProduct[] = [
  {
    id: "v1",
    productId: "p1",
    sku: "PVC-ELB-001",
    barcode: "6291000000017",
    name: 'PVC Elbow 1" 90 Degree',
    variantName: null,
    unitAbbr: "pcs",
    sellingPrice: "2.75",
    minSellingPrice: "2.00",
    taxPercent: "5",
    stock: "100",
    categoryName: "Plumbing",
  },
  {
    id: "v2",
    productId: "p2",
    sku: "PVC-ELB-002",
    barcode: "6291000000024",
    name: 'PVC Elbow 3/4" 90 Degree',
    variantName: null,
    unitAbbr: "pcs",
    sellingPrice: "2.10",
    minSellingPrice: "1.55",
    taxPercent: "5",
    stock: "100",
    categoryName: "Plumbing",
  },
  {
    id: "v3",
    productId: "p3",
    sku: "CBL-25-RED",
    barcode: "6291000000031",
    name: "Electrical Cable 2.5mm Red",
    variantName: null,
    unitAbbr: "m",
    sellingPrice: "3.50",
    minSellingPrice: "2.75",
    taxPercent: "5",
    stock: "100",
    categoryName: "Electrical",
  },
  {
    id: "v4",
    productId: "p4",
    sku: "PNT-WHT-4L",
    barcode: "6291000000048",
    name: "Emulsion Paint White 4 Litre",
    variantName: null,
    unitAbbr: "ltr",
    sellingPrice: "48.00",
    minSellingPrice: "38.00",
    taxPercent: "5",
    stock: "40",
    categoryName: "Paint",
  },
  {
    id: "v5",
    productId: "p5",
    sku: "TAP-MIX-CHR",
    barcode: "6291000000055",
    name: "Basin Mixer Tap Chrome",
    variantName: null,
    unitAbbr: "pcs",
    sellingPrice: "135.00",
    minSellingPrice: "105.00",
    taxPercent: "5",
    stock: "12",
    categoryName: "Sanitary",
  },
];

const SEED_CUSTOMERS: PosCustomer[] = [
  {
    id: "c1",
    name: "Al Noor Contracting",
    company: "Al Noor Contracting LLC",
    phone: "+971501234567",
    trn: "100123456700003",
    priceListId: null,
    creditLimit: "5000.00",
    creditBalance: "1240.00",
    creditOnHold: false,
  },
  {
    id: "c2",
    name: "Walk-in customer",
    company: null,
    phone: null,
    trn: null,
    priceListId: null,
    creditLimit: "0",
    creditBalance: "0",
    creditOnHold: false,
  },
];

/** Survives navigation within the tab; deliberately not persisted. */
const browserState = {
  session: null as PosCashSession | null,
  sales: [] as PosSaleReceipt[],
};

const matches = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.toLowerCase());

/**
 * Development staff, matching `pnpm db:seed`. PINs are verified by the server
 * on a real terminal — this list exists so the login screen is reachable in a
 * browser tab with no API running.
 */
const SEED_STAFF: Array<PosCashier & { pin: string }> = [
  {
    id: "u1",
    name: "Administrator",
    roleName: "admin",
    permissions: [...(DEFAULT_ROLE_PERMISSIONS.admin ?? [])],
    branchId: "dev-branch",
    branchName: "Dubai — Main",
    tenantName: "DevsFleet Trading",
    pin: "1234",
  },
  {
    id: "u2",
    name: "Ravi Kumar",
    roleName: "cashier",
    permissions: [...(DEFAULT_ROLE_PERMISSIONS.cashier ?? [])],
    branchId: "dev-branch",
    branchName: "Dubai — Main",
    tenantName: "DevsFleet Trading",
    pin: "2222",
  },
  {
    id: "u3",
    name: "Fatima Al Balushi",
    roleName: "manager",
    permissions: [...(DEFAULT_ROLE_PERMISSIONS.manager ?? [])],
    branchId: "dev-branch",
    branchName: "Dubai — Main",
    tenantName: "DevsFleet Trading",
    pin: "3333",
  },
];

const browserAdapter: PosDataAdapter = {
  async signIn(pin) {
    const staff = SEED_STAFF.find((s) => s.pin === pin);
    if (!staff) throw new Error("That PIN was not recognised. Try again.");
    const { pin: _pin, ...cashier } = staff;
    return cashier;
  },
  async searchProducts(query, limit = 25) {
    const q = query.trim();
    if (!q) return SEED_PRODUCTS.slice(0, limit);
    return SEED_PRODUCTS.filter(
      (p) => matches(p.name, q) || matches(p.sku, q) || (p.barcode ?? "").includes(q),
    ).slice(0, limit);
  },
  async findByBarcode(barcode) {
    return SEED_PRODUCTS.find((p) => p.barcode === barcode) ?? null;
  },
  async searchCustomers(query) {
    const q = query.trim();
    if (!q) return SEED_CUSTOMERS;
    return SEED_CUSTOMERS.filter(
      (c) => matches(c.name, q) || matches(c.company ?? "", q) || (c.phone ?? "").includes(q),
    );
  },
  async getOpenCashSession() {
    return browserState.session;
  },
  async openCashSession(openingAmount) {
    browserState.session = {
      id: crypto.randomUUID(),
      openingAmount,
      openedAt: new Date().toISOString(),
      status: "open",
      cashIn: "0",
      cashOut: "0",
      cashSales: "0",
    };
    return browserState.session;
  },
  async closeCashSession() {
    browserState.session = null;
  },
  async recordCashMovement(type, amount) {
    if (!browserState.session) return;
    const key = type === "cash_in" ? "cashIn" : "cashOut";
    browserState.session[key] = String(
      Number(browserState.session[key]) + Number(amount),
    );
  },
  async commitSale(draft) {
    const receipt: PosSaleReceipt = { ...draft, saleNumber: null, synced: false };
    browserState.sales.unshift(receipt);
    if (browserState.session) {
      const cash = draft.payments
        .filter((p) => p.method === "cash")
        .reduce((sum, p) => sum + Number(p.amount), 0);
      browserState.session.cashSales = String(
        Number(browserState.session.cashSales) + cash,
      );
    }
    return receipt;
  },
  async recentSales(limit = 20) {
    return browserState.sales.slice(0, limit);
  },
  async findSale(ref) {
    return (
      browserState.sales.find((s) => s.saleNumber === ref || s.clientId === ref) ?? null
    );
  },
};

/**
 * Picked once, at module load. The bridge either exists for the whole session
 * or it never will, so re-checking per call would only add noise.
 */
export const posData: PosDataAdapter = hasBridge() ? electronAdapter : browserAdapter;

/** Shown in Settings so it is obvious which mode a terminal is running in. */
export const dataMode: "electron" | "browser" = hasBridge() ? "electron" : "browser";
