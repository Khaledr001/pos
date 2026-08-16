"use strict";const c=require("electron"),G=require("node:url"),A=require("node:path"),Y=require("better-sqlite3"),O=require("node:crypto"),v=require("node:os");var R=typeof document<"u"?document.currentScript:null;let d=null;function V(){if(d)return d;const e=A.join(c.app.getPath("userData"),process.env.POS_DB_FILE??"devsfleet-pos.sqlite");return d=new Y(e),d.pragma("journal_mode = WAL"),d.pragma("synchronous = FULL"),d.pragma("foreign_keys = ON"),d.pragma("busy_timeout = 5000"),K(d),d}function i(){if(!d)throw new Error("SQLite is not open. Call openDatabase() first.");return d}function $(){d&&(d.pragma("wal_checkpoint(TRUNCATE)"),d.close(),d=null)}const C=[{version:1,sql:`
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
    `}];function K(e){const t=e.pragma("user_version",{simple:!0}),n=C.at(-1)?.version??0;if(t>n)throw new Error(`Local database is at version ${t} but this build expects ${n}. Reinstall the newer POS version — do not delete the database, it may contain unsynced sales.`);for(const a of C)a.version<=t||e.transaction(()=>{e.exec(a.sql),e.pragma(`user_version = ${a.version}`)})()}function J(e){e.handle("printer:list",async()=>[]),e.handle("printer:receipt",async(t,n,a)=>{throw new Error("Receipt printing lands in Phase 3")}),e.handle("printer:test",async(t,n)=>{throw new Error("Test printing lands in Phase 3")}),e.handle("cash-drawer:open",async(t,n)=>{throw new Error("Cash drawer control lands in Phase 3")})}const S=`
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
`,L=`
  LEFT JOIN variant_prices p ON p.id = (
    SELECT id FROM variant_prices
    WHERE variant_id = v.id
    ORDER BY is_default DESC, updated_at DESC
    LIMIT 1
  )
  LEFT JOIN inventory i ON i.variant_id = v.id
`;function j(e,t=25){const n=i(),a=e.trim();if(!a)return n.prepare(`SELECT ${S} FROM variants v ${L}
         ORDER BY v.product_name LIMIT ?`).all(t);const r=P(a);if(r)return[r];const s=a.split(/\s+/).filter(Boolean).map(l=>`"${l.replace(/"/g,'""')}"*`).join(" ");try{return n.prepare(`SELECT ${S} FROM variants_fts f
         JOIN variants v ON v.rowid = f.rowid
         ${L}
         WHERE variants_fts MATCH ?
         ORDER BY rank LIMIT ?`).all(s,t)}catch{const l=`%${a}%`;return n.prepare(`SELECT ${S} FROM variants v ${L}
         WHERE v.product_name LIKE ? OR v.sku LIKE ? OR v.search_key LIKE ?
         ORDER BY v.product_name LIMIT ?`).all(l,l,l,t)}}function P(e){return i().prepare(`SELECT ${S} FROM variants v ${L}
       WHERE v.barcode = ? OR v.sku = ? LIMIT 1`).get(e.trim(),e.trim())??null}function z(e,t=25){const n=i(),a=e.trim(),r=`
    SELECT id, name, company, phone, trn,
           price_list_id  AS priceListId,
           credit_limit   AS creditLimit,
           credit_balance AS creditBalance,
           credit_on_hold AS creditOnHold
    FROM customers`;if(!a)return n.prepare(`${r} ORDER BY name LIMIT ?`).all(t);const s=`%${a}%`;return n.prepare(`${r} WHERE name LIKE ? OR company LIKE ? OR phone LIKE ? ORDER BY name LIMIT ?`).all(s,s,s,t)}function b(){const e=i(),t=e.prepare(`SELECT client_id AS id, payload
       FROM outbox WHERE entity = 'cash_session' AND status IN ('pending','synced')
       ORDER BY sequence DESC LIMIT 1`).get();if(!t)return null;const n=JSON.parse(t.payload);return n.closedAt?null:{id:t.id,openingAmount:String(n.openingAmount??"0"),openedAt:JSON.parse(t.payload).openedAt??"",status:"open",...Q(e,t.id)}}function Q(e,t){const n=e.prepare(`SELECT payload FROM outbox
       WHERE entity = 'cash_movement' AND json_extract(payload, '$.cashSessionId') = ?`).all(t);let a=0,r=0;for(const l of n){const _=JSON.parse(l.payload);_.type==="cash_in"?a+=Number(_.amount):r+=Number(_.amount)}const s=e.prepare(`SELECT COALESCE(SUM(CAST(paid_amount AS REAL)), 0) AS total
       FROM local_sales WHERE cash_session_id = ? AND status = 'completed'`).get(t);return{cashIn:String(a),cashOut:String(r),cashSales:String(s.total??0)}}function Z(e,t){const n=i(),a=b();if(a)return a;const r=O.randomUUID(),s=new Date().toISOString();return g(n,{clientId:r,entity:"cash_session",occurredAt:s,payload:{branchId:t,openingAmount:e,openedAt:s}}),{id:r,openingAmount:e,openedAt:s,status:"open",cashIn:"0",cashOut:"0",cashSales:"0"}}function ee(e,t){const n=i(),a=n.prepare(`SELECT client_id AS id, payload FROM outbox
       WHERE entity = 'cash_session' ORDER BY sequence DESC LIMIT 1`).get();if(!a)return;const r=JSON.parse(a.payload);r.closedAt=new Date().toISOString(),r.countedAmount=e,t&&(r.notes=t),n.prepare("UPDATE outbox SET payload = ?, status = 'pending' WHERE client_id = ?").run(JSON.stringify(r),a.id)}function te(e,t,n){const a=i(),r=b();if(!r)throw new Error("No drawer is open on this terminal");g(a,{clientId:O.randomUUID(),entity:"cash_movement",occurredAt:new Date().toISOString(),payload:{cashSessionId:r.id,type:e,amount:t,reason:n}})}function ne(e){const t=i(),n=e.payments.reduce((a,r)=>a+Number(r.amount),0);return t.transaction(()=>{t.prepare(`INSERT INTO local_sales
         (client_id, customer_id, cash_session_id, subtotal, tax_amount,
          discount_amount, total, paid_amount, status, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`).run(e.clientId,e.customerId,e.cashSessionId,e.subtotal,e.taxAmount,e.discountAmount,e.total,String(n),e.occurredAt);const a=t.prepare(`INSERT INTO local_sale_items
         (sale_client_id, variant_id, product_name, product_sku, quantity,
          unit_price, discount_percent, tax_percent, line_subtotal, tax_amount,
          total, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),r=t.prepare(`UPDATE inventory
       SET local_delta = CAST(CAST(local_delta AS REAL) - ? AS TEXT)
       WHERE variant_id = ?`);e.lines.forEach((s,l)=>{a.run(e.clientId,s.variantId,s.productName,s.productSku,s.quantity,s.unitPrice,s.discountPercent,s.taxPercent,s.total,"0",s.total,l),r.run(Number(s.quantity),s.variantId)}),g(t,{clientId:e.clientId,entity:"sale",occurredAt:e.occurredAt,payload:{customerId:e.customerId,cashSessionId:e.cashSessionId,lines:e.lines.map(s=>({variantId:s.variantId,quantity:Number(s.quantity),unitPrice:s.unitPrice,...Number(s.discountPercent)>0?{discountPercent:Number(s.discountPercent)}:{}})),payments:e.payments.map(s=>({method:s.method,amount:Number(s.amount),...s.reference?{reference:s.reference}:{}}))}})})(),{...e,saleNumber:null,synced:!1}}function ae(e=20){const t=i();return t.prepare(`SELECT s.client_id AS clientId, s.sale_number AS saleNumber,
              s.customer_id AS customerId, s.cash_session_id AS cashSessionId,
              s.subtotal, s.tax_amount AS taxAmount,
              s.discount_amount AS discountAmount, s.total,
              s.occurred_at AS occurredAt, s.synced_at AS syncedAt
       FROM local_sales s ORDER BY s.occurred_at DESC LIMIT ?`).all(e).map(a=>({...a,synced:a.syncedAt!==null,lines:q(t,a.clientId),payments:[]}))}function re(e){const t=i(),n=t.prepare(`SELECT client_id AS clientId, sale_number AS saleNumber,
              customer_id AS customerId, cash_session_id AS cashSessionId,
              subtotal, tax_amount AS taxAmount, discount_amount AS discountAmount,
              total, occurred_at AS occurredAt, synced_at AS syncedAt
       FROM local_sales WHERE sale_number = ? OR client_id = ? LIMIT 1`).get(e.trim(),e.trim());return n?{...n,synced:n.syncedAt!==null,lines:q(t,n.clientId),payments:[]}:null}function q(e,t){return e.prepare(`SELECT variant_id AS variantId, product_name AS productName,
              product_sku AS productSku, quantity, unit_price AS unitPrice,
              discount_percent AS discountPercent, tax_percent AS taxPercent, total
       FROM local_sale_items WHERE sale_client_id = ? ORDER BY sort_order`).all(t)}function se(e){const t=i(),n=O.randomUUID(),a=new Date().toISOString();return t.prepare(`INSERT INTO held_carts (id, label, line_count, total, customer_name, cart_data, held_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`).run(n,e.label,e.lineCount,e.total,e.customerName,JSON.stringify(e.cartData),a),{id:n,...e,heldAt:a,cartData:void 0}}function ie(e=50){return i().prepare(`SELECT id, label, line_count AS lineCount, total,
              customer_name AS customerName, held_at AS heldAt
       FROM held_carts ORDER BY held_at DESC LIMIT ?`).all(e)}function oe(e){const t=i();return t.transaction(()=>{const n=t.prepare("SELECT cart_data FROM held_carts WHERE id = ?").get(e);return n?(t.prepare("DELETE FROM held_carts WHERE id = ?").run(e),JSON.parse(n.cart_data)):null})()}function ce(e){i().prepare("DELETE FROM held_carts WHERE id = ?").run(e)}function de(e){return e.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM outbox").get().next}function g(e,t){e.prepare(`INSERT INTO outbox (client_id, entity, sequence, occurred_at, payload)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(client_id) DO NOTHING`).run(t.clientId,t.entity,de(e),t.occurredAt,JSON.stringify(t.payload))}function le(e=200){return i().prepare(`SELECT client_id AS clientId, entity, sequence, occurred_at AS occurredAt, payload
       FROM outbox WHERE status = 'pending' ORDER BY sequence LIMIT ?`).all(e).map(a=>({clientId:a.clientId,entity:a.entity,sequence:a.sequence,occurredAt:a.occurredAt,payload:JSON.parse(a.payload)}))}function ue(){const t=i().prepare(`SELECT
         SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS failed
       FROM outbox`).get();return{pending:t.pending??0,failed:t.failed??0}}function Te(e){const t=i();if(e.outcome==="applied"||e.outcome==="duplicate"){t.transaction(()=>{t.prepare(`UPDATE outbox SET status = 'synced', server_id = ?, document_number = ?, last_error = NULL
         WHERE client_id = ?`).run(e.serverId??null,e.documentNumber??null,e.clientId),t.prepare(`UPDATE local_sales SET server_id = ?, sale_number = ?, synced_at = datetime('now')
         WHERE client_id = ?`).run(e.serverId??null,e.documentNumber??null,e.clientId)})();return}if(e.outcome==="rejected"){t.prepare(`UPDATE outbox SET status = 'rejected', last_error = ?, attempts = attempts + 1
       WHERE client_id = ?`).run(e.message??"Rejected by the server",e.clientId);return}t.prepare("UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE client_id = ?").run(e.message??null,e.clientId)}function Ee(){i().prepare(`UPDATE inventory SET local_delta = '0'
     WHERE variant_id IN (
       SELECT i.variant_id FROM local_sale_items i
       JOIN local_sales s ON s.client_id = i.sale_client_id
       WHERE s.synced_at IS NOT NULL
     )`).run()}function u(e){return i().prepare("SELECT value FROM device_state WHERE key = ?").get(e)?.value??null}function N(e,t){i().prepare(`INSERT INTO device_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(e,t)}class U extends Error{constructor(t,n,a){super(a),this.status=t,this.code=n,this.name="ApiError"}status;code;get isPermanent(){return this.status>=400&&this.status<500&&this.status!==408&&this.status!==429}}let E=null,y=null;function B(){return u("api_url")}function f(){return u("device_id")}function _e(){return u("branch_id")}function pe(){return E!==null||u("refresh_token")!==null}function Ne(){E=null,N("refresh_token",null)}async function he(e){const t=X(),n=f(),a=_e();if(!n||!a)throw new Error("This terminal has not been activated yet");const r=await k(`${t}/auth/pin-login`,{method:"POST",body:JSON.stringify({pin:e,deviceId:n,branchId:a})});return M(r.accessToken,r.refreshToken,r.expiresIn),r.user}function M(e,t,n){E={accessToken:e,refreshToken:t,expiresAt:Date.now()+Math.max(0,n-60)*1e3},N("refresh_token",t)}async function me(){if(E&&Date.now()<E.expiresAt)return E.accessToken;if(y??=Se().finally(()=>{y=null}),await y,!E)throw new Error("This terminal is signed out. Sign in with a PIN.");return E.accessToken}async function Se(){const e=E?.refreshToken??u("refresh_token");if(!e)throw new Error("This terminal is signed out. Sign in with a PIN.");try{const t=await k(`${X()}/auth/refresh`,{method:"POST",body:JSON.stringify({refreshToken:e})});M(t.accessToken,t.refreshToken,t.expiresIn)}catch(t){throw t instanceof U&&t.isPermanent&&Ne(),t}}async function H(e,t){const n=await me();return k(`${X()}${e}`,{method:"POST",headers:{authorization:`Bearer ${n}`},body:JSON.stringify(t)})}async function Le(){const e=B();if(!e)return!1;try{const t=new AbortController,n=setTimeout(()=>t.abort(),4e3),a=await fetch(new URL("/health",e),{signal:t.signal});return clearTimeout(n),a.ok}catch{return!1}}function X(){const e=B();if(!e)throw new Error("No server address is configured on this terminal");return e.replace(/\/+$/,"")}async function k(e,t){const n=new AbortController,a=setTimeout(()=>n.abort(),3e4);let r;try{r=await fetch(e,{...t,signal:n.signal,headers:{"content-type":"application/json",...t.headers??{}}})}finally{clearTimeout(a)}const s=await r.text(),l=s?JSON.parse(s):{};if(!r.ok||l.success===!1){const _=l.error??{};throw new U(r.status,_.code??"UNKNOWN",_.message??`Request failed with ${r.status}`)}return l.data??l}const Ie=500;let I=null,h=null,W=()=>null;const p={online:!1,lastPullAt:null,lastPushAt:null,lastCheckpoint:null,pendingPushCount:0,failedPushCount:0,syncing:!1,lastError:null};function T(e={}){Object.assign(p,e);const t=ue();return p.pendingPushCount=t.pending,p.failedPushCount=t.failed,W()?.webContents.send("sync:status-changed",{...p}),{...p}}function Ae(e,t){W=t,p.lastCheckpoint=u("checkpoint"),e.handle("sync:status",()=>T()),e.handle("sync:now",()=>w());const n=Number(process.env.POS_SYNC_INTERVAL_MS??3e4);I=setInterval(()=>{w().catch(()=>{})},n)}function Oe(){I&&(clearInterval(I),I=null)}async function w(){return h||(h=(async()=>{if(!f())return T({online:!1,lastError:"This terminal has not been activated"});if(T({syncing:!0,lastError:null}),!await Le())return T({syncing:!1,online:!1});if(!pe())return T({syncing:!1,online:!0,lastError:"Signed out — enter a PIN"});try{return await fe(),await ve(),Ee(),T({syncing:!1,online:!0,lastError:null})}catch(t){const n=t instanceof Error?t.message:"Sync failed";return T({syncing:!1,online:t instanceof U,lastError:n})}})().finally(()=>{h=null}),h)}async function fe(){const e=le(200);if(e.length===0)return;const t=await H("/sync/push",{deviceId:f(),lastCheckpoint:u("checkpoint"),items:e});for(const n of t.results)Te(n);T({lastPushAt:new Date().toISOString()})}async function ve(){for(let e=0;e<200;e+=1){const t=await H("/sync/pull",{deviceId:f(),since:u("checkpoint"),limit:Ie});if(Re(t.changes,t.checkpoint),T({lastPullAt:new Date().toISOString(),lastCheckpoint:t.checkpoint}),!t.hasMore)return}}function Re(e,t){const n=i();n.transaction(()=>{for(const a of e){if(a.deleted){ye(a.entity,a.id);continue}a.record&&we(a.entity,a.id,a.record)}n.prepare(`INSERT INTO device_state (key, value) VALUES ('checkpoint', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(t)})()}function ye(e,t){const n=i(),a={product:"variants",customer:"customers",category:null,unit:null}[e];a&&n.prepare(`DELETE FROM ${a} WHERE id = ?`).run(t),n.prepare(`INSERT INTO deleted_records (entity, id, deleted_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(entity, id) DO NOTHING`).run(e,t)}function we(e,t,n){const a=i(),r=s=>s==null?null:String(s);switch(e){case"product":a.prepare(`INSERT INTO variants
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
           credit_on_hold = excluded.credit_on_hold, updated_at = datetime('now')`).run(t,r(n.name),r(n.company),r(n.phone),r(n.trn),r(n.priceListId),r(n.creditLimit)??"0",r(n.creditBalance)??"0",n.creditOnHold?1:0);return;default:return}}function m(){w().catch(()=>{})}function be(e){e.handle("catalog:search",(t,n,a)=>j(n??"",a)),e.handle("catalog:by-barcode",(t,n)=>P(n??"")),e.handle("customers:search",(t,n)=>z(n??"")),e.handle("cash:current",()=>b()),e.handle("cash:open",(t,n)=>Z(String(n??"0"),u("branch_id"))),e.handle("cash:close",(t,n,a)=>{ee(String(n??"0"),a),m()}),e.handle("cash:movement",(t,n,a,r)=>{te(n,String(a??"0"),r??"")}),e.handle("carts:hold",(t,n)=>se(n)),e.handle("carts:list",()=>ie()),e.handle("carts:restore",(t,n)=>oe(n)),e.handle("carts:discard",(t,n)=>ce(n)),e.handle("sales:commit",(t,n)=>{const a=ne(n);return m(),a}),e.handle("sales:recent",(t,n)=>ae(n)),e.handle("sales:find",(t,n)=>re(n??"")),e.handle("auth:pin-login",async(t,n)=>{const a=await he(String(n??""));return m(),a}),e.handle("device:info",()=>({deviceId:u("device_id"),branchId:u("branch_id"),apiUrl:u("api_url"),hardwareId:D(),version:c.app.getVersion()})),e.handle("device:activate",(t,n,a)=>{const[r,s]=String(n??"").split(":");if(!r||!s)throw new Error("Activation code must be <terminal-id>:<branch-id>");return N("api_url",String(a??"").replace(/\/+$/,"")),N("device_id",r.trim()),N("branch_id",s.trim()),N("hardware_id",D()),m(),{deviceId:r.trim()}})}function D(){const e=Object.values(v.networkInterfaces()).flat().filter(t=>!!t).filter(t=>!t.internal&&t.mac&&t.mac!=="00:00:00:00:00:00").map(t=>t.mac).sort();return O.createHash("sha256").update([...e,v.hostname(),v.platform()].join("|")).digest("hex").slice(0,32)}const F=A.dirname(G.fileURLToPath(typeof document>"u"?require("url").pathToFileURL(__filename).href:R&&R.tagName.toUpperCase()==="SCRIPT"&&R.src||new URL("main.js",document.baseURI).href));let o=null;function x(){o=new c.BrowserWindow({width:1440,height:900,minWidth:1024,minHeight:720,show:!1,backgroundColor:"#0b0d10",title:"DevsFleet POS",webPreferences:{preload:A.join(F,"preload.js"),contextIsolation:!0,nodeIntegration:!1,sandbox:!1,webSecurity:!0,spellcheck:!1}}),o.once("ready-to-show",()=>o?.show());const e=process.env.VITE_DEV_SERVER_URL;e?(o.loadURL(e),o.webContents.openDevTools({mode:"detach"})):o.loadFile(A.join(F,"../dist/index.html")),o.webContents.setWindowOpenHandler(()=>({action:"deny"})),o.webContents.on("will-navigate",(t,n)=>{n!==e&&t.preventDefault()}),o.on("closed",()=>{o=null})}c.app.requestSingleInstanceLock()?(c.app.on("second-instance",()=>{o&&(o.isMinimized()&&o.restore(),o.focus())}),c.app.whenReady().then(()=>{V(),be(c.ipcMain),Ae(c.ipcMain,()=>o),J(c.ipcMain),x(),c.app.on("activate",()=>{c.BrowserWindow.getAllWindows().length===0&&x()})})):c.app.quit();c.app.on("window-all-closed",()=>{process.platform!=="darwin"&&c.app.quit()});c.app.on("before-quit",()=>{Oe(),$()});
