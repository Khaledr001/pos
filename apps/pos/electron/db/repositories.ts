import type Database from "better-sqlite3";
import { Money } from "@devsfleet/shared-utils";
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

/** One quantity-break tier (Stage 5.2). minQuantity "1" is the ordinary, untiered price. */
export interface BridgePriceTier {
  minQuantity: string;
  sellingPrice: string;
}

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
  /** Every tier on the default list, lowest minQuantity first. Always has at least one entry when priced at all. */
  priceTiers: BridgePriceTier[];
}

export interface BridgeVariantUnit {
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
  /** In the SOLD unit — "1" box, not the 20 pieces it converts to. */
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  total: string;
  /** A packaging from variant_units. Omit to sell the base unit. */
  unitId?: string;
  /** Base units per pack, snapshotted at sale time. Defaults to "1". */
  unitConversionFactor?: string;
}

export interface SaleDraftInput {
  localId: string;
  customerId: string | null;
  cashSessionId: string | null;
  lines: SaleLineInput[];
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  payments: Array<{ method: string; amount: string; reference?: string }>;
  occurredAt: string;
  /**
   * Signed supervisor approvals collected while ringing this sale up.
   *
   * They go into the outbox payload with everything else, because the sale may
   * not reach the server for hours and the approval has to still be there when
   * it does. Nothing local reads them — they are opaque to the terminal.
   */
  overrideGrants?: string[];
}

interface ReturnLineInput {
  /** Position of this line on the ORIGINAL sale — how the server finds it back. */
  originalLineIndex: number;
  variantId: string;
  productName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  disposition: "restock" | "scrap";
}

