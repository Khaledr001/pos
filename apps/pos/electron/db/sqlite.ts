import Database from "better-sqlite3";
import { app } from "electron";
import { join } from "node:path";

/**
 * Local SQLite database.
 *
 * Two responsibilities that must not be confused:
 *
 *   MIRROR  — products, prices, customers, stock. Pulled from the server,
 *             read-only on the terminal. Safe to delete and re-pull.
 *   OUTBOX  — sales, payments, cash movements created here. Authoritative until
 *             the server acknowledges them. Losing this file loses a day's
 *             takings, so it is never cleared on a schema mismatch — the app
 *             refuses to start instead.
 *
 * The distinction drives the migration policy at the bottom of this file.
 */

let db: Database.Database | null = null;

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
    stock: "100",
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
    stock: "100",
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
    stock: "100",
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
    stock: "40",
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
    stock: "12",
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
    stock: "50",
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
    stock: "150",
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
    stock: "30",
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
    stock: "25",
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
    stock: "80",
  },
];

const DEFAULT_CUSTOMERS = [
  {
    id: "c1",
    name: "Al Noor Contracting",
    company: "Al Noor Contracting LLC",
    phone: "+971501234567",
    trn: "100123456700003",
    creditLimit: "5000.00",
    creditBalance: "1240.00",
  },
  {
    id: "c2",
    name: "Walk-in customer",
    company: null,
    phone: null,
    trn: null,
    creditLimit: "0",
    creditBalance: "0",
  },
];

