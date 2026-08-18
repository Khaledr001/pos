"use strict";const l=require("electron"),Q=require("node:url"),b=require("node:path"),Z=require("better-sqlite3"),O=require("node:crypto"),w=require("node:os");var X=typeof document<"u"?document.currentScript:null;let c=null;function ee(e){try{const t=e.pragma("table_info(variant_prices)");t&&t.length>0&&!t.some(n=>n.name==="is_default")&&e.exec("ALTER TABLE variant_prices ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;")}catch(t){console.warn("Could not check/add is_default on variant_prices:",t)}try{const t=e.pragma("table_info(local_sale_items)");t&&t.length>0&&!t.some(n=>n.name==="unit_abbr")&&e.exec("ALTER TABLE local_sale_items ADD COLUMN unit_abbr TEXT;")}catch(t){console.warn("Could not check/add unit_abbr on local_sale_items:",t)}}const te=[{id:"v1",productId:"p1",sku:"PVC-ELB-001",barcode:"6291000000017",productName:'PVC Elbow 1" 90 Degree',variantName:null,unitAbbr:"pcs",categoryName:"Plumbing",taxRate:"5",sellingPrice:"2.75",minSellingPrice:"2.00",stock:"100"},{id:"v2",productId:"p2",sku:"PVC-ELB-002",barcode:"6291000000024",productName:'PVC Elbow 3/4" 90 Degree',variantName:null,unitAbbr:"pcs",categoryName:"Plumbing",taxRate:"5",sellingPrice:"2.10",minSellingPrice:"1.55",stock:"100"},{id:"v3",productId:"p3",sku:"CBL-25-RED",barcode:"6291000000031",productName:"Electrical Cable 2.5mm Red",variantName:null,unitAbbr:"m",categoryName:"Electrical",taxRate:"5",sellingPrice:"3.50",minSellingPrice:"2.75",stock:"100"},{id:"v4",productId:"p4",sku:"PNT-WHT-4L",barcode:"6291000000048",productName:"Emulsion Paint White 4 Litre",variantName:null,unitAbbr:"ltr",categoryName:"Paint",taxRate:"5",sellingPrice:"48.00",minSellingPrice:"38.00",stock:"40"},{id:"v5",productId:"p5",sku:"TAP-MIX-CHR",barcode:"6291000000055",productName:"Basin Mixer Tap Chrome",variantName:null,unitAbbr:"pcs",categoryName:"Sanitary",taxRate:"5",sellingPrice:"135.00",minSellingPrice:"105.00",stock:"12"},{id:"v6",productId:"p6",sku:"EL-CBL-3CX25",barcode:"6291000000062",productName:"Ducab 3-Core 2.5mm² Flexible Copper Cable",variantName:null,unitAbbr:"m",categoryName:"Electrical",taxRate:"5",sellingPrice:"215.00",minSellingPrice:"190.00",stock:"50"},{id:"v7",productId:"p7",sku:"EL-SW-1G2W",barcode:"6291000000079",productName:"Schneider 1-Gang 2-Way Light Switch",variantName:null,unitAbbr:"pcs",categoryName:"Electrical",taxRate:"5",sellingPrice:"18.50",minSellingPrice:"14.00",stock:"150"},{id:"v8",productId:"p8",sku:"TL-TM-8M",barcode:"6291000000086",productName:"Stanley FatMax Heavy Duty Tape Measure 8m",variantName:null,unitAbbr:"pcs",categoryName:"Hardware & Tools",taxRate:"5",sellingPrice:"45.00",minSellingPrice:"35.00",stock:"30"},{id:"v9",productId:"p9",sku:"SAN-MX-GROHE",barcode:"6291000000093",productName:"Grohe Eurosmart Single-Lever Basin Mixer",variantName:null,unitAbbr:"pcs",categoryName:"Sanitary",taxRate:"5",sellingPrice:"285.00",minSellingPrice:"240.00",stock:"25"},{id:"v10",productId:"p10",sku:"FX-PLUG-UX8",barcode:"6291000000109",productName:"Fischer Wall Plugs UX 8x50mm Universal Box (100pcs)",variantName:null,unitAbbr:"box",categoryName:"Fasteners & Fixings",taxRate:"5",sellingPrice:"32.00",minSellingPrice:"25.00",stock:"80"}],ne=[{id:"c1",name:"Al Noor Contracting",company:"Al Noor Contracting LLC",phone:"+971501234567",trn:"100123456700003",creditLimit:"5000.00",creditBalance:"1240.00"},{id:"c2",name:"Walk-in customer",company:null,phone:null,trn:null,creditLimit:"0",creditBalance:"0"}];function ae(e){try{const t=e.prepare("SELECT count(*) as count FROM variants").get();if(t&&(t.count??0)>0)return;e.transaction(()=>{const n=e.prepare(`
        INSERT OR IGNORE INTO variants (id, product_id, sku, barcode, product_name, variant_name, search_key, unit_abbr, category_name, tax_rate, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `),a=e.prepare(`
        INSERT OR IGNORE INTO variant_prices (id, variant_id, price_list_id, selling_price, min_selling_price, is_default, updated_at)
        VALUES (?, ?, 'default', ?, ?, 1, datetime('now'))
      `),r=e.prepare(`
        INSERT OR IGNORE INTO inventory (id, variant_id, quantity, reserved_qty, local_delta, updated_at)
        VALUES (?, ?, ?, '0', '0', datetime('now'))
      `);for(const i of te){const u=`${i.productName} ${i.sku} ${i.barcode??""} ${i.categoryName??""}`.toLowerCase();n.run(i.id,i.productId,i.sku,i.barcode,i.productName,i.variantName,u,i.unitAbbr,i.categoryName,i.taxRate),a.run(`pr_${i.id}`,i.id,i.sellingPrice,i.minSellingPrice),r.run(`inv_${i.id}`,i.id,i.stock)}const o=e.prepare(`
        INSERT OR IGNORE INTO customers (id, name, company, phone, trn, credit_limit, credit_balance, credit_on_hold, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
      `);for(const i of ne)o.run(i.id,i.name,i.company,i.phone,i.trn,i.creditLimit,i.creditBalance)})()}catch(t){console.warn("Could not seed initial catalog into SQLite:",t)}}function re(){if(c)return c;const e=b.join(l.app.getPath("userData"),process.env.POS_DB_FILE??"devsfleet-pos.sqlite");return c=new Z(e),c.pragma("journal_mode = WAL"),c.pragma("synchronous = FULL"),c.pragma("foreign_keys = ON"),c.pragma("busy_timeout = 5000"),ie(c),ee(c),ae(c),c}function s(){if(!c)throw new Error("SQLite is not open. Call openDatabase() first.");return c}function oe(){c&&(c.pragma("wal_checkpoint(TRUNCATE)"),c.close(),c=null)}const M=[{version:1,sql:`
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
    `},{version:3,sql:`
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
    `},{version:4,sql:`
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
    `},{version:5,sql:`
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
    `},{version:6,sql:`
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
    `},{version:7,sql:`
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
    `},{version:8,sql:`
      -- version 6 renamed client_id -> local_id everywhere else in the outbox
      -- family; this table was added in version 7, after that rename, and
      -- never got it — it still stands out as the one table naming the same
      -- idempotency key differently.
      ALTER TABLE local_customer_payments RENAME COLUMN client_id TO local_id;
    `}];function ie(e){const t=e.pragma("user_version",{simple:!0}),n=M.at(-1)?.version??0;if(t>n)throw new Error(`Local database is at version ${t} but this build expects ${n}. Reinstall the newer POS version — do not delete the database, it may contain unsynced sales.`);for(const a of M)a.version<=t||e.transaction(()=>{e.exec(a.sql),e.pragma(`user_version = ${a.version}`)})()}function se(e){e.handle("printer:list",async()=>[]),e.handle("printer:receipt",async(t,n,a)=>{throw new Error("Receipt printing lands in Phase 3")}),e.handle("printer:test",async(t,n)=>{throw new Error("Test printing lands in Phase 3")}),e.handle("cash-drawer:open",async(t,n)=>{throw new Error("Cash drawer control lands in Phase 3")})}const p=4,B=10000n;function I(e){if(typeof e=="bigint")return e;const t=typeof e=="number"?ue(e):e.trim();if(t===""||t==="-"||t==="+")return 0n;const n=/^([+-]?)(\d*)(?:\.(\d*))?$/.exec(t);if(!n)throw new TypeError(`Not a decimal money value: ${JSON.stringify(e)}`);const[,a="",r="",o=""]=n,i=o.padEnd(p,"0").slice(0,p),u=`${r||"0"}${i}`,E=BigInt(u);return a==="-"?-E:E}function S(e,t=p){if(t<0||t>p)throw new RangeError(`decimals must be between 0 and ${p}`);const n=t===p?e:le(e,t),a=n<0n,r=a?-n:n,o=r/B,i=(r%B).toString().padStart(p,"0"),u=t===0?"":`.${i.slice(0,t)}`;return`${a?"-":""}${o}${u}`}function v(...e){return e.reduce((t,n)=>t+n,0n)}function ce(e,t){return e-t}function de(e,t){if(t===0n)throw new RangeError("Division by zero");const n=e<0n!=t<0n,a=e<0n?-e:e,r=t<0n?-t:t,o=a/r,E=a%r*2n>=r?o+1n:o;return n?-E:E}function le(e,t){if(t>=p)return e;const n=10n**BigInt(p-t);return de(e,n)*n}function ue(e){if(!Number.isFinite(e))throw new TypeError(`Not a finite money value: ${e}`);return e.toFixed(20).replace(/0+$/,"").replace(/\.$/,"")}const y=`
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
`,f=`
  LEFT JOIN variant_prices p ON p.id = (
    SELECT id FROM variant_prices
    WHERE variant_id = v.id
    ORDER BY is_default DESC, updated_at DESC
    LIMIT 1
  )
  LEFT JOIN inventory i ON i.variant_id = v.id
`;function Te(e,t=25){const n=s(),a=e.trim();if(!a)return n.prepare(`SELECT ${y} FROM variants v ${f}
         ORDER BY v.product_name LIMIT ?`).all(t);const r=$(a);if(r)return[r];const o=a.split(/\s+/).filter(Boolean).map(i=>`"${i.replace(/"/g,'""')}"*`).join(" ");try{return n.prepare(`SELECT ${y} FROM variants_fts f
         JOIN variants v ON v.rowid = f.rowid
         ${f}
         WHERE variants_fts MATCH ?
         ORDER BY rank LIMIT ?`).all(o,t)}catch{const i=`%${a}%`;return n.prepare(`SELECT ${y} FROM variants v ${f}
         WHERE v.product_name LIKE ? OR v.sku LIKE ? OR v.search_key LIKE ?
         ORDER BY v.product_name LIMIT ?`).all(i,i,i,t)}}function $(e){return s().prepare(`SELECT ${y} FROM variants v ${f}
       WHERE v.barcode = ? OR v.sku = ? LIMIT 1`).get(e.trim(),e.trim())??null}function Ee(e,t=25){const n=s(),a=e.trim(),r=`
    SELECT id, name, company, phone, trn,
           price_list_id  AS priceListId,
           credit_limit   AS creditLimit,
           credit_balance AS creditBalance,
           credit_on_hold AS creditOnHold
    FROM customers`;if(!a)return n.prepare(`${r} ORDER BY name LIMIT ?`).all(t);const o=`%${a}%`;return n.prepare(`${r} WHERE name LIKE ? OR company LIKE ? OR phone LIKE ? ORDER BY name LIMIT ?`).all(o,o,o,t)}function k(){const e=s(),t=e.prepare(`SELECT local_id AS id, payload
       FROM outbox WHERE entity = 'cash_session' AND status IN ('pending','synced')
       ORDER BY sequence DESC LIMIT 1`).get();if(!t)return null;const n=JSON.parse(t.payload);return n.closedAt?null:{id:t.id,openingAmount:String(n.openingAmount??"0"),openedAt:JSON.parse(t.payload).openedAt??"",status:"open",..._e(e,t.id)}}function _e(e,t){const n=e.prepare(`SELECT payload FROM outbox
       WHERE entity = 'cash_movement' AND json_extract(payload, '$.cashSessionId') = ?`).all(t);let a=0n,r=0n;for(const u of n){const E=JSON.parse(u.payload),q=I(E.amount);E.type==="cash_in"?a=v(a,q):r=v(r,q)}const i=e.prepare("SELECT paid_amount FROM local_sales WHERE cash_session_id = ? AND status = 'completed'").all(t).reduce((u,E)=>v(u,I(E.paid_amount)),0n);return{cashIn:S(a,4),cashOut:S(r,4),cashSales:S(i,4)}}function pe(e,t){const n=s(),a=k();if(a)return a;const r=O.randomUUID(),o=new Date().toISOString();return R(n,{localId:r,entity:"cash_session",occurredAt:o,payload:{branchId:t,openingAmount:e,openedAt:o}}),{id:r,openingAmount:e,openedAt:o,status:"open",cashIn:"0",cashOut:"0",cashSales:"0"}}function Ne(e,t){const n=s(),a=n.prepare(`SELECT local_id AS id, payload FROM outbox
       WHERE entity = 'cash_session' ORDER BY sequence DESC LIMIT 1`).get();if(!a)return;const r=JSON.parse(a.payload);r.closedAt=new Date().toISOString(),r.countedAmount=e,t&&(r.notes=t),n.prepare("UPDATE outbox SET payload = ?, status = 'pending' WHERE local_id = ?").run(JSON.stringify(r),a.id)}function me(e,t,n){const a=s(),r=k();if(!r)throw new Error("No drawer is open on this terminal");R(a,{localId:O.randomUUID(),entity:"cash_movement",occurredAt:new Date().toISOString(),payload:{cashSessionId:r.id,type:e,amount:t,reason:n}})}function Le(e){const t=s(),n=S(e.payments.reduce((a,r)=>v(a,I(r.amount)),0n),4);return t.transaction(()=>{t.prepare(`INSERT INTO local_sales
         (local_id, customer_id, cash_session_id, subtotal, tax_amount,
          discount_amount, total, paid_amount, status, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`).run(e.localId,e.customerId,e.cashSessionId,e.subtotal,e.taxAmount,e.discountAmount,e.total,n,e.occurredAt);const a=t.prepare(`INSERT INTO local_sale_items
         (sale_local_id, variant_id, product_name, product_sku, quantity,
          unit_price, discount_percent, tax_percent, line_subtotal, tax_amount,
          total, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),r=t.prepare(`UPDATE inventory
       SET local_delta = CAST(CAST(local_delta AS REAL) - ? AS TEXT)
       WHERE variant_id = ?`);e.lines.forEach((o,i)=>{a.run(e.localId,o.variantId,o.productName,o.productSku,o.quantity,o.unitPrice,o.discountPercent,o.taxPercent,o.total,"0",o.total,i),r.run(Number(o.quantity),o.variantId)}),R(t,{localId:e.localId,entity:"sale",occurredAt:e.occurredAt,payload:{customerId:e.customerId,cashSessionId:e.cashSessionId,lines:e.lines.map(o=>({variantId:o.variantId,quantity:Number(o.quantity),unitPrice:o.unitPrice,...Number(o.discountPercent)>0?{discountPercent:Number(o.discountPercent)}:{}})),payments:e.payments.map(o=>({method:o.method,amount:Number(o.amount),...o.reference?{reference:o.reference}:{}}))}})})(),{...e,saleNumber:null,synced:!1}}function he(e=20){const t=s();return t.prepare(`SELECT s.local_id AS localId, s.sale_number AS saleNumber,
              s.customer_id AS customerId, s.cash_session_id AS cashSessionId,
              s.subtotal, s.tax_amount AS taxAmount,
              s.discount_amount AS discountAmount, s.total,
              s.occurred_at AS occurredAt, s.synced_at AS syncedAt
       FROM local_sales s ORDER BY s.occurred_at DESC LIMIT ?`).all(e).map(a=>({...a,synced:a.syncedAt!==null,lines:V(t,a.localId),payments:[]}))}function Ae(e){const t=s(),n=t.prepare(`SELECT local_id AS localId, sale_number AS saleNumber,
              customer_id AS customerId, cash_session_id AS cashSessionId,
              subtotal, tax_amount AS taxAmount, discount_amount AS discountAmount,
              total, occurred_at AS occurredAt, synced_at AS syncedAt
       FROM local_sales WHERE sale_number = ? OR local_id = ? LIMIT 1`).get(e.trim(),e.trim());return n?{...n,synced:n.syncedAt!==null,lines:V(t,n.localId),payments:[]}:null}function V(e,t){return e.prepare(`SELECT variant_id AS variantId, product_name AS productName,
              product_sku AS productSku, quantity, unit_price AS unitPrice,
              discount_percent AS discountPercent, tax_percent AS taxPercent, total
       FROM local_sale_items WHERE sale_local_id = ? ORDER BY sort_order`).all(t)}function Se(e){const t=s();return t.transaction(()=>{t.prepare(`INSERT INTO local_quotations
         (local_id, customer_id, subtotal, tax_amount, discount_amount, total, status, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`).run(e.localId,e.customerId,e.subtotal,e.taxAmount,e.discountAmount,e.total,e.occurredAt);const n=t.prepare(`INSERT INTO local_quotation_items
         (quotation_local_id, variant_id, product_name, product_sku, quantity,
          unit_price, discount_percent, tax_percent, line_subtotal, tax_amount, total, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);e.lines.forEach((a,r)=>{n.run(e.localId,a.variantId,a.productName,a.productSku,a.quantity,a.unitPrice,a.discountPercent,a.taxPercent,a.total,"0",a.total,r)}),R(t,{localId:e.localId,entity:"quotation",occurredAt:e.occurredAt,payload:{customerId:e.customerId,lines:e.lines.map(a=>({variantId:a.variantId,quantity:Number(a.quantity),unitPrice:a.unitPrice,...Number(a.discountPercent)>0?{discountPercent:Number(a.discountPercent)}:{}}))}})})(),{...e,quotationNumber:null,synced:!1}}function Ie(){const e=s(),t=e.prepare(`SELECT q.local_id AS localId, q.quotation_number AS quotationNumber,
              q.customer_id AS customerId,
              q.subtotal, q.tax_amount AS taxAmount,
              q.discount_amount AS discountAmount, q.total,
              q.status, q.occurred_at AS occurredAt, q.synced_at AS syncedAt
       FROM local_quotations q ORDER BY q.occurred_at DESC`).all();for(const n of t)n.lines=e.prepare(`SELECT line.variant_id AS variantId, line.product_name AS productName,
                line.product_sku AS productSku, line.quantity, line.unit_price AS unitPrice,
                line.discount_percent AS discountPercent, line.tax_percent AS taxPercent,
                line.line_subtotal AS lineSubtotal, line.tax_amount AS taxAmount, line.total
         FROM local_quotation_items line
         WHERE line.quotation_local_id = ?
         ORDER BY line.sort_order`).all(n.localId);return t}function Oe(e){const t=s(),n=O.randomUUID();return t.transaction(()=>{t.prepare(`INSERT INTO local_customer_payments
         (local_id, customer_id, cash_session_id, amount, method, reference, notes, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(n,e.customerId,e.cashSessionId,e.amount,e.method,e.reference,e.notes,e.occurredAt);const a=t.prepare("SELECT credit_balance FROM customers WHERE id = ?").get(e.customerId);if(a){const r=ce(I(a.credit_balance),I(e.amount));t.prepare("UPDATE customers SET credit_balance = ? WHERE id = ?").run(S(r,4),e.customerId)}R(t,{localId:n,entity:"customer_payment",occurredAt:e.occurredAt,payload:e})})(),{localId:n,...e,synced:!1}}function Re(e){const t=s(),n=O.randomUUID(),a=new Date().toISOString();return t.prepare(`INSERT INTO held_carts (id, label, line_count, total, customer_name, cart_data, held_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`).run(n,e.label,e.lineCount,e.total,e.customerName,JSON.stringify(e.cartData),a),{id:n,...e,heldAt:a,cartData:void 0}}function ve(e=50){return s().prepare(`SELECT id, label, line_count AS lineCount, total,
              customer_name AS customerName, held_at AS heldAt
       FROM held_carts ORDER BY held_at DESC LIMIT ?`).all(e)}function ye(e){const t=s();return t.transaction(()=>{const n=t.prepare("SELECT cart_data FROM held_carts WHERE id = ?").get(e);return n?(t.prepare("DELETE FROM held_carts WHERE id = ?").run(e),JSON.parse(n.cart_data)):null})()}function fe(e){s().prepare("DELETE FROM held_carts WHERE id = ?").run(e)}function Ue(e){return e.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM outbox").get().next}function R(e,t){e.prepare(`INSERT INTO outbox (local_id, entity, sequence, occurred_at, payload)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(local_id) DO NOTHING`).run(t.localId,t.entity,Ue(e),t.occurredAt,JSON.stringify(t.payload))}function be(e=200){return s().prepare(`SELECT local_id AS localId, entity, sequence, occurred_at AS occurredAt, payload
       FROM outbox WHERE status = 'pending' ORDER BY sequence LIMIT ?`).all(e).map(a=>({localId:a.localId,entity:a.entity,sequence:a.sequence,occurredAt:a.occurredAt,payload:JSON.parse(a.payload)}))}function ge(){const t=s().prepare(`SELECT
         SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS failed
       FROM outbox`).get();return{pending:t.pending??0,failed:t.failed??0}}function we(e){const t=s();if(e.outcome==="applied"||e.outcome==="duplicate"){t.transaction(()=>{t.prepare(`UPDATE outbox SET status = 'synced', server_id = ?, document_number = ?, last_error = NULL
         WHERE local_id = ?`).run(e.serverId??null,e.documentNumber??null,e.localId),t.prepare(`UPDATE local_sales SET server_id = ?, sale_number = ?, synced_at = datetime('now')
         WHERE local_id = ?`).run(e.serverId??null,e.documentNumber??null,e.localId)})();return}if(e.outcome==="rejected"){t.prepare(`UPDATE outbox SET status = 'rejected', last_error = ?, attempts = attempts + 1
       WHERE local_id = ?`).run(e.message??"Rejected by the server",e.localId);return}t.prepare("UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE local_id = ?").run(e.message??null,e.localId)}function Xe(){s().prepare(`UPDATE inventory SET local_delta = '0'
     WHERE variant_id IN (
       SELECT i.variant_id FROM local_sale_items i
       JOIN local_sales s ON s.local_id = i.sale_local_id
       WHERE s.synced_at IS NOT NULL
     )`).run()}function T(e){return s().prepare("SELECT value FROM device_state WHERE key = ?").get(e)?.value??null}function h(e,t){s().prepare(`INSERT INTO device_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(e,t)}class F extends Error{constructor(t,n,a){super(a),this.status=t,this.code=n,this.name="ApiError"}status;code;get isPermanent(){return this.status>=400&&this.status<500&&this.status!==408&&this.status!==429}}let N=null,C=null;function K(){return T("api_url")??process.env.VITE_API_URL??"http://localhost:3001/api/v1"}function g(){return T("device_id")}function Ce(){return T("branch_id")}function De(){return N!==null||T("refresh_token")!==null}function ke(){N=null,h("refresh_token",null)}async function G(e){const t=x(),n=g(),a=Ce();if(!n||!a)throw new Error("This terminal has not been activated yet");const r=await P(`${t}/auth/pin-login`,{method:"POST",body:JSON.stringify({pin:e,deviceId:n,branchId:a})});return J(r.accessToken,r.refreshToken,r.expiresIn),r.user}function J(e,t,n){N={accessToken:e,refreshToken:t,expiresAt:Date.now()+Math.max(0,n-60)*1e3},h("refresh_token",t)}async function Fe(){if(N&&Date.now()<N.expiresAt)return N.accessToken;if(C??=xe().finally(()=>{C=null}),await C,!N)throw new Error("This terminal is signed out. Sign in with a PIN.");return N.accessToken}async function xe(){const e=N?.refreshToken??T("refresh_token");if(!e)throw new Error("This terminal is signed out. Sign in with a PIN.");try{const t=await P(`${x()}/auth/refresh`,{method:"POST",body:JSON.stringify({refreshToken:e})});J(t.accessToken,t.refreshToken,t.expiresIn)}catch(t){throw t instanceof F&&t.isPermanent&&ke(),t}}async function j(e,t){const n=await Fe();return P(`${x()}${e}`,{method:"POST",headers:{authorization:`Bearer ${n}`},body:JSON.stringify(t)})}async function Pe(){const e=K();if(!e)return!1;try{const t=new AbortController,n=setTimeout(()=>t.abort(),4e3),a=await fetch(new URL("/health",e),{signal:t.signal});return clearTimeout(n),a.ok}catch{return!1}}function x(){const e=K();if(!e)throw new Error("No server address is configured on this terminal");return e.replace(/\/+$/,"")}async function P(e,t){const n=new AbortController,a=setTimeout(()=>n.abort(),3e4);let r;try{r=await fetch(e,{...t,signal:n.signal,headers:{"content-type":"application/json",...t.headers??{}}})}finally{clearTimeout(a)}const o=await r.text(),i=o?JSON.parse(o):{};if(!r.ok||i.success===!1){const u=i.error??{};throw new F(r.status,u.code??"UNKNOWN",u.message??`Request failed with ${r.status}`)}return i.data??i}const qe=500;let U=null,A=null,z=()=>null;const L={online:!1,lastPullAt:null,lastPushAt:null,lastCheckpoint:null,pendingPushCount:0,failedPushCount:0,syncing:!1,lastError:null};function _(e={}){Object.assign(L,e);const t=ge();return L.pendingPushCount=t.pending,L.failedPushCount=t.failed,z()?.webContents.send("sync:status-changed",{...L}),{...L}}function Me(e,t){z=t,L.lastCheckpoint=T("checkpoint"),e.handle("sync:status",()=>_()),e.handle("sync:now",()=>D());const n=Number(process.env.POS_SYNC_INTERVAL_MS??3e4);U=setInterval(()=>{D().catch(()=>{})},n)}function Be(){U&&(clearInterval(U),U=null)}async function D(){return A||(A=(async()=>{if(_({syncing:!0,lastError:null}),!await Pe())return _({syncing:!1,online:!1});if(!g())return _({syncing:!1,online:!0,lastError:"Terminal not yet activated with code"});if(!De())return _({syncing:!1,online:!0,lastError:"Signed out — enter a PIN"});try{return await Ge(),await He(),Xe(),_({syncing:!1,online:!0,lastError:null})}catch(t){const n=t instanceof Error?t.message:"Sync failed";return _({syncing:!1,online:t instanceof F,lastError:n})}})().finally(()=>{A=null}),A)}async function Ge(){const e=be(200);if(e.length===0)return;const t=await j("/sync/push",{deviceId:g(),lastCheckpoint:T("checkpoint"),items:e});for(const n of t.results)we(n);_({lastPushAt:new Date().toISOString()})}async function He(){for(let e=0;e<200;e+=1){const t=await j("/sync/pull",{deviceId:g(),since:T("checkpoint"),limit:qe});if(Ye(t.changes,t.checkpoint),_({lastPullAt:new Date().toISOString(),lastCheckpoint:t.checkpoint}),!t.hasMore)return}}function Ye(e,t){const n=s();n.transaction(()=>{for(const a of e){if(a.deleted){We(a.entity,a.id);continue}a.record&&$e(a.entity,a.id,a.record)}n.prepare(`INSERT INTO device_state (key, value) VALUES ('checkpoint', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(t)})()}function We(e,t){const n=s(),a={product:"variants",customer:"customers",category:null,unit:null}[e];a&&n.prepare(`DELETE FROM ${a} WHERE id = ?`).run(t),n.prepare(`INSERT INTO deleted_records (entity, id, deleted_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(entity, id) DO NOTHING`).run(e,t)}function $e(e,t,n){const a=s(),r=o=>o==null?null:String(o);switch(e){case"product":a.prepare(`INSERT INTO variants
           (id, product_id, sku, barcode, product_name, variant_name, search_key,
            unit_abbr, category_name, tax_rate, min_stock, is_stock_tracked, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           product_id = excluded.product_id, sku = excluded.sku,
           barcode = excluded.barcode, product_name = excluded.product_name,
           variant_name = excluded.variant_name, search_key = excluded.search_key,
           unit_abbr = excluded.unit_abbr, category_name = excluded.category_name,
           tax_rate = excluded.tax_rate, min_stock = excluded.min_stock,
           is_stock_tracked = excluded.is_stock_tracked, updated_at = datetime('now')`).run(t,r(n.productId),r(n.sku),r(n.barcode),r(n.productName),r(n.variantName),r(n.searchKey)??"",r(n.unitAbbr),r(n.categoryName),r(n.taxRate),r(n.minStock),n.isStockTracked===!1?0:1);return;case"product_price":a.prepare(`INSERT INTO variant_prices
           (id, variant_id, price_list_id, selling_price, min_selling_price, is_default, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           selling_price = excluded.selling_price,
           min_selling_price = excluded.min_selling_price,
           is_default = excluded.is_default,
           updated_at = datetime('now')`).run(t,r(n.variantId),r(n.priceListId),r(n.sellingPrice)??"0",r(n.minSellingPrice),n.isDefault?1:0);return;case"inventory":a.prepare(`INSERT INTO inventory (id, variant_id, quantity, reserved_qty, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(variant_id) DO UPDATE SET
           quantity = excluded.quantity,
           reserved_qty = excluded.reserved_qty,
           updated_at = datetime('now')`).run(t,r(n.variantId),r(n.quantity)??"0",r(n.reservedQuantity)??"0");return;case"customer":a.prepare(`INSERT INTO customers
           (id, name, company, phone, trn, price_list_id, credit_limit,
            credit_balance, credit_on_hold, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, company = excluded.company, phone = excluded.phone,
           trn = excluded.trn, price_list_id = excluded.price_list_id,
           credit_limit = excluded.credit_limit, credit_balance = excluded.credit_balance,
           credit_on_hold = excluded.credit_on_hold, updated_at = datetime('now')`).run(t,r(n.name),r(n.company),r(n.phone),r(n.trn),r(n.priceListId),r(n.creditLimit)??"0",r(n.creditBalance)??"0",n.creditOnHold?1:0);return;default:return}}function m(){D().catch(()=>{})}function Ve(e){e.handle("catalog:search",(t,n,a)=>Te(n??"",a)),e.handle("catalog:by-barcode",(t,n)=>$(n??"")),e.handle("customers:search",(t,n)=>Ee(n??"")),e.handle("customers:payment",(t,n)=>{const a=Oe(n);return m(),a}),e.handle("cash:current",()=>k()),e.handle("cash:open",(t,n)=>pe(String(n??"0"),T("branch_id"))),e.handle("cash:close",(t,n,a)=>{Ne(String(n??"0"),a),m()}),e.handle("cash:movement",(t,n,a,r)=>{me(n,String(a??"0"),r??"")}),e.handle("carts:hold",(t,n)=>Re(n)),e.handle("carts:list",()=>ve()),e.handle("carts:restore",(t,n)=>ye(n)),e.handle("carts:discard",(t,n)=>fe(n)),e.handle("sales:commit",(t,n)=>{const a=Le(n);return m(),a}),e.handle("sales:recent",(t,n)=>he(n)),e.handle("sales:find",(t,n)=>Ae(n??"")),e.handle("quotations:save",(t,n)=>{const a=Se(n);return m(),a}),e.handle("quotations:list",()=>Ie()),e.handle("auth:pin-login",async(t,n)=>{const a=await G(String(n??""));return m(),a}),e.handle("auth:manager-override",async(t,n,a)=>{const r=await G(String(n??""));if(!(r.permissions.includes("*")||r.permissions.includes(a)))throw new Error(`Manager lacks required permission: ${a}`);return r.name}),e.handle("device:info",()=>({deviceId:T("device_id"),branchId:T("branch_id"),apiUrl:T("api_url"),hardwareId:H(),version:l.app.getVersion()})),e.handle("device:activate",(t,n,a)=>{const[r,o]=String(n??"").split(":");if(!r||!o)throw new Error("Activation code must be <terminal-id>:<branch-id>");return h("api_url",String(a??"").replace(/\/+$/,"")),h("device_id",r.trim()),h("branch_id",o.trim()),h("hardware_id",H()),m(),{deviceId:r.trim()}})}function H(){const e=Object.values(w.networkInterfaces()).flat().filter(t=>!!t).filter(t=>!t.internal&&t.mac&&t.mac!=="00:00:00:00:00:00").map(t=>t.mac).sort();return O.createHash("sha256").update([...e,w.hostname(),w.platform()].join("|")).digest("hex").slice(0,32)}const Y=b.dirname(Q.fileURLToPath(typeof document>"u"?require("url").pathToFileURL(__filename).href:X&&X.tagName.toUpperCase()==="SCRIPT"&&X.src||new URL("main.js",document.baseURI).href));let d=null;function W(){d=new l.BrowserWindow({width:1440,height:900,minWidth:1024,minHeight:720,show:!1,backgroundColor:"#0b0d10",title:"DevsFleet POS",webPreferences:{preload:b.join(Y,"preload.js"),contextIsolation:!0,nodeIntegration:!1,sandbox:!1,webSecurity:!0,spellcheck:!1}}),d.once("ready-to-show",()=>d?.show());const e=process.env.VITE_DEV_SERVER_URL;e?(d.loadURL(e),d.webContents.openDevTools({mode:"detach"})):d.loadFile(b.join(Y,"../dist/index.html")),d.webContents.setWindowOpenHandler(()=>({action:"deny"})),d.webContents.on("will-navigate",(t,n)=>{n!==e&&t.preventDefault()}),d.on("closed",()=>{d=null})}l.app.requestSingleInstanceLock()?(l.app.on("second-instance",()=>{d&&(d.isMinimized()&&d.restore(),d.focus())}),l.app.whenReady().then(()=>{re(),Ve(l.ipcMain),Me(l.ipcMain,()=>d),se(l.ipcMain),W(),l.app.on("activate",()=>{l.BrowserWindow.getAllWindows().length===0&&W()})})):l.app.quit();l.app.on("window-all-closed",()=>{process.platform!=="darwin"&&l.app.quit()});l.app.on("before-quit",()=>{Be(),oe()});
