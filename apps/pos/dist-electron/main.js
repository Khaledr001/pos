"use strict";
const electron = require("electron");
const node_url = require("node:url");
const node_path = require("node:path");
const Database = require("better-sqlite3");
const node_crypto = require("node:crypto");
const node_os = require("node:os");
var _documentCurrentScript = typeof document !== "undefined" ? document.currentScript : null;
let db = null;
function ensureColumns(database) {
  try {
    const pricesInfo = database.pragma("table_info(variant_prices)");
    if (pricesInfo && pricesInfo.length > 0 && !pricesInfo.some((c) => c.name === "is_default")) {
      database.exec("ALTER TABLE variant_prices ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;");
    }
  } catch (err) {
    console.warn("Could not check/add is_default on variant_prices:", err);
  }
  try {
    const saleItemsInfo = database.pragma("table_info(local_sale_items)");
    if (saleItemsInfo && saleItemsInfo.length > 0 && !saleItemsInfo.some((c) => c.name === "unit_abbr")) {
      database.exec("ALTER TABLE local_sale_items ADD COLUMN unit_abbr TEXT;");
    }
  } catch (err) {
    console.warn("Could not check/add unit_abbr on local_sale_items:", err);
  }
}
const DEFAULT_CATALOG = [
  {
    id: "v1",
    productId: "p1",
    sku: "PVC-ELB-001",
    barcode: "6291000000017",
    productName: 'PVC Elbow 1" 90 Degree',
    variantName: null,
    unitAbbr: "pcs",
    categoryName: "Plumbing",
    taxRate: "5",
    sellingPrice: "2.75",
    minSellingPrice: "2.00",
    stock: "100"
  },
  {
    id: "v2",
    productId: "p2",
    sku: "PVC-ELB-002",
    barcode: "6291000000024",
    productName: 'PVC Elbow 3/4" 90 Degree',
    variantName: null,
    unitAbbr: "pcs",
    categoryName: "Plumbing",
    taxRate: "5",
    sellingPrice: "2.10",
    minSellingPrice: "1.55",
    stock: "100"
  },
  {
    id: "v3",
    productId: "p3",
    sku: "CBL-25-RED",
    barcode: "6291000000031",
    productName: "Electrical Cable 2.5mm Red",
    variantName: null,
    unitAbbr: "m",
    categoryName: "Electrical",
    taxRate: "5",
    sellingPrice: "3.50",
    minSellingPrice: "2.75",
    stock: "100"
  },
  {
    id: "v4",
    productId: "p4",
    sku: "PNT-WHT-4L",
    barcode: "6291000000048",
    productName: "Emulsion Paint White 4 Litre",
    variantName: null,
    unitAbbr: "ltr",
    categoryName: "Paint",
    taxRate: "5",
    sellingPrice: "48.00",
    minSellingPrice: "38.00",
    stock: "40"
  },
  {
    id: "v5",
    productId: "p5",
    sku: "TAP-MIX-CHR",
    barcode: "6291000000055",
    productName: "Basin Mixer Tap Chrome",
    variantName: null,
    unitAbbr: "pcs",
    categoryName: "Sanitary",
    taxRate: "5",
    sellingPrice: "135.00",
    minSellingPrice: "105.00",
    stock: "12"
  },
  {
    id: "v6",
    productId: "p6",
    sku: "EL-CBL-3CX25",
    barcode: "6291000000062",
    productName: "Ducab 3-Core 2.5mm² Flexible Copper Cable",
    variantName: null,
    unitAbbr: "m",
    categoryName: "Electrical",
    taxRate: "5",
    sellingPrice: "215.00",
    minSellingPrice: "190.00",
    stock: "50"
  },
  {
    id: "v7",
    productId: "p7",
    sku: "EL-SW-1G2W",
    barcode: "6291000000079",
    productName: "Schneider 1-Gang 2-Way Light Switch",
    variantName: null,
    unitAbbr: "pcs",
    categoryName: "Electrical",
    taxRate: "5",
    sellingPrice: "18.50",
    minSellingPrice: "14.00",
    stock: "150"
  },
  {
    id: "v8",
    productId: "p8",
    sku: "TL-TM-8M",
    barcode: "6291000000086",
    productName: "Stanley FatMax Heavy Duty Tape Measure 8m",
    variantName: null,
    unitAbbr: "pcs",
    categoryName: "Hardware & Tools",
    taxRate: "5",
    sellingPrice: "45.00",
    minSellingPrice: "35.00",
    stock: "30"
  },
  {
    id: "v9",
    productId: "p9",
    sku: "SAN-MX-GROHE",
    barcode: "6291000000093",
    productName: "Grohe Eurosmart Single-Lever Basin Mixer",
    variantName: null,
    unitAbbr: "pcs",
    categoryName: "Sanitary",
    taxRate: "5",
    sellingPrice: "285.00",
    minSellingPrice: "240.00",
    stock: "25"
  },
  {
    id: "v10",
    productId: "p10",
    sku: "FX-PLUG-UX8",
    barcode: "6291000000109",
    productName: "Fischer Wall Plugs UX 8x50mm Universal Box (100pcs)",
    variantName: null,
    unitAbbr: "box",
    categoryName: "Fasteners & Fixings",
    taxRate: "5",
    sellingPrice: "32.00",
    minSellingPrice: "25.00",
    stock: "80"
  }
];
const DEFAULT_CUSTOMERS = [
  {
    id: "c1",
    name: "Al Noor Contracting",
    company: "Al Noor Contracting LLC",
    phone: "+971501234567",
    trn: "100123456700003",
    creditLimit: "5000.00",
    creditBalance: "1240.00"
  },
  {
    id: "c2",
    name: "Walk-in customer",
    company: null,
    phone: null,
    trn: null,
    creditLimit: "0",
    creditBalance: "0"
  }
];
function seedInitialCatalog(database) {
  try {
    const row = database.prepare("SELECT count(*) as count FROM variants").get();
    if (row && (row.count ?? 0) > 0) return;
    database.transaction(() => {
      const insertVariant = database.prepare(`
        INSERT OR IGNORE INTO variants (id, product_id, sku, barcode, product_name, variant_name, search_key, unit_abbr, category_name, tax_rate, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);
      const insertPrice = database.prepare(`
        INSERT OR IGNORE INTO variant_prices (id, variant_id, price_list_id, selling_price, min_selling_price, is_default, updated_at)
        VALUES (?, ?, 'default', ?, ?, 1, datetime('now'))
      `);
      const insertInventory = database.prepare(`
        INSERT OR IGNORE INTO inventory (id, variant_id, quantity, reserved_qty, local_delta, updated_at)
        VALUES (?, ?, ?, '0', '0', datetime('now'))
      `);
      for (const item of DEFAULT_CATALOG) {
        const searchKey = `${item.productName} ${item.sku} ${item.barcode ?? ""} ${item.categoryName ?? ""}`.toLowerCase();
        insertVariant.run(
          item.id,
          item.productId,
          item.sku,
          item.barcode,
          item.productName,
          item.variantName,
          searchKey,
          item.unitAbbr,
          item.categoryName,
          item.taxRate
        );
        insertPrice.run(`pr_${item.id}`, item.id, item.sellingPrice, item.minSellingPrice);
        insertInventory.run(`inv_${item.id}`, item.id, item.stock);
      }
      const insertCustomer = database.prepare(`
        INSERT OR IGNORE INTO customers (id, name, company, phone, trn, credit_limit, credit_balance, credit_on_hold, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
      `);
      for (const c of DEFAULT_CUSTOMERS) {
        insertCustomer.run(c.id, c.name, c.company, c.phone, c.trn, c.creditLimit, c.creditBalance);
      }
    })();
  } catch (err) {
    console.warn("Could not seed initial catalog into SQLite:", err);
  }
}
function openDatabase() {
  if (db) return db;
  const file = node_path.join(electron.app.getPath("userData"), process.env.POS_DB_FILE ?? "devsfleet-pos.sqlite");
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  ensureColumns(db);
  seedInitialCatalog(db);
  return db;
}
function getDatabase() {
  if (!db) throw new Error("SQLite is not open. Call openDatabase() first.");
  return db;
}
function closeDatabase() {
  if (!db) return;
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  db = null;
}
const MIGRATIONS = [
  {
    version: 1,
    sql: `
      -- ---------------------------------------------------------------
      -- MIRROR: pulled from the server, never edited locally
      -- ---------------------------------------------------------------
      CREATE TABLE IF NOT EXISTS products (
        id              TEXT PRIMARY KEY,
        sku             TEXT NOT NULL,
        barcode         TEXT,
        name            TEXT NOT NULL,
        search_key      TEXT NOT NULL DEFAULT '',
        category_id     TEXT,
        brand_id        TEXT,
        unit_id         TEXT NOT NULL,
        unit_abbr       TEXT,
        attributes      TEXT NOT NULL DEFAULT '{}',
        image_url       TEXT,
        tax_rate        TEXT,
        is_stock_tracked INTEGER NOT NULL DEFAULT 1,
        is_active       INTEGER NOT NULL DEFAULT 1,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);

      -- FTS5 over name + sku, so a partial-word search at the counter stays
      -- instant across 5,000+ products. External-content table: the index
      -- stores no copy of the rows, only the terms.
      CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
        name, sku, search_key,
        content='products',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      -- Prices are resolved server-side and pulled flat: the terminal must not
      -- reimplement the price-resolution ladder, or an offline sale would price
      -- differently from an online one.
      CREATE TABLE IF NOT EXISTS product_prices (
        product_id        TEXT NOT NULL,
        price_list_id     TEXT NOT NULL,
        selling_price     TEXT NOT NULL,
        min_selling_price TEXT,
        updated_at        TEXT NOT NULL,
        PRIMARY KEY (product_id, price_list_id)
      );

      CREATE TABLE IF NOT EXISTS inventory (
        product_id      TEXT PRIMARY KEY,
        quantity        TEXT NOT NULL DEFAULT '0',
        reserved_qty    TEXT NOT NULL DEFAULT '0',
        -- This terminal's offline ceiling, from the server's allocation.
        offline_limit   TEXT,
        updated_at      TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customers (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        company         TEXT,
        phone           TEXT,
        trn             TEXT,
        type            TEXT NOT NULL DEFAULT 'retail',
        price_list_id   TEXT,
        credit_limit    TEXT NOT NULL DEFAULT '0',
        credit_balance  TEXT NOT NULL DEFAULT '0',
        credit_on_hold  INTEGER NOT NULL DEFAULT 0,
        updated_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);

      -- ---------------------------------------------------------------
      -- OUTBOX: created here, authoritative until the server acknowledges
      -- ---------------------------------------------------------------

      -- client_id is minted here and is the server's idempotency key. A retry
      -- after a timeout resends the same id, so a sale can never double-book.
      CREATE TABLE IF NOT EXISTS outbox (
        client_id       TEXT PRIMARY KEY,
        entity          TEXT NOT NULL,
        sequence        INTEGER NOT NULL,
        occurred_at     TEXT NOT NULL,
        payload         TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_error      TEXT,
        server_id       TEXT,
        document_number TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox(status, sequence);

      -- Local copy of what was sold here, so history and reprints work offline.
      CREATE TABLE IF NOT EXISTS local_sales (
        client_id       TEXT PRIMARY KEY,
        server_id       TEXT,
        sale_number     TEXT,
        customer_id     TEXT,
        cash_session_id TEXT,
        subtotal        TEXT NOT NULL,
        tax_amount      TEXT NOT NULL,
        discount_amount TEXT NOT NULL,
        total           TEXT NOT NULL,
        paid_amount     TEXT NOT NULL DEFAULT '0',
        status          TEXT NOT NULL DEFAULT 'completed',
        occurred_at     TEXT NOT NULL,
        synced_at       TEXT
      );

      CREATE TABLE IF NOT EXISTS local_sale_items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_client_id  TEXT NOT NULL REFERENCES local_sales(client_id) ON DELETE CASCADE,
        product_id      TEXT NOT NULL,
        product_name    TEXT NOT NULL,
        product_sku     TEXT NOT NULL,
        quantity        TEXT NOT NULL,
        unit_price      TEXT NOT NULL,
        discount_percent TEXT NOT NULL DEFAULT '0',
        tax_percent     TEXT NOT NULL DEFAULT '0',
        line_subtotal   TEXT NOT NULL,
        tax_amount      TEXT NOT NULL,
        total           TEXT NOT NULL,
        sort_order      INTEGER NOT NULL DEFAULT 0
      );

      -- Single-row key/value: device id, checkpoint, sequence counter.
      CREATE TABLE IF NOT EXISTS device_state (
        key             TEXT PRIMARY KEY,
        value           TEXT
      );
    `
  },
  {
    version: 2,
    sql: `
      -- Keep the FTS index in step with the products mirror. Triggers rather
      -- than manual maintenance, so a pull path that forgets to reindex cannot
      -- silently break product search at the counter.
      CREATE TRIGGER IF NOT EXISTS products_fts_insert AFTER INSERT ON products BEGIN
        INSERT INTO products_fts(rowid, name, sku, search_key)
        VALUES (new.rowid, new.name, new.sku, new.search_key);
      END;

      CREATE TRIGGER IF NOT EXISTS products_fts_delete AFTER DELETE ON products BEGIN
        INSERT INTO products_fts(products_fts, rowid, name, sku, search_key)
        VALUES ('delete', old.rowid, old.name, old.sku, old.search_key);
      END;

      CREATE TRIGGER IF NOT EXISTS products_fts_update AFTER UPDATE ON products BEGIN
        INSERT INTO products_fts(products_fts, rowid, name, sku, search_key)
        VALUES ('delete', old.rowid, old.name, old.sku, old.search_key);
        INSERT INTO products_fts(rowid, name, sku, search_key)
        VALUES (new.rowid, new.name, new.sku, new.search_key);
      END;
    `
  },
  {
    version: 3,
    sql: `
      -- The sellable unit is the VARIANT, not the product. A 1" elbow and a
      -- 3/4" elbow are one catalogue entry with two barcodes, two prices and
      -- two stock figures, and it is the variant a cashier scans.
      --
      -- The mirror is disposable by definition, so it is rebuilt rather than
      -- migrated: dropping it costs one pull. The outbox is untouched — it
      -- holds sales that exist nowhere else yet.
      DROP TRIGGER IF EXISTS products_fts_insert;
      DROP TRIGGER IF EXISTS products_fts_delete;
      DROP TRIGGER IF EXISTS products_fts_update;
      DROP TABLE IF EXISTS products_fts;
      DROP TABLE IF EXISTS products;
      DROP TABLE IF EXISTS product_prices;
      DROP TABLE IF EXISTS inventory;

      CREATE TABLE IF NOT EXISTS variants (
        id               TEXT PRIMARY KEY,
        product_id       TEXT NOT NULL,
        sku              TEXT NOT NULL,
        barcode          TEXT,
        product_name     TEXT NOT NULL,
        variant_name     TEXT,
        search_key       TEXT NOT NULL DEFAULT '',
        unit_abbr        TEXT,
        category_name    TEXT,
        tax_rate         TEXT,
        min_stock        TEXT,
        is_stock_tracked INTEGER NOT NULL DEFAULT 1,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_variants_sku ON variants(sku);
      CREATE INDEX IF NOT EXISTS idx_variants_barcode ON variants(barcode);

      -- External-content FTS5: the index stores terms, not a second copy of
      -- the rows. Over 5,000 SKUs a partial-word search stays instant.
      CREATE VIRTUAL TABLE IF NOT EXISTS variants_fts USING fts5(
        product_name, variant_name, sku, search_key,
        content='variants',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS variants_fts_insert AFTER INSERT ON variants BEGIN
        INSERT INTO variants_fts(rowid, product_name, variant_name, sku, search_key)
        VALUES (new.rowid, new.product_name, new.variant_name, new.sku, new.search_key);
      END;

      CREATE TRIGGER IF NOT EXISTS variants_fts_delete AFTER DELETE ON variants BEGIN
        INSERT INTO variants_fts(variants_fts, rowid, product_name, variant_name, sku, search_key)
        VALUES ('delete', old.rowid, old.product_name, old.variant_name, old.sku, old.search_key);
      END;

      CREATE TRIGGER IF NOT EXISTS variants_fts_update AFTER UPDATE ON variants BEGIN
        INSERT INTO variants_fts(variants_fts, rowid, product_name, variant_name, sku, search_key)
        VALUES ('delete', old.rowid, old.product_name, old.variant_name, old.sku, old.search_key);
        INSERT INTO variants_fts(rowid, product_name, variant_name, sku, search_key)
        VALUES (new.rowid, new.product_name, new.variant_name, new.sku, new.search_key);
      END;

      -- Prices arrive already resolved by the server. The terminal must never
      -- reimplement the resolution ladder, or an offline sale would price
      -- differently from the same sale rung up online.
      CREATE TABLE IF NOT EXISTS variant_prices (
        id                TEXT PRIMARY KEY,
        variant_id        TEXT NOT NULL,
        price_list_id     TEXT NOT NULL,
        selling_price     TEXT NOT NULL,
        min_selling_price TEXT,
        is_default        INTEGER NOT NULL DEFAULT 0,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_variant_prices_variant ON variant_prices(variant_id);

      CREATE TABLE IF NOT EXISTS inventory (
        id              TEXT PRIMARY KEY,
        variant_id      TEXT NOT NULL UNIQUE,
        quantity        TEXT NOT NULL DEFAULT '0',
        reserved_qty    TEXT NOT NULL DEFAULT '0',
        -- Decremented locally as offline sales are rung up, so the second
        -- cashier to sell the last tap sees zero rather than one.
        local_delta     TEXT NOT NULL DEFAULT '0',
        updated_at      TEXT NOT NULL
      );

      -- A tombstone must survive the row it kills. Without it a variant that
      -- was deactivated server-side is indistinguishable from one that simply
      -- was not in the last page, and the till keeps offering it forever.
      CREATE TABLE IF NOT EXISTS deleted_records (
        entity      TEXT NOT NULL,
        id          TEXT NOT NULL,
        deleted_at  TEXT NOT NULL,
        PRIMARY KEY (entity, id)
      );
    `
  },
  {
    version: 4,
    sql: `
      -- Which price list a row belongs to is not something the terminal can
      -- infer, and a variant carries one row per list. Without the flag the
      -- till shows whichever the join happened to return — a different price
      -- on two tills looking at the same product.
      ALTER TABLE variant_prices ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

      -- The sale line references the variant it sold. Snapshotted alongside it:
      -- name, sku and tax as they were at that moment, because a receipt is a
      -- statement about a moment and must not be rewritten by a later edit.
      ALTER TABLE local_sale_items RENAME COLUMN product_id TO variant_id;
      ALTER TABLE local_sale_items ADD COLUMN unit_abbr TEXT;
    `
  },
  {
    version: 5,
    sql: `
      -- A parked cart, stored whole.
      --
      -- Local-first like everything else at the counter: a cart parked while
      -- the line is down and restored two minutes later must not depend on the
      -- server having seen it — that is exactly when a queue is forming.
      --
      -- Deliberately NOT in the outbox. A held cart is a draft, not a document;
      -- pushing every parked basket would fill the server with carts that were
      -- restored and rung up thirty seconds later.
      CREATE TABLE IF NOT EXISTS held_carts (
        id            TEXT PRIMARY KEY,
        label         TEXT,
        line_count    INTEGER NOT NULL DEFAULT 0,
        total         TEXT NOT NULL DEFAULT '0',
        customer_name TEXT,
        cart_data     TEXT NOT NULL,
        held_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_held_carts_held_at ON held_carts(held_at DESC);
    `
  }
];
function migrate(database) {
  const current = database.pragma("user_version", { simple: true });
  const target = MIGRATIONS.at(-1)?.version ?? 0;
  if (current > target) {
    throw new Error(
      `Local database is at version ${current} but this build expects ${target}. Reinstall the newer POS version — do not delete the database, it may contain unsynced sales.`
    );
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    database.transaction(() => {
      database.exec(migration.sql);
      database.pragma(`user_version = ${migration.version}`);
    })();
  }
}
function registerHardwareHandlers(ipcMain) {
  ipcMain.handle("printer:list", async () => {
    return [];
  });
  ipcMain.handle("printer:receipt", async (_event, _saleId, _format) => {
    throw new Error("Receipt printing lands in Phase 3");
  });
  ipcMain.handle("printer:test", async (_event, _format) => {
    throw new Error("Test printing lands in Phase 3");
  });
  ipcMain.handle("cash-drawer:open", async (_event, _reason) => {
    throw new Error("Cash drawer control lands in Phase 3");
  });
}
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
const PRICE_JOIN = `
  LEFT JOIN variant_prices p ON p.id = (
    SELECT id FROM variant_prices
    WHERE variant_id = v.id
    ORDER BY is_default DESC, updated_at DESC
    LIMIT 1
  )
  LEFT JOIN inventory i ON i.variant_id = v.id
`;
function searchProducts(query, limit = 25) {
  const db2 = getDatabase();
  const q = query.trim();
  if (!q) {
    return db2.prepare(
      `SELECT ${VARIANT_COLUMNS} FROM variants v ${PRICE_JOIN}
         ORDER BY v.product_name LIMIT ?`
    ).all(limit);
  }
  const scanned = findByBarcode(q);
  if (scanned) return [scanned];
  const match = q.split(/\s+/).filter(Boolean).map((token) => `"${token.replace(/"/g, '""')}"*`).join(" ");
  try {
    return db2.prepare(
      `SELECT ${VARIANT_COLUMNS} FROM variants_fts f
         JOIN variants v ON v.rowid = f.rowid
         ${PRICE_JOIN}
         WHERE variants_fts MATCH ?
         ORDER BY rank LIMIT ?`
    ).all(match, limit);
  } catch {
    const like = `%${q}%`;
    return db2.prepare(
      `SELECT ${VARIANT_COLUMNS} FROM variants v ${PRICE_JOIN}
         WHERE v.product_name LIKE ? OR v.sku LIKE ? OR v.search_key LIKE ?
         ORDER BY v.product_name LIMIT ?`
    ).all(like, like, like, limit);
  }
}
function findByBarcode(barcode) {
  const db2 = getDatabase();
  const row = db2.prepare(
    `SELECT ${VARIANT_COLUMNS} FROM variants v ${PRICE_JOIN}
       WHERE v.barcode = ? OR v.sku = ? LIMIT 1`
  ).get(barcode.trim(), barcode.trim());
  return row ?? null;
}
function searchCustomers(query, limit = 25) {
  const db2 = getDatabase();
  const q = query.trim();
  const sql = `
    SELECT id, name, company, phone, trn,
           price_list_id  AS priceListId,
           credit_limit   AS creditLimit,
           credit_balance AS creditBalance,
           credit_on_hold AS creditOnHold
    FROM customers`;
  if (!q) return db2.prepare(`${sql} ORDER BY name LIMIT ?`).all(limit);
  const like = `%${q}%`;
  return db2.prepare(
    `${sql} WHERE name LIKE ? OR company LIKE ? OR phone LIKE ? ORDER BY name LIMIT ?`
  ).all(like, like, like, limit);
}
function getOpenCashSession() {
  const db2 = getDatabase();
  const row = db2.prepare(
    `SELECT client_id AS id, payload
       FROM outbox WHERE entity = 'cash_session' AND status IN ('pending','synced')
       ORDER BY sequence DESC LIMIT 1`
  ).get();
  if (!row) return null;
  const payload = JSON.parse(row.payload);
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
    openedAt: JSON.parse(row.payload).openedAt ?? "",
    status: "open",
    ...movementTotals(db2, row.id)
  };
}
function movementTotals(db2, sessionClientId) {
  const movements = db2.prepare(
    `SELECT payload FROM outbox
       WHERE entity = 'cash_movement' AND json_extract(payload, '$.cashSessionId') = ?`
  ).all(sessionClientId);
  let cashIn = 0;
  let cashOut = 0;
  for (const movement of movements) {
    const parsed = JSON.parse(movement.payload);
    if (parsed.type === "cash_in") cashIn += Number(parsed.amount);
    else cashOut += Number(parsed.amount);
  }
  const sales = db2.prepare(
    `SELECT COALESCE(SUM(CAST(paid_amount AS REAL)), 0) AS total
       FROM local_sales WHERE cash_session_id = ? AND status = 'completed'`
  ).get(sessionClientId);
  return {
    cashIn: String(cashIn),
    cashOut: String(cashOut),
    cashSales: String(sales.total ?? 0)
  };
}
function openCashSession(openingAmount, branchId2) {
  const db2 = getDatabase();
  const existing = getOpenCashSession();
  if (existing) return existing;
  const clientId = node_crypto.randomUUID();
  const openedAt = (/* @__PURE__ */ new Date()).toISOString();
  enqueue(db2, {
    clientId,
    entity: "cash_session",
    occurredAt: openedAt,
    payload: { branchId: branchId2, openingAmount, openedAt }
  });
  return {
    id: clientId,
    openingAmount,
    openedAt,
    status: "open",
    cashIn: "0",
    cashOut: "0",
    cashSales: "0"
  };
}
function closeCashSession(countedAmount, notes) {
  const db2 = getDatabase();
  const open = db2.prepare(
    `SELECT client_id AS id, payload FROM outbox
       WHERE entity = 'cash_session' ORDER BY sequence DESC LIMIT 1`
  ).get();
  if (!open) return;
  const payload = JSON.parse(open.payload);
  payload.closedAt = (/* @__PURE__ */ new Date()).toISOString();
  payload.countedAmount = countedAmount;
  if (notes) payload.notes = notes;
  db2.prepare(`UPDATE outbox SET payload = ?, status = 'pending' WHERE client_id = ?`).run(
    JSON.stringify(payload),
    open.id
  );
}
function recordCashMovement(type, amount, reason) {
  const db2 = getDatabase();
  const session = getOpenCashSession();
  if (!session) throw new Error("No drawer is open on this terminal");
  enqueue(db2, {
    clientId: node_crypto.randomUUID(),
    entity: "cash_movement",
    occurredAt: (/* @__PURE__ */ new Date()).toISOString(),
    payload: { cashSessionId: session.id, type, amount, reason }
  });
}
function commitSale(draft) {
  const db2 = getDatabase();
  const paid = draft.payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  db2.transaction(() => {
    db2.prepare(
      `INSERT INTO local_sales
         (client_id, customer_id, cash_session_id, subtotal, tax_amount,
          discount_amount, total, paid_amount, status, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).run(
      draft.clientId,
      draft.customerId,
      draft.cashSessionId,
      draft.subtotal,
      draft.taxAmount,
      draft.discountAmount,
      draft.total,
      String(paid),
      draft.occurredAt
    );
    const insertItem = db2.prepare(
      `INSERT INTO local_sale_items
         (sale_client_id, variant_id, product_name, product_sku, quantity,
          unit_price, discount_percent, tax_percent, line_subtotal, tax_amount,
          total, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const decrementStock = db2.prepare(
      `UPDATE inventory
       SET local_delta = CAST(CAST(local_delta AS REAL) - ? AS TEXT)
       WHERE variant_id = ?`
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
        index
      );
      decrementStock.run(Number(line.quantity), line.variantId);
    });
    enqueue(db2, {
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
          ...Number(line.discountPercent) > 0 ? { discountPercent: Number(line.discountPercent) } : {}
        })),
        payments: draft.payments.map((payment) => ({
          method: payment.method,
          amount: Number(payment.amount),
          ...payment.reference ? { reference: payment.reference } : {}
        }))
      }
    });
  })();
  return { ...draft, saleNumber: null, synced: false };
}
function recentSales(limit = 20) {
  const db2 = getDatabase();
  const sales = db2.prepare(
    `SELECT s.client_id AS clientId, s.sale_number AS saleNumber,
              s.customer_id AS customerId, s.cash_session_id AS cashSessionId,
              s.subtotal, s.tax_amount AS taxAmount,
              s.discount_amount AS discountAmount, s.total,
              s.occurred_at AS occurredAt, s.synced_at AS syncedAt
       FROM local_sales s ORDER BY s.occurred_at DESC LIMIT ?`
  ).all(limit);
  return sales.map((sale) => ({
    ...sale,
    synced: sale.syncedAt !== null,
    lines: saleLines(db2, sale.clientId),
    payments: []
  }));
}
function findSale(reference) {
  const db2 = getDatabase();
  const sale = db2.prepare(
    `SELECT client_id AS clientId, sale_number AS saleNumber,
              customer_id AS customerId, cash_session_id AS cashSessionId,
              subtotal, tax_amount AS taxAmount, discount_amount AS discountAmount,
              total, occurred_at AS occurredAt, synced_at AS syncedAt
       FROM local_sales WHERE sale_number = ? OR client_id = ? LIMIT 1`
  ).get(reference.trim(), reference.trim());
  if (!sale) return null;
  return {
    ...sale,
    synced: sale.syncedAt !== null,
    lines: saleLines(db2, sale.clientId),
    payments: []
  };
}
function saleLines(db2, clientId) {
  return db2.prepare(
    `SELECT variant_id AS variantId, product_name AS productName,
              product_sku AS productSku, quantity, unit_price AS unitPrice,
              discount_percent AS discountPercent, tax_percent AS taxPercent, total
       FROM local_sale_items WHERE sale_client_id = ? ORDER BY sort_order`
  ).all(clientId);
}
function holdCart(cart) {
  const db2 = getDatabase();
  const id = node_crypto.randomUUID();
  const heldAt = (/* @__PURE__ */ new Date()).toISOString();
  db2.prepare(
    `INSERT INTO held_carts (id, label, line_count, total, customer_name, cart_data, held_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    cart.label,
    cart.lineCount,
    cart.total,
    cart.customerName,
    JSON.stringify(cart.cartData),
    heldAt
  );
  return { id, ...cart, heldAt, cartData: void 0 };
}
function listHeldCarts(limit = 50) {
  return getDatabase().prepare(
    `SELECT id, label, line_count AS lineCount, total,
              customer_name AS customerName, held_at AS heldAt
       FROM held_carts ORDER BY held_at DESC LIMIT ?`
  ).all(limit);
}
function restoreHeldCart(id) {
  const db2 = getDatabase();
  return db2.transaction(() => {
    const row = db2.prepare(`SELECT cart_data FROM held_carts WHERE id = ?`).get(id);
    if (!row) return null;
    db2.prepare(`DELETE FROM held_carts WHERE id = ?`).run(id);
    return JSON.parse(row.cart_data);
  })();
}
function discardHeldCart(id) {
  getDatabase().prepare(`DELETE FROM held_carts WHERE id = ?`).run(id);
}
function nextSequence(db2) {
  const row = db2.prepare(`SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM outbox`).get();
  return row.next;
}
function enqueue(db2, item) {
  db2.prepare(
    `INSERT INTO outbox (client_id, entity, sequence, occurred_at, payload)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(client_id) DO NOTHING`
  ).run(
    item.clientId,
    item.entity,
    nextSequence(db2),
    item.occurredAt,
    JSON.stringify(item.payload)
  );
}
function pendingOutbox(limit = 200) {
  const db2 = getDatabase();
  const rows = db2.prepare(
    `SELECT client_id AS clientId, entity, sequence, occurred_at AS occurredAt, payload
       FROM outbox WHERE status = 'pending' ORDER BY sequence LIMIT ?`
  ).all(limit);
  return rows.map((row) => ({
    clientId: row.clientId,
    entity: row.entity,
    sequence: row.sequence,
    occurredAt: row.occurredAt,
    payload: JSON.parse(row.payload)
  }));
}
function outboxCounts() {
  const db2 = getDatabase();
  const row = db2.prepare(
    `SELECT
         SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS failed
       FROM outbox`
  ).get();
  return { pending: row.pending ?? 0, failed: row.failed ?? 0 };
}
function settleOutboxItem(result) {
  const db2 = getDatabase();
  if (result.outcome === "applied" || result.outcome === "duplicate") {
    db2.transaction(() => {
      db2.prepare(
        `UPDATE outbox SET status = 'synced', server_id = ?, document_number = ?, last_error = NULL
         WHERE client_id = ?`
      ).run(result.serverId ?? null, result.documentNumber ?? null, result.clientId);
      db2.prepare(
        `UPDATE local_sales SET server_id = ?, sale_number = ?, synced_at = datetime('now')
         WHERE client_id = ?`
      ).run(result.serverId ?? null, result.documentNumber ?? null, result.clientId);
    })();
    return;
  }
  if (result.outcome === "rejected") {
    db2.prepare(
      `UPDATE outbox SET status = 'rejected', last_error = ?, attempts = attempts + 1
       WHERE client_id = ?`
    ).run(result.message ?? "Rejected by the server", result.clientId);
    return;
  }
  db2.prepare(
    `UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE client_id = ?`
  ).run(result.message ?? null, result.clientId);
}
function clearSettledDeltas() {
  const db2 = getDatabase();
  db2.prepare(
    `UPDATE inventory SET local_delta = '0'
     WHERE variant_id IN (
       SELECT i.variant_id FROM local_sale_items i
       JOIN local_sales s ON s.client_id = i.sale_client_id
       WHERE s.synced_at IS NOT NULL
     )`
  ).run();
}
function getState(key) {
  const row = getDatabase().prepare(`SELECT value FROM device_state WHERE key = ?`).get(key);
  return row?.value ?? null;
}
function setState(key, value) {
  getDatabase().prepare(
    `INSERT INTO device_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}
class ApiError extends Error {
  constructor(status2, code, message) {
    super(message);
    this.status = status2;
    this.code = code;
    this.name = "ApiError";
  }
  status;
  code;
  /**
   * A refused request, as opposed to an unreachable server.
   *
   * The distinction decides whether an outbox item is retried or parked: a 4xx
   * will say the same thing on the thousandth attempt.
   */
  get isPermanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}
let tokens = null;
let refreshing = null;
function apiUrl() {
  return getState("api_url") ?? process.env.VITE_API_URL ?? "http://localhost:3001/api/v1";
}
function deviceId() {
  return getState("device_id");
}
function branchId() {
  return getState("branch_id");
}
function isAuthenticated() {
  return tokens !== null || getState("refresh_token") !== null;
}
function forgetTokens() {
  tokens = null;
  setState("refresh_token", null);
}
async function loginWithPin(pin) {
  const base = requireApiUrl();
  const device = deviceId();
  const branch = branchId();
  if (!device || !branch) throw new Error("This terminal has not been activated yet");
  const response = await request(`${base}/auth/pin-login`, {
    method: "POST",
    body: JSON.stringify({ pin, deviceId: device, branchId: branch })
  });
  storeTokens(response.accessToken, response.refreshToken, response.expiresIn);
  return response.user;
}
function storeTokens(accessToken, refreshToken, expiresIn) {
  tokens = {
    accessToken,
    refreshToken,
    // Sixty seconds of slack: a token that expires mid-flight fails the push it
    // was carrying, and that push may be a day's takings.
    expiresAt: Date.now() + Math.max(0, expiresIn - 60) * 1e3
  };
  setState("refresh_token", refreshToken);
}
async function ensureAccessToken() {
  if (tokens && Date.now() < tokens.expiresAt) return tokens.accessToken;
  refreshing ??= refreshTokens().finally(() => {
    refreshing = null;
  });
  await refreshing;
  if (!tokens) throw new Error("This terminal is signed out. Sign in with a PIN.");
  return tokens.accessToken;
}
async function refreshTokens() {
  const stored = tokens?.refreshToken ?? getState("refresh_token");
  if (!stored) throw new Error("This terminal is signed out. Sign in with a PIN.");
  try {
    const response = await request(`${requireApiUrl()}/auth/refresh`, {
      method: "POST",
      body: JSON.stringify({ refreshToken: stored })
    });
    storeTokens(response.accessToken, response.refreshToken, response.expiresIn);
  } catch (error) {
    if (error instanceof ApiError && error.isPermanent) forgetTokens();
    throw error;
  }
}
async function authorized(path, body) {
  const accessToken = await ensureAccessToken();
  return request(`${requireApiUrl()}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body)
  });
}
async function ping() {
  const base = apiUrl();
  if (!base) return false;
  try {
    const controller = new AbortController();
    const timer2 = setTimeout(() => controller.abort(), 4e3);
    const response = await fetch(new URL("/health", base), { signal: controller.signal });
    clearTimeout(timer2);
    return response.ok;
  } catch {
    return false;
  }
}
function requireApiUrl() {
  const base = apiUrl();
  if (!base) throw new Error("No server address is configured on this terminal");
  return base.replace(/\/+$/, "");
}
async function request(url, init) {
  const controller = new AbortController();
  const timer2 = setTimeout(() => controller.abort(), 3e4);
  let response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...init.headers ?? {} }
    });
  } finally {
    clearTimeout(timer2);
  }
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : {};
  if (!response.ok || parsed.success === false) {
    const error = parsed.error ?? {};
    throw new ApiError(
      response.status,
      error.code ?? "UNKNOWN",
      error.message ?? `Request failed with ${response.status}`
    );
  }
  return parsed.data ?? parsed;
}
const PULL_PAGE_LIMIT = 500;
let timer = null;
let cycleInFlight = null;
let getWindow = () => null;
const status = {
  online: false,
  lastPullAt: null,
  lastPushAt: null,
  lastCheckpoint: null,
  pendingPushCount: 0,
  failedPushCount: 0,
  syncing: false,
  lastError: null
};
function emit(patch = {}) {
  Object.assign(status, patch);
  const counts = outboxCounts();
  status.pendingPushCount = counts.pending;
  status.failedPushCount = counts.failed;
  getWindow()?.webContents.send("sync:status-changed", { ...status });
  return { ...status };
}
function registerSyncHandlers(ipcMain, windowGetter) {
  getWindow = windowGetter;
  status.lastCheckpoint = getState("checkpoint");
  ipcMain.handle("sync:status", () => emit());
  ipcMain.handle("sync:now", () => runCycle());
  const interval = Number(process.env.POS_SYNC_INTERVAL_MS ?? 3e4);
  timer = setInterval(() => {
    void runCycle().catch(() => {
    });
  }, interval);
}
function stopSyncEngine() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
async function runCycle() {
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
        lastError: message
      });
    }
  })().finally(() => {
    cycleInFlight = null;
  });
  return cycleInFlight;
}
async function pushOutbox() {
  const items = pendingOutbox(200);
  if (items.length === 0) return;
  const response = await authorized("/sync/push", {
    deviceId: deviceId(),
    lastCheckpoint: getState("checkpoint"),
    items
  });
  for (const result of response.results) settleOutboxItem(result);
  emit({ lastPushAt: (/* @__PURE__ */ new Date()).toISOString() });
}
async function pullChanges() {
  for (let page = 0; page < 200; page += 1) {
    const response = await authorized("/sync/pull", {
      deviceId: deviceId(),
      since: getState("checkpoint"),
      limit: PULL_PAGE_LIMIT
    });
    applyChanges(response.changes, response.checkpoint);
    emit({ lastPullAt: (/* @__PURE__ */ new Date()).toISOString(), lastCheckpoint: response.checkpoint });
    if (!response.hasMore) return;
  }
}
function applyChanges(changes, checkpoint) {
  const db2 = getDatabase();
  db2.transaction(() => {
    for (const change of changes) {
      if (change.deleted) {
        applyTombstone(change.entity, change.id);
        continue;
      }
      if (!change.record) continue;
      applyRecord(change.entity, change.id, change.record);
    }
    db2.prepare(
      `INSERT INTO device_state (key, value) VALUES ('checkpoint', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(checkpoint);
  })();
}
function applyTombstone(entity, id) {
  const db2 = getDatabase();
  const table = { product: "variants", customer: "customers", category: null, unit: null }[entity];
  if (table) db2.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  db2.prepare(
    `INSERT INTO deleted_records (entity, id, deleted_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(entity, id) DO NOTHING`
  ).run(entity, id);
}
function applyRecord(entity, id, record) {
  const db2 = getDatabase();
  const text = (value) => value === null || value === void 0 ? null : String(value);
  switch (entity) {
    case "product":
      db2.prepare(
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
           is_stock_tracked = excluded.is_stock_tracked, updated_at = datetime('now')`
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
        record.isStockTracked === false ? 0 : 1
      );
      return;
    case "product_price":
      db2.prepare(
        `INSERT INTO variant_prices
           (id, variant_id, price_list_id, selling_price, min_selling_price, is_default, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           selling_price = excluded.selling_price,
           min_selling_price = excluded.min_selling_price,
           is_default = excluded.is_default,
           updated_at = datetime('now')`
      ).run(
        id,
        text(record.variantId),
        text(record.priceListId),
        text(record.sellingPrice) ?? "0",
        text(record.minSellingPrice),
        record.isDefault ? 1 : 0
      );
      return;
    case "inventory":
      db2.prepare(
        `INSERT INTO inventory (id, variant_id, quantity, reserved_qty, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(variant_id) DO UPDATE SET
           quantity = excluded.quantity,
           reserved_qty = excluded.reserved_qty,
           updated_at = datetime('now')`
      ).run(
        id,
        text(record.variantId),
        text(record.quantity) ?? "0",
        text(record.reservedQuantity) ?? "0"
      );
      return;
    case "customer":
      db2.prepare(
        `INSERT INTO customers
           (id, name, company, phone, trn, price_list_id, credit_limit,
            credit_balance, credit_on_hold, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, company = excluded.company, phone = excluded.phone,
           trn = excluded.trn, price_list_id = excluded.price_list_id,
           credit_limit = excluded.credit_limit, credit_balance = excluded.credit_balance,
           credit_on_hold = excluded.credit_on_hold, updated_at = datetime('now')`
      ).run(
        id,
        text(record.name),
        text(record.company),
        text(record.phone),
        text(record.trn),
        text(record.priceListId),
        text(record.creditLimit) ?? "0",
        text(record.creditBalance) ?? "0",
        record.creditOnHold ? 1 : 0
      );
      return;
    default:
      return;
  }
}
function syncNow() {
  void runCycle().catch(() => void 0);
}
function registerDataHandlers(ipcMain) {
  ipcMain.handle(
    "catalog:search",
    (_event, query, limit) => searchProducts(query ?? "", limit)
  );
  ipcMain.handle(
    "catalog:by-barcode",
    (_event, barcode) => findByBarcode(barcode ?? "")
  );
  ipcMain.handle(
    "customers:search",
    (_event, query) => searchCustomers(query ?? "")
  );
  ipcMain.handle("cash:current", () => getOpenCashSession());
  ipcMain.handle(
    "cash:open",
    (_event, openingAmount) => openCashSession(String(openingAmount ?? "0"), getState("branch_id"))
  );
  ipcMain.handle("cash:close", (_event, countedAmount, notes) => {
    closeCashSession(String(countedAmount ?? "0"), notes);
    syncNow();
  });
  ipcMain.handle(
    "cash:movement",
    (_event, type, amount, reason) => {
      recordCashMovement(type, String(amount ?? "0"), reason ?? "");
    }
  );
  ipcMain.handle(
    "carts:hold",
    (_event, cart) => holdCart(cart)
  );
  ipcMain.handle("carts:list", () => listHeldCarts());
  ipcMain.handle("carts:restore", (_event, id) => restoreHeldCart(id));
  ipcMain.handle("carts:discard", (_event, id) => discardHeldCart(id));
  ipcMain.handle("sales:commit", (_event, draft) => {
    const receipt = commitSale(draft);
    syncNow();
    return receipt;
  });
  ipcMain.handle("sales:recent", (_event, limit) => recentSales(limit));
  ipcMain.handle("sales:find", (_event, reference) => findSale(reference ?? ""));
  ipcMain.handle("auth:pin-login", async (_event, pin) => {
    const user = await loginWithPin(String(pin ?? ""));
    syncNow();
    return user;
  });
  ipcMain.handle("device:info", () => ({
    deviceId: getState("device_id"),
    branchId: getState("branch_id"),
    apiUrl: getState("api_url"),
    hardwareId: hardwareId(),
    version: electron.app.getVersion()
  }));
  ipcMain.handle(
    "device:activate",
    (_event, activationCode, apiUrl2) => {
      const [device, branch] = String(activationCode ?? "").split(":");
      if (!device || !branch) {
        throw new Error("Activation code must be <terminal-id>:<branch-id>");
      }
      setState("api_url", String(apiUrl2 ?? "").replace(/\/+$/, ""));
      setState("device_id", device.trim());
      setState("branch_id", branch.trim());
      setState("hardware_id", hardwareId());
      syncNow();
      return { deviceId: device.trim() };
    }
  );
}
function hardwareId() {
  const macs = Object.values(node_os.networkInterfaces()).flat().filter((iface) => Boolean(iface)).filter((iface) => !iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00").map((iface) => iface.mac).sort();
  return node_crypto.createHash("sha256").update([...macs, node_os.hostname(), node_os.platform()].join("|")).digest("hex").slice(0, 32);
}
const __dirname$1 = node_path.dirname(node_url.fileURLToPath(typeof document === "undefined" ? require("url").pathToFileURL(__filename).href : _documentCurrentScript && _documentCurrentScript.tagName.toUpperCase() === "SCRIPT" && _documentCurrentScript.src || new URL("main.js", document.baseURI).href));
let mainWindow = null;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#0b0d10",
    title: "DevsFleet POS",
    webPreferences: {
      preload: node_path.join(__dirname$1, "preload.js"),
      // Non-negotiable on a terminal that handles money.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // preload needs `require` for the IPC bridge
      webSecurity: true,
      spellcheck: false
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(node_path.join(__dirname$1, "../dist/index.html"));
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== devServerUrl) event.preventDefault();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}
if (!electron.app.requestSingleInstanceLock()) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  void electron.app.whenReady().then(() => {
    openDatabase();
    registerDataHandlers(electron.ipcMain);
    registerSyncHandlers(electron.ipcMain, () => mainWindow);
    registerHardwareHandlers(electron.ipcMain);
    createWindow();
    electron.app.on("activate", () => {
      if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", () => {
  stopSyncEngine();
  closeDatabase();
});
