"use strict";const r=require("electron"),u=require("node:url"),a=require("node:path"),N=require("better-sqlite3");var i=typeof document<"u"?document.currentScript:null;let n=null;function L(){if(n)return n;const e=a.join(r.app.getPath("userData"),process.env.POS_DB_FILE??"devsfleet-pos.sqlite");return n=new N(e),n.pragma("journal_mode = WAL"),n.pragma("synchronous = FULL"),n.pragma("foreign_keys = ON"),n.pragma("busy_timeout = 5000"),p(n),n}function _(){n&&(n.pragma("wal_checkpoint(TRUNCATE)"),n.close(),n=null)}const d=[{version:1,sql:`
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
    `},{version:2,sql:`
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
    `}];function p(e){const T=e.pragma("user_version",{simple:!0}),o=d.at(-1)?.version??0;if(T>o)throw new Error(`Local database is at version ${T} but this build expects ${o}. Reinstall the newer POS version — do not delete the database, it may contain unsynced sales.`);for(const s of d)s.version<=T||e.transaction(()=>{e.exec(s.sql),e.pragma(`user_version = ${s.version}`)})()}function h(e){e.handle("printer:list",async()=>[]),e.handle("printer:receipt",async(T,o,s)=>{throw new Error("Receipt printing lands in Phase 3")}),e.handle("printer:test",async(T,o)=>{throw new Error("Test printing lands in Phase 3")}),e.handle("cash-drawer:open",async(T,o)=>{throw new Error("Cash drawer control lands in Phase 3")}),e.handle("device:info",async()=>({deviceId:null,hardwareId:"",version:process.env.npm_package_version??"0.1.0"})),e.handle("device:activate",async(T,o,s)=>{throw new Error("Device activation lands in Phase 3")})}const E={online:!1,lastPullAt:null,lastPushAt:null,lastCheckpoint:null,pendingPushCount:0,failedPushCount:0,syncing:!1,lastError:null};function X(e,T){e.handle("sync:status",()=>E),e.handle("sync:now",async()=>E)}const c=a.dirname(u.fileURLToPath(typeof document>"u"?require("url").pathToFileURL(__filename).href:i&&i.tagName.toUpperCase()==="SCRIPT"&&i.src||new URL("main.js",document.baseURI).href));let t=null;function l(){t=new r.BrowserWindow({width:1440,height:900,minWidth:1024,minHeight:720,show:!1,backgroundColor:"#0b0d10",title:"DevsFleet POS",webPreferences:{preload:a.join(c,"preload.js"),contextIsolation:!0,nodeIntegration:!1,sandbox:!1,webSecurity:!0,spellcheck:!1}}),t.once("ready-to-show",()=>t?.show());const e=process.env.VITE_DEV_SERVER_URL;e?(t.loadURL(e),t.webContents.openDevTools({mode:"detach"})):t.loadFile(a.join(c,"../dist/index.html")),t.webContents.setWindowOpenHandler(()=>({action:"deny"})),t.webContents.on("will-navigate",(T,o)=>{o!==e&&T.preventDefault()}),t.on("closed",()=>{t=null})}r.app.requestSingleInstanceLock()?(r.app.on("second-instance",()=>{t&&(t.isMinimized()&&t.restore(),t.focus())}),r.app.whenReady().then(()=>{L(),X(r.ipcMain),h(r.ipcMain),l(),r.app.on("activate",()=>{r.BrowserWindow.getAllWindows().length===0&&l()})})):r.app.quit();r.app.on("window-all-closed",()=>{process.platform!=="darwin"&&r.app.quit()});r.app.on("before-quit",()=>{_()});