export interface ReturnDraftInput {
  localId: string;
  /** The original sale's OWN local_id — only a same-till return is supported. */
  originalSaleLocalId: string;
  customerId: string | null;
  cashSessionId: string | null;
  lines: ReturnLineInput[];
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  refunds: Array<{ method: string; amount: string; reference?: string }>;
  reason?: string;
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
  v.category_name     AS categoryName,
  COALESCE(t.tiersJson, '[]') AS priceTiersJson
`;

/**
 * Exactly ONE row per variant for `sellingPrice`/`minSellingPrice` display —
 * the base (lowest-minQuantity) tier on the default list.
 *
 * A variant carries a row per price list, so joining on `variant_id` alone
 * multiplies every search result by the number of lists and shows a different
 * price depending on join order. The default list wins; customer-specific
 * pricing is resolved server-side and applied when the sale is pushed.
 *
 * `t` is every tier on that SAME default list, quantity-break pricing
 * (Stage 5.2) — resolved locally, unlike the customer/default-list choice
 * above, because it needs no identity to pick between, only the quantity
 * already on the line.
 */
const PRICE_JOIN = `
  LEFT JOIN variant_prices p ON p.id = (
    SELECT id FROM variant_prices
    WHERE variant_id = v.id
    ORDER BY is_default DESC, CAST(min_quantity AS REAL) ASC, updated_at DESC
    LIMIT 1
  )
  LEFT JOIN (
    SELECT variant_id, json_group_array(
      json_object('minQuantity', min_quantity, 'sellingPrice', selling_price)
    ) AS tiersJson
    FROM (
      SELECT variant_id, min_quantity, selling_price
      FROM variant_prices
      WHERE is_default = 1
      ORDER BY variant_id, CAST(min_quantity AS REAL) ASC
    )
    GROUP BY variant_id
  ) t ON t.variant_id = v.id
  LEFT JOIN inventory i ON i.variant_id = v.id
`;

function parsePriceTiers(row: Record<string, unknown>): BridgeProduct {
  const { priceTiersJson, ...rest } = row as { priceTiersJson: string } & Record<string, unknown>;
  let priceTiers: BridgePriceTier[] = [];
  try {
    priceTiers = JSON.parse(priceTiersJson) as BridgePriceTier[];
  } catch {
    // Malformed JSON here would be a bug in the query above, never bad data —
    // falling back to the single sellingPrice column keeps search working.
  }
  return { ...rest, priceTiers } as BridgeProduct;
}

export function searchProducts(query: string, limit = 25): BridgeProduct[] {
  const db = getDatabase();
  const q = query.trim();

  if (!q) {
    return (
      db
        .prepare(
          `SELECT ${VARIANT_COLUMNS} FROM variants v ${PRICE_JOIN}
         ORDER BY v.product_name LIMIT ?`,
        )
        .all(limit) as Array<Record<string, unknown>>
    ).map(parsePriceTiers);
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
    return (
      db
        .prepare(
          `SELECT ${VARIANT_COLUMNS} FROM variants_fts f
         JOIN variants v ON v.rowid = f.rowid
         ${PRICE_JOIN}
         WHERE variants_fts MATCH ?
         ORDER BY rank LIMIT ?`,
        )
        .all(match, limit) as Array<Record<string, unknown>>
    ).map(parsePriceTiers);
  } catch {
    // FTS refuses some inputs outright. Falling back to LIKE keeps the counter
    // working on a query that would otherwise show an empty catalogue.
    const like = `%${q}%`;
    return (
      db
        .prepare(
          `SELECT ${VARIANT_COLUMNS} FROM variants v ${PRICE_JOIN}
         WHERE v.product_name LIKE ? OR v.sku LIKE ? OR v.search_key LIKE ?
         ORDER BY v.product_name LIMIT ?`,
        )
        .all(like, like, like, limit) as Array<Record<string, unknown>>
    ).map(parsePriceTiers);
  }
}

export function findByBarcode(barcode: string): BridgeProduct | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `SELECT ${VARIANT_COLUMNS} FROM variants v ${PRICE_JOIN}
       WHERE v.barcode = ? OR v.sku = ? LIMIT 1`,
    )
    .get(barcode.trim(), barcode.trim()) as Record<string, unknown> | undefined;
  return row ? parsePriceTiers(row) : null;
}

/**
 * Packagings offered for one variant — a box, a carton — pulled down at sync
 * time (Stage 3.2) so a unit choice exists with the network unplugged.
 *
 * `is_sellable = 0` is a merchant retiring a packaging, not a delete (the
 * server row carries no deletedAt either) — excluded here rather than at
 * pull time so a re-enabled packaging needs no re-sync to reappear.
 */
export function unitsForVariant(variantId: string): BridgeVariantUnit[] {
  return getDatabase()
    .prepare(
      `SELECT id, unit_id AS unitId, unit_name AS unitName, unit_abbr AS unitAbbr,
              conversion_factor AS conversionFactor, barcode, price_override AS priceOverride
       FROM variant_units WHERE variant_id = ? AND is_sellable = 1
       ORDER BY CAST(conversion_factor AS REAL)`,
    )
    .all(variantId) as BridgeVariantUnit[];
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

export interface NewCustomerInput {
  name: string;
  phone?: string;
  company?: string;
  trn?: string;
  email?: string;
  /** Decimal string. A walk-in gets "0" — credit is granted deliberately, never by default. */
  creditLimit?: string;
}

/**
 * Create a customer at the till, offline.
 *
 * The counter case this exists for: someone wants an invoice in a company
 * name and the terminal has no network. Refusing means either no sale or a
 * sale attached to nobody, and `customers` is the one mirror table the POS
 * had no way to add to — search could only ever find what sync had already
 * brought down.
 *
 * The row is inserted under the `localId` this mints, so the cart can attach
 * it and the receipt can name it immediately. `settleOutboxItem` rewrites
 * that id to the server's once the push lands — see the `customer` branch
 * there for why the rewrite has to carry every local reference with it.
 */
export function createCustomer(input: NewCustomerInput): Record<string, unknown> {
  const db = getDatabase();
  const localId = randomUUID();
  const occurredAt = new Date().toISOString();
  const creditLimit = input.creditLimit?.trim() ? input.creditLimit.trim() : "0";

  db.transaction(() => {
    db.prepare(
      `INSERT INTO customers
         (id, name, company, phone, trn, type, price_list_id,
          credit_limit, credit_balance, credit_on_hold, updated_at)
       VALUES (?, ?, ?, ?, ?, 'retail', NULL, ?, '0', 0, ?)`,
    ).run(
      localId,
      input.name.trim(),
      input.company?.trim() || null,
      input.phone?.trim() || null,
      input.trn?.trim() || null,
      creditLimit,
      occurredAt,
    );

    enqueue(db, {
      localId,
      entity: "customer",
      occurredAt,
      payload: {
        name: input.name.trim(),
        ...(input.company?.trim() ? { company: input.company.trim() } : {}),
        ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
        ...(input.trn?.trim() ? { trn: input.trn.trim() } : {}),
        ...(input.email?.trim() ? { email: input.email.trim() } : {}),
        creditLimit: Number(creditLimit),
      },
    });
  })();

  // Shaped like searchCustomers' rows, because the cart attaches this
  // directly rather than searching for it again.
  return {
    id: localId,
    name: input.name.trim(),
    company: input.company?.trim() || null,
    phone: input.phone?.trim() || null,
    trn: input.trn?.trim() || null,
    priceListId: null,
    creditLimit,
    creditBalance: "0",
    creditOnHold: 0,
  };
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
      `SELECT local_id AS id, payload
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

