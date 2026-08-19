"use strict";
const electron = require("electron");
const node_url = require("node:url");
const node_path = require("node:path");
const Database = require("better-sqlite3");
const node_crypto = require("node:crypto");
const node_os = require("node:os");
const nodeCrypto = require("crypto");
var _documentCurrentScript = typeof document !== "undefined" ? document.currentScript : null;
let db = null;
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
    /**
     * A function step, not `sql`, because this migration cannot be a single
     * idempotent SQL string.
     *
     * Version 3 above originally created `variant_prices` WITHOUT
     * `is_default` — this migration's job was to add it for installs that had
     * already run v3. A later edit (forbidden by the rule at the top of this
     * file, and the direct cause of this being a function instead of plain SQL)
     * put `is_default` into v3's own CREATE TABLE. That fixed nothing for an
     * existing install still on v3, but it means a FRESH install now creates
     * the column twice: once in v3, once here — and SQLite has no
     * `ADD COLUMN IF NOT EXISTS`, so the plain-SQL version of this migration
     * failed on every new terminal with "duplicate column name: is_default"
     * before the window ever opened.
     *
     * Each statement below checks first, so this runs correctly whichever
     * state a database arrives in: pre-edit v3 (needs all three changes),
     * post-edit v3 (needs only the last two), or a replay after this fix
     * (needs none — see the migration-replay test in `__tests__/`).
     */
    up: (database) => {
      const prices = database.pragma("table_info(variant_prices)");
      if (!prices.some((c) => c.name === "is_default")) {
        database.exec(
          "ALTER TABLE variant_prices ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;"
        );
      }
      const saleItems = database.pragma("table_info(local_sale_items)");
      if (saleItems.some((c) => c.name === "product_id") && !saleItems.some((c) => c.name === "variant_id")) {
        database.exec("ALTER TABLE local_sale_items RENAME COLUMN product_id TO variant_id;");
      }
      if (!saleItems.some((c) => c.name === "unit_abbr")) {
        database.exec("ALTER TABLE local_sale_items ADD COLUMN unit_abbr TEXT;");
      }
    }
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
  },
  {
    version: 6,
    sql: `
      -- Sync Engine Schema Updates (API Parity Step 1.2)
      ALTER TABLE outbox RENAME COLUMN client_id TO local_id;
      ALTER TABLE local_sales RENAME COLUMN client_id TO local_id;
      ALTER TABLE local_sale_items RENAME COLUMN sale_client_id TO sale_local_id;

      -- Add version tracking to mirror tables
      ALTER TABLE variants ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE variant_prices ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE inventory ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE customers ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE customers ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced';
      
      -- Support for offline orders (Quotations & Sales Orders)
      CREATE TABLE IF NOT EXISTS local_quotations (
        local_id        TEXT PRIMARY KEY,
        server_id       TEXT,
        quotation_number TEXT,
        customer_id     TEXT,
        subtotal        TEXT NOT NULL,
        tax_amount      TEXT NOT NULL,
        discount_amount TEXT NOT NULL,
        total           TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'draft',
        occurred_at     TEXT NOT NULL,
        synced_at       TEXT
      );

      CREATE TABLE IF NOT EXISTS local_quotation_items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        quotation_local_id TEXT NOT NULL REFERENCES local_quotations(local_id) ON DELETE CASCADE,
        variant_id      TEXT NOT NULL,
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

      CREATE TABLE IF NOT EXISTS local_orders (
        local_id        TEXT PRIMARY KEY,
        server_id       TEXT,
        order_number    TEXT,
        customer_id     TEXT,
        subtotal        TEXT NOT NULL,
        tax_amount      TEXT NOT NULL,
        discount_amount TEXT NOT NULL,
        total           TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        occurred_at     TEXT NOT NULL,
        synced_at       TEXT
      );

      CREATE TABLE IF NOT EXISTS local_order_items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        order_local_id  TEXT NOT NULL REFERENCES local_orders(local_id) ON DELETE CASCADE,
        variant_id      TEXT NOT NULL,
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
    `
  },
  {
    version: 7,
    sql: `
      CREATE TABLE IF NOT EXISTS local_customer_payments (
        client_id       TEXT PRIMARY KEY,
        customer_id     TEXT NOT NULL,
        cash_session_id TEXT,
        amount          TEXT NOT NULL,
        method          TEXT NOT NULL,
        reference       TEXT,
        notes           TEXT,
        occurred_at     TEXT NOT NULL,
        synced_at       TEXT
      );
    `
  },
  {
    version: 8,
    sql: `
      -- version 6 renamed client_id -> local_id everywhere else in the outbox
      -- family; this table was added in version 7, after that rename, and
      -- never got it — it still stands out as the one table naming the same
      -- idempotency key differently.
      ALTER TABLE local_customer_payments RENAME COLUMN client_id TO local_id;
    `
  },
  {
    version: 9,
    sql: `
      -- The staff directory, mirrored from \`users\` so a PIN can be verified
      -- with the network unplugged. \`branch_id\` NULL means the same as it does
      -- server-side: this person may sign in at any branch (an owner, an area
      -- manager) — not "unassigned".
      --
      -- \`permissions\` is the resolved array from their role, not a role id: the
      -- terminal has no roles table of its own and no use for one, only for the
      -- grants a role currently carries.
      CREATE TABLE IF NOT EXISTS staff (
        id                    TEXT PRIMARY KEY,
        branch_id             TEXT,
        name                  TEXT NOT NULL,
        role_name             TEXT NOT NULL,
        permissions           TEXT NOT NULL,
        pin_hash              TEXT,
        max_discount_percent  TEXT NOT NULL DEFAULT '0',
        updated_at            TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_staff_branch ON staff(branch_id);

      -- Deliberately NOT part of the \`staff\` mirror above, and never synced.
      --
      -- A wrong PIN cannot be attributed to a specific account — it may match
      -- nobody, and there is no way to tell a mistyped digit from a stranger's
      -- guess. That is exactly why neither this nor the SERVER's own
      -- \`pinLogin\` tracks a per-account lockout for it (contrast \`login()\`,
      -- which resolves the account from the email FIRST and can blame it).
      --
      -- What guards a PIN online is the route's rate limit — 20 requests a
      -- minute, everyone sharing it. Offline there is no route to limit, so
      -- this is the same idea moved to the till: one counter for the whole
      -- terminal, not per person, because per-person is not an answer this
      -- problem has. \`id = 1\` enforces there is ever only one row.
      CREATE TABLE IF NOT EXISTS pin_throttle (
        id                  INTEGER PRIMARY KEY CHECK (id = 1),
        failed_count        INTEGER NOT NULL DEFAULT 0,
        window_started_at   TEXT,
        locked_until         TEXT
      );
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
      if (migration.up) migration.up(database);
      else database.exec(migration.sql);
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
const MONEY_SCALE = 4;
const SCALE_FACTOR = 10000n;
function toMinor(value) {
  if (typeof value === "bigint")
    return value;
  const raw = typeof value === "number" ? numberToDecimalString(value) : value.trim();
  if (raw === "" || raw === "-" || raw === "+")
    return 0n;
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!match) {
    throw new TypeError(`Not a decimal money value: ${JSON.stringify(value)}`);
  }
  const [, sign = "", whole = "", frac = ""] = match;
  const paddedFrac = frac.padEnd(MONEY_SCALE, "0").slice(0, MONEY_SCALE);
  const digits = `${whole || "0"}${paddedFrac}`;
  const magnitude = BigInt(digits);
  return sign === "-" ? -magnitude : magnitude;
}
function toDecimalString(amount, decimals = MONEY_SCALE) {
  if (decimals < 0 || decimals > MONEY_SCALE) {
    throw new RangeError(`decimals must be between 0 and ${MONEY_SCALE}`);
  }
  const rounded = decimals === MONEY_SCALE ? amount : roundTo(amount, decimals);
  const negative = rounded < 0n;
  const magnitude = negative ? -rounded : rounded;
  const whole = magnitude / SCALE_FACTOR;
  const frac = (magnitude % SCALE_FACTOR).toString().padStart(MONEY_SCALE, "0");
  const shown = decimals === 0 ? "" : `.${frac.slice(0, decimals)}`;
  return `${negative ? "-" : ""}${whole}${shown}`;
}
function add(...amounts) {
  return amounts.reduce((sum, a) => sum + a, 0n);
}
function subtract(a, b) {
  return a - b;
}
function divideRoundHalfUp(numerator, denominator) {
  if (denominator === 0n)
    throw new RangeError("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  const roundUp = remainder * 2n >= d;
  const magnitude = roundUp ? quotient + 1n : quotient;
  return negative ? -magnitude : magnitude;
}
function roundTo(amount, decimals) {
  if (decimals >= MONEY_SCALE)
    return amount;
  const step = 10n ** BigInt(MONEY_SCALE - decimals);
  return divideRoundHalfUp(amount, step) * step;
}
function numberToDecimalString(value) {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Not a finite money value: ${value}`);
  }
  return value.toFixed(20).replace(/0+$/, "").replace(/\.$/, "");
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
    `SELECT local_id AS id, payload
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
  let cashIn = 0n;
  let cashOut = 0n;
  for (const movement of movements) {
    const parsed = JSON.parse(movement.payload);
    const amount = toMinor(parsed.amount);
    if (parsed.type === "cash_in") cashIn = add(cashIn, amount);
    else cashOut = add(cashOut, amount);
  }
  const salePayments = db2.prepare(
    `SELECT paid_amount FROM local_sales WHERE cash_session_id = ? AND status = 'completed'`
  ).all(sessionClientId);
  const cashSales = salePayments.reduce(
    (sum, row) => add(sum, toMinor(row.paid_amount)),
    0n
  );
  return {
    cashIn: toDecimalString(cashIn, 4),
    cashOut: toDecimalString(cashOut, 4),
    cashSales: toDecimalString(cashSales, 4)
  };
}
function openCashSession(openingAmount, branchId2) {
  const db2 = getDatabase();
  const existing = getOpenCashSession();
  if (existing) return existing;
  const localId = node_crypto.randomUUID();
  const openedAt = (/* @__PURE__ */ new Date()).toISOString();
  enqueue(db2, {
    localId,
    entity: "cash_session",
    occurredAt: openedAt,
    payload: { branchId: branchId2, openingAmount, openedAt }
  });
  return {
    id: localId,
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
    `SELECT local_id AS id, payload FROM outbox
       WHERE entity = 'cash_session' ORDER BY sequence DESC LIMIT 1`
  ).get();
  if (!open) return;
  const payload = JSON.parse(open.payload);
  payload.closedAt = (/* @__PURE__ */ new Date()).toISOString();
  payload.countedAmount = countedAmount;
  if (notes) payload.notes = notes;
  db2.prepare(`UPDATE outbox SET payload = ?, status = 'pending' WHERE local_id = ?`).run(
    JSON.stringify(payload),
    open.id
  );
}
function recordCashMovement(type, amount, reason) {
  const db2 = getDatabase();
  const session = getOpenCashSession();
  if (!session) throw new Error("No drawer is open on this terminal");
  enqueue(db2, {
    localId: node_crypto.randomUUID(),
    entity: "cash_movement",
    occurredAt: (/* @__PURE__ */ new Date()).toISOString(),
    payload: { cashSessionId: session.id, type, amount, reason }
  });
}
function commitSale(draft) {
  const db2 = getDatabase();
  if (getState("allow_negative_stock") !== "1") {
    const available = db2.prepare(
      `SELECT
         COALESCE(CAST(quantity AS REAL), 0)
         - COALESCE(CAST(reserved_qty AS REAL), 0)
         + COALESCE(CAST(local_delta AS REAL), 0) AS available
       FROM inventory WHERE variant_id = ?`
    );
    for (const line of draft.lines) {
      const row = available.get(line.variantId);
      const stock = row?.available ?? 0;
      if (Number(line.quantity) > stock) {
        throw new Error(
          `${line.productName} — only ${stock} left at this terminal. Check with a manager before selling more offline.`
        );
      }
    }
  }
  const paid = toDecimalString(
    draft.payments.reduce((sum, payment) => add(sum, toMinor(payment.amount)), 0n),
    4
  );
  db2.transaction(() => {
    db2.prepare(
      `INSERT INTO local_sales
         (local_id, customer_id, cash_session_id, subtotal, tax_amount,
          discount_amount, total, paid_amount, status, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`
    ).run(
      draft.localId,
      draft.customerId,
      draft.cashSessionId,
      draft.subtotal,
      draft.taxAmount,
      draft.discountAmount,
      draft.total,
      paid,
      draft.occurredAt
    );
    const insertItem = db2.prepare(
      `INSERT INTO local_sale_items
         (sale_local_id, variant_id, product_name, product_sku, quantity,
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
      decrementStock.run(Number(line.quantity), line.variantId);
    });
    enqueue(db2, {
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
          ...Number(line.discountPercent) > 0 ? { discountPercent: Number(line.discountPercent) } : {}
        })),
        payments: draft.payments.map((payment) => ({
          method: payment.method,
          amount: Number(payment.amount),
          ...payment.reference ? { reference: payment.reference } : {}
        })),
        ...draft.overrideGrants?.length ? { overrideGrants: draft.overrideGrants } : {}
      }
    });
  })();
  return { ...draft, saleNumber: null, synced: false };
}
function recentSales(limit = 20) {
  const db2 = getDatabase();
  const sales = db2.prepare(
    `SELECT s.local_id AS localId, s.sale_number AS saleNumber,
              s.customer_id AS customerId, s.cash_session_id AS cashSessionId,
              s.subtotal, s.tax_amount AS taxAmount,
              s.discount_amount AS discountAmount, s.total,
              s.occurred_at AS occurredAt, s.synced_at AS syncedAt
       FROM local_sales s ORDER BY s.occurred_at DESC LIMIT ?`
  ).all(limit);
  return sales.map((sale) => ({
    ...sale,
    synced: sale.syncedAt !== null,
    lines: saleLines(db2, sale.localId),
    payments: []
  }));
}
function findSale(reference) {
  const db2 = getDatabase();
  const sale = db2.prepare(
    `SELECT local_id AS localId, sale_number AS saleNumber,
              customer_id AS customerId, cash_session_id AS cashSessionId,
              subtotal, tax_amount AS taxAmount, discount_amount AS discountAmount,
              total, occurred_at AS occurredAt, synced_at AS syncedAt
       FROM local_sales WHERE sale_number = ? OR local_id = ? LIMIT 1`
  ).get(reference.trim(), reference.trim());
  if (!sale) return null;
  return {
    ...sale,
    synced: sale.syncedAt !== null,
    lines: saleLines(db2, sale.localId),
    payments: []
  };
}
function saleLines(db2, localId) {
  return db2.prepare(
    `SELECT variant_id AS variantId, product_name AS productName,
              product_sku AS productSku, quantity, unit_price AS unitPrice,
              discount_percent AS discountPercent, tax_percent AS taxPercent, total
       FROM local_sale_items WHERE sale_local_id = ? ORDER BY sort_order`
  ).all(localId);
}
function saveQuotation(draft) {
  const db2 = getDatabase();
  db2.transaction(() => {
    db2.prepare(
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
    const insertItem = db2.prepare(
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
    enqueue(db2, {
      localId: draft.localId,
      entity: "quotation",
      occurredAt: draft.occurredAt,
      payload: {
        customerId: draft.customerId,
        lines: draft.lines.map((line) => ({
          variantId: line.variantId,
          quantity: Number(line.quantity),
          unitPrice: line.unitPrice,
          ...Number(line.discountPercent) > 0 ? { discountPercent: Number(line.discountPercent) } : {}
        }))
      }
    });
  })();
  return { ...draft, quotationNumber: null, synced: false };
}
function listQuotations() {
  const db2 = getDatabase();
  const quotations = db2.prepare(
    `SELECT q.local_id AS localId, q.quotation_number AS quotationNumber,
              q.customer_id AS customerId,
              q.subtotal, q.tax_amount AS taxAmount,
              q.discount_amount AS discountAmount, q.total,
              q.status, q.occurred_at AS occurredAt, q.synced_at AS syncedAt
       FROM local_quotations q ORDER BY q.occurred_at DESC`
  ).all();
  for (const q of quotations) {
    q.lines = db2.prepare(
      `SELECT line.variant_id AS variantId, line.product_name AS productName,
                line.product_sku AS productSku, line.quantity, line.unit_price AS unitPrice,
                line.discount_percent AS discountPercent, line.tax_percent AS taxPercent,
                line.line_subtotal AS lineSubtotal, line.tax_amount AS taxAmount, line.total
         FROM local_quotation_items line
         WHERE line.quotation_local_id = ?
         ORDER BY line.sort_order`
    ).all(q.localId);
  }
  return quotations;
}
function recordAccountPayment(input) {
  const db2 = getDatabase();
  const localId = node_crypto.randomUUID();
  db2.transaction(() => {
    db2.prepare(
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
    const customer = db2.prepare(`SELECT credit_balance FROM customers WHERE id = ?`).get(input.customerId);
    if (customer) {
      const newBalance = subtract(
        toMinor(customer.credit_balance),
        toMinor(input.amount)
      );
      db2.prepare(`UPDATE customers SET credit_balance = ? WHERE id = ?`).run(
        toDecimalString(newBalance, 4),
        input.customerId
      );
    }
    enqueue(db2, {
      localId,
      entity: "customer_payment",
      occurredAt: input.occurredAt,
      payload: input
    });
  })();
  return { localId, ...input, synced: false };
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
    `INSERT INTO outbox (local_id, entity, sequence, occurred_at, payload)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(local_id) DO NOTHING`
  ).run(
    item.localId,
    item.entity,
    nextSequence(db2),
    item.occurredAt,
    JSON.stringify(item.payload)
  );
}
function pendingOutbox(limit = 200) {
  const db2 = getDatabase();
  const rows = db2.prepare(
    `SELECT local_id AS localId, entity, sequence, occurred_at AS occurredAt, payload
       FROM outbox WHERE status = 'pending' ORDER BY sequence LIMIT ?`
  ).all(limit);
  return rows.map((row) => ({
    localId: row.localId,
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
  if (result.outcome === "applied" || result.outcome === "duplicate" || result.outcome === "applied_with_warning") {
    const warning = result.outcome === "applied_with_warning" ? result.message ?? "Applied with a warning" : null;
    db2.transaction(() => {
      db2.prepare(
        `UPDATE outbox SET status = 'synced', server_id = ?, document_number = ?, last_error = ?
         WHERE local_id = ?`
      ).run(result.serverId ?? null, result.documentNumber ?? null, warning, result.localId);
      if (result.entity === "quotation") {
        db2.prepare(
          `UPDATE local_quotations SET server_id = ?, quotation_number = ?, synced_at = datetime('now')
           WHERE local_id = ?`
        ).run(result.serverId ?? null, result.documentNumber ?? null, result.localId);
      } else if (result.entity === "customer_payment") {
        db2.prepare(
          `UPDATE local_customer_payments SET synced_at = datetime('now') WHERE local_id = ?`
        ).run(result.localId);
      } else {
        db2.prepare(
          `UPDATE local_sales SET server_id = ?, sale_number = ?, synced_at = datetime('now')
           WHERE local_id = ?`
        ).run(result.serverId ?? null, result.documentNumber ?? null, result.localId);
      }
    })();
    return;
  }
  if (result.outcome === "rejected") {
    db2.prepare(
      `UPDATE outbox SET status = 'rejected', last_error = ?, attempts = attempts + 1
       WHERE local_id = ?`
    ).run(result.message ?? "Rejected by the server", result.localId);
    return;
  }
  db2.prepare(
    `UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE local_id = ?`
  ).run(result.message ?? null, result.localId);
}
function outboxAttentionItems() {
  const rows = getDatabase().prepare(
    `SELECT local_id AS localId, entity, status, last_error AS lastError,
              occurred_at AS occurredAt, attempts
       FROM outbox
       WHERE status = 'rejected' OR (status = 'synced' AND last_error IS NOT NULL)
       ORDER BY occurred_at DESC`
  ).all();
  return rows.map((row) => ({
    localId: row.localId,
    entity: row.entity,
    kind: row.status === "rejected" ? "rejected" : "warning",
    reason: row.lastError ?? "Unknown reason",
    occurredAt: row.occurredAt,
    attempts: row.attempts
  }));
}
function retryOutboxItem(localId) {
  getDatabase().prepare(`UPDATE outbox SET status = 'pending', last_error = NULL WHERE local_id = ? AND status = 'rejected'`).run(localId);
}
function discardOutboxItem(localId) {
  getDatabase().prepare(`UPDATE outbox SET status = 'discarded' WHERE local_id = ? AND status = 'rejected'`).run(localId);
}
function acknowledgeWarning(localId) {
  getDatabase().prepare(`UPDATE outbox SET last_error = NULL WHERE local_id = ? AND status = 'synced'`).run(localId);
}
function clearSettledDeltas() {
  const db2 = getDatabase();
  db2.prepare(
    `UPDATE inventory SET local_delta = '0'
     WHERE variant_id IN (
       SELECT i.variant_id FROM local_sale_items i
       JOIN local_sales s ON s.local_id = i.sale_local_id
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
var randomFallback = null;
function randomBytes(len) {
  try {
    return crypto.getRandomValues(new Uint8Array(len));
  } catch {
  }
  try {
    return nodeCrypto.randomBytes(len);
  } catch {
  }
  if (!randomFallback) {
    throw Error(
      "Neither WebCryptoAPI nor a crypto module is available. Use bcrypt.setRandomFallback to set an alternative"
    );
  }
  return randomFallback(len);
}
function setRandomFallback(random) {
  randomFallback = random;
}
function genSaltSync(rounds, seed_length) {
  rounds = rounds || GENSALT_DEFAULT_LOG2_ROUNDS;
  if (typeof rounds !== "number")
    throw Error(
      "Illegal arguments: " + typeof rounds + ", " + typeof seed_length
    );
  if (rounds < 4) rounds = 4;
  else if (rounds > 31) rounds = 31;
  var salt = [];
  salt.push("$2b$");
  if (rounds < 10) salt.push("0");
  salt.push(rounds.toString());
  salt.push("$");
  salt.push(base64_encode(randomBytes(BCRYPT_SALT_LEN), BCRYPT_SALT_LEN));
  return salt.join("");
}
function genSalt(rounds, seed_length, callback) {
  if (typeof seed_length === "function")
    callback = seed_length, seed_length = void 0;
  if (typeof rounds === "function") callback = rounds, rounds = void 0;
  if (typeof rounds === "undefined") rounds = GENSALT_DEFAULT_LOG2_ROUNDS;
  else if (typeof rounds !== "number")
    throw Error("illegal arguments: " + typeof rounds);
  function _async(callback2) {
    nextTick(function() {
      try {
        callback2(null, genSaltSync(rounds));
      } catch (err) {
        callback2(err);
      }
    });
  }
  if (callback) {
    if (typeof callback !== "function")
      throw Error("Illegal callback: " + typeof callback);
    _async(callback);
  } else
    return new Promise(function(resolve, reject) {
      _async(function(err, res) {
        if (err) {
          reject(err);
          return;
        }
        resolve(res);
      });
    });
}
function hashSync(password, salt) {
  if (typeof salt === "undefined") salt = GENSALT_DEFAULT_LOG2_ROUNDS;
  if (typeof salt === "number") salt = genSaltSync(salt);
  if (typeof password !== "string" || typeof salt !== "string")
    throw Error("Illegal arguments: " + typeof password + ", " + typeof salt);
  return _hash(password, salt);
}
function hash(password, salt, callback, progressCallback) {
  function _async(callback2) {
    if (typeof password === "string" && typeof salt === "number")
      genSalt(salt, function(err, salt2) {
        _hash(password, salt2, callback2, progressCallback);
      });
    else if (typeof password === "string" && typeof salt === "string")
      _hash(password, salt, callback2, progressCallback);
    else
      nextTick(
        callback2.bind(
          this,
          Error("Illegal arguments: " + typeof password + ", " + typeof salt)
        )
      );
  }
  if (callback) {
    if (typeof callback !== "function")
      throw Error("Illegal callback: " + typeof callback);
    _async(callback);
  } else
    return new Promise(function(resolve, reject) {
      _async(function(err, res) {
        if (err) {
          reject(err);
          return;
        }
        resolve(res);
      });
    });
}
function safeStringCompare(known, unknown) {
  var diff = known.length ^ unknown.length;
  for (var i = 0; i < known.length; ++i) {
    diff |= known.charCodeAt(i) ^ unknown.charCodeAt(i);
  }
  return diff === 0;
}
function compareSync(password, hash2) {
  if (typeof password !== "string" || typeof hash2 !== "string")
    throw Error("Illegal arguments: " + typeof password + ", " + typeof hash2);
  if (hash2.length !== 60) return false;
  return safeStringCompare(
    hashSync(password, hash2.substring(0, hash2.length - 31)),
    hash2
  );
}
function compare(password, hashValue, callback, progressCallback) {
  function _async(callback2) {
    if (typeof password !== "string" || typeof hashValue !== "string") {
      nextTick(
        callback2.bind(
          this,
          Error(
            "Illegal arguments: " + typeof password + ", " + typeof hashValue
          )
        )
      );
      return;
    }
    if (hashValue.length !== 60) {
      nextTick(callback2.bind(this, null, false));
      return;
    }
    hash(
      password,
      hashValue.substring(0, 29),
      function(err, comp) {
        if (err) callback2(err);
        else callback2(null, safeStringCompare(comp, hashValue));
      },
      progressCallback
    );
  }
  if (callback) {
    if (typeof callback !== "function")
      throw Error("Illegal callback: " + typeof callback);
    _async(callback);
  } else
    return new Promise(function(resolve, reject) {
      _async(function(err, res) {
        if (err) {
          reject(err);
          return;
        }
        resolve(res);
      });
    });
}
function getRounds(hash2) {
  if (typeof hash2 !== "string")
    throw Error("Illegal arguments: " + typeof hash2);
  return parseInt(hash2.split("$")[2], 10);
}
function getSalt(hash2) {
  if (typeof hash2 !== "string")
    throw Error("Illegal arguments: " + typeof hash2);
  if (hash2.length !== 60)
    throw Error("Illegal hash length: " + hash2.length + " != 60");
  return hash2.substring(0, 29);
}
function truncates(password) {
  if (typeof password !== "string")
    throw Error("Illegal arguments: " + typeof password);
  return utf8Length(password) > 72;
}
var nextTick = typeof setImmediate === "function" ? setImmediate : typeof scheduler === "object" && typeof scheduler.postTask === "function" ? scheduler.postTask.bind(scheduler) : setTimeout;
function utf8Length(string) {
  var len = 0, c = 0;
  for (var i = 0; i < string.length; ++i) {
    c = string.charCodeAt(i);
    if (c < 128) len += 1;
    else if (c < 2048) len += 2;
    else if ((c & 64512) === 55296 && (string.charCodeAt(i + 1) & 64512) === 56320) {
      ++i;
      len += 4;
    } else len += 3;
  }
  return len;
}
function utf8Array(string) {
  var offset = 0, c1, c2;
  var buffer = new Array(utf8Length(string));
  for (var i = 0, k = string.length; i < k; ++i) {
    c1 = string.charCodeAt(i);
    if (c1 < 128) {
      buffer[offset++] = c1;
    } else if (c1 < 2048) {
      buffer[offset++] = c1 >> 6 | 192;
      buffer[offset++] = c1 & 63 | 128;
    } else if ((c1 & 64512) === 55296 && ((c2 = string.charCodeAt(i + 1)) & 64512) === 56320) {
      c1 = 65536 + ((c1 & 1023) << 10) + (c2 & 1023);
      ++i;
      buffer[offset++] = c1 >> 18 | 240;
      buffer[offset++] = c1 >> 12 & 63 | 128;
      buffer[offset++] = c1 >> 6 & 63 | 128;
      buffer[offset++] = c1 & 63 | 128;
    } else {
      buffer[offset++] = c1 >> 12 | 224;
      buffer[offset++] = c1 >> 6 & 63 | 128;
      buffer[offset++] = c1 & 63 | 128;
    }
  }
  return buffer;
}
var BASE64_CODE = "./ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789".split("");
var BASE64_INDEX = [
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  0,
  1,
  54,
  55,
  56,
  57,
  58,
  59,
  60,
  61,
  62,
  63,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  21,
  22,
  23,
  24,
  25,
  26,
  27,
  -1,
  -1,
  -1,
  -1,
  -1,
  -1,
  28,
  29,
  30,
  31,
  32,
  33,
  34,
  35,
  36,
  37,
  38,
  39,
  40,
  41,
  42,
  43,
  44,
  45,
  46,
  47,
  48,
  49,
  50,
  51,
  52,
  53,
  -1,
  -1,
  -1,
  -1,
  -1
];
function base64_encode(b, len) {
  var off = 0, rs = [], c1, c2;
  if (len <= 0 || len > b.length) throw Error("Illegal len: " + len);
  while (off < len) {
    c1 = b[off++] & 255;
    rs.push(BASE64_CODE[c1 >> 2 & 63]);
    c1 = (c1 & 3) << 4;
    if (off >= len) {
      rs.push(BASE64_CODE[c1 & 63]);
      break;
    }
    c2 = b[off++] & 255;
    c1 |= c2 >> 4 & 15;
    rs.push(BASE64_CODE[c1 & 63]);
    c1 = (c2 & 15) << 2;
    if (off >= len) {
      rs.push(BASE64_CODE[c1 & 63]);
      break;
    }
    c2 = b[off++] & 255;
    c1 |= c2 >> 6 & 3;
    rs.push(BASE64_CODE[c1 & 63]);
    rs.push(BASE64_CODE[c2 & 63]);
  }
  return rs.join("");
}
function base64_decode(s, len) {
  var off = 0, slen = s.length, olen = 0, rs = [], c1, c2, c3, c4, o, code;
  if (len <= 0) throw Error("Illegal len: " + len);
  while (off < slen - 1 && olen < len) {
    code = s.charCodeAt(off++);
    c1 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
    code = s.charCodeAt(off++);
    c2 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
    if (c1 == -1 || c2 == -1) break;
    o = c1 << 2 >>> 0;
    o |= (c2 & 48) >> 4;
    rs.push(String.fromCharCode(o));
    if (++olen >= len || off >= slen) break;
    code = s.charCodeAt(off++);
    c3 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
    if (c3 == -1) break;
    o = (c2 & 15) << 4 >>> 0;
    o |= (c3 & 60) >> 2;
    rs.push(String.fromCharCode(o));
    if (++olen >= len || off >= slen) break;
    code = s.charCodeAt(off++);
    c4 = code < BASE64_INDEX.length ? BASE64_INDEX[code] : -1;
    o = (c3 & 3) << 6 >>> 0;
    o |= c4;
    rs.push(String.fromCharCode(o));
    ++olen;
  }
  var res = [];
  for (off = 0; off < olen; off++) res.push(rs[off].charCodeAt(0));
  return res;
}
var BCRYPT_SALT_LEN = 16;
var GENSALT_DEFAULT_LOG2_ROUNDS = 10;
var BLOWFISH_NUM_ROUNDS = 16;
var MAX_EXECUTION_TIME = 100;
var P_ORIG = [
  608135816,
  2242054355,
  320440878,
  57701188,
  2752067618,
  698298832,
  137296536,
  3964562569,
  1160258022,
  953160567,
  3193202383,
  887688300,
  3232508343,
  3380367581,
  1065670069,
  3041331479,
  2450970073,
  2306472731
];
var S_ORIG = [
  3509652390,
  2564797868,
  805139163,
  3491422135,
  3101798381,
  1780907670,
  3128725573,
  4046225305,
  614570311,
  3012652279,
  134345442,
  2240740374,
  1667834072,
  1901547113,
  2757295779,
  4103290238,
  227898511,
  1921955416,
  1904987480,
  2182433518,
  2069144605,
  3260701109,
  2620446009,
  720527379,
  3318853667,
  677414384,
  3393288472,
  3101374703,
  2390351024,
  1614419982,
  1822297739,
  2954791486,
  3608508353,
  3174124327,
  2024746970,
  1432378464,
  3864339955,
  2857741204,
  1464375394,
  1676153920,
  1439316330,
  715854006,
  3033291828,
  289532110,
  2706671279,
  2087905683,
  3018724369,
  1668267050,
  732546397,
  1947742710,
  3462151702,
  2609353502,
  2950085171,
  1814351708,
  2050118529,
  680887927,
  999245976,
  1800124847,
  3300911131,
  1713906067,
  1641548236,
  4213287313,
  1216130144,
  1575780402,
  4018429277,
  3917837745,
  3693486850,
  3949271944,
  596196993,
  3549867205,
  258830323,
  2213823033,
  772490370,
  2760122372,
  1774776394,
  2652871518,
  566650946,
  4142492826,
  1728879713,
  2882767088,
  1783734482,
  3629395816,
  2517608232,
  2874225571,
  1861159788,
  326777828,
  3124490320,
  2130389656,
  2716951837,
  967770486,
  1724537150,
  2185432712,
  2364442137,
  1164943284,
  2105845187,
  998989502,
  3765401048,
  2244026483,
  1075463327,
  1455516326,
  1322494562,
  910128902,
  469688178,
  1117454909,
  936433444,
  3490320968,
  3675253459,
  1240580251,
  122909385,
  2157517691,
  634681816,
  4142456567,
  3825094682,
  3061402683,
  2540495037,
  79693498,
  3249098678,
  1084186820,
  1583128258,
  426386531,
  1761308591,
  1047286709,
  322548459,
  995290223,
  1845252383,
  2603652396,
  3431023940,
  2942221577,
  3202600964,
  3727903485,
  1712269319,
  422464435,
  3234572375,
  1170764815,
  3523960633,
  3117677531,
  1434042557,
  442511882,
  3600875718,
  1076654713,
  1738483198,
  4213154764,
  2393238008,
  3677496056,
  1014306527,
  4251020053,
  793779912,
  2902807211,
  842905082,
  4246964064,
  1395751752,
  1040244610,
  2656851899,
  3396308128,
  445077038,
  3742853595,
  3577915638,
  679411651,
  2892444358,
  2354009459,
  1767581616,
  3150600392,
  3791627101,
  3102740896,
  284835224,
  4246832056,
  1258075500,
  768725851,
  2589189241,
  3069724005,
  3532540348,
  1274779536,
  3789419226,
  2764799539,
  1660621633,
  3471099624,
  4011903706,
  913787905,
  3497959166,
  737222580,
  2514213453,
  2928710040,
  3937242737,
  1804850592,
  3499020752,
  2949064160,
  2386320175,
  2390070455,
  2415321851,
  4061277028,
  2290661394,
  2416832540,
  1336762016,
  1754252060,
  3520065937,
  3014181293,
  791618072,
  3188594551,
  3933548030,
  2332172193,
  3852520463,
  3043980520,
  413987798,
  3465142937,
  3030929376,
  4245938359,
  2093235073,
  3534596313,
  375366246,
  2157278981,
  2479649556,
  555357303,
  3870105701,
  2008414854,
  3344188149,
  4221384143,
  3956125452,
  2067696032,
  3594591187,
  2921233993,
  2428461,
  544322398,
  577241275,
  1471733935,
  610547355,
  4027169054,
  1432588573,
  1507829418,
  2025931657,
  3646575487,
  545086370,
  48609733,
  2200306550,
  1653985193,
  298326376,
  1316178497,
  3007786442,
  2064951626,
  458293330,
  2589141269,
  3591329599,
  3164325604,
  727753846,
  2179363840,
  146436021,
  1461446943,
  4069977195,
  705550613,
  3059967265,
  3887724982,
  4281599278,
  3313849956,
  1404054877,
  2845806497,
  146425753,
  1854211946,
  1266315497,
  3048417604,
  3681880366,
  3289982499,
  290971e4,
  1235738493,
  2632868024,
  2414719590,
  3970600049,
  1771706367,
  1449415276,
  3266420449,
  422970021,
  1963543593,
  2690192192,
  3826793022,
  1062508698,
  1531092325,
  1804592342,
  2583117782,
  2714934279,
  4024971509,
  1294809318,
  4028980673,
  1289560198,
  2221992742,
  1669523910,
  35572830,
  157838143,
  1052438473,
  1016535060,
  1802137761,
  1753167236,
  1386275462,
  3080475397,
  2857371447,
  1040679964,
  2145300060,
  2390574316,
  1461121720,
  2956646967,
  4031777805,
  4028374788,
  33600511,
  2920084762,
  1018524850,
  629373528,
  3691585981,
  3515945977,
  2091462646,
  2486323059,
  586499841,
  988145025,
  935516892,
  3367335476,
  2599673255,
  2839830854,
  265290510,
  3972581182,
  2759138881,
  3795373465,
  1005194799,
  847297441,
  406762289,
  1314163512,
  1332590856,
  1866599683,
  4127851711,
  750260880,
  613907577,
  1450815602,
  3165620655,
  3734664991,
  3650291728,
  3012275730,
  3704569646,
  1427272223,
  778793252,
  1343938022,
  2676280711,
  2052605720,
  1946737175,
  3164576444,
  3914038668,
  3967478842,
  3682934266,
  1661551462,
  3294938066,
  4011595847,
  840292616,
  3712170807,
  616741398,
  312560963,
  711312465,
  1351876610,
  322626781,
  1910503582,
  271666773,
  2175563734,
  1594956187,
  70604529,
  3617834859,
  1007753275,
  1495573769,
  4069517037,
  2549218298,
  2663038764,
  504708206,
  2263041392,
  3941167025,
  2249088522,
  1514023603,
  1998579484,
  1312622330,
  694541497,
  2582060303,
  2151582166,
  1382467621,
  776784248,
  2618340202,
  3323268794,
  2497899128,
  2784771155,
  503983604,
  4076293799,
  907881277,
  423175695,
  432175456,
  1378068232,
  4145222326,
  3954048622,
  3938656102,
  3820766613,
  2793130115,
  2977904593,
  26017576,
  3274890735,
  3194772133,
  1700274565,
  1756076034,
  4006520079,
  3677328699,
  720338349,
  1533947780,
  354530856,
  688349552,
  3973924725,
  1637815568,
  332179504,
  3949051286,
  53804574,
  2852348879,
  3044236432,
  1282449977,
  3583942155,
  3416972820,
  4006381244,
  1617046695,
  2628476075,
  3002303598,
  1686838959,
  431878346,
  2686675385,
  1700445008,
  1080580658,
  1009431731,
  832498133,
  3223435511,
  2605976345,
  2271191193,
  2516031870,
  1648197032,
  4164389018,
  2548247927,
  300782431,
  375919233,
  238389289,
  3353747414,
  2531188641,
  2019080857,
  1475708069,
  455242339,
  2609103871,
  448939670,
  3451063019,
  1395535956,
  2413381860,
  1841049896,
  1491858159,
  885456874,
  4264095073,
  4001119347,
  1565136089,
  3898914787,
  1108368660,
  540939232,
  1173283510,
  2745871338,
  3681308437,
  4207628240,
  3343053890,
  4016749493,
  1699691293,
  1103962373,
  3625875870,
  2256883143,
  3830138730,
  1031889488,
  3479347698,
  1535977030,
  4236805024,
  3251091107,
  2132092099,
  1774941330,
  1199868427,
  1452454533,
  157007616,
  2904115357,
  342012276,
  595725824,
  1480756522,
  206960106,
  497939518,
  591360097,
  863170706,
  2375253569,
  3596610801,
  1814182875,
  2094937945,
  3421402208,
  1082520231,
  3463918190,
  2785509508,
  435703966,
  3908032597,
  1641649973,
  2842273706,
  3305899714,
  1510255612,
  2148256476,
  2655287854,
  3276092548,
  4258621189,
  236887753,
  3681803219,
  274041037,
  1734335097,
  3815195456,
  3317970021,
  1899903192,
  1026095262,
  4050517792,
  356393447,
  2410691914,
  3873677099,
  3682840055,
  3913112168,
  2491498743,
  4132185628,
  2489919796,
  1091903735,
  1979897079,
  3170134830,
  3567386728,
  3557303409,
  857797738,
  1136121015,
  1342202287,
  507115054,
  2535736646,
  337727348,
  3213592640,
  1301675037,
  2528481711,
  1895095763,
  1721773893,
  3216771564,
  62756741,
  2142006736,
  835421444,
  2531993523,
  1442658625,
  3659876326,
  2882144922,
  676362277,
  1392781812,
  170690266,
  3921047035,
  1759253602,
  3611846912,
  1745797284,
  664899054,
  1329594018,
  3901205900,
  3045908486,
  2062866102,
  2865634940,
  3543621612,
  3464012697,
  1080764994,
  553557557,
  3656615353,
  3996768171,
  991055499,
  499776247,
  1265440854,
  648242737,
  3940784050,
  980351604,
  3713745714,
  1749149687,
  3396870395,
  4211799374,
  3640570775,
  1161844396,
  3125318951,
  1431517754,
  545492359,
  4268468663,
  3499529547,
  1437099964,
  2702547544,
  3433638243,
  2581715763,
  2787789398,
  1060185593,
  1593081372,
  2418618748,
  4260947970,
  69676912,
  2159744348,
  86519011,
  2512459080,
  3838209314,
  1220612927,
  3339683548,
  133810670,
  1090789135,
  1078426020,
  1569222167,
  845107691,
  3583754449,
  4072456591,
  1091646820,
  628848692,
  1613405280,
  3757631651,
  526609435,
  236106946,
  48312990,
  2942717905,
  3402727701,
  1797494240,
  859738849,
  992217954,
  4005476642,
  2243076622,
  3870952857,
  3732016268,
  765654824,
  3490871365,
  2511836413,
  1685915746,
  3888969200,
  1414112111,
  2273134842,
  3281911079,
  4080962846,
  172450625,
  2569994100,
  980381355,
  4109958455,
  2819808352,
  2716589560,
  2568741196,
  3681446669,
  3329971472,
  1835478071,
  660984891,
  3704678404,
  4045999559,
  3422617507,
  3040415634,
  1762651403,
  1719377915,
  3470491036,
  2693910283,
  3642056355,
  3138596744,
  1364962596,
  2073328063,
  1983633131,
  926494387,
  3423689081,
  2150032023,
  4096667949,
  1749200295,
  3328846651,
  309677260,
  2016342300,
  1779581495,
  3079819751,
  111262694,
  1274766160,
  443224088,
  298511866,
  1025883608,
  3806446537,
  1145181785,
  168956806,
  3641502830,
  3584813610,
  1689216846,
  3666258015,
  3200248200,
  1692713982,
  2646376535,
  4042768518,
  1618508792,
  1610833997,
  3523052358,
  4130873264,
  2001055236,
  3610705100,
  2202168115,
  4028541809,
  2961195399,
  1006657119,
  2006996926,
  3186142756,
  1430667929,
  3210227297,
  1314452623,
  4074634658,
  4101304120,
  2273951170,
  1399257539,
  3367210612,
  3027628629,
  1190975929,
  2062231137,
  2333990788,
  2221543033,
  2438960610,
  1181637006,
  548689776,
  2362791313,
  3372408396,
  3104550113,
  3145860560,
  296247880,
  1970579870,
  3078560182,
  3769228297,
  1714227617,
  3291629107,
  3898220290,
  166772364,
  1251581989,
  493813264,
  448347421,
  195405023,
  2709975567,
  677966185,
  3703036547,
  1463355134,
  2715995803,
  1338867538,
  1343315457,
  2802222074,
  2684532164,
  233230375,
  2599980071,
  2000651841,
  3277868038,
  1638401717,
  4028070440,
  3237316320,
  6314154,
  819756386,
  300326615,
  590932579,
  1405279636,
  3267499572,
  3150704214,
  2428286686,
  3959192993,
  3461946742,
  1862657033,
  1266418056,
  963775037,
  2089974820,
  2263052895,
  1917689273,
  448879540,
  3550394620,
  3981727096,
  150775221,
  3627908307,
  1303187396,
  508620638,
  2975983352,
  2726630617,
  1817252668,
  1876281319,
  1457606340,
  908771278,
  3720792119,
  3617206836,
  2455994898,
  1729034894,
  1080033504,
  976866871,
  3556439503,
  2881648439,
  1522871579,
  1555064734,
  1336096578,
  3548522304,
  2579274686,
  3574697629,
  3205460757,
  3593280638,
  3338716283,
  3079412587,
  564236357,
  2993598910,
  1781952180,
  1464380207,
  3163844217,
  3332601554,
  1699332808,
  1393555694,
  1183702653,
  3581086237,
  1288719814,
  691649499,
  2847557200,
  2895455976,
  3193889540,
  2717570544,
  1781354906,
  1676643554,
  2592534050,
  3230253752,
  1126444790,
  2770207658,
  2633158820,
  2210423226,
  2615765581,
  2414155088,
  3127139286,
  673620729,
  2805611233,
  1269405062,
  4015350505,
  3341807571,
  4149409754,
  1057255273,
  2012875353,
  2162469141,
  2276492801,
  2601117357,
  993977747,
  3918593370,
  2654263191,
  753973209,
  36408145,
  2530585658,
  25011837,
  3520020182,
  2088578344,
  530523599,
  2918365339,
  1524020338,
  1518925132,
  3760827505,
  3759777254,
  1202760957,
  3985898139,
  3906192525,
  674977740,
  4174734889,
  2031300136,
  2019492241,
  3983892565,
  4153806404,
  3822280332,
  352677332,
  2297720250,
  60907813,
  90501309,
  3286998549,
  1016092578,
  2535922412,
  2839152426,
  457141659,
  509813237,
  4120667899,
  652014361,
  1966332200,
  2975202805,
  55981186,
  2327461051,
  676427537,
  3255491064,
  2882294119,
  3433927263,
  1307055953,
  942726286,
  933058658,
  2468411793,
  3933900994,
  4215176142,
  1361170020,
  2001714738,
  2830558078,
  3274259782,
  1222529897,
  1679025792,
  2729314320,
  3714953764,
  1770335741,
  151462246,
  3013232138,
  1682292957,
  1483529935,
  471910574,
  1539241949,
  458788160,
  3436315007,
  1807016891,
  3718408830,
  978976581,
  1043663428,
  3165965781,
  1927990952,
  4200891579,
  2372276910,
  3208408903,
  3533431907,
  1412390302,
  2931980059,
  4132332400,
  1947078029,
  3881505623,
  4168226417,
  2941484381,
  1077988104,
  1320477388,
  886195818,
  18198404,
  3786409e3,
  2509781533,
  112762804,
  3463356488,
  1866414978,
  891333506,
  18488651,
  661792760,
  1628790961,
  3885187036,
  3141171499,
  876946877,
  2693282273,
  1372485963,
  791857591,
  2686433993,
  3759982718,
  3167212022,
  3472953795,
  2716379847,
  445679433,
  3561995674,
  3504004811,
  3574258232,
  54117162,
  3331405415,
  2381918588,
  3769707343,
  4154350007,
  1140177722,
  4074052095,
  668550556,
  3214352940,
  367459370,
  261225585,
  2610173221,
  4209349473,
  3468074219,
  3265815641,
  314222801,
  3066103646,
  3808782860,
  282218597,
  3406013506,
  3773591054,
  379116347,
  1285071038,
  846784868,
  2669647154,
  3771962079,
  3550491691,
  2305946142,
  453669953,
  1268987020,
  3317592352,
  3279303384,
  3744833421,
  2610507566,
  3859509063,
  266596637,
  3847019092,
  517658769,
  3462560207,
  3443424879,
  370717030,
  4247526661,
  2224018117,
  4143653529,
  4112773975,
  2788324899,
  2477274417,
  1456262402,
  2901442914,
  1517677493,
  1846949527,
  2295493580,
  3734397586,
  2176403920,
  1280348187,
  1908823572,
  3871786941,
  846861322,
  1172426758,
  3287448474,
  3383383037,
  1655181056,
  3139813346,
  901632758,
  1897031941,
  2986607138,
  3066810236,
  3447102507,
  1393639104,
  373351379,
  950779232,
  625454576,
  3124240540,
  4148612726,
  2007998917,
  544563296,
  2244738638,
  2330496472,
  2058025392,
  1291430526,
  424198748,
  50039436,
  29584100,
  3605783033,
  2429876329,
  2791104160,
  1057563949,
  3255363231,
  3075367218,
  3463963227,
  1469046755,
  985887462
];
var C_ORIG = [
  1332899944,
  1700884034,
  1701343084,
  1684370003,
  1668446532,
  1869963892
];
function _encipher(lr, off, P, S) {
  var n, l = lr[off], r = lr[off + 1];
  l ^= P[0];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[1];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[2];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[3];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[4];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[5];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[6];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[7];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[8];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[9];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[10];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[11];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[12];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[13];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[14];
  n = S[l >>> 24];
  n += S[256 | l >> 16 & 255];
  n ^= S[512 | l >> 8 & 255];
  n += S[768 | l & 255];
  r ^= n ^ P[15];
  n = S[r >>> 24];
  n += S[256 | r >> 16 & 255];
  n ^= S[512 | r >> 8 & 255];
  n += S[768 | r & 255];
  l ^= n ^ P[16];
  lr[off] = r ^ P[BLOWFISH_NUM_ROUNDS + 1];
  lr[off + 1] = l;
  return lr;
}
function _streamtoword(data, offp) {
  for (var i = 0, word = 0; i < 4; ++i)
    word = word << 8 | data[offp] & 255, offp = (offp + 1) % data.length;
  return { key: word, offp };
}
function _key(key, P, S) {
  var offset = 0, lr = [0, 0], plen = P.length, slen = S.length, sw;
  for (var i = 0; i < plen; i++)
    sw = _streamtoword(key, offset), offset = sw.offp, P[i] = P[i] ^ sw.key;
  for (i = 0; i < plen; i += 2)
    lr = _encipher(lr, 0, P, S), P[i] = lr[0], P[i + 1] = lr[1];
  for (i = 0; i < slen; i += 2)
    lr = _encipher(lr, 0, P, S), S[i] = lr[0], S[i + 1] = lr[1];
}
function _ekskey(data, key, P, S) {
  var offp = 0, lr = [0, 0], plen = P.length, slen = S.length, sw;
  for (var i = 0; i < plen; i++)
    sw = _streamtoword(key, offp), offp = sw.offp, P[i] = P[i] ^ sw.key;
  offp = 0;
  for (i = 0; i < plen; i += 2)
    sw = _streamtoword(data, offp), offp = sw.offp, lr[0] ^= sw.key, sw = _streamtoword(data, offp), offp = sw.offp, lr[1] ^= sw.key, lr = _encipher(lr, 0, P, S), P[i] = lr[0], P[i + 1] = lr[1];
  for (i = 0; i < slen; i += 2)
    sw = _streamtoword(data, offp), offp = sw.offp, lr[0] ^= sw.key, sw = _streamtoword(data, offp), offp = sw.offp, lr[1] ^= sw.key, lr = _encipher(lr, 0, P, S), S[i] = lr[0], S[i + 1] = lr[1];
}
function _crypt(b, salt, rounds, callback, progressCallback) {
  var cdata = C_ORIG.slice(), clen = cdata.length, err;
  if (rounds < 4 || rounds > 31) {
    err = Error("Illegal number of rounds (4-31): " + rounds);
    if (callback) {
      nextTick(callback.bind(this, err));
      return;
    } else throw err;
  }
  if (salt.length !== BCRYPT_SALT_LEN) {
    err = Error(
      "Illegal salt length: " + salt.length + " != " + BCRYPT_SALT_LEN
    );
    if (callback) {
      nextTick(callback.bind(this, err));
      return;
    } else throw err;
  }
  rounds = 1 << rounds >>> 0;
  var P, S, i = 0, j;
  if (typeof Int32Array === "function") {
    P = new Int32Array(P_ORIG);
    S = new Int32Array(S_ORIG);
  } else {
    P = P_ORIG.slice();
    S = S_ORIG.slice();
  }
  _ekskey(salt, b, P, S);
  function next() {
    if (progressCallback) progressCallback(i / rounds);
    if (i < rounds) {
      var start = Date.now();
      for (; i < rounds; ) {
        i = i + 1;
        _key(b, P, S);
        _key(salt, P, S);
        if (Date.now() - start > MAX_EXECUTION_TIME) break;
      }
    } else {
      for (i = 0; i < 64; i++)
        for (j = 0; j < clen >> 1; j++) _encipher(cdata, j << 1, P, S);
      var ret = [];
      for (i = 0; i < clen; i++)
        ret.push((cdata[i] >> 24 & 255) >>> 0), ret.push((cdata[i] >> 16 & 255) >>> 0), ret.push((cdata[i] >> 8 & 255) >>> 0), ret.push((cdata[i] & 255) >>> 0);
      if (callback) {
        callback(null, ret);
        return;
      } else return ret;
    }
    if (callback) nextTick(next);
  }
  if (typeof callback !== "undefined") {
    next();
  } else {
    var res;
    while (true) if (typeof (res = next()) !== "undefined") return res || [];
  }
}
function _hash(password, salt, callback, progressCallback) {
  var err;
  if (typeof password !== "string" || typeof salt !== "string") {
    err = Error("Invalid string / salt: Not a string");
    if (callback) {
      nextTick(callback.bind(this, err));
      return;
    } else throw err;
  }
  var minor, offset;
  if (salt.charAt(0) !== "$" || salt.charAt(1) !== "2") {
    err = Error("Invalid salt version: " + salt.substring(0, 2));
    if (callback) {
      nextTick(callback.bind(this, err));
      return;
    } else throw err;
  }
  if (salt.charAt(2) === "$") minor = String.fromCharCode(0), offset = 3;
  else {
    minor = salt.charAt(2);
    if (minor !== "a" && minor !== "b" && minor !== "y" || salt.charAt(3) !== "$") {
      err = Error("Invalid salt revision: " + salt.substring(2, 4));
      if (callback) {
        nextTick(callback.bind(this, err));
        return;
      } else throw err;
    }
    offset = 4;
  }
  if (salt.charAt(offset + 2) > "$") {
    err = Error("Missing salt rounds");
    if (callback) {
      nextTick(callback.bind(this, err));
      return;
    } else throw err;
  }
  var r1 = parseInt(salt.substring(offset, offset + 1), 10) * 10, r2 = parseInt(salt.substring(offset + 1, offset + 2), 10), rounds = r1 + r2, real_salt = salt.substring(offset + 3, offset + 25);
  password += minor >= "a" ? "\0" : "";
  var passwordb = utf8Array(password), saltb = base64_decode(real_salt, BCRYPT_SALT_LEN);
  function finish(bytes) {
    var res = [];
    res.push("$2");
    if (minor >= "a") res.push(minor);
    res.push("$");
    if (rounds < 10) res.push("0");
    res.push(rounds.toString());
    res.push("$");
    res.push(base64_encode(saltb, saltb.length));
    res.push(base64_encode(bytes, C_ORIG.length * 4 - 1));
    return res.join("");
  }
  if (typeof callback == "undefined")
    return finish(_crypt(passwordb, saltb, rounds));
  else {
    _crypt(
      passwordb,
      saltb,
      rounds,
      function(err2, bytes) {
        if (err2) callback(err2, null);
        else callback(null, finish(bytes));
      },
      progressCallback
    );
  }
}
function encodeBase64(bytes, length) {
  return base64_encode(bytes, length);
}
function decodeBase64(string, length) {
  return base64_decode(string, length);
}
const bcrypt = {
  setRandomFallback,
  genSaltSync,
  genSalt,
  hashSync,
  hash,
  compareSync,
  compare,
  getRounds,
  getSalt,
  truncates,
  encodeBase64,
  decodeBase64
};
const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_MS = 5 * 6e4;
const LOCKOUT_MS = 15 * 6e4;
function readThrottle(db2) {
  const row = db2.prepare(`SELECT failed_count, window_started_at, locked_until FROM pin_throttle WHERE id = 1`).get();
  return row ?? { failed_count: 0, window_started_at: null, locked_until: null };
}
function writeThrottle(db2, next) {
  db2.prepare(
    `INSERT INTO pin_throttle (id, failed_count, window_started_at, locked_until)
     VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       failed_count = excluded.failed_count,
       window_started_at = excluded.window_started_at,
       locked_until = excluded.locked_until`
  ).run(next.failed_count, next.window_started_at, next.locked_until);
}
function throttleRemaining(db2) {
  const { locked_until } = readThrottle(db2);
  if (!locked_until) return null;
  const ms = new Date(locked_until).getTime() - Date.now();
  if (ms <= 0) return null;
  const minutes = Math.ceil(ms / 6e4);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
function recordWrongAttempt(db2) {
  const now = Date.now();
  const throttle = readThrottle(db2);
  const windowStart = throttle.window_started_at ? new Date(throttle.window_started_at).getTime() : null;
  const withinWindow = windowStart !== null && now - windowStart < WINDOW_MS;
  const failedCount = (withinWindow ? throttle.failed_count : 0) + 1;
  const lock = failedCount >= MAX_FAILED_ATTEMPTS;
  writeThrottle(db2, {
    failed_count: lock ? 0 : failedCount,
    window_started_at: lock ? null : new Date(withinWindow ? windowStart : now).toISOString(),
    locked_until: lock ? new Date(now + LOCKOUT_MS).toISOString() : throttle.locked_until
  });
}
function clearThrottle(db2) {
  writeThrottle(db2, { failed_count: 0, window_started_at: null, locked_until: null });
}
function verifyPinLocally(pin, branchId2, database) {
  const db2 = getDatabase();
  const locked = throttleRemaining(db2);
  if (locked) {
    throw new Error(`Too many attempts on this terminal. Try again in ${locked}.`);
  }
  const candidates = db2.prepare(
    `SELECT * FROM staff WHERE pin_hash IS NOT NULL AND (branch_id IS NULL OR branch_id = ?)`
  ).all(branchId2);
  const matches = [];
  for (const candidate of candidates) {
    if (!bcrypt.compareSync(pin, candidate.pin_hash)) continue;
    matches.push(candidate);
  }
  if (matches.length > 1) {
    throw new Error(
      "More than one person at this branch uses that PIN. Ask a manager to change it."
    );
  }
  const [match] = matches;
  if (!match) {
    recordWrongAttempt(db2);
    throw new Error("Incorrect PIN");
  }
  clearThrottle(db2);
  return {
    id: match.id,
    name: match.name,
    roleName: match.role_name,
    permissions: JSON.parse(match.permissions),
    // The TERMINAL's branch, not the matched user's own `branch_id` column —
    // that column is null for a tenant-wide user (an owner, an area manager),
    // and the online path returns `dto.branchId` for exactly this reason: a
    // session is always pinned to the till it was opened at, whatever the
    // signed-in user's own default scope otherwise is.
    branchId: branchId2,
    maxDiscountPercent: match.max_discount_percent
  };
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
  return { ...response.user, maxDiscountPercent: response.user.maxDiscountPercent ?? "0" };
}
async function verifyOverride(pin, permission, reason) {
  return authorized("/auth/verify-override", { pin, permission, ...reason ? { reason } : {} });
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
  const entityByLocalId = new Map(items.map((item) => [item.localId, item.entity]));
  for (const result of response.results) {
    settleOutboxItem({ ...result, entity: entityByLocalId.get(result.localId) });
  }
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
    setState("allow_negative_stock", response.allowNegativeStock ? "1" : "0");
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
  const table = {
    product: "variants",
    customer: "customers",
    user: "staff",
    category: null,
    unit: null
  }[entity];
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
    case "user":
      db2.prepare(
        `INSERT INTO staff
           (id, branch_id, name, role_name, permissions, pin_hash, max_discount_percent, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           branch_id = excluded.branch_id, name = excluded.name,
           role_name = excluded.role_name, permissions = excluded.permissions,
           pin_hash = excluded.pin_hash, max_discount_percent = excluded.max_discount_percent,
           updated_at = datetime('now')`
      ).run(
        id,
        text(record.branchId),
        text(record.name),
        text(record.roleName),
        JSON.stringify(record.permissions ?? []),
        text(record.pinHash),
        text(record.maxDiscountPercent) ?? "0"
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
  ipcMain.handle("customers:payment", (_event, input) => {
    const payment = recordAccountPayment(input);
    syncNow();
    return payment;
  });
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
  ipcMain.handle("quotations:save", (_event, draft) => {
    const receipt = saveQuotation(draft);
    syncNow();
    return receipt;
  });
  ipcMain.handle("quotations:list", () => listQuotations());
  ipcMain.handle("auth:pin-login", async (_event, pin) => {
    const pinValue = String(pin ?? "");
    try {
      const user = await loginWithPin(pinValue);
      syncNow();
      return user;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      const branch = getState("branch_id");
      if (!branch) throw err;
      const user = verifyPinLocally(pinValue, branch);
      syncNow();
      return user;
    }
  });
  ipcMain.handle(
    "auth:manager-override",
    async (_event, pin, requiredPermission, reason) => {
      try {
        const result = await verifyOverride(
          String(pin ?? ""),
          String(requiredPermission ?? ""),
          reason ? String(reason) : void 0
        );
        return { managerName: result.approvedBy.name, grant: result.grant };
      } catch (err) {
        if (err instanceof ApiError) throw err;
        throw new Error(
          "A manager's approval needs the network. Reconnect, or handle this sale once back online."
        );
      }
    }
  );
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
  ipcMain.handle("outbox:attention-items", () => outboxAttentionItems());
  ipcMain.handle("outbox:retry", (_event, localId) => {
    retryOutboxItem(String(localId ?? ""));
    syncNow();
  });
  ipcMain.handle("outbox:discard", (_event, localId) => {
    discardOutboxItem(String(localId ?? ""));
  });
  ipcMain.handle("outbox:acknowledge-warning", (_event, localId) => {
    acknowledgeWarning(String(localId ?? ""));
  });
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
    try {
      openDatabase();
    } catch (error) {
      electron.dialog.showErrorBox(
        "DevsFleet POS cannot start",
        error instanceof Error ? error.message : String(error)
      );
      electron.app.quit();
      return;
    }
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
