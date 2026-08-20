import {
  DEFAULT_ROLE_PERMISSIONS,
  type PaymentMethod,
  type PermissionGrant,
} from "@devsfleet/shared-types";
import { apiClient, clearApiTokens, storeApiTokens } from "./api-client.js";

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
  /**
   * Quantity-break tiers on the default list, lowest minQuantity first —
   * "1" is the ordinary, untiered price every product had before quantity
   * breaks existed. Optional so the browser dev stand-in's plain sample
   * data (no tiers configured) still type-checks.
   */
  priceTiers?: PosPriceTier[];
}

/** One quantity-break tier — see PosProduct.priceTiers. */
export interface PosPriceTier {
  minQuantity: string;
  sellingPrice: string;
}

/**
 * ONLINE-ONLY SHAPES.
 *
 * Transfers and purchase orders are the two things a till genuinely cannot
 * hold locally: both describe stock that is somewhere else. They are not part
 * of `PosDataAdapter` for that reason — there is no offline implementation to
 * pick between, so they go through `window.devsfleet.transfers` /
 * `.purchases`, which proxy the API from the main process.
 */
export interface PosTransferItem {
  variantId: string;
  sku: string;
  productName: string;
  quantity: string;
}

export interface PosTransfer {
  id: string;
  transferNumber: string;
  fromBranchId: string;
  toBranchId: string;
  status: "requested" | "approved" | "shipped" | "received" | "cancelled";
  createdAt: string;
  notes: string | null;
  items: PosTransferItem[];
}

export interface PosPurchaseOrder {
  id: string;
  poNumber: string;
  status: "draft" | "sent" | "partial" | "received" | "cancelled";
  supplierName: string;
  expectedDate: string | null;
  createdAt: string;
}

export interface PosPurchaseOrderItem {
  id: string;
  variantId: string;
  productName: string;
  productSku: string;
  quantity: string;
  receivedQuantity: string;
  unitPrice: string;
  unitAbbr: string;
}

export interface PosPurchaseOrderDetails {
  id: string;
  poNumber: string;
  supplierId: string;
  branchId: string;
  items: PosPurchaseOrderItem[];
}

/** A packaging a variant can be sold in — a box, a carton (Stage 3). */
export interface PosVariantUnit {
  id: string;
  unitId: string;
  unitName: string;
  unitAbbr: string;
  /** Base units per pack. Box of 20 -> "20". */
  conversionFactor: string;
  barcode: string | null;
  /** Flat price for the pack. null = base price x conversionFactor. */
  priceOverride: string | null;
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
  /** In the SOLD unit — "1" box, not the 20 pieces it converts to. */
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  total: string;
  /** A packaging from variant_units. Omit to sell the base unit. */
  unitId?: string;
  /** Base units per pack, snapshotted at sale time. "1" for the base unit. */
  unitConversionFactor?: string;
}

export interface PosSaleDraft {
  /** Minted in the renderer. The server's idempotency key — never regenerated. */
  localId: string;
  customerId: string | null;
  cashSessionId: string | null;
  lines: PosSaleLine[];
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  payments: Array<{ method: PaymentMethod; amount: string; reference?: string }>;
  occurredAt: string;
  /** Signed supervisor approvals, forwarded to the server with the sale. */
  overrideGrants?: string[];
}

export interface PosSaleReceipt extends PosSaleDraft {
  /** Assigned by the server on sync; null while the sale is still local. */
  saleNumber: string | null;
  synced: boolean;
}

export interface PosReturnLine {
  /**
   * Position of this line on the ORIGINAL sale — `sale.lines[originalLineIndex]`.
   * Neither end assigns a line its own id until the server does on first
   * sync, so this is the only stable way to name one offline.
   */
  originalLineIndex: number;
  variantId: string;
  productName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  disposition: "restock" | "scrap";
}

export interface PosReturnDraft {
  localId: string;
  /** The original sale's `localId` — only a same-till return is supported. */
  originalSaleLocalId: string;
  customerId: string | null;
  cashSessionId: string | null;
  lines: PosReturnLine[];
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  refunds: Array<{ method: PaymentMethod; amount: string; reference?: string }>;
  reason?: string;
  occurredAt: string;
}

export interface PosReturnReceipt extends PosReturnDraft {
  /** Assigned by the server on sync; null while the return is still local. */
  returnNumber: string | null;
  synced: boolean;
}