  let cashIn = 0n;
  let cashOut = 0n;
  for (const movement of movements) {
    const parsed = JSON.parse(movement.payload) as { type: string; amount: string };
    const amount = Money.toMinor(parsed.amount);
    if (parsed.type === "cash_in") cashIn = Money.add(cashIn, amount);
    else cashOut = Money.add(cashOut, amount);
  }

  // Cash sales come from the sales themselves, never from a mirrored movement
  // row — counting both would double every sale in the close-out. Summed in
  // JS via Money rather than SQLite's SUM(CAST(... AS REAL)) — REAL is the
  // same IEEE754 double a JS Number is, and a shift total is exactly the kind
  // of running accumulation where that drift shows up on the drawer screen.
  const salePayments = db
    .prepare(
      `SELECT paid_amount FROM local_sales WHERE cash_session_id = ? AND status = 'completed'`,
    )
    .all(sessionClientId) as Array<{ paid_amount: string }>;
  const cashSales = salePayments.reduce(
    (sum, row) => Money.add(sum, Money.toMinor(row.paid_amount)),
    0n,
  );

  return {
    cashIn: Money.toDecimalString(cashIn, 4),
    cashOut: Money.toDecimalString(cashOut, 4),
    cashSales: Money.toDecimalString(cashSales, 4),
  };
}

export function openCashSession(openingAmount: string, branchId: string | null): BridgeCashSession {
  const db = getDatabase();
  const existing = getOpenCashSession();
  if (existing) return existing;

  const localId = randomUUID();
  const openedAt = new Date().toISOString();

  enqueue(db, {
    localId,
    entity: "cash_session",
    occurredAt: openedAt,
    payload: { branchId, openingAmount, openedAt },
  });

  return {
    id: localId,
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
      `SELECT local_id AS id, payload FROM outbox
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
  db.prepare(`UPDATE outbox SET payload = ?, status = 'pending' WHERE local_id = ?`).run(
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
    localId: randomUUID(),
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

  /**
   * This terminal's own offline ceiling: the last-synced quantity, minus
   * what THIS terminal has already sold offline. Not the full disjoint
   * cross-terminal allocation the sync contract's `stockAllocation` describes
   * — that needs a server-side division algorithm across a branch's
   * terminals that does not exist yet. This catches the far more common
   * case, a single till selling past what it actually has, which nothing
   * refused before: `local_delta` only ever tracked the figure, it never
   * blocked one from going negative.
   *
   * Skipped entirely when the tenant has opted into overselling offline
   * (`sales.allowNegativeStock`, pulled on every sync) — a deliberate choice
   * this must not quietly override.
   */
  if (getState("allow_negative_stock") !== "1") {
    const available = db.prepare(
      `SELECT
         COALESCE(CAST(quantity AS REAL), 0)
         - COALESCE(CAST(reserved_qty AS REAL), 0)
         + COALESCE(CAST(local_delta AS REAL), 0) AS available
       FROM inventory WHERE variant_id = ?`,
    );

    for (const line of draft.lines) {
      const row = available.get(line.variantId) as { available: number } | undefined;
      // No local inventory row at all reads as "nothing known" here, not
      // "unlimited" — a variant that has never synced its stock figure
      // should not be sellable past zero any more than one that has.
      const stock = row?.available ?? 0;
      // A line sold by the box asks the shelf for boxes x conversion factor,
      // in base units — the same terms `stock` is already expressed in.
      const baseQuantity = Number(line.quantity) * Number(line.unitConversionFactor ?? "1");
      if (baseQuantity > stock) {
        throw new Error(
          `${line.productName} — only ${stock} left at this terminal. ` +
            "Check with a manager before selling more offline.",
        );
      }
    }
  }

  // Decimal-string arithmetic — same rule as the account-payment balance
  // below. Two ordinary tenders like 15.99 + 3.98 do not misbehave, but
  // 19.99 - 15.99 alone already prints as 3.9999999999999982 in a plain JS
  // float, and paid_amount is read back verbatim for receipt reprints.
  const paid = Money.toDecimalString(
    draft.payments.reduce((sum, payment) => Money.add(sum, Money.toMinor(payment.amount)), 0n),
    4,
  );

  db.transaction(() => {
    db.prepare(
      `INSERT INTO local_sales
         (local_id, customer_id, cash_session_id, subtotal, tax_amount,
          discount_amount, total, paid_amount, status, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
    ).run(
      draft.localId,
      draft.customerId,
      draft.cashSessionId,
      draft.subtotal,
      draft.taxAmount,
      draft.discountAmount,
      draft.total,
      paid,
      draft.occurredAt,
    );

    const insertItem = db.prepare(
      `INSERT INTO local_sale_items
         (sale_local_id, variant_id, product_name, product_sku, quantity,
          unit_price, discount_percent, tax_percent, line_subtotal, tax_amount,
          total, sort_order, unit_id, unit_conversion_factor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const decrementStock = db.prepare(
      `UPDATE inventory
       SET local_delta = CAST(CAST(local_delta AS REAL) - ? AS TEXT)
       WHERE variant_id = ?`,
    );

    draft.lines.forEach((line, index) => {
      const conversionFactor = line.unitConversionFactor ?? "1";
      insertItem.run(
        draft.localId,
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
        line.unitId ?? null,
        conversionFactor,
      );
      // Stock always moves in base units — a box of 20 sold is 20 leaving
      // the shelf, whatever the receipt says was sold.
      decrementStock.run(Number(line.quantity) * Number(conversionFactor), line.variantId);
    });

    const insertPayment = db.prepare(
      `INSERT INTO local_sale_payments (sale_local_id, method, amount, reference, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    );
    draft.payments.forEach((payment, index) => {
      insertPayment.run(draft.localId, payment.method, payment.amount, payment.reference ?? null, index);
    });

    enqueue(db, {
      localId: draft.localId,
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
          // The server re-resolves the conversion factor itself from
          // variant_units — it is not trusted from the terminal, only which
          // packaging was chosen.
          ...(line.unitId ? { unitId: line.unitId } : {}),
        })),
        payments: draft.payments.map((payment) => ({
          method: payment.method,
          amount: Number(payment.amount),
          ...(payment.reference ? { reference: payment.reference } : {}),
        })),
        ...(draft.overrideGrants?.length
          ? { overrideGrants: draft.overrideGrants }
          : {}),
      },
    });
  })();

  return { ...draft, saleNumber: null, synced: false };
}