function seedInitialCatalog(database: Database.Database): void {
  try {
    const row = database.prepare("SELECT count(*) as count FROM variants").get() as { count?: number } | undefined;
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
          item.taxRate,
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

export function openDatabase(): Database.Database {
  if (db) return db;

  const file = join(app.getPath("userData"), process.env.POS_DB_FILE ?? "devsfleet-pos.sqlite");
  db = new Database(file);

  /**
   * WAL: readers do not block the writer. The UI queries the catalogue on every
   * keystroke of a product search while the sync engine writes pulled rows;
   * under the default rollback journal those contend and the search stutters.
   */
  db.pragma("journal_mode = WAL");

  /**
   * FULL, not NORMAL. NORMAL can lose the last transactions on power loss, and
   * on a shop counter power loss is a Tuesday. A sale that printed a receipt
   * and then vanished is unrecoverable; the fsync cost is worth it.
   */
  db.pragma("synchronous = FULL");

  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  migrate(db);
  seedInitialCatalog(db);
  return db;
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error("SQLite is not open. Call openDatabase() first.");
  return db;
}

export function closeDatabase(): void {
  if (!db) return;
  // Fold the WAL back into the main file so the next boot starts clean.
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.close();
  db = null;
}

// -----------------------------------------------------------------------------
// Schema
// -----------------------------------------------------------------------------

/**
 * Migrations are ordered, forward-only, and tracked with `user_version`.
 *
 * Append a new entry; never edit a shipped one. A terminal may be three
 * versions behind after a fortnight offline, and it has to walk the whole path.
 */
/**
 * Almost every migration is a plain SQL string. `up` exists only for the rare
 * step that cannot be idempotent as pure SQL — SQLite has no
 * `ADD COLUMN IF NOT EXISTS` — and must check the schema before acting. See
 * version 4 below for why one exists.
 */
const MIGRATIONS: Array<
  { version: number } & ({ sql: string; up?: never } | { sql?: never; up: (database: Database.Database) => void })
> = [
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
    `,
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
    `,
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
    `,
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
      const prices = database.pragma("table_info(variant_prices)") as Array<{ name: string }>;
      if (!prices.some((c) => c.name === "is_default")) {
        database.exec(
          "ALTER TABLE variant_prices ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;",
        );
      }

      // The sale line references the variant it sold. Snapshotted alongside
      // it: name, sku and tax as they were at that moment, because a receipt
      // is a statement about a moment and must not be rewritten by a later
      // edit.
      const saleItems = database.pragma("table_info(local_sale_items)") as Array<{ name: string }>;
      if (
        saleItems.some((c) => c.name === "product_id") &&
        !saleItems.some((c) => c.name === "variant_id")
      ) {
        database.exec("ALTER TABLE local_sale_items RENAME COLUMN product_id TO variant_id;");
      }
      if (!saleItems.some((c) => c.name === "unit_abbr")) {
        database.exec("ALTER TABLE local_sale_items ADD COLUMN unit_abbr TEXT;");
      }
    },
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
    `,
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
    `,
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
    `,
  },
  {
    version: 8,
    sql: `
      -- version 6 renamed client_id -> local_id everywhere else in the outbox
      -- family; this table was added in version 7, after that rename, and
      -- never got it — it still stands out as the one table naming the same
      -- idempotency key differently.
      ALTER TABLE local_customer_payments RENAME COLUMN client_id TO local_id;
    `,
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
    `,
  },
  {
    version: 10,
    sql: `
      -- A return recorded offline, against a sale THIS terminal rang up.
      --
      -- Only same-till originals are supported: \`sales:find\` has no path to a
      -- sale from another terminal until both have synced (see Returns.tsx), so
      -- \`original_sale_local_id\` always resolves against this till's own
      -- \`local_sales\`. Stored positive, unlike the server's own linked-negative-
      -- sale row (D15) — this mirror is a memory of "a return happened", not a
      -- ledger, so there is no sign convention to preserve.
      CREATE TABLE IF NOT EXISTS local_returns (
        local_id               TEXT PRIMARY KEY,
        server_id              TEXT,
        return_number          TEXT,
        original_sale_local_id TEXT NOT NULL REFERENCES local_sales(local_id),
        customer_id            TEXT,
        cash_session_id        TEXT,
        subtotal               TEXT NOT NULL,
        tax_amount             TEXT NOT NULL,
        discount_amount        TEXT NOT NULL,
        total                  TEXT NOT NULL,
        reason                 TEXT,
        occurred_at            TEXT NOT NULL,
        synced_at              TEXT
      );

      -- \`original_line_index\` is the ORIGINAL sale's line position
      -- (\`local_sale_items.sort_order\`) — the only stable way to name one of
      -- its lines, since neither end assigns a line its own id until the
      -- server does on first sync. The server resolves it back to a real
      -- \`sale_items.id\` by matching \`sort_order\`, sanity-checked against
      -- \`variant_id\`. \`sort_order\` here is this RETURN's own display order,
      -- and can repeat an \`original_line_index\` — the drill kit returned
      -- earlier in this session split one original line into a restocked row
      -- and a scrapped row.
      CREATE TABLE IF NOT EXISTS local_return_items (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        return_local_id     TEXT NOT NULL REFERENCES local_returns(local_id) ON DELETE CASCADE,
        original_line_index INTEGER NOT NULL,
        variant_id          TEXT NOT NULL,
        product_name        TEXT NOT NULL,
        product_sku         TEXT NOT NULL,
        quantity            TEXT NOT NULL,
        unit_price          TEXT NOT NULL,
        disposition         TEXT NOT NULL,
        sort_order          INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    version: 11,
    sql: `
      -- Packagings a variant can be sold in — a box, a carton — pulled so a
      -- unit choice is available with the network unplugged (Stage 3.2).
      -- Mirrors variant_prices' own shape: one row per (variant, packaging),
      -- no tombstone handling needed because the server table carries no
      -- deletedAt either (see catalog.ts) — retiring a packaging flips
      -- is_sellable instead, an ordinary field update.
      CREATE TABLE IF NOT EXISTS variant_units (
        id                TEXT PRIMARY KEY,
        variant_id        TEXT NOT NULL,
        unit_id           TEXT NOT NULL,
        unit_name         TEXT NOT NULL,
        unit_abbr         TEXT NOT NULL,
        -- Base units per pack. Box of 20 -> 20.
        conversion_factor TEXT NOT NULL,
        barcode           TEXT,
        -- NULL = base price x conversion_factor.
        price_override    TEXT,
        is_sellable       INTEGER NOT NULL DEFAULT 1,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_variant_units_variant ON variant_units(variant_id);
    `,
  },
  {
    version: 12,
    sql: `
      -- Which packaging a locally-rung sale line was actually sold in (Stage
      -- 3.3) — quantity/unit_price on the row stay in that SOLD unit, exactly
      -- as sale_items does server-side; conversion_factor is what the offline
      -- stock ceiling and the local_delta decrement scale by to reach base
      -- units. NULL unit_id / '1' factor is the base unit, same as always.
      ALTER TABLE local_sale_items ADD COLUMN unit_id TEXT;
      ALTER TABLE local_sale_items ADD COLUMN unit_conversion_factor TEXT NOT NULL DEFAULT '1';
    `,
  },
  {
    version: 13,
    sql: `
      -- The per-tender breakdown a sale was actually paid with. commitSale
      -- already received this in full (draft.payments) but never wrote it
      -- anywhere — findSale/recentSales have hardcoded payments: [] since
      -- they were built, which a receipt (Stage 4) cannot print "tender"
      -- from. amount is what was TENDERED (e.g. "100" on a 100 note for a
      -- 78 sale), matching PaymentDialog's own figure — change is computed
      -- at read time as sum(amount) - total, the same subtraction the
      -- payment dialog itself does.
      CREATE TABLE IF NOT EXISTS local_sale_payments (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_local_id TEXT NOT NULL REFERENCES local_sales(local_id) ON DELETE CASCADE,
        method        TEXT NOT NULL,
        amount        TEXT NOT NULL,
        reference     TEXT,
        sort_order    INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_local_sale_payments_sale ON local_sale_payments(sale_local_id);

      -- A manual "no sale" drawer open (Stage 4.3) — never a cash_movement,
      -- which is money-shaped (amount NOT NULL, feeds day-close's cash
      -- reconciliation) and has no "just checking the drawer" type. This is
      -- pure audit trail, pushed through the outbox like anything else
      -- created offline; the server writes it straight into audit_log.
      CREATE TABLE IF NOT EXISTS local_drawer_opens (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id    TEXT NOT NULL UNIQUE,
        reason      TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        synced_at   TEXT
      );
    `,
  },
];

export function migrate(database: Database.Database): void {
  const current = database.pragma("user_version", { simple: true }) as number;
  const target = MIGRATIONS.at(-1)?.version ?? 0;

  if (current > target) {
    // The app was downgraded. Refuse rather than guess: the outbox may hold
    // unsynced sales in a shape this build does not understand, and dropping
    // them would destroy takings that exist nowhere else yet.
    throw new Error(
      `Local database is at version ${current} but this build expects ${target}. ` +
        "Reinstall the newer POS version — do not delete the database, it may " +
        "contain unsynced sales.",
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
