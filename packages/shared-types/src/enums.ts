/**
 * Every string union in the platform lives here, expressed as a frozen const
 * object plus a derived union type.
 *
 * Why not TypeScript `enum`: enums emit runtime objects that do not survive
 * `isolatedModules`, cannot be used in a Postgres CHECK constraint verbatim,
 * and do not narrow from a plain string coming off the wire. The const-object
 * pattern gives us the literal union for types, the value list for Zod and for
 * drizzle `pgEnum`, and zero interop friction between NestJS, Next.js and the
 * Electron renderer.
 *
 * RULE: these values are written to the database. Renaming one is a migration,
 * not a refactor.
 */

const asConst = <T extends readonly string[]>(values: T) => values;

// -----------------------------------------------------------------------------
// Money & locale
// -----------------------------------------------------------------------------

/**
 * ISO-4217. AED is the only currency in use today, but every monetary document
 * carries a currency code and an FX rate snapshot so adding a second currency
 * later is a data change, not a schema migration.
 */
export const CURRENCIES = asConst(["AED", "USD", "EUR", "GBP", "INR", "PKR", "BDT", "SAR"]);
export type Currency = (typeof CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = "AED";

/** Languages the WhatsApp AI and the UIs must handle. */
export const LOCALES = asConst(["en", "ar", "hi", "ur", "bn"]);
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Locales that render right-to-left. Drives `dir` on the admin panel. */
export const RTL_LOCALES: readonly Locale[] = ["ar", "ur"];

/**
 * How a document's tax_pct relates to its unit_price.
 * Configured per tenant, overridable per document.
 */
export const TAX_MODES = asConst(["exclusive", "inclusive"]);
export type TaxMode = (typeof TAX_MODES)[number];

// -----------------------------------------------------------------------------
// Identity
// -----------------------------------------------------------------------------

/**
 * Seeded role names. Roles are rows, not code — a tenant can add its own — but
 * these four are created for every tenant and referenced by seed data.
 */
export const SYSTEM_ROLES = asConst(["admin", "manager", "cashier", "warehouse"]);
export type SystemRole = (typeof SYSTEM_ROLES)[number];

// -----------------------------------------------------------------------------
// Catalog & pricing
// -----------------------------------------------------------------------------

export const PRICE_LIST_TYPES = asConst(["retail", "wholesale", "special"]);
export type PriceListType = (typeof PRICE_LIST_TYPES)[number];

export const CUSTOMER_TYPES = asConst(["retail", "wholesale", "vip"]);
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

// -----------------------------------------------------------------------------
// Inventory
// -----------------------------------------------------------------------------

/**
 * Every row in inventory_transactions carries one of these. The ledger is
 * append-only: a mistake is corrected with a compensating `adjustment`, never
 * by updating or deleting an existing row.
 */
export const INVENTORY_TX_TYPES = asConst([
  "sale",
  "sale_return",
  "purchase",
  "purchase_return",
  "transfer_in",
  "transfer_out",
  "adjustment",
  "reservation",
  "release",
  "opening_balance",
]);
export type InventoryTxType = (typeof INVENTORY_TX_TYPES)[number];

export const TRANSFER_STATUSES = asConst([
  "requested",
  "approved",
  "shipped",
  "received",
  "cancelled",
]);
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

// -----------------------------------------------------------------------------
// Sales pipeline
// -----------------------------------------------------------------------------

export const QUOTATION_STATUSES = asConst([
  "draft",
  "sent",
  "confirmed",
  "converted",
  "expired",
  "cancelled",
]);
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const ORDER_STATUSES = asConst([
  "pending",
  "processing",
  "ready",
  "completed",
  "cancelled",
]);
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const SALE_STATUSES = asConst(["completed", "returned", "partially_returned", "voided"]);
export type SaleStatus = (typeof SALE_STATUSES)[number];

/** Which surface created the document. Drives reporting and sync rules. */
export const DOCUMENT_SOURCES = asConst(["pos", "whatsapp", "admin", "manual", "api"]);
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

export const PURCHASE_ORDER_STATUSES = asConst([
  "draft",
  "sent",
  "partial",
  "received",
  "cancelled",
]);
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

// -----------------------------------------------------------------------------
// Money movement
// -----------------------------------------------------------------------------

export const PAYMENT_METHODS = asConst([
  "cash",
  "card",
  "bank_transfer",
  "cheque",
  "credit",
  "store_credit",
  /** A sale funded, wholly or partly, by spending loyalty points. */
  "loyalty_points",
]);
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CASH_SESSION_STATUSES = asConst(["open", "closed"]);
export type CashSessionStatus = (typeof CASH_SESSION_STATUSES)[number];

export const CASH_MOVEMENT_TYPES = asConst(["sale", "refund", "cash_in", "cash_out", "payout"]);
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

// -----------------------------------------------------------------------------
// WhatsApp & AI
// -----------------------------------------------------------------------------

export const CONVERSATION_STATUSES = asConst(["active", "resolved", "escalated"]);
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_DIRECTIONS = asConst(["inbound", "outbound"]);
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MESSAGE_TYPES = asConst([
  "text",
  "image",
  "document",
  "audio",
  "video",
  "location",
  "template",
  "interactive",
  "unsupported",
]);
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const MESSAGE_STATUSES = asConst(["queued", "sent", "delivered", "read", "failed"]);
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * One row per LLM tool invocation. This table is the audit trail for
 * "why did the bot say that" — every AI action is logged with its input and
 * output, including the ones that failed.
 */
export const AI_ACTION_TYPES = asConst([
  "product_search",
  "check_price",
  "check_stock",
  "create_quotation",
  "confirm_order",
  "get_customer_info",
  "get_order_status",
  "escalate_to_human",
]);
export type AiActionType = (typeof AI_ACTION_TYPES)[number];

export const AI_ACTION_STATUSES = asConst(["completed", "failed", "rejected"]);
export type AiActionStatus = (typeof AI_ACTION_STATUSES)[number];

// -----------------------------------------------------------------------------
// Sync
// -----------------------------------------------------------------------------

export const DEVICE_TYPES = asConst(["pos", "kiosk", "warehouse_scanner"]);
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const SYNC_DIRECTIONS = asConst(["push", "pull"]);
export type SyncDirection = (typeof SYNC_DIRECTIONS)[number];

export const SYNC_STATUSES = asConst(["pending", "synced", "conflict", "resolved", "rejected"]);
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/** Entities the POS pushes up or pulls down. Order matters on pull: dependencies first. */
/**
 * A closed day is never reopened.
 *
 * There is no `reopened` state on purpose: the totals are a signed statement
 * about a moment, and a state that allows editing them is a state that makes
 * every prior signature meaningless.
 */
export const DAY_CLOSE_STATUSES = asConst(["open", "closed"]);
export type DayCloseStatus = (typeof DAY_CLOSE_STATUSES)[number];

export const SYNC_ENTITIES = asConst([
  "product",
  "product_price",
  "category",
  "brand",
  "unit",
  "customer",
  "inventory",
  "sale",
  "payment",
  "cash_session",
  "cash_movement",
  "held_cart",
  "expense",
  "quotation",
  "order",
  "customer_payment",
  /**
   * The staff directory, pulled so a terminal can verify a PIN with no
   * network at all. Every terminal pulls it, regardless of the signed-in
   * principal's own permissions — see PULL_PERMISSIONS in sync.service.ts for
   * why this one is deliberately not `user:read`-gated.
   */
  "user",
]);
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

// -----------------------------------------------------------------------------
// Printing
// -----------------------------------------------------------------------------

/** The POS must support all three — thermal for the counter, A4 for tax invoices. */
/**
 * `Available` -> `Sold` -> `Returned` -> `Available`. Any state -> `Damaged`,
 * which is terminal — a damaged unit never becomes sellable again by changing
 * its status back.
 */
export const SERIAL_NUMBER_STATUSES = asConst(["available", "sold", "returned", "damaged"]);
export type SerialNumberStatus = (typeof SERIAL_NUMBER_STATUSES)[number];

export const LOYALTY_TYPES = asConst(["earned", "redeemed"]);
export type LoyaltyType = (typeof LOYALTY_TYPES)[number];

export const PRINT_FORMATS = asConst(["thermal_58", "thermal_80", "a4"]);
export type PrintFormat = (typeof PRINT_FORMATS)[number];