/**
 * Record a return against a sale this terminal rang up, and enqueue it for
 * push. Restocked lines credit `inventory.local_delta` back — the mirror
 * image of `commitSale`'s decrement — so a unit handed back offline is
 * sellable again at this till before the next sync, not just after it.
 *
 * Does not re-check the returned quantity against what the original sale
 * still has outstanding: this mirror does not track prior offline returns of
 * the same line, only what has synced. The server is the authority here and
 * refuses an over-return on push (`RETURN_QUANTITY_EXCEEDS_REMAINING`), which
 * surfaces through the same "needs attention" queue a rejected sale does.
 */
export function commitReturn(draft: ReturnDraftInput): Record<string, unknown> {
  const db = getDatabase();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO local_returns
         (local_id, original_sale_local_id, customer_id, cash_session_id,
          subtotal, tax_amount, discount_amount, total, reason, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      draft.localId,
      draft.originalSaleLocalId,
      draft.customerId,
      draft.cashSessionId,
      draft.subtotal,
      draft.taxAmount,
      draft.discountAmount,
      draft.total,
      draft.reason ?? null,
      draft.occurredAt,
    );

    const insertItem = db.prepare(
      `INSERT INTO local_return_items
         (return_local_id, original_line_index, variant_id, product_name,
          product_sku, quantity, unit_price, disposition, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const restockVariant = db.prepare(
      `UPDATE inventory
       SET local_delta = CAST(CAST(local_delta AS REAL) + ? AS TEXT)
       WHERE variant_id = ?`,
    );

    draft.lines.forEach((line, index) => {
      insertItem.run(
        draft.localId,
        line.originalLineIndex,
        line.variantId,
        line.productName,
        line.productSku,
        line.quantity,
        line.unitPrice,
        line.disposition,
        index,
      );
      if (line.disposition === "restock") {
        restockVariant.run(Number(line.quantity), line.variantId);
      }
    });

    enqueue(db, {
      localId: draft.localId,
      entity: "return",
      occurredAt: draft.occurredAt,
      payload: {
        originalSaleId: draft.originalSaleLocalId,
        customerId: draft.customerId,
        cashSessionId: draft.cashSessionId,
        lines: draft.lines.map((line) => ({
          lineIndex: line.originalLineIndex,
          variantId: line.variantId,
          quantity: Number(line.quantity),
          disposition: line.disposition,
        })),
        refunds: draft.refunds.map((refund) => ({
          method: refund.method,
          amount: Number(refund.amount),
          ...(refund.reference ? { reference: refund.reference } : {}),
        })),
        ...(draft.reason ? { reason: draft.reason } : {}),
      },
    });

    /**
     * A cash refund is cash leaving the till, same as paying a delivery driver
     * out of the drawer — `movementTotals` folds `cash_movement` rows into
     * `cashOut`, and the return itself is never counted there (it lives in
     * `local_returns`, not `local_sales`), so without this the drawer would
     * show more cash on hand than is actually left in it.
     */
    const cashRefunded = draft.refunds
      .filter((r) => r.method === "cash")
      .reduce((sum, r) => Money.add(sum, Money.toMinor(r.amount)), 0n);

    if (draft.cashSessionId && Money.isPositive(cashRefunded)) {
      enqueue(db, {
        localId: randomUUID(),
        entity: "cash_movement",
        occurredAt: draft.occurredAt,
        payload: {
          cashSessionId: draft.cashSessionId,
          type: "cash_out",
          amount: Money.toDecimalString(cashRefunded, 4),
          reason: draft.reason ? `Return refund: ${draft.reason}` : "Return refund",
        },
      });
    }
  })();

  return { ...draft, returnNumber: null, synced: false };
}

export function recentSales(limit = 20): unknown[] {
  const db = getDatabase();
  const sales = db
    .prepare(
      `SELECT s.local_id AS localId, s.sale_number AS saleNumber,
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
    lines: saleLines(db, sale.localId as string),
    payments: salePayments(db, sale.localId as string),
  }));
}

