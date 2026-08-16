import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { getDatabase } from "./sqlite.js";

/**
 * Every read and write the terminal performs, against local SQLite only.
 *
 * Nothing here touches the network. That is the whole offline-first premise:
 * a sale completes at the same speed with the router unplugged, and the sync
 * engine catches up later. A function in this file that awaited an HTTP call
 * would silently make the counter depend on the shop's internet.
 */

export interface BridgeProduct {
  /** The VARIANT id — the sellable unit, and what a sale line carries. */
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  variantName: string | null;
  unitAbbr: string;
  sellingPrice: string;
  minSellingPrice: string | null;
  taxPercent: string;
  stock: string;
  categoryName: string | null;
}

export interface BridgeCashSession {
  id: string;
  openingAmount: string;
  openedAt: string;
  status: "open" | "closed";
  cashIn: string;
  cashOut: string;
  cashSales: string;
}

interface SaleLineInput {
  variantId: string;
  productName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  total: string;
}

export interface SaleDraftInput {
  clientId: string;
  customerId: string | null;
  cashSessionId: string | null;
  lines: SaleLineInput[];
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  payments: Array<{ method: string; amount: string; reference?: string }>;
  occurredAt: string;
}

// -----------------------------------------------------------------------------
// Catalogue
// -----------------------------------------------------------------------------

/**
 * Stock is the pulled figure plus this terminal's own unpushed movements.
 *
 * Without `local_delta`, a cashier who sells the last tap offline still sees
 * one in stock until the next successful sync — and sells it again.
 */
const VARIANT_COLUMNS = `
  v.id                AS id,
  v.product_id        AS productId,
  v.sku               AS sku,
  v.barcode           AS barcode,
  v.product_name      AS name,
  v.variant_name      AS variantName,
  COALESCE(v.unit_abbr, 'pcs')  AS unitAbbr,
  COALESCE(p.selling_price, '0') AS sellingPrice,
  p.min_selling_price AS minSellingPrice,
  COALESCE(v.tax_rate, '0')      AS taxPercent,
  CAST(
    COALESCE(CAST(i.quantity AS REAL), 0)
    - COALESCE(CAST(i.reserved_qty AS REAL), 0)
    + COALESCE(CAST(i.local_delta AS REAL), 0)
    AS TEXT
  ) AS stock,
  v.category_name     AS categoryName
`;

/**
 * Exactly ONE price row per variant.
 *
 * A variant carries a row per price list, so joining on `variant_id` alone
 * multiplies every search result by the number of lists and shows a different
 * price depending on join order. The default list wins; customer-specific
 * pricing is resolved server-side and applied when the sale is pushed.
 */
const PRICE_JOIN = `
  LEFT JOIN variant_prices p ON p.id = (
    SELECT id FROM variant_prices
    WHERE variant_id = v.id
    ORDER BY is_default DESC, updated_at DESC
    LIMIT 1
  )
  LEFT JOIN inventory i ON i.variant_id = v.id
`;

export function searchProducts(query: string, limit = 25): BridgeProduct[] {
  const db = getDatabase();
  const q = query.trim();

  if (!q) {
    return db
      .prepare(
        `SELECT ${VARIANT_COLUMNS} FROM variants v ${PRICE_JOIN}
         ORDER BY v.product_name LIMIT ?`,
      )
      .all(limit) as BridgeProduct[];
  }

  // An exact barcode wins outright. A scanner firing mid-search must not have
  // its result buried under fuzzy name matches.
  const scanned = findByBarcode(q);
  if (scanned) return [scanned];

  /**
   * FTS5 prefix search on every token, so "elb 1" finds 'PVC Elbow 1"'. The
   * quotes matter: a bare `1"` is FTS syntax, and an unescaped one from a
   * barcode scan throws rather than returning nothing.
   */
  const match = q
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/"/g, '""')}"*`)
    .join(" ");

  try {
    return db
      .prepare(
        `SELECT ${VARIANT_COLUMNS} FROM variants_fts f
         JOIN variants v ON v.rowid = f.rowid
         ${PRICE_JOIN}
         WHERE variants_fts MATCH ?
         ORDER BY rank LIMIT ?`,
      )
      .all(match, limit) as BridgeProduct[];
  } catch {
    // FTS refuses some inputs outright. Falling back to LIKE keeps the counter
    // working on a query that would otherwise show an empty catalogue.
    const like = `%${q}%`;
    return db
      .prepare(
        `SELECT ${VARIANT_COLUMNS} FROM variants v ${PRICE_JOIN}
         WHERE v.product_name LIKE ? OR v.sku LIKE ? OR v.search_key LIKE ?
         ORDER BY v.product_name LIMIT ?`,
      )
      .all(like, like, like, limit) as BridgeProduct[];
  }
}

export function findByBarcode(barcode: string): BridgeProduct | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT ${VARIANT_COLUMNS} FROM variants v ${PRICE_JOIN}
       WHERE v.barcode = ? OR v.sku = ? LIMIT 1`,
    )
    .get(barcode.trim(), barcode.trim()) as BridgeProduct | undefined;
  return row ?? null;
}

