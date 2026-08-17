import type { SyncStatusSnapshot } from "@devsfleet/shared-types";
import type { BrowserWindow, IpcMain } from "electron";
import { getDatabase } from "../db/sqlite.js";
import {
  clearSettledDeltas,
  getState,
  outboxCounts,
  pendingOutbox,
  setState,
  settleOutboxItem,
} from "../db/repositories.js";
import { ApiError, authorized, deviceId, isAuthenticated, ping } from "./api-client.js";

/**
 * SYNC ENGINE.
 *
 * Implements the contract in `@devsfleet/shared-types/sync`. That file is the
 * specification for both ends — nothing here may invent a field the server
 * does not know about.
 *
 * The order is push, then pull, and it is not arbitrary. Pulling first
 * overwrites the local stock figure that an unpushed sale was priced against,
 * so the terminal would forget it had already sold the last tap.
 *
 * Three rules that are cheap to state and expensive to rediscover:
 *
 *   - Only an explicit server outcome moves an outbox item. A timeout leaves it
 *     pending, because the server may have applied it and the reply may have
 *     been lost — and the `clientId` makes a resend harmless.
 *   - A rejected item is never cleared. It needs a human.
 *   - The mirror is disposable; the outbox is not. Never truncate both.
 */

const PULL_PAGE_LIMIT = 500;

let timer: NodeJS.Timeout | null = null;
let cycleInFlight: Promise<SyncStatusSnapshot> | null = null;
let getWindow: () => BrowserWindow | null = () => null;

const status: SyncStatusSnapshot = {
  online: false,
  lastPullAt: null,
  lastPushAt: null,
  lastCheckpoint: null,
  pendingPushCount: 0,
  failedPushCount: 0,
  syncing: false,
  lastError: null,
};

function emit(patch: Partial<SyncStatusSnapshot> = {}): SyncStatusSnapshot {
  Object.assign(status, patch);
  const counts = outboxCounts();
  status.pendingPushCount = counts.pending;
  status.failedPushCount = counts.failed;

  getWindow()?.webContents.send("sync:status-changed", { ...status });
  return { ...status };
}

export function registerSyncHandlers(
  ipcMain: IpcMain,
  windowGetter: () => BrowserWindow | null,
): void {
  getWindow = windowGetter;
  status.lastCheckpoint = getState("checkpoint");

  ipcMain.handle("sync:status", () => emit());
  ipcMain.handle("sync:now", () => runCycle());

  const interval = Number(process.env.POS_SYNC_INTERVAL_MS ?? 30_000);
  timer = setInterval(() => {
    void runCycle().catch(() => {
      // Reported through status; an unhandled rejection here would take down
      // the main process and with it the till.
    });
  }, interval);
}