export function findSale(reference: string): unknown | null {
  const db = getDatabase();
  const sale = db
    .prepare(
      `SELECT local_id AS localId, sale_number AS saleNumber,
              customer_id AS customerId, cash_session_id AS cashSessionId,
              subtotal, tax_amount AS taxAmount, discount_amount AS discountAmount,
              total, occurred_at AS occurredAt, synced_at AS syncedAt
       FROM local_sales WHERE sale_number = ? OR local_id = ? LIMIT 1`,
    )
    .get(reference.trim(), reference.trim()) as Record<string, unknown> | undefined;

  if (!sale) return null;
  return {
    ...sale,
    synced: sale.syncedAt !== null,
    lines: saleLines(db, sale.localId as string),
    payments: salePayments(db, sale.localId as string),
  };
}

function salePayments(db: Database.Database, localId: string): unknown[] {
  return db
    .prepare(
      `SELECT method, amount, reference
       FROM local_sale_payments WHERE sale_local_id = ? ORDER BY sort_order`,
    )
    .all(localId);
}

function saleLines(db: Database.Database, localId: string): unknown[] {
  return db
    .prepare(
      `SELECT variant_id AS variantId, product_name AS productName,
              product_sku AS productSku, quantity, unit_price AS unitPrice,
              discount_percent AS discountPercent, tax_percent AS taxPercent, total,
              unit_id AS unitId, unit_conversion_factor AS unitConversionFactor
       FROM local_sale_items WHERE sale_local_id = ? ORDER BY sort_order`,
    )
    .all(localId);
}

// -----------------------------------------------------------------------------
// Quotations
// -----------------------------------------------------------------------------

export function saveQuotation(draft: SaleDraftInput): Record<string, unknown> {
  const db = getDatabase();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO local_quotations
         (local_id, customer_id, subtotal, tax_amount, discount_amount, total, status, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`
    ).run(
      draft.localId,
      draft.customerId,
      draft.subtotal,
      draft.taxAmount,
      draft.discountAmount,
      draft.total,
      draft.occurredAt
    );

    const insertItem = db.prepare(
      `INSERT INTO local_quotation_items
         (quotation_local_id, variant_id, product_name, product_sku, quantity,
          unit_price, discount_percent, tax_percent, line_subtotal, tax_amount, total, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    draft.lines.forEach((line, index) => {
      insertItem.run(
        draft.localId,
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
        index
      );
    });

    enqueue(db, {
      localId: draft.localId,
      entity: "quotation",
      occurredAt: draft.occurredAt,
      payload: {
        customerId: draft.customerId,
        lines: draft.lines.map((line) => ({
          variantId: line.variantId,
          quantity: Number(line.quantity),
          unitPrice: line.unitPrice,
          ...(Number(line.discountPercent) > 0 ? { discountPercent: Number(line.discountPercent) } : {}),
        })),
      },
    });
  })();

  return { ...draft, quotationNumber: null, synced: false };
}

