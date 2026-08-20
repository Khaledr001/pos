import type { SyncEntity } from "./enums.js";

/**
 * The POS <-> API sync contract.
 *
 * Design rules, fixed here so both sides cannot drift:
 *
 *  1. PUSH is idempotent. The POS mints a v4 UUID (`localId`) for every
 *     record it creates offline and sends it every time. The server upserts on
 *     `localId`, so a retry after a timeout can never double-book a sale.
 *
 *  2. PUSH is append-only. A POS pushes sales, payments, cash sessions and
 *     cash movements. It never pushes a product or a price — the catalogue is
 *     read-only on the terminal.
 *
 *  3. PULL is a high-water mark, not a diff. The POS stores the server's
 *     `checkpoint` and sends it back next time. The server returns everything
 *     changed since. Deletes arrive as tombstones because a row that vanished
 *     from a result set is indistinguishable from one that was never sent.
 *
 *  4. The server clock wins for ordering; the POS clock wins for `occurredAt`
 *     on documents it created offline. A terminal with a wrong clock must not
 *     be able to reorder another terminal's sales.
 */

// -----------------------------------------------------------------------------
// Push
// -----------------------------------------------------------------------------

export interface SyncPushItem<TPayload = unknown> {
  /** UUID minted on the terminal. The idempotency key. Never regenerated. */
  localId: string;
  entity: SyncEntity;
  /** Local monotonic sequence; orders operations from the same device. */
  sequence: number;
  /** Terminal wall-clock at creation, ISO 8601 with offset. */
  occurredAt: string;
  payload: TPayload;
}

export interface SyncPushRequest {
  deviceId: string;
  /** Last checkpoint the device successfully pulled. Lets the server detect staleness. */
  lastCheckpoint: string | null;
  items: SyncPushItem[];
}

export type SyncItemOutcome =
  /** Written for the first time. */
  | "applied"
  /** Already present with this localId — a safe retry, nothing changed. */
  | "duplicate"
  /** Written, but something needs a human: stock went negative, credit exceeded. */
  | "applied_with_warning"
  /** Not written. Permanently invalid — do not retry. */
  | "rejected"
  /** Not written. Transient. Retry with backoff. */
  | "deferred";

export interface SyncPushResult {
  localId: string;
  outcome: SyncItemOutcome;
  /** Server-assigned id, present when outcome is applied/duplicate/applied_with_warning. */
  serverId?: string;
  /** Server-assigned document number, e.g. "INV-2026-000123". */
  documentNumber?: string;
  /** Set on rejected/deferred, and on applied_with_warning. */
  code?: string;
  message?: string;
  /** Populated for applied_with_warning so the terminal can surface an alert. */
  warning?: SyncWarning;
}

export interface SyncWarning {
  type: "negative_stock" | "credit_exceeded" | "price_stale" | "product_inactive";
  message: string;
  context?: Record<string, unknown>;
}

export interface SyncPushResponse {
  results: SyncPushResult[];
  /** Advance the terminal's checkpoint to this after a fully successful push. */
  checkpoint: string;
  serverTime: string;
}

// -----------------------------------------------------------------------------
// Pull
// -----------------------------------------------------------------------------

export interface SyncPullRequest {
  deviceId: string;
  /** null on first sync = full catalogue snapshot. */
  since: string | null;
  entities?: SyncEntity[];
  /** Rows per entity per page. */
  limit?: number;
}

export interface SyncPullChange<TRecord = unknown> {
  entity: SyncEntity;
  id: string;
  /** `deleted: true` is a tombstone — the record is gone or no longer visible. */
  deleted: boolean;
  updatedAt: string;
  record?: TRecord;
}

export interface SyncPullResponse {
  changes: SyncPullChange[];
  /** Store this and send it as `since` next time. Opaque to the client. */
  checkpoint: string;
  /** true = call again immediately with the new checkpoint. */
  hasMore: boolean;
  serverTime: string;
  /** Refreshed offline stock ceiling for this terminal. */
  stockAllocation?: OfflineStockAllocation;
  /**
   * Whether this tenant permits a cart to go negative on stock. Sent on every
   * pull rather than as its own sync entity — it is one flag, not a table,
   * and the terminal needs it before it can decide whether to enforce
   * anything at all: if true, its own local ceiling must stay a no-op.
   */
  allowNegativeStock: boolean;
  /**
   * The seller's own identity — what a compliant tax invoice must print
   * (TRN, legal name, address), not something derivable from any synced
   * table. Sent on every pull, like `allowNegativeStock`: one small object,
   * not worth its own entity and its own checkpoint.
   */
  business: SyncBusinessInfo;
}

export interface SyncBusinessInfo {
  /** Falls back to the tenant's registered name when never set at signup. */
  legalName: string;
  trn: string | null;
  phone: string | null;
  email: string | null;
  addressLines: string[];
  currency: string;
  taxLabel: string;
}

// -----------------------------------------------------------------------------
// Offline stock allocation
// -----------------------------------------------------------------------------

/**
 * Each terminal gets a slice of branch stock it is allowed to sell while
 * offline. Slices are disjoint, so two terminals selling simultaneously offline
 * cannot oversell — until an operator overrides, which is logged.
 *
 * Stored on `devices.offline_stock_allocation` and refreshed on every pull.
 */
export interface OfflineStockAllocation {
  /** Checkpoint at which these numbers were true. */
  issuedAt: string;
  /** Terminal must refuse offline sales of allocated products after this. */
  expiresAt: string;
  /** productId -> units this terminal may sell offline. */
  limits: Record<string, number>;
  /**
   * Products absent from `limits` fall back to this policy.
   * "block"  = cannot be sold offline at all
   * "allow"  = sell freely, reconcile on sync (default; suits a 5,000-SKU catalogue)
   */
  fallback: "block" | "allow";
}

// -----------------------------------------------------------------------------
// Status
// -----------------------------------------------------------------------------

export interface SyncStatusSnapshot {
  online: boolean;
  lastPullAt: string | null;
  lastPushAt: string | null;
  lastCheckpoint: string | null;
  /** Items sitting in the local outbox. */
  pendingPushCount: number;
  /** Items the server rejected and a human must resolve. */
  failedPushCount: number;
  syncing: boolean;
  lastError: string | null;
}