export function searchCustomers(query: string, limit = 25): unknown[] {
  const db = getDatabase();
  const q = query.trim();

  const sql = `
    SELECT id, name, company, phone, trn,
           price_list_id  AS priceListId,
           credit_limit   AS creditLimit,
           credit_balance AS creditBalance,
           credit_on_hold AS creditOnHold
    FROM customers`;

  if (!q) return db.prepare(`${sql} ORDER BY name LIMIT ?`).all(limit);

  const like = `%${q}%`;
  return db
    .prepare(
      `${sql} WHERE name LIKE ? OR company LIKE ? OR phone LIKE ? ORDER BY name LIMIT ?`,
    )
    .all(like, like, like, limit);
}

// -----------------------------------------------------------------------------
// Cash drawer
// -----------------------------------------------------------------------------

/**
 * Sessions live in the outbox, not a mirror table.
 *
 * A drawer opened offline is a real event that the server has not seen yet, so
 * it is authoritative here until it is acknowledged — exactly like a sale.
 */
export function getOpenCashSession(): BridgeCashSession | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT client_id AS id, payload
       FROM outbox WHERE entity = 'cash_session' AND status IN ('pending','synced')
       ORDER BY sequence DESC LIMIT 1`,
    )
    .get() as { id: string; payload: string } | undefined;

  if (!row) return null;

  const payload = JSON.parse(row.payload) as { openingAmount?: string; closedAt?: string };
  if (payload.closedAt) return null;

  return {
    /**
     * The terminal's own id, even after the server has assigned one.
     *
     * An identifier that changes underneath a running shift breaks every local
     * row already pointing at it. The server resolves either form on push, so
     * there is nothing to gain by switching.
     */
    id: row.id,
    openingAmount: String(payload.openingAmount ?? "0"),
    openedAt: (JSON.parse(row.payload) as { openedAt?: string }).openedAt ?? "",
    status: "open",
    ...movementTotals(db, row.id),
  };
}

function movementTotals(
  db: Database.Database,
  sessionClientId: string,
): { cashIn: string; cashOut: string; cashSales: string } {
  const movements = db
    .prepare(
      `SELECT payload FROM outbox
       WHERE entity = 'cash_movement' AND json_extract(payload, '$.cashSessionId') = ?`,
    )
    .all(sessionClientId) as Array<{ payload: string }>;

  let cashIn = 0;
  let cashOut = 0;
  for (const movement of movements) {
    const parsed = JSON.parse(movement.payload) as { type: string; amount: string };
    if (parsed.type === "cash_in") cashIn += Number(parsed.amount);
    else cashOut += Number(parsed.amount);
  }

  // Cash sales come from the sales themselves, never from a mirrored movement
  // row — counting both would double every sale in the close-out.
  const sales = db
    .prepare(
      `SELECT COALESCE(SUM(CAST(paid_amount AS REAL)), 0) AS total
       FROM local_sales WHERE cash_session_id = ? AND status = 'completed'`,
    )
    .get(sessionClientId) as { total: number };

  return {
    cashIn: String(cashIn),
    cashOut: String(cashOut),
    cashSales: String(sales.total ?? 0),
  };
}

export function openCashSession(openingAmount: string, branchId: string | null): BridgeCashSession {
  const db = getDatabase();
  const existing = getOpenCashSession();
  if (existing) return existing;

  const clientId = randomUUID();
  const openedAt = new Date().toISOString();

  enqueue(db, {
    clientId,
    entity: "cash_session",
    occurredAt: openedAt,
    payload: { branchId, openingAmount, openedAt },
  });

  return {
    id: clientId,
    openingAmount,
    openedAt,
    status: "open",
    cashIn: "0",
    cashOut: "0",
    cashSales: "0",
  };
}

export function closeCashSession(countedAmount: string, notes?: string): void {
  const db = getDatabase();
  const open = db
    .prepare(
      `SELECT client_id AS id, payload FROM outbox
       WHERE entity = 'cash_session' ORDER BY sequence DESC LIMIT 1`,
    )
    .get() as { id: string; payload: string } | undefined;

  if (!open) return;

  const payload = JSON.parse(open.payload) as Record<string, unknown>;
  payload.closedAt = new Date().toISOString();
  payload.countedAmount = countedAmount;
  if (notes) payload.notes = notes;

  /**
   * The close is folded into the session's own payload rather than queued as a
   * second item. The server opens and closes in one call, and two items could
   * be split across batches — leaving a drawer that closed at 8pm still open
   * on the server overnight.
   */
  db.prepare(`UPDATE outbox SET payload = ?, status = 'pending' WHERE client_id = ?`).run(
    JSON.stringify(payload),
    open.id,
  );
}

export function recordCashMovement(
  type: "cash_in" | "cash_out",
  amount: string,
  reason: string,
): void {
  const db = getDatabase();
  const session = getOpenCashSession();
  if (!session) throw new Error("No drawer is open on this terminal");

  enqueue(db, {
    clientId: randomUUID(),
    entity: "cash_movement",
    occurredAt: new Date().toISOString(),
    payload: { cashSessionId: session.id, type, amount, reason },
  });
}

// -----------------------------------------------------------------------------
// Sales
// -----------------------------------------------------------------------------

/**
 * Commit a sale locally and queue it. Returns immediately — the customer is at
 * the counter, and the sale is already real whether or not the server has
 * heard about it.
 *
 * The local write, the stock decrement and the outbox row go in ONE SQLite
 * transaction. A crash between them would either lose takings or leave stock
 * that never comes back.
 */
export function commitSale(draft: SaleDraftInput): Record<string, unknown> {
  const db = getDatabase();

  const paid = draft.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO local_sales
         (client_id, customer_id, cash_session_id, subtotal, tax_amount,
          discount_amount, total, paid_amount, status, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
    ).run(
      draft.clientId,
      draft.customerId,
      draft.cashSessionId,
      draft.subtotal,
      draft.taxAmount,
      draft.discountAmount,
      draft.total,
      String(paid),
      draft.occurredAt,
    );

    const insertItem = db.prepare(
      `INSERT INTO local_sale_items
         (sale_client_id, variant_id, product_name, product_sku, quantity,
          unit_price, discount_percent, tax_percent, line_subtotal, tax_amount,
          total, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const decrementStock = db.prepare(
      `UPDATE inventory
       SET local_delta = CAST(CAST(local_delta AS REAL) - ? AS TEXT)
       WHERE variant_id = ?`,
    );

    draft.lines.forEach((line, index) => {
      insertItem.run(
        draft.clientId,
        line.variantId,
        line.productName,
        line.productSku,
        line.quantity,
        line.unitPrice,
        line.discountPercent,
        line.taxPercent,
        line.total,
        "0",
        line.total,
        index,
      );
      decrementStock.run(Number(line.quantity), line.variantId);
    });

    enqueue(db, {
      clientId: draft.clientId,
      entity: "sale",
      occurredAt: draft.occurredAt,
      payload: {
        customerId: draft.customerId,
        cashSessionId: draft.cashSessionId,
        lines: draft.lines.map((line) => ({
          variantId: line.variantId,
          quantity: Number(line.quantity),
          unitPrice: line.unitPrice,
          ...(Number(line.discountPercent) > 0
            ? { discountPercent: Number(line.discountPercent) }
            : {}),
        })),
        payments: draft.payments.map((payment) => ({
          method: payment.method,
          amount: Number(payment.amount),
          ...(payment.reference ? { reference: payment.reference } : {}),
        })),
      },
    });
  })();

  return { ...draft, saleNumber: null, synced: false };
}