export function listQuotations(): unknown[] {
  const db = getDatabase();
  const quotations = db
    .prepare(
      `SELECT q.local_id AS localId, q.quotation_number AS quotationNumber,
              q.customer_id AS customerId,
              q.subtotal, q.tax_amount AS taxAmount,
              q.discount_amount AS discountAmount, q.total,
              q.status, q.occurred_at AS occurredAt, q.synced_at AS syncedAt
       FROM local_quotations q ORDER BY q.occurred_at DESC`
    )
    .all() as any[];

  for (const q of quotations) {
    q.lines = db
      .prepare(
        `SELECT line.variant_id AS variantId, line.product_name AS productName,
                line.product_sku AS productSku, line.quantity, line.unit_price AS unitPrice,
                line.discount_percent AS discountPercent, line.tax_percent AS taxPercent,
                line.line_subtotal AS lineSubtotal, line.tax_amount AS taxAmount, line.total
         FROM local_quotation_items line
         WHERE line.quotation_local_id = ?
         ORDER BY line.sort_order`
      )
      .all(q.localId);
  }

  return quotations;
}

// -----------------------------------------------------------------------------
// Account Payments
// -----------------------------------------------------------------------------

export interface AccountPaymentInput {
  customerId: string;
  cashSessionId: string | null;
  amount: string;
  method: string;
  reference: string | null;
  notes: string | null;
  occurredAt: string;
}

export function recordAccountPayment(input: AccountPaymentInput): Record<string, unknown> {
  const db = getDatabase();
  const localId = randomUUID();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO local_customer_payments
         (local_id, customer_id, cash_session_id, amount, method, reference, notes, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      localId,
      input.customerId,
      input.cashSessionId,
      input.amount,
      input.method,
      input.reference,
      input.notes,
      input.occurredAt
    );

    // Decimal-string arithmetic, not JS floats — Rule #1. `Number(balance) -
    // Number(amount)` was landing values like 19.999999999999996 in the local
    // mirror; harmless until the next pull overwrote it with the server's
    // exact figure, but the intervening receipt or balance display was wrong.
    const customer = db
      .prepare(`SELECT credit_balance FROM customers WHERE id = ?`)
      .get(input.customerId) as { credit_balance: string } | undefined;

    if (customer) {
      const newBalance = Money.subtract(
        Money.toMinor(customer.credit_balance),
        Money.toMinor(input.amount),
      );
      db.prepare(`UPDATE customers SET credit_balance = ? WHERE id = ?`).run(
        Money.toDecimalString(newBalance, 4),
        input.customerId
      );
    }

    enqueue(db, {
      localId,
      entity: "customer_payment",
      occurredAt: input.occurredAt,
      payload: input,
    });
  })();

  return { localId, ...input, synced: false };
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
  item: { localId: string; entity: string; occurredAt: string; payload: unknown },
): void {
  db.prepare(
    `INSERT INTO outbox (local_id, entity, sequence, occurred_at, payload)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(local_id) DO NOTHING`,
  ).run(
    item.localId,
    item.entity,
    nextSequence(db),
    item.occurredAt,
    JSON.stringify(item.payload),
  );
}