export function stopSyncEngine(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/**
 * One cycle at a time.
 *
 * The interval and the operator's Sync button can fire together, and two
 * concurrent cycles would push the same outbox rows twice. The server's
 * idempotency key would absorb it, but the second cycle would also apply the
 * same pull page over the mirror while the first was mid-transaction.
 */
async function runCycle(): Promise<SyncStatusSnapshot> {
  if (cycleInFlight) return cycleInFlight;

  cycleInFlight = (async () => {
    emit({ syncing: true, lastError: null });

    const reachable = await ping();
    if (!reachable) {
      return emit({ syncing: false, online: false });
    }

    if (!deviceId()) {
      return emit({ syncing: false, online: true, lastError: "Terminal not yet activated with code" });
    }

    if (!isAuthenticated()) {
      return emit({ syncing: false, online: true, lastError: "Signed out — enter a PIN" });
    }

    try {
      await pushOutbox();
      await pullChanges();
      clearSettledDeltas();
      return emit({ syncing: false, online: true, lastError: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sync failed";
      return emit({
        syncing: false,
        // An auth or validation failure means the server answered, so the
        // terminal is online — flagging it offline would send a cashier to
        // check a router that is working fine.
        online: error instanceof ApiError,
        lastError: message,
      });
    }
  })().finally(() => {
    cycleInFlight = null;
  });

  return cycleInFlight;
}

// -----------------------------------------------------------------------------
// Push
// -----------------------------------------------------------------------------

async function pushOutbox(): Promise<void> {
  const items = pendingOutbox(200);
  if (items.length === 0) return;

  const response = await authorized<{
    results: Array<{
      clientId: string;
      outcome: string;
      serverId?: string;
      documentNumber?: string;
      message?: string;
    }>;
  }>("/sync/push", {
    deviceId: deviceId(),
    lastCheckpoint: getState("checkpoint"),
    items,
  });

  for (const result of response.results) settleOutboxItem(result);
  emit({ lastPushAt: new Date().toISOString() });
}

// -----------------------------------------------------------------------------
// Pull
// -----------------------------------------------------------------------------

async function pullChanges(): Promise<void> {
  /**
   * Keep paging while the server says there is more.
   *
   * The bound is a safety net, not a design limit: a bug that returns
   * `hasMore` forever must not spin the terminal, and 200 pages of 500 rows is
   * far more than a real catalogue.
   */
  for (let page = 0; page < 200; page += 1) {
    const response = await authorized<{
      changes: Array<{
        entity: string;
        id: string;
        deleted: boolean;
        updatedAt: string;
        record?: Record<string, unknown>;
      }>;
      checkpoint: string;
      hasMore: boolean;
    }>("/sync/pull", {
      deviceId: deviceId(),
      since: getState("checkpoint"),
      limit: PULL_PAGE_LIMIT,
    });

    applyChanges(response.changes, response.checkpoint);
    emit({ lastPullAt: new Date().toISOString(), lastCheckpoint: response.checkpoint });

    if (!response.hasMore) return;
  }
}

/**
 * Apply a page and store its checkpoint in ONE transaction.
 *
 * If the two were separate, a crash between them would either replay a page
 * (harmless) or skip one (silent, permanent data loss on the terminal). Making
 * them atomic removes the second case entirely.
 */
function applyChanges(
  changes: Array<{
    entity: string;
    id: string;
    deleted: boolean;
    record?: Record<string, unknown>;
  }>,
  checkpoint: string,
): void {
  const db = getDatabase();

  db.transaction(() => {
    for (const change of changes) {
      if (change.deleted) {
        applyTombstone(change.entity, change.id);
        continue;
      }
      if (!change.record) continue;
      applyRecord(change.entity, change.id, change.record);
    }

    db.prepare(
      `INSERT INTO device_state (key, value) VALUES ('checkpoint', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(checkpoint);
  })();
}

function applyTombstone(entity: string, id: string): void {
  const db = getDatabase();

  const table = { product: "variants", customer: "customers", category: null, unit: null }[
    entity
  ];
  if (table) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);

  db.prepare(
    `INSERT INTO deleted_records (entity, id, deleted_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(entity, id) DO NOTHING`,
  ).run(entity, id);
}

function applyRecord(entity: string, id: string, record: Record<string, unknown>): void {
  const db = getDatabase();
  const text = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value);

  switch (entity) {
    case "product":
      db.prepare(
        `INSERT INTO variants
           (id, product_id, sku, barcode, product_name, variant_name, search_key,
            unit_abbr, category_name, tax_rate, min_stock, is_stock_tracked, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           product_id = excluded.product_id, sku = excluded.sku,
           barcode = excluded.barcode, product_name = excluded.product_name,
           variant_name = excluded.variant_name, search_key = excluded.search_key,
           unit_abbr = excluded.unit_abbr, category_name = excluded.category_name,
           tax_rate = excluded.tax_rate, min_stock = excluded.min_stock,
           is_stock_tracked = excluded.is_stock_tracked, updated_at = datetime('now')`,
      ).run(
        id,
        text(record.productId),
        text(record.sku),
        text(record.barcode),
        text(record.productName),
        text(record.variantName),
        text(record.searchKey) ?? "",
        text(record.unitAbbr),
        text(record.categoryName),
        text(record.taxRate),
        text(record.minStock),
        record.isStockTracked === false ? 0 : 1,
      );
      return;

    case "product_price":
      db.prepare(
        `INSERT INTO variant_prices
           (id, variant_id, price_list_id, selling_price, min_selling_price, is_default, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           selling_price = excluded.selling_price,
           min_selling_price = excluded.min_selling_price,
           is_default = excluded.is_default,
           updated_at = datetime('now')`,
      ).run(
        id,
        text(record.variantId),
        text(record.priceListId),
        text(record.sellingPrice) ?? "0",
        text(record.minSellingPrice),
        record.isDefault ? 1 : 0,
      );
      return;

    case "inventory":
      // local_delta is deliberately not touched. It represents sales this
      // terminal has made and the server has not yet acknowledged, so a pull
      // must leave it alone or those sales are counted back into stock.
      db.prepare(
        `INSERT INTO inventory (id, variant_id, quantity, reserved_qty, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(variant_id) DO UPDATE SET
           quantity = excluded.quantity,
           reserved_qty = excluded.reserved_qty,
           updated_at = datetime('now')`,
      ).run(
        id,
        text(record.variantId),
        text(record.quantity) ?? "0",
        text(record.reservedQuantity) ?? "0",
      );
      return;

    case "customer":
      db.prepare(
        `INSERT INTO customers
           (id, name, company, phone, trn, price_list_id, credit_limit,
            credit_balance, credit_on_hold, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, company = excluded.company, phone = excluded.phone,
           trn = excluded.trn, price_list_id = excluded.price_list_id,
           credit_limit = excluded.credit_limit, credit_balance = excluded.credit_balance,
           credit_on_hold = excluded.credit_on_hold, updated_at = datetime('now')`,
      ).run(
        id,
        text(record.name),
        text(record.company),
        text(record.phone),
        text(record.trn),
        text(record.priceListId),
        text(record.creditLimit) ?? "0",
        text(record.creditBalance) ?? "0",
        record.creditOnHold ? 1 : 0,
      );
      return;

    default:
      // Units and categories arrive denormalised onto the variant row, so
      // there is nothing to store separately. Ignoring an unknown entity keeps
      // an older terminal working against a newer server.
      return;
  }
}

/** Called after activation, so the first cycle starts without waiting. */
export function syncNow(): void {
  void runCycle().catch(() => undefined);
}

export { setState as setSyncState };