/**
 * A quotation is not a sale draft with fields ignored — it takes no payment
 * and is not tied to a drawer session, so it gets its own type rather than
 * reusing `PosSaleDraft` and leaving `cashSessionId`/`payments` meaningless.
 */
export interface PosQuotationDraft {
  localId: string;
  customerId: string | null;
  lines: PosSaleLine[];
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  occurredAt: string;
}

export interface PosQuotationReceipt extends PosQuotationDraft {
  /** Assigned by the server on sync; null while the quotation is still local. */
  quotationNumber: string | null;
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

export interface PosHeldCart {
  id: string;
  label: string | null;
  lineCount: number;
  total: string;
  customerName: string | null;
  heldAt: string;
}

export interface PosCashier {
  id: string;
  name: string;
  roleName: string;
  permissions: PermissionGrant[];
  /**
   * This cashier's own discount ceiling, as a decimal string.
   *
   * The till needs it to gate the discount box the way it gates the price box.
   * Without it a cashier capped at 0% could type 50%, the receipt would print,
   * and the server would refuse the sale on push — hours later, after the
   * goods had gone.
   *
   * A courtesy, not the control: the server re-checks it on every sale.
   */
  maxDiscountPercent: string;
  branchId: string | null;
  branchName: string | null;
  tenantName: string | null;
}

export interface ManagerApproval {
  managerName: string;
  /** Opaque to the terminal. Attach it, never inspect it. */
  grant: string;
}

export interface CreateCustomerInput {
  name: string;
  phone?: string;
  company?: string;
  trn?: string;
  email?: string;
  creditLimit?: string;
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
  /** Packagings offered for one variant — a box, a carton. Base unit only = []. */
  unitsForVariant(variantId: string): Promise<PosVariantUnit[]>;
  searchCustomers(query: string): Promise<PosCustomer[]>;
  createCustomer(input: CreateCustomerInput): Promise<PosCustomer>;
  checkStockInOtherBranches(sku: string): Promise<Array<{ branchName: string; available: string }>>;

  getOpenCashSession(): Promise<PosCashSession | null>;
  openCashSession(openingAmount: string): Promise<PosCashSession>;
  closeCashSession(countedAmount: string, notes?: string): Promise<void>;
  recordCashMovement(
    type: "cash_in" | "cash_out",
    amount: string,
    reason: string,
  ): Promise<void>;

  recordAccountPayment(input: {
    customerId: string;
    cashSessionId: string | null;
    amount: string;
    method: string;
    reference: string | null;
    notes: string | null;
    occurredAt: string;
  }): Promise<void>;

  /**
   * Ask a supervisor to authorise one action.
   *
   * Returns their name for the receipt AND a signed grant. The grant is what
   * the sale carries to the server: an approval given at the counter has to
   * survive a push that may not happen for hours, and the push goes out on the
   * CASHIER's session. Without it the manager's decision is simply absent at
   * the moment the server makes up its mind, and the sale is refused after the
   * goods have left.
   */
  managerOverride(pin: string, requiredPermission: string): Promise<ManagerApproval>;

  /**
   * Park a cart, list what is parked, take one back.
   *
   * Local, like everything else here. A cart parked while the line is down and
   * restored two minutes later must not depend on the server having seen it —
   * that is the exact moment a queue is forming.
   */
  holdCart(cart: { label: string | null; lineCount: number; total: string; customerName: string | null; cartData: unknown }): Promise<PosHeldCart>;
  listHeldCarts(): Promise<PosHeldCart[]>;
  restoreHeldCart(id: string): Promise<unknown>;
  discardHeldCart(id: string): Promise<void>;

  /** Writes to the local outbox and returns immediately. Never blocks on network. */
  commitSale(draft: PosSaleDraft): Promise<PosSaleReceipt>;
  recentSales(limit?: number): Promise<PosSaleReceipt[]>;
  findSale(saleNumberOrClientId: string): Promise<PosSaleReceipt | null>;
  /** Same fire-and-forget posture as `commitSale` — the refund is already real. */
  commitReturn(draft: PosReturnDraft): Promise<PosReturnReceipt>;