export function pendingOutbox(limit = 200): Array<{
  localId: string;
  entity: string;
  sequence: number;
  occurredAt: string;
  payload: unknown;
}> {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT local_id AS localId, entity, sequence, occurred_at AS occurredAt, payload
       FROM outbox WHERE status = 'pending' ORDER BY sequence LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    localId: row.localId as string,
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
  localId: string;
  outcome: string;
  entity?: string;
  serverId?: string;
  documentNumber?: string;
  message?: string;
}): void {
  const db = getDatabase();

  if (result.outcome === "applied" || result.outcome === "duplicate" || result.outcome === "applied_with_warning") {
    /**
     * `applied_with_warning` used to fall through to the catch-all below,
     * which leaves the row `pending` — the server had already created a real
     * sale, with a real invoice number, and the terminal kept re-pushing it
     * every cycle forever. The server's own idempotency check absorbed the
     * duplicates, so nothing double-booked, but the local mirror never
     * learned the sale had succeeded, and the one thing actually worth
     * surfacing — "this landed but could not be reconciled to a drawer" —
     * was silently discarded along with the rest of the response.
     *
     * Treated as synced, because it is: the money is real and the invoice
     * number is real. `last_error` carries the warning forward instead of
     * being cleared, so it stays findable by a manager without inventing a
     * separate table for what is, structurally, the same "needs a look"
     * queue a rejected item sits in.
     */
    const warning = result.outcome === "applied_with_warning" ? (result.message ?? "Applied with a warning") : null;

    db.transaction(() => {
      db.prepare(
        `UPDATE outbox SET status = 'synced', server_id = ?, document_number = ?, last_error = ?
         WHERE local_id = ?`,
      ).run(result.serverId ?? null, result.documentNumber ?? null, warning, result.localId);

      /**
       * Which local mirror table gets the server's id and sync stamp depends
       * on which entity this was — the response only correlates by localId,
       * so the caller threads the entity through from the original push item.
       *
       * `local_quotations.synced_at` and `local_customer_payments.synced_at`
       * were never stamped at all before this: a synced quotation stayed
       * marked unsynced forever, and a synced payment the same way. Both
       * looked like a sync that never finished, to anyone who checked.
       *
       * Sales alone release their local stock delta here — the server's
       * pulled quantity already counts a sale once it has one, but neither a
       * quotation nor a payment ever moved stock in the first place.
       */
      if (result.entity === "quotation") {
        db.prepare(
          `UPDATE local_quotations SET server_id = ?, quotation_number = ?, synced_at = datetime('now')
           WHERE local_id = ?`,
        ).run(result.serverId ?? null, result.documentNumber ?? null, result.localId);
      } else if (result.entity === "return") {
        db.prepare(
          `UPDATE local_returns SET server_id = ?, return_number = ?, synced_at = datetime('now')
           WHERE local_id = ?`,
        ).run(result.serverId ?? null, result.documentNumber ?? null, result.localId);
      } else if (result.entity === "customer_payment") {
        db.prepare(
          `UPDATE local_customer_payments SET synced_at = datetime('now') WHERE local_id = ?`,
        ).run(result.localId);
      } else if (result.entity === "customer") {
        /**
         * A customer created at the till lives under the localId the terminal
         * minted, because the cart had to attach it before any server knew it
         * existed. Now that the server has given it a real id, the local row
         * is re-keyed to that id — otherwise the next pull inserts the SAME
         * customer a second time under the server's id and the cashier sees
         * a duplicate they cannot explain or merge.
         *
         * Every local row pointing at the old id moves with it. Missing one
         * would orphan a document from its customer, and a receipt reprinted
         * afterwards would show no name — silently, because a LEFT JOIN on a
         * dead id yields NULL rather than an error. Held carts are exempt:
         * they store the customer as JSON, and restoring one re-reads the
         * name from that snapshot rather than joining.
         */
        if (result.serverId) {
          for (const table of [
            "local_sales",
            "local_quotations",
            "local_orders",
            "local_customer_payments",
            "local_returns",
          ]) {
            db.prepare(
              `UPDATE ${table} SET customer_id = ? WHERE customer_id = ?`,
            ).run(result.serverId, result.localId);
          }
          db.prepare(`UPDATE customers SET id = ? WHERE id = ?`).run(
            result.serverId,
            result.localId,
          );
        }
      } else {
        db.prepare(
          `UPDATE local_sales SET server_id = ?, sale_number = ?, synced_at = datetime('now')
           WHERE local_id = ?`,
        ).run(result.serverId ?? null, result.documentNumber ?? null, result.localId);
      }
    })();
    return;
  }

  if (result.outcome === "rejected") {
    // Permanent. Retrying an over-limit credit sale forever will never succeed,
    // so it stops here and waits for a human.
    db.prepare(
      `UPDATE outbox SET status = 'rejected', last_error = ?, attempts = attempts + 1
       WHERE local_id = ?`,
    ).run(result.message ?? "Rejected by the server", result.localId);
    return;
  }

  db.prepare(
    `UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE local_id = ?`,
  ).run(result.message ?? null, result.localId);
}

export interface OutboxAttentionItem {
  localId: string;
  entity: string;
  /** `rejected` needs retry-or-discard; `warning` already succeeded and needs a read, not an action. */
  kind: "rejected" | "warning";
  reason: string;
  occurredAt: string;
  attempts: number;
}