export function recentSales(limit = 20): unknown[] {
  const db = getDatabase();
  const sales = db
    .prepare(
      `SELECT s.client_id AS clientId, s.sale_number AS saleNumber,
              s.customer_id AS customerId, s.cash_session_id AS cashSessionId,
              s.subtotal, s.tax_amount AS taxAmount,
              s.discount_amount AS discountAmount, s.total,
              s.occurred_at AS occurredAt, s.synced_at AS syncedAt
       FROM local_sales s ORDER BY s.occurred_at DESC LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;

  return sales.map((sale) => ({
    ...sale,
    synced: sale.syncedAt !== null,
    lines: saleLines(db, sale.clientId as string),
    payments: [],
  }));
}

export function findSale(reference: string): unknown | null {
  const db = getDatabase();
  const sale = db
    .prepare(
      `SELECT client_id AS clientId, sale_number AS saleNumber,
              customer_id AS customerId, cash_session_id AS cashSessionId,
              subtotal, tax_amount AS taxAmount, discount_amount AS discountAmount,
              total, occurred_at AS occurredAt, synced_at AS syncedAt
       FROM local_sales WHERE sale_number = ? OR client_id = ? LIMIT 1`,
    )
    .get(reference.trim(), reference.trim()) as Record<string, unknown> | undefined;

  if (!sale) return null;
  return {
    ...sale,
    synced: sale.syncedAt !== null,
    lines: saleLines(db, sale.clientId as string),
    payments: [],
  };
}

function saleLines(db: Database.Database, clientId: string): unknown[] {
  return db
    .prepare(
      `SELECT variant_id AS variantId, product_name AS productName,
              product_sku AS productSku, quantity, unit_price AS unitPrice,
              discount_percent AS discountPercent, tax_percent AS taxPercent, total
       FROM local_sale_items WHERE sale_client_id = ? ORDER BY sort_order`,
    )
    .all(clientId);
}

// -----------------------------------------------------------------------------
// Held carts
// -----------------------------------------------------------------------------

export interface BridgeHeldCart {
  id: string;
  label: string | null;
  lineCount: number;
  total: string;
  customerName: string | null;
  heldAt: string;
}

export function holdCart(cart: {
  label: string | null;
  lineCount: number;
  total: string;
  customerName: string | null;
  cartData: unknown;
}): BridgeHeldCart {
  const db = getDatabase();
  const id = randomUUID();
  const heldAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO held_carts (id, label, line_count, total, customer_name, cart_data, held_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    cart.label,
    cart.lineCount,
    cart.total,
    cart.customerName,
    JSON.stringify(cart.cartData),
    heldAt,
  );

  return { id, ...cart, heldAt, cartData: undefined } as BridgeHeldCart;
}

export function listHeldCarts(limit = 50): BridgeHeldCart[] {
  return getDatabase()
    .prepare(
      `SELECT id, label, line_count AS lineCount, total,
              customer_name AS customerName, held_at AS heldAt
       FROM held_carts ORDER BY held_at DESC LIMIT ?`,
    )
    .all(limit) as BridgeHeldCart[];
}

/**
 * Take a cart back, and stop holding it in the same breath.
 *
 * Restoring without removing leaves the same basket parked AND on a till: the
 * next cashier rings up a cart that is already being paid for at the counter.
 */
export function restoreHeldCart(id: string): unknown {
  const db = getDatabase();

  return db.transaction(() => {
    const row = db.prepare(`SELECT cart_data FROM held_carts WHERE id = ?`).get(id) as
      | { cart_data: string }
      | undefined;
    if (!row) return null;

    db.prepare(`DELETE FROM held_carts WHERE id = ?`).run(id);
    return JSON.parse(row.cart_data) as unknown;
  })();
}

export function discardHeldCart(id: string): void {
  getDatabase().prepare(`DELETE FROM held_carts WHERE id = ?`).run(id);
}

// -----------------------------------------------------------------------------
// Outbox
// -----------------------------------------------------------------------------

/**
 * A monotonic per-terminal counter, not a timestamp.
 *
 * The server applies a batch in this order, and a sale that references a cash
 * session opened moments earlier must not overtake it. Two events in the same
 * millisecond are ordinary at a counter; two with the same sequence are not.
 */
function nextSequence(db: Database.Database): number {
  const row = db
    .prepare(`SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM outbox`)
    .get() as { next: number };
  return row.next;
}

function enqueue(
  db: Database.Database,
  item: { clientId: string; entity: string; occurredAt: string; payload: unknown },
): void {
  db.prepare(
    `INSERT INTO outbox (client_id, entity, sequence, occurred_at, payload)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(client_id) DO NOTHING`,
  ).run(
    item.clientId,
    item.entity,
    nextSequence(db),
    item.occurredAt,
    JSON.stringify(item.payload),
  );
}

export function pendingOutbox(limit = 200): Array<{
  clientId: string;
  entity: string;
  sequence: number;
  occurredAt: string;
  payload: unknown;
}> {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT client_id AS clientId, entity, sequence, occurred_at AS occurredAt, payload
       FROM outbox WHERE status = 'pending' ORDER BY sequence LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    clientId: row.clientId as string,
    entity: row.entity as string,
    sequence: row.sequence as number,
    occurredAt: row.occurredAt as string,
    payload: JSON.parse(row.payload as string),
  }));
}

export function outboxCounts(): { pending: number; failed: number } {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS failed
       FROM outbox`,
    )
    .get() as { pending: number | null; failed: number | null };

  return { pending: row.pending ?? 0, failed: row.failed ?? 0 };
}