  saveQuotation(draft: PosQuotationDraft): Promise<PosQuotationReceipt>;
  listQuotations(): Promise<PosQuotationReceipt[]>;
}

// -----------------------------------------------------------------------------
// Electron
// -----------------------------------------------------------------------------

/** True when running inside Electron with the preload bridge attached. */
export const hasBridge = (): boolean =>
  typeof window !== "undefined" && typeof window.devsfleet !== "undefined";

/**
 * `electronAdapter` only runs when `hasBridge()` is already true, so it must
 * never reach for `browserAdapter` — that would be a real terminal, synced or
 * not, silently selling from the ten fixed demo SKUs `pnpm dev` ships with.
 *
 * A stock quirk that made this look almost reasonable at a glance: a brand
 * new terminal whose catalogue has not synced yet has an empty local mirror,
 * so an empty result here is completely normal and not itself an error — the
 * bug was answering it with fake products instead of an empty list.
 */
const electronAdapter: PosDataAdapter = {
  signIn: (pin) => window.devsfleet.auth.pinLogin(pin) as unknown as Promise<PosCashier>,
  searchProducts: async (query, limit) => {
    try {
      const rows = await window.devsfleet.catalog.search(query, limit);
      return rows ?? [];
    } catch (err) {
      console.warn("Local catalogue search failed:", err);
      return [];
    }
  },
  findByBarcode: async (barcode) => {
    try {
      return await window.devsfleet.catalog.byBarcode(barcode);
    } catch (err) {
      console.warn("Local barcode lookup failed:", err);
      return null;
    }
  },
  unitsForVariant: async (variantId) => {
    try {
      return await window.devsfleet.catalog.unitsForVariant(variantId);
    } catch (err) {
      console.warn("Local packaging lookup failed:", err);
      return [];
    }
  },
  searchCustomers: async (query) => {
    try {
      return await window.devsfleet.customers.search(query);
    } catch (err) {
      console.warn("Local customer search failed:", err);
      return [];
    }
  },
  /**
   * Works with the network unplugged: the row lands in the local mirror
   * under a terminal-minted id and goes out through the outbox, so the sale
   * being rung up right now can attach it.
   *
   * This used to be feature-detected and throw "not supported offline" —
   * except the bridge method did not exist at all, so it threw on a
   * connected terminal too, and the new-customer form on the sale screen
   * could never succeed anywhere.
   */
  createCustomer: (input) => window.devsfleet.customers.createCustomer(input),
  checkStockInOtherBranches: async (sku) => {
    try {
      const res = await apiClient.get<{ data: Array<{ branchName: string; available: string }> }>(`/inventory?q=${encodeURIComponent(sku)}`);
      return res.data || [];
    } catch {
      return [];
    }
  },
  getOpenCashSession: () => window.devsfleet.cash.current(),
  openCashSession: (amount) => window.devsfleet.cash.open(amount),
  closeCashSession: (amount, notes) => window.devsfleet.cash.close(amount, notes),
  recordCashMovement: (type, amount, reason) =>
    window.devsfleet.cash.movement(type, amount, reason),
  recordAccountPayment: (input) => window.devsfleet.customers.payment(input) as Promise<void>,
  managerOverride: (pin, requiredPermission) =>
    window.devsfleet.auth.managerOverride(pin, requiredPermission),
  holdCart: (cart) => window.devsfleet.carts.hold(cart),
  listHeldCarts: () => window.devsfleet.carts.list(),
  restoreHeldCart: (id) => window.devsfleet.carts.restore(id),
  discardHeldCart: (id) => window.devsfleet.carts.discard(id),
  commitSale: (draft) => window.devsfleet.sales.commit(draft),
  recentSales: (limit) => window.devsfleet.sales.recent(limit),
  findSale: (ref) => window.devsfleet.sales.find(ref),
  commitReturn: (draft) => window.devsfleet.sales.commitReturn(draft),
  saveQuotation: (draft) => window.devsfleet.quotations.save(draft),
  listQuotations: () => window.devsfleet.quotations.list(),
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
  {
    id: "v6",
    productId: "p6",
    sku: "EL-CBL-3CX25",
    barcode: "6291000000062",
    name: "Ducab 3-Core 2.5mm² Flexible Copper Cable",
    variantName: null,
    unitAbbr: "m",
    sellingPrice: "215.00",
    minSellingPrice: "190.00",
    taxPercent: "5",
    stock: "50",
    categoryName: "Electrical",
  },
  {
    id: "v7",
    productId: "p7",
    sku: "EL-SW-1G2W",
    barcode: "6291000000079",
    name: "Schneider 1-Gang 2-Way Light Switch",
    variantName: null,
    unitAbbr: "pcs",
    sellingPrice: "18.50",
    minSellingPrice: "14.00",
    taxPercent: "5",
    stock: "150",
    categoryName: "Electrical",
  },
  {
    id: "v8",
    productId: "p8",
    sku: "TL-TM-8M",
    barcode: "6291000000086",
    name: "Stanley FatMax Heavy Duty Tape Measure 8m",
    variantName: null,
    unitAbbr: "pcs",
    sellingPrice: "45.00",
    minSellingPrice: "35.00",
    taxPercent: "5",
    stock: "30",
    categoryName: "Hardware & Tools",
  },
  {
    id: "v9",
    productId: "p9",
    sku: "SAN-MX-GROHE",
    barcode: "6291000000093",
    name: "Grohe Eurosmart Single-Lever Basin Mixer",
    variantName: null,
    unitAbbr: "pcs",
    sellingPrice: "285.00",
    minSellingPrice: "240.00",
    taxPercent: "5",
    stock: "25",
    categoryName: "Sanitary",
  },
  {
    id: "v10",
    productId: "p10",
    sku: "FX-PLUG-UX8",
    barcode: "6291000000109",
    name: "Fischer Wall Plugs UX 8x50mm Universal Box (100pcs)",
    variantName: null,
    unitAbbr: "box",
    sellingPrice: "32.00",
    minSellingPrice: "25.00",
    taxPercent: "5",
    stock: "80",
    categoryName: "Fasteners & Fixings",
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
  carts: [] as Array<PosHeldCart & { cartData: unknown }>,
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
    maxDiscountPercent: "100",
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
    maxDiscountPercent: "0",
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
    maxDiscountPercent: "25",
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
  // No live backend in this mode — matches saveQuotation below. Every seed
  // product sells in its base unit only.
  async unitsForVariant() {
    return [];
  },
  async searchCustomers(query) {
    const q = query.trim();
    if (!q) return SEED_CUSTOMERS;
    return SEED_CUSTOMERS.filter(
      (c) => matches(c.name, q) || matches(c.company ?? "", q) || (c.phone ?? "").includes(q),
    );
  },
  async createCustomer(input) {
    const newCustomer: PosCustomer = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      company: input.company?.trim() || null,
      phone: input.phone?.trim() || null,
      trn: input.trn?.trim() || null,
      priceListId: null,
      creditLimit: input.creditLimit ? String(input.creditLimit) : "0",
      creditBalance: "0",
      creditOnHold: false,
    };
    SEED_CUSTOMERS.unshift(newCustomer);
    return newCustomer;
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
  async recordAccountPayment(input) {
    const customer = SEED_CUSTOMERS.find((c) => c.id === input.customerId);
    if (customer) {
      customer.creditBalance = String(Number(customer.creditBalance) - Number(input.amount));
    }
  },
  async managerOverride(pin, requiredPermission) {
    const staff = SEED_STAFF.find((s) => s.pin === pin);
    if (!staff) throw new Error("That PIN was not recognised.");
    const hasPerm =
      staff.permissions.includes("*") ||
      staff.permissions.includes(requiredPermission as never);
    if (!hasPerm) throw new Error(`Manager lacks required permission: ${requiredPermission}`);
    // No server, so no signature to produce. The grant is empty rather than
    // faked: browser mode never pushes, and a fabricated one would be a
    // credential-shaped string in a development build.
    return { managerName: staff.name, grant: "" };
  },
  async holdCart(cart) {
    const held = {
      id: crypto.randomUUID(),
      label: cart.label,
      lineCount: cart.lineCount,
      total: cart.total,
      customerName: cart.customerName,
      heldAt: new Date().toISOString(),
      cartData: cart.cartData,
    };
    browserState.carts.unshift(held);
    return held;
  },
  async listHeldCarts() {
    return browserState.carts;
  },
  async restoreHeldCart(id) {
    const index = browserState.carts.findIndex((c) => c.id === id);
    if (index < 0) return null;
    const [held] = browserState.carts.splice(index, 1);
    return held?.cartData ?? null;
  },
  async discardHeldCart(id) {
    browserState.carts = browserState.carts.filter((c) => c.id !== id);
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
      browserState.sales.find((s) => s.saleNumber === ref || s.localId === ref) ?? null
    );
  },
  // No live backend in this mode — matches saveQuotation below. Nothing reads
  // a return back in dev mode, so there is nowhere to store it.
  async commitReturn(draft) {
    return { ...draft, returnNumber: null, synced: false };
  },
  async saveQuotation(draft) {
    return { ...draft, quotationNumber: null, synced: false };
  },
  async listQuotations() {
    return [];
  },
  // No live backend in this mode — matches saveQuotation/listQuotations above.
  async checkStockInOtherBranches() {
    return [];
  },
};

// -----------------------------------------------------------------------------
// API adapter — browser dev mode wired to the real NestJS backend
// -----------------------------------------------------------------------------

/**
 * True when a Vite API URL is configured and the Electron bridge is absent.
 *
 * This is the "browser tab talking to a live API" path, used by developers
 * and for production web builds (if they ever land). The Electron app never
 * reaches this code path — it always has the bridge.
 */
export const hasApiUrl = (): boolean =>
  typeof import.meta !== "undefined" &&
  Boolean((import.meta.env as Record<string, unknown>).VITE_API_URL);

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(val?: string | null): val is string {
  return typeof val === "string" && UUID_REGEX.test(val);
}

/**
 * Thin helpers to read the terminal binding from the auth store without
 * creating a circular dependency — pos-data must not import from store.
 */
function getStoredTerminal(): { branchId: string; deviceId: string } | null {
  try {
    const raw = localStorage.getItem("devsfleet.pos.session");
    if (!raw) return null;
    const session = JSON.parse(raw) as { terminal?: { branchId?: string; deviceId?: string } };
    const t = session.terminal;
    if (t?.branchId && t?.deviceId) return { branchId: t.branchId, deviceId: t.deviceId };
    return null;
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------------
// Terminal Registration (Online only)
// -----------------------------------------------------------------------------
export async function adminLoginForRegistration(email: string, password: string) {
  const res = await apiClient.post<{ accessToken: string; refreshToken: string; user: { tenantName: string } }>("/auth/login", { email, password });
  storeApiTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });
  return res.user;
}

export async function fetchBranchesForRegistration() {
  const res = await apiClient.get<{ data: Array<{ id: string; name: string }> }>("/branches");
  return res.data;
}

export async function registerDeviceOnServer(branchId: string, name: string) {
  return apiClient.post<{ id: string }>("/devices", { branchId, name });
}

// API response shapes (may differ slightly from PosXxx interfaces).
interface ApiVariant {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  variantName: string;
  productName: string;
  unitAbbr: string;
  sellingPrice: string;
  minSellingPrice: string | null;
  taxRate: string | null;
  stock: string;
  categoryName: string | null;
  imageUrl?: string | null;
}

interface ApiCustomer {
  id: string;
  name: string;
  companyName: string | null;
  company?: string | null;
  phone: string | null;
  trn: string | null;
  priceListId: string | null;
  creditLimit: string | number;
  creditBalance: string | number;
  creditOnHold: boolean;
}

interface ApiSession {
  id: string;
  openingAmount: string;
  openedAt: string;
  status: "open" | "closed";
  cashIn: string;
  cashOut: string;
  cashSales: string;
}

interface ApiHeldCart {
  id: string;
  label: string | null;
  lineCount: number;
  total: string | number;
  customerName: string | null;
  createdAt: string;
  cartData?: unknown;
}

interface ApiSale {
  id: string;
  saleNumber: string | null;
  localId: string | null;
  customerId: string | null;
  cashSessionId: string | null;
  lines: Array<{
    /** Present on the real API response; absent nowhere it is actually used. */
    id: string;
    variantId: string;
    productName: string;
    productSku: string;
    quantity: string;
    unitPrice: string;
    discountPercent: string;
    taxPercent: string;
    total: string;
  }>;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  payments: Array<{ method: PaymentMethod; amount: string; reference?: string }>;
  occurredAt: string;
  syncedAt?: string | null;
}

function mapVariant(v: ApiVariant): PosProduct {
  return {
    id: v.id,
    productId: v.productId,
    sku: v.sku,
    barcode: v.barcode,
    name: v.productName ?? v.variantName,
    variantName: v.variantName === "Default" ? null : v.variantName,
    unitAbbr: v.unitAbbr,
    sellingPrice: String(v.sellingPrice ?? "0"),
    minSellingPrice: v.minSellingPrice ? String(v.minSellingPrice) : null,
    taxPercent: v.taxRate ?? "0",
    stock: String(v.stock ?? "0"),
    categoryName: v.categoryName,
  };
}

function mapCustomer(c: ApiCustomer): PosCustomer {
  return {
    id: c.id,
    name: c.name,
    company: c.companyName ?? c.company ?? null,
    phone: c.phone ?? null,
    trn: c.trn ?? null,
    priceListId: c.priceListId ?? null,
    creditLimit: String(c.creditLimit ?? "0"),
    creditBalance: String(c.creditBalance ?? "0"),
    creditOnHold: Boolean(c.creditOnHold),
  };
}

function mapSession(s: ApiSession): PosCashSession {
  return {
    id: s.id,
    openingAmount: s.openingAmount,
    openedAt: s.openedAt,
    status: s.status,
    cashIn: s.cashIn ?? "0",
    cashOut: s.cashOut ?? "0",
    cashSales: s.cashSales ?? "0",
  };
}

function mapHeldCart(h: ApiHeldCart): PosHeldCart {
  return {
    id: h.id,
    label: h.label,
    lineCount: h.lineCount,
    total: String(h.total),
    customerName: h.customerName,
    heldAt: h.createdAt,
  };
}

function mapSale(s: ApiSale): PosSaleReceipt {
  return {
    localId: s.localId ?? s.id,
    customerId: s.customerId,
    cashSessionId: s.cashSessionId,
    lines: s.lines ?? [],
    subtotal: s.subtotal,
    taxAmount: s.taxAmount,
    discountAmount: s.discountAmount,
    total: s.total,
    payments: s.payments ?? [],
    occurredAt: s.occurredAt,
    saleNumber: s.saleNumber,
    synced: Boolean(s.syncedAt),
  };
}

const apiAdapter: PosDataAdapter = {
  async signIn(pin) {
    const terminal = getStoredTerminal();
    if (!terminal || !isUuid(terminal.branchId) || !isUuid(terminal.deviceId)) {
      throw new Error("This terminal has not been activated yet.");
    }

    interface PinLoginResponse {
      accessToken: string;
      refreshToken: string;
      user: {
        id: string;
        name: string;
        roleName: string;
        permissions: PermissionGrant[];
        branchId: string | null;
        branchName: string | null;
        tenantName: string;
        maxDiscountPercent?: string;
      };
    }

    /**
     * Errors reach the caller as-is. This used to fall through to
     * `browserAdapter.signIn`, so ANY failure — the network down, a wrong
     * PIN, a misconfigured terminal — was answered by checking the hardcoded
     * PINs 1234/2222/3333 and, if one matched, signing the cashier in as a
     * fake administrator with every permission granted. Typing 1234 into a
     * real, disconnected terminal is not a login failure most people would
     * think to test; it looked like the till working normally.
     */
    const res = await apiClient.post<PinLoginResponse>("/auth/pin-login", {
      pin,
      deviceId: terminal.deviceId,
      branchId: terminal.branchId,
    });

    storeApiTokens({ accessToken: res.accessToken, refreshToken: res.refreshToken });

    return {
      id: res.user.id,
      name: res.user.name,
      roleName: res.user.roleName,
      permissions: res.user.permissions,
      branchId: res.user.branchId,
      branchName: res.user.branchName,
      tenantName: res.user.tenantName ?? null,
      // Absent means zero, not unlimited: an older server leaves the till
      // refusing discounts rather than waving them through.
      maxDiscountPercent: res.user.maxDiscountPercent ?? "0",
    };
  },

  async searchProducts(query, limit = 25) {
    try {
      const terminal = getStoredTerminal();
      const params = new URLSearchParams({ q: query, limit: String(limit) });
      if (isUuid(terminal?.branchId)) params.set("branchId", terminal.branchId);
      const rows = await apiClient.get<ApiVariant[]>(`/products/search?${params.toString()}`);
      return Array.isArray(rows) ? rows.map(mapVariant) : [];
    } catch (err) {
      console.warn("Product search failed:", err);
      return [];
    }
  },

  async findByBarcode(barcode) {
    try {
      const terminal = getStoredTerminal();
      const params = new URLSearchParams({ q: barcode, limit: "1" });
      if (isUuid(terminal?.branchId)) params.set("branchId", terminal.branchId);
      const rows = await apiClient.get<ApiVariant[]>(`/products/search?${params.toString()}`);
      const match = rows?.find((r) => r.barcode === barcode);
      return match ? mapVariant(match) : null;
    } catch (err) {
      console.warn("Barcode lookup failed:", err);
      return null;
    }
  },

  // No direct-read route exists for variant_units yet — the offline mirror
  // (Stage 3.2) is the only consumer so far. This adapter never runs in the
  // real Electron app, so packagings are simply unavailable here for now.
  async unitsForVariant() {
    return [];
  },

  async searchCustomers(query) {
    try {
      const params = new URLSearchParams({ q: query, pageSize: "20" });
      const res = await apiClient.get<{ items: ApiCustomer[] } | ApiCustomer[]>(
        `/customers?${params.toString()}`,
      );
      const items = Array.isArray(res) ? res : (res?.items ?? []);
      return items.map(mapCustomer);
    } catch (err) {
      console.warn("Customer search failed:", err);
      return [];
    }
  },

  async createCustomer(input) {
    try {
      const terminal = getStoredTerminal();
      const payload: Record<string, unknown> = {
        name: input.name.trim(),
        type: "retail",
      };
      if (input.company?.trim()) payload.company = input.company.trim();
      if (input.phone?.trim()) payload.phone = input.phone.trim();
      if (input.email?.trim()) payload.email = input.email.trim();
      if (input.trn?.trim()) payload.trn = input.trn.trim();
      if (input.creditLimit) payload.creditLimit = Number(input.creditLimit);
      if (isUuid(terminal?.branchId)) payload.branchId = terminal.branchId;

      const res = await apiClient.post<ApiCustomer>("/customers", payload);
      return mapCustomer(res);
    } catch (err) {
      // Rethrown, not answered with a customer that only ever existed in this
      // tab's memory: the caller would show "customer added" for something
      // the server never saw, and it vanishes on the next reload regardless.
      console.warn("Creating the customer failed:", err);
      throw err instanceof Error ? err : new Error("Could not create the customer.");
    }
  },

  async getOpenCashSession() {
    const terminal = getStoredTerminal();
    if (!terminal) return null;
    try {
      const params = new URLSearchParams({ branchId: terminal.branchId, deviceId: terminal.deviceId });
      const session = await apiClient.get<ApiSession | null>(`/cash-register/current?${params.toString()}`);
      return session ? mapSession(session) : null;
    } catch {
      return null;
    }
  },

  async openCashSession(openingAmount) {
    const terminal = getStoredTerminal();
    const session = await apiClient.post<ApiSession>("/cash-register/open", {
      branchId: terminal?.branchId,
      deviceId: terminal?.deviceId,
      openingAmount: Number(openingAmount),
      openedAt: new Date().toISOString(),
    });
    return mapSession(session);
  },

  async closeCashSession(countedAmount, notes) {
    // We need the open session id — read it first.
    const terminal = getStoredTerminal();
    if (!terminal) return;
    const params = new URLSearchParams({ branchId: terminal.branchId, deviceId: terminal.deviceId });
    const session = await apiClient.get<ApiSession | null>(`/cash-register/current?${params.toString()}`);
    if (!session) return;
    await apiClient.post(`/cash-register/${session.id}/close`, {
      countedAmount: Number(countedAmount),
      notes,
    });
  },

  async recordCashMovement(type, amount, reason) {
    const session = await this.getOpenCashSession();
    if (!session) throw new Error("No open session");

    await apiClient.post(`/cash-registers/sessions/${session.id}/movements`, {
      type,
      amount: Number(amount),
      reason,
    });
  },

  async recordAccountPayment() {
    // API direct fallback (browser mode without bridge)
    throw new Error("Not implemented in direct API mode");
  },

  async managerOverride(pin, requiredPermission) {
    /**
     * Returns the approver's NAME, and nothing else, because that is all the
     * server returns. The endpoint mints no token: the session making this
     * call is the cashier's and stays the cashier's, which is the difference
     * between an override and a login.
     */
    const result = await apiClient.post<{
      approvedBy: { id: string; name: string };
      grant: string;
    }>("/auth/verify-override", { pin, permission: requiredPermission });
    return { managerName: result.approvedBy.name, grant: result.grant };
  },

  async checkStockInOtherBranches(sku) {
    try {
      const res = await apiClient.get<{ data: Array<{ branchName: string; available: string }> }>(`/inventory?q=${encodeURIComponent(sku)}`);
      return res.data || [];
    } catch {
      return [];
    }
  },

  async holdCart(cart) {
    const terminal = getStoredTerminal();
    const held = await apiClient.post<ApiHeldCart>("/held-carts", {
      branchId: terminal?.branchId,
      label: cart.label,
      lineCount: cart.lineCount,
      total: Number(cart.total),
      customerName: cart.customerName,
      cartData: cart.cartData as Record<string, unknown>,
    });
    return mapHeldCart(held);
  },

  async listHeldCarts() {
    const terminal = getStoredTerminal();
    const params = new URLSearchParams();
    if (terminal?.branchId) params.set("branchId", terminal.branchId);
    const res = await apiClient.get<ApiHeldCart[] | { items: ApiHeldCart[] }>(`/held-carts?${params.toString()}`);
    const items = Array.isArray(res) ? res : res.items;
    return items.map(mapHeldCart);
  },

  async restoreHeldCart(id) {
    const res = await apiClient.post<ApiHeldCart>(`/held-carts/${id}/restore`);
    return res?.cartData ?? null;
  },

  async discardHeldCart(id) {
    await apiClient.delete(`/held-carts/${id}`);
  },

  async commitSale(draft) {
    const terminal = getStoredTerminal();
    const sale = await apiClient.post<ApiSale>("/sales", {
      branchId: terminal?.branchId,
      customerId: draft.customerId,
      cashSessionId: draft.cashSessionId,
      source: "pos",
      localId: draft.localId,
      occurredAt: draft.occurredAt,
      lines: draft.lines.map((l) => ({
        variantId: l.variantId,
        quantity: Number(l.quantity),
        unitPrice: l.unitPrice,
        discountPercent: Number(l.discountPercent),
      })),
      payments: draft.payments.map((p) => ({
        method: p.method,
        amount: Number(p.amount),
        reference: p.reference,
      })),
    });
    return mapSale(sale);
  },

  async recentSales(limit = 20) {
    const terminal = getStoredTerminal();
    const params = new URLSearchParams({ limit: String(limit) });
    if (terminal?.branchId) params.set("branchId", terminal.branchId);
    const res = await apiClient.get<{ items: ApiSale[] } | ApiSale[]>(`/sales?${params.toString()}`);
    const items = Array.isArray(res) ? res : res.items;
    return items.map(mapSale);
  },

  async findSale(ref) {
    try {
      const sale = await apiClient.get<ApiSale>(`/sales/${ref}`);
      return mapSale(sale);
    } catch {
      return null;
    }
  },
  /**
   * This adapter talks to the API directly, so — unlike the offline mirror —
   * it can just fetch the original sale and read each line's real id, rather
   * than resolving `originalLineIndex` back to one server-side.
   */
  async commitReturn(draft) {
    const original = await apiClient.get<ApiSale>(`/sales/${draft.originalSaleLocalId}`);
    const lines = draft.lines.map((line) => {
      const match = original.lines[line.originalLineIndex];
      if (!match) {
        throw new Error(`Line ${line.originalLineIndex} no longer exists on this sale`);
      }
      return { saleItemId: match.id, quantity: Number(line.quantity), disposition: line.disposition };
    });

    const created = await apiClient.post<{ saleNumber: string | null }>("/sales/returns", {
      originalSaleId: original.id,
      lines,
      refunds: draft.refunds.map((r) => ({
        method: r.method,
        amount: Number(r.amount),
        ...(r.reference ? { reference: r.reference } : {}),
      })),
      ...(draft.reason ? { reason: draft.reason } : {}),
      ...(draft.cashSessionId ? { cashSessionId: draft.cashSessionId } : {}),
    });

    return { ...draft, returnNumber: created.saleNumber, synced: true };
  },
  async saveQuotation(draft) {
    return { ...draft, quotationNumber: null, synced: false };
  },
  async listQuotations() {
    return [];
  },
};

/**
 * Picked once, at module load. The bridge either exists for the whole session
 * or it never will, so re-checking per call would only add noise.
 */
export const posData: PosDataAdapter = hasBridge()
  ? electronAdapter
  : hasApiUrl()
    ? apiAdapter
    : browserAdapter;

/** Shown in Settings so it is obvious which mode a terminal is running in. */
export const dataMode: "electron" | "api" | "browser" = hasBridge()
  ? "electron"
  : hasApiUrl()
    ? "api"
    : "browser";

/**
 * Call this on sign-out in API mode so the stored token is cleared.
 * The Zustand signOut already wipes the session; this handles the API tokens.
 */
export function clearPosApiSession(): void {
  /**
   * Unconditional, not `if (dataMode === "api")`.
   *
   * The renderer holds API tokens in EVERY mode, because terminal registration
   * signs in as an administrator over HTTP before the Electron bridge is ever
   * used, and Transfers/Receiving call the API directly afterwards. Gating the
   * cleanup on api-mode meant that on a real Electron till — the only kind that
   * ships — signing out never cleared anything.
   */
  clearApiTokens();
}
