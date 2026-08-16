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
const MIGRATIONS: Array<{ version: number; sql: string }> = [
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
    `,
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
];

function migrate(database: Database.Database): void {
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
      database.exec(migration.sql);
      database.pragma(`user_version = ${migration.version}`);
    })();
  }
}