/**
 * Record what the server said about one pushed item.
 *
 * `deferred` deliberately does nothing: the row stays `pending` and goes again
 * next cycle. Only an explicit server outcome moves an item, so a timeout can
 * never lose a sale.
 */
export function settleOutboxItem(result: {
  clientId: string;
  outcome: string;
  serverId?: string;
  documentNumber?: string;
  message?: string;
}): void {
  const db = getDatabase();

  if (result.outcome === "applied" || result.outcome === "duplicate") {
    db.transaction(() => {
      db.prepare(
        `UPDATE outbox SET status = 'synced', server_id = ?, document_number = ?, last_error = NULL
         WHERE client_id = ?`,
      ).run(result.serverId ?? null, result.documentNumber ?? null, result.clientId);

      /**
       * The local stock delta is released only once the server has the sale.
       * Until then the terminal's own figure is the honest one — the server's
       * pulled quantity still counts stock this sale has already sold.
       */
      db.prepare(
        `UPDATE local_sales SET server_id = ?, sale_number = ?, synced_at = datetime('now')
         WHERE client_id = ?`,
      ).run(result.serverId ?? null, result.documentNumber ?? null, result.clientId);
    })();
    return;
  }

  if (result.outcome === "rejected") {
    // Permanent. Retrying an over-limit credit sale forever will never succeed,
    // so it stops here and waits for a human.
    db.prepare(
      `UPDATE outbox SET status = 'rejected', last_error = ?, attempts = attempts + 1
       WHERE client_id = ?`,
    ).run(result.message ?? "Rejected by the server", result.clientId);
    return;
  }

  db.prepare(
    `UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE client_id = ?`,
  ).run(result.message ?? null, result.clientId);
}

/**
 * Drop the local stock adjustments for sales the server has confirmed.
 *
 * Run after a pull, never before: the pulled quantity already accounts for
 * those sales, so keeping the delta would double-count them and make the
 * terminal think it has less stock than it does.
 */
export function clearSettledDeltas(): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE inventory SET local_delta = '0'
     WHERE variant_id IN (
       SELECT i.variant_id FROM local_sale_items i
       JOIN local_sales s ON s.client_id = i.sale_client_id
       WHERE s.synced_at IS NOT NULL
     )`,
  ).run();
}

// -----------------------------------------------------------------------------
// Device state
// -----------------------------------------------------------------------------

export function getState(key: string): string | null {
  const row = getDatabase()
    .prepare(`SELECT value FROM device_state WHERE key = ?`)
    .get(key) as { value: string | null } | undefined;
  return row?.value ?? null;
}

export function setState(key: string, value: string | null): void {
  getDatabase()
    .prepare(
      `INSERT INTO device_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}