/**
 * Everything sitting in the outbox that a human, not the sync loop, has to
 * resolve — a permanent rejection, or a push that succeeded with a caveat.
 *
 * Both belong in one list rather than two: to whoever is looking, "the server
 * refused this" and "the server accepted this but flagged it" are the same
 * question — is this one of mine, and does it need me to do something.
 */
export function outboxAttentionItems(): OutboxAttentionItem[] {
  const rows = getDatabase()
    .prepare(
      `SELECT local_id AS localId, entity, status, last_error AS lastError,
              occurred_at AS occurredAt, attempts
       FROM outbox
       WHERE status = 'rejected' OR (status = 'synced' AND last_error IS NOT NULL)
       ORDER BY occurred_at DESC`,
    )
    .all() as Array<{
    localId: string;
    entity: string;
    status: string;
    lastError: string | null;
    occurredAt: string;
    attempts: number;
  }>;

  return rows.map((row) => ({
    localId: row.localId,
    entity: row.entity,
    kind: row.status === "rejected" ? "rejected" : "warning",
    reason: row.lastError ?? "Unknown reason",
    occurredAt: row.occurredAt,
    attempts: row.attempts,
  }));
}

/**
 * Puts a rejected item back at the end of the push queue.
 *
 * For the case a rejection usually means: a manager just raised a customer's
 * credit limit, or corrected the PIN collision that blocked it, and the exact
 * same push should now go through. Restricted to `rejected` — retrying a
 * `pending` row would race the sync loop pushing it anyway, and retrying an
 * already-`synced` one makes no sense.
 */
export function retryOutboxItem(localId: string): void {
  getDatabase()
    .prepare(`UPDATE outbox SET status = 'pending', last_error = NULL WHERE local_id = ? AND status = 'rejected'`)
    .run(localId);
}

/**
 * Gives up on a rejected item without deleting it.
 *
 * The row stays, because it is the only record that a sale was rung up and
 * never reached the books — exactly the kind of thing an audit trail exists
 * to answer for. `discarded` removes it from the attention list and from the
 * push queue permanently, which is different from `rejected` (still queued
 * for a retry) and different from deleting (destroys the evidence).
 */
export function discardOutboxItem(localId: string): void {
  getDatabase()
    .prepare(`UPDATE outbox SET status = 'discarded' WHERE local_id = ? AND status = 'rejected'`)
    .run(localId);
}

/**
 * Dismisses a warning on an ALREADY-synced item — there is nothing to retry
 * or discard, the sale already went through. This just stops it showing up
 * as needing a look, once someone has taken one.
 */
export function acknowledgeWarning(localId: string): void {
  getDatabase()
    .prepare(`UPDATE outbox SET last_error = NULL WHERE local_id = ? AND status = 'synced'`)
    .run(localId);
}

/**
 * Drop the local stock adjustments for sales AND returns the server has
 * confirmed.
 *
 * Run after a pull, never before: the pulled quantity already accounts for
 * both, so keeping the delta would double-count them and make the terminal
 * think it has more or less stock than it does.
 */
export function clearSettledDeltas(): void {
  const db = getDatabase();
  db.prepare(
    `UPDATE inventory SET local_delta = '0'
     WHERE variant_id IN (
       SELECT i.variant_id FROM local_sale_items i
       JOIN local_sales s ON s.local_id = i.sale_local_id
       WHERE s.synced_at IS NOT NULL
       UNION
       SELECT i.variant_id FROM local_return_items i
       JOIN local_returns r ON r.local_id = i.return_local_id
       WHERE r.synced_at IS NOT NULL
     )`,
  ).run();
}

// -----------------------------------------------------------------------------
// Cash drawer
// -----------------------------------------------------------------------------

/**
 * Records a MANUAL drawer open — never a cash_movement, which is money-shaped
 * (a required amount, feeding day-close's cash reconciliation) and has no
 * "just checking the till" type. Pure audit trail: local first, like a sale,
 * so the reason survives even if the till is offline when the drawer opens.
 */
export function recordDrawerOpen(reason: string): void {
  const db = getDatabase();
  const localId = randomUUID();
  const occurredAt = new Date().toISOString();

  db.prepare(
    `INSERT INTO local_drawer_opens (local_id, reason, occurred_at) VALUES (?, ?, ?)`,
  ).run(localId, reason, occurredAt);

  enqueue(db, {
    localId,
    entity: "drawer_open",
    occurredAt,
    payload: { reason },
  });
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
