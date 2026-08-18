# DevsFleet POS — Feature Audit & Execution Plan

**Audited:** 2026-08-19, against commit `3be97d3`.
**Method:** every claim below was read out of the source or executed. File:line
references are given so you can verify rather than trust. Where a document in
this repo contradicts the code, the code won.

This file replaces the previous speculative plan. That version described work as
if none of it existed; roughly two thirds of it is built. Planning against it
would have rebuilt working modules and skipped broken ones.

---

## 0. How to use this document

You are an LLM asked to advance this codebase. Read this section fully before
writing any code.

### 0.1 Read these first, in order

1. `CLAUDE.md` — the eight rules. They are not style preferences. Each exists
   because breaking it produced a specific, expensive failure.
2. `docs/PATTERNS.md` — the worked module walkthrough plus a **Gotchas** section
   listing traps this codebase has already hit and paid for. Read the Gotchas
   even if you think you know the stack.
3. `docs/DECISIONS.md` — locked architectural decisions (D1–D14) and the four
   still-open questions. Do not relitigate a locked decision.
4. `apps/api/src/modules/branches/` — the reference module. Copy its shape.

### 0.2 Status vocabulary used in this document

| Mark | Meaning |
|---|---|
| ✅ **DONE** | Implemented end-to-end and exercised. Do not rebuild. |
| 🟡 **PARTIAL** | Works, with a specific named gap. Extend; do not restart. |
| 🔴 **MISSING** | No implementation. Greenfield. |
| 💀 **BROKEN** | Code exists and looks finished but cannot work. **More dangerous than missing**, because a reader assumes it is done. |
| 📋 **SCHEMA-ONLY** | Database table exists; zero code reads or writes it. |

`💀` and `📋` are the two categories that matter most here. This codebase's
problem is not fake services — there are none. Its problem is **missing wiring
between layers that each look complete on their own**, and **documentation that
claims finished work that does not exist**.

### 0.3 Rules that must not be relaxed to make progress

These are the ones most likely to be broken by someone moving fast:

- **Money is never a `number`.** `Money` (scaled `bigint`) or a decimal string,
  never a float, in the API *and* in the POS *and* in the renderer. Every total a
  customer sees comes from `calculateDocument`. Never reimplement "subtotal minus
  discount plus VAT". Dividing two `Minor4` values is always wrong — use
  `Money.divideByQuantity`. See `docs/PATTERNS.md`.
- **Never put `tenantId` in a WHERE clause.** RLS applies it. Go through
  `TenantDatabase.run()`.
- **Services throw `AppError`, not `HttpException`.** New codes go in
  `ERROR_CODES` and get a status mapping in `AllExceptionsFilter`.
- **Ledgers are append-only.** `inventory_transactions`, `price_history`,
  `audit_log` reject UPDATE/DELETE at the database level. Correct with a
  compensating entry.
- **Every document snapshots what it needs.** Renaming a product must not rewrite
  last year's invoice.
- **Every route declares `@RequirePermissions`.** A missing line is visible in
  review; a missing check is not.
- **Never edit a shipped SQLite migration** in `apps/pos/electron/db/sqlite.ts`.
  Append a new version. Doing otherwise is what caused blocker **B1** below.
- **Do not nest `TenantDatabase.run()`.** It opens a fresh transaction each call,
  so a nested call runs on a second connection with no shared atomicity. Either
  pass the caller's `tx` down (see `StockService`) or call the other service as a
  separate top-level transaction (see `QuotationsService.convert`).

### 0.4 Definition of done for any item in this plan

1. `pnpm typecheck` clean — **and confirm it actually type-checks.** The POS
   script was `tsc -b --dry` until 2026-08-19, which prints what *would* build and
   exits 0 regardless of errors. CI was green while the renderer had 20+ errors.
2. `pnpm test` passes, and the change is covered where the logic is non-obvious.
3. `pnpm check:boundaries` passes — apps stay independently deployable.
4. Migrations reviewed as SQL before commit; `pnpm db:migrate` re-verifies RLS.
5. For anything touching money, stock, or sync: exercised against a real running
   API and Postgres, not just unit-tested. This repo's worst bugs — landed cost
   off by 10⁴, sync never converging, change booked as revenue — all type-checked
   and passed tests.

---

## 1. What genuinely works today

Verified end-to-end. Do not rebuild these.

**API (25 controllers, ~14,300 lines).** No stubs — every service issues real
queries. Auth (JWT + PIN + refresh rotation), tenants/branches/users, catalog
(categories/brands/units), products with variants and trigram search, inventory
with an append-only ledger and weighted-average landed cost, purchases (PO →
goods receipt → stock in), transfers (request → approve → ship → receive), stock
take (count → submit → approve → post variances), sales creation (split tender,
credit limits, floor prices, ABAC ceilings, loyalty accrual, serial assignment),
cash register, day close, expenses, held carts, quotations, customers with a
credit and loyalty ledger, serials, paint mixing, 4 reports, the SaaS platform
console, and the sync push/pull engine.

**Multi-tenancy.** RLS enforced by Postgres, proven by `scripts/verify-rls.mjs`
(11 checks) against a real database in CI on every API change.

**Money engine.** `Money` + `calculateDocument` shared by API, POS and admin.
58 tests across `shared-utils` and `shared-types`.

**Sync.** Idempotent push on terminal-minted `localId`; pull as a per-entity
high-water checkpoint carrying raw microsecond timestamps; atomic page+checkpoint
application; tombstones for deletes.

**POS offline transaction core.** Product search (local FTS5), barcode lookup,
cart, pricing (default list), customer lookup, completing a sale, cash payment,
held carts, cash drawer sessions — all work with the network unplugged.

**CI.** Boundaries → typecheck → build → test → format, plus migrations + seed +
RLS proof against a real PostgreSQL 18. Per-app change detection.

---

## 2. P0 blockers — fix before any feature work

### B1 💀 A fresh POS install crashes on first launch

`apps/pos/electron/db/sqlite.ts`: migration **v3** creates `variant_prices`
already containing `is_default` (line 546), and migration **v4** then runs
`ALTER TABLE variant_prices ADD COLUMN is_default` (line 580).

Replayed against a clean database:

```
v1: OK   v2: OK   v3: OK   v4: FAIL -> duplicate column name: is_default
```

`migrate()` (line 733) has no error handling, and `openDatabase()` is unguarded
at `main.ts:88` — so the app throws before the window opens. Every machine that
already ran the app is fine; **every new terminal is bricked.**

Cause: commit `5641bb7` edited migration v3 after it had shipped, which the
file's own comment at line 313 forbids.

Fix: make v4 conditional (or drop the redundant statement), keeping v3 as
shipped. Add a test that replays every migration against an empty database — this
class of bug is invisible to every other check in the repo.

### B2 💀 Returns and refunds do not exist, and three documents claim they do

- `sales.controller.ts` has exactly 3 routes: `GET /sales`, `GET /sales/:id`,
  `POST /sales`. `sales.service.ts` has exactly 3 methods: `create`, `findById`,
  `list`.
- Permissions `sale:void` and `sale:return` exist and are attached to **zero**
  routes.
- `apps/pos/src/pages/Returns.tsx` is a complete UI — finds the sale, caps return
  quantity, computes the refund — and its confirm button (line 283) is
  `// TODO(phase-3): write the linked return to the outbox`. It closes the dialog
  and discards everything.
- `sync.service.ts` push handles 6 entity types; none is a return.
- The database is fully prepared: `sales.voidedAt/voidedBy/voidReason`,
  `sales.returnOfSaleId`, `saleItems.returnedQuantity`, and `StockService`
  already emits a `sale_return` ledger reason that nothing produces.

**`docs/ROADMAP.md:109` ticks "[x] Returns and refunds against an original sale"
and `modules/README.md` describes sales as "Sale creation, returns, voids". Both
are false.** A cashier can take goods back and hand over cash with no record
anywhere.

### B3 💀 Manager override hijacks the terminal's session, and needs network

`apps/pos/electron/ipc/index.ts:79` implements `auth:manager-override` by calling
`loginWithPin(managerPin)` — which calls `storeTokens(...)`
(`sync/api-client.ts`), **overwriting the terminal's access and refresh tokens
with the manager's.** Nothing restores the cashier: `PaymentDialog.tsx:369` only
sets a local boolean.

Consequences: every sale after an override is attributed to the manager on the
server and carries the manager's permissions, for the rest of the shift. And
because it is a network call, override does not work offline at all — in an
offline-first POS.

Fix: verify the manager's PIN **without** mutating the session, record the
override (who authorised what, on which line), and restore nothing because
nothing was replaced.

### B4 🔴 Offline login is impossible — and login gates the whole app

There is no local `users` table, no PIN hash, no permissions in SQLite. Grep
across `apps/pos/electron/` for `users|pin_hash|permission|role` returns no
schema and no queries. `user` is not in `SYNC_ENTITIES`, so the server has no way
to send them.

A signed-in till survives a restart (the renderer persists the cashier in
`localStorage`, with permissions frozen at last login and no expiry). But a
**cold-start offline terminal cannot be used at all**, and a shift change offline
is impossible. This defeats the primary premise of the product.

### B5 🔴 Receipt printing does not exist

`apps/pos/electron/hardware/index.ts` is 53 lines: `printer:receipt`,
`printer:test` and `cash-drawer:open` all `throw new Error("...lands in Phase
3")`; `printer:list` returns `[]`. No printing library is imported.

The renderer never calls it either — `Sale.tsx:744` "Print receipt" is wired to
`onClose`. A completed sale produces no customer document, online or offline.
For a VAT-registered UAE business this is a compliance problem, not a nicety.

### B6 🔴 Per-user ABAC limits never reach the POS

`maxDiscountPercent`, `maxSaleAmount`, `canApproveRefund` are enforced in
`sales.service.create` — but grep for them across `apps/pos/` returns nothing.
Offline, a cashier's discount ceiling is unenforced; the sale completes, the
receipt is handed over, and the server rejects it at push time.

This directly violates the architecture rule: *the API must enforce it when
online, and the POS must have the same rules locally when offline.* Floor price
**is** enforced locally (`store/cart.ts:241`) — follow that pattern.

### B7 🟡 Silent fallback to fake seed data on a real terminal

`pos-data.ts:230-257`: in Electron mode, `searchProducts`, `findByBarcode` and
`searchCustomers` fall back to `browserAdapter` **on error _or_ on an empty
result**. A real terminal whose catalogue has not synced shows 10 fake demo SKUs
and 2 fake customers, priced and sellable. `apiAdapter.signIn` similarly falls
back to hardcoded PINs 1234/2222/3333 (`pos-data.ts:883`).

Demo data must never be reachable from a production build.

---

## 3. Documentation that currently misleads

Fix these in the same pass as the code, or the next reader repeats the mistake.

| File | Claim | Reality |
|---|---|---|
| `docs/ROADMAP.md:109` | `[x]` Returns and refunds | Do not exist (**B2**) |
| `modules/README.md` | `sales` — "Sale creation, returns, voids" | Creation only |
| `modules/README.md` | `pricing` ✅ done | No module, no controller, no routes |
| `modules/README.md` | `transfers` ⬜ todo | Implemented and registered |
| `modules/README.md` | — | `devices` implemented but absent from the table |
| `serials.service.ts:23` | "`markReturned`/`restock` are written for when it does" | Neither method exists |

---

## 4. Feature audit, mapped to your checklist

Numbering follows your list. "Where" cites the strongest evidence.

### Foundation

| # | Area | Status | Notes |
|---|---|---|---|
| 1 | POS auth & security | 🟡 | Login/PIN/roles/branch/device-auth/session/auto-logout ✅ (`useIdleTimer(5)`, `App.tsx:36`). Screen lock 🔴. Manager approval 💀 **B3**. Offline auth 🔴 **B4**. Failed-login tracking ✅ (`users.failedLoginCount`). |
| 2 | Terminal management | 🟡 | Registration, device id, branch, status, last sync, version ✅. Default printer/receipt-format/price-list per terminal 🔴. Remote disable 🔴 (no route). No admin UI. |
| 3 | POS dashboard | 🟡 | Cashier/branch/drawer/online/sync status ✅ in `TopBar`. Today's sales, transaction count, pending-order count, low-stock warnings, notifications 🔴. |
| 27–30 | Offline mode, local DB, sync, conflicts | 🟡 | Transaction core offline ✅. Auth 🔴 **B4**. Conflict resolution 🔴 — pull is blind last-writer-wins upsert; `version` columns exist and are never compared. No backoff. `applied_with_warning` unhandled (`repositories.ts:830`). Rejected rows have no UI or retry path. |
| 55 | Offline multi-branch identity | ✅ | `tenantId`/`branchId`/`deviceId`/`localId`/`serverId`/timestamps/`syncStatus` all present. |

### Catalogue and pricing

| # | Area | Status | Notes |
|---|---|---|---|
| 4 | Product search | 🟡 | Name/SKU/barcode/partial/fuzzy ✅ (FTS5 + trigram). Brand/category/supplier-code/model/size search 🔴 — attributes are untyped JSONB, not indexed. Recent/frequent/favourite 🔴. Arabic/Bangla 🟡 — `nameTranslations` exists but the tsvector is `'english'` only, so non-Latin names are not full-text indexed. |
| 5 | Barcode | 🟡 | Scan (USB HID via keystroke heuristic) ✅, multiple barcodes per variant ✅ (`variant_barcodes`). Serial-mode scanner 💀 — `preload.ts:156` subscribes to `scanner:scan`, nothing emits it. Camera scanning 🔴. **Generation/label printing 🔴.** Supplier barcode 🔴 — no product↔supplier link exists at all. `variant_units.barcode` has **no unique index**. |
| 6 | Variants | 🟡 | Variants ✅. Typed size/colour/material/model/length 🔴 — free-form JSONB only, so "all 1-inch elbows" cannot be filtered without a scan. Variant-specific barcode/price/stock ✅. |
| 7 | **Units & conversion** | 📋 | **Schema-only, zero code.** `variant_units.conversionFactor` and `unitConversionFactor` on sale/PO lines exist; grep across `apps/` finds **no reader or writer**. `LineInput` in `shared-utils/totals.ts` has no unit field. **Selling a carton of 20 is impossible today.** For a hardware business this is the highest-value gap in this document. |
| 9 | Pricing engine | 🟡 | Retail/wholesale/dealer via price lists ✅, customer-specific ✅, min selling price ✅ + enforced ✅, price history ✅, override + approval 🟡 (override ✅; `sale_items.floorPriceOverriddenBy` **is never written** — the audit trail your §49 example describes does not capture who authorised it). **Quantity/bulk-break pricing 🔴** — no `minQuantity` column anywhere. Branch-specific pricing 🔴. **No CRUD API for price lists at all** — `price:read`/`price:write` are attached to zero routes; prices can only be set once, at product creation, from the admin. |
| 41 | Hardware-specific | 🟡 | Fractional quantity 🟡 — the store handles decimals, **the UI has only ±1 steppers**, so 1.5 m of cable cannot be entered. Weight ✅. Piece/box/carton 📋 (see #7). Alternative/substitute/compatible products 🔴 (no table). Cut-to-length 🔴. |
| 42 | Bundles / kits | 🔴 | No table, no code. |
| 43 | Serial / batch | 🟡 | Serials ✅ end-to-end (check-in at receipt, assign at sale, damage, lookup) — but **no POS capture UI**, and no restock/return path. **Batch tracking effectively 🔴** — `batchNumber` is recorded on goods receipt and then never carried to inventory, sale lines or the ledger. Expiry 🟡 — no expiry on stock balances, so no FEFO and no expiring-stock report. |
| 44 | Warranty | 🟡 | `products.warrantyMonths` ✅ + serial lookup ✅. No claim/RMA entity, no registration. |

### Selling

| # | Area | Status | Notes |
|---|---|---|---|
| 8 | Cart | 🟡 | Add/remove/qty/price override/line discount/floor block ✅. **UoM selection per line 🔴.** Decimal qty — store ✅, UI 🔴. **Cart-level discount and document note exist in the store and are wired to no control** (`setDocumentDiscount`, `setNote` are never called). Line notes 🔴. Undo delete 🔴. Product image 🔴 — `imageUrl` is fetched then dropped in `mapVariant`. |
| 10 | Discounts | 🟡 | Item ✅, limits + ABAC ceiling ✅ server-side, audit ✅. Cart discount 🔴 (unreachable). Discount reason 🔴. Offline ceiling 🔴 **B6**. |
| 11–12 | Customers, walk-in | 🟡 | Search/create/credit/balance/history ✅ via API. Walk-in ✅. **Offline create 🔴** — `createCustomer` is feature-detected and no bridge method exists, so a new credit customer cannot be created at the till. |
| 13 | Sales | ✅ | Creation is the heaviest write and is correct: one transaction covers sale, lines, payments, stock ledger and customer balance, with every refusal check before any write. |
| 14 | Multiple payment methods | ✅ | Split tender, cash/card/bank transfer/credit, 25-fils cash rounding, change. |
| 15 | Payment terminal integration | 🔴 | No abstraction, no provider. |
| 16–17 | Cash drawer, shift | ✅ | Open/close, pay-in/out with mandatory reason, blind count then variance reveal, mandatory shortfall note. **Denomination counting 🔴** (single scalar, no breakdown). |
| 18 | Hold / suspend | ✅ | Park, list, restore-and-delete atomically, discard. Deliberately not synced. |
| 19 | Quotations | 🟡 | Create/send/convert-to-sale ✅, prices snapshotted ✅, expiry ✅. **PDF 🔴, email 🔴, WhatsApp 🔴.** Convert→**order** 🔴. In the POS, `local_quotations.synced_at` is never stamped, so quotations display as unsynced forever; and `listQuotations` returns `[]` in both non-Electron modes. |
| 20 | Sales orders | 📋 | `orders`/`order_items` tables, `OrderStatus`, `stockReserved` column, `order:read`/`order:write` permissions — **no module, no controller, no service, no POS code.** |
| 21–22 | Returns, exchange | 💀 | See **B2**. Exchange 🔴. |
| 35 | Credit sales | ✅ | Limit, available credit, hold, block, override path, outstanding balance. |
| 36 | Customer payment collection | 🟡 | Collection ✅ (API + POS, folds into the drawer and the day close). **Statement 🔴** — payments are not allocated to specific invoices, so a true aged statement cannot be produced. |
| 37 | Expenses / cash out | ✅ | Category, amount, reason, cash-vs-non-cash, day-close linkage. Receipt attachment 🔴. Not syncable from POS. |

### Inventory and operations

| # | Area | Status | Notes |
|---|---|---|---|
| 23 | Inventory visibility | 🟡 | Available/reserved ✅ locally and via API. On-order and damaged not surfaced. **`offline_limit` was dropped in POS migration v3** — there is no cap on how far a disconnected till can oversell, even though `devices.offlineStockAllocation` exists server-side. |
| 24 | Branch inventory | 🟡 | `checkStockInOtherBranches` ✅ — but it calls the API directly from inside the offline-first adapter, so it is online-only and returns `[]` on failure. |
| 25 | Stock transfer | 🟡 | Full request→approve→ship→receive ✅ in the API. POS shows **incoming only** and bypasses `posData` to call the API directly — online-only. No approve/ship UI anywhere. No admin UI. No cancel/reject route. |
| 26 | Purchase receiving | 🟡 | API ✅ (landed cost, partial, damaged, serials). POS Receiving screen ✅ but online-only, and **matches scans against SKU, not barcode** (`Receiving.tsx:170`). |
| 33 | Barcode label printing | 🔴 | Nothing anywhere. |
| 48 | POS reports | 🔴 | No shift/X-report/Z-report screen in the POS. The API has 4 reports; day-close preview exists. |

### Platform

| # | Area | Status | Notes |
|---|---|---|---|
| 31 | Receipt printing | 🔴 | **B5.** |
| 32 | Customer display | 🔴 | Zero references. |
| 34 | Invoice & tax | 🟡 | VAT per tenant ✅, inclusive/exclusive ✅, per-line snapshot ✅, breakdown ✅, gapless numbering ✅, TRN fields ✅. **Credit note / debit note 🔴** (blocked on **B2**). No tax-rate table — rates live in tenant settings JSONB. |
| 38 | Commission | 🔴 | No table, and **`sales` has no salesperson column at all** — only `createdBy`. Attribution is impossible today. |
| 39 | Loyalty | 🟡 | Ledger + cached balance + earn/redeem inside sale creation + manual adjust ✅. **No tiers, no earn-rate table, no expiry, no POS UI, no coupons.** |
| 40 | Promotions | 🔴 | No table, no API. Date-bounded price rows are the intended substitute; there is no promotion entity, no bundle offer, no coupon. |
| 45 | Delivery | 🔴 | Nothing. Outbound delivery is entirely unmodelled. |
| 46 | WhatsApp | 🔴 | Schema ✅ (`whatsapp_conversations`, `whatsapp_messages`, `ai_actions`), env config ✅ incl. webhook signature secret. **No API module.** The admin page is hardcoded mock threads with scripted replies and no network call. |
| 47 | AI in POS | 🔴 | No module, no UI. |
| 49 | Audit log | 🟡 | Append-only table ✅, `@Audited` on many routes ✅, platform actions ✅. **Price-override authoriser is never recorded** (§9). POS-side actions are not audited. |
| 50 | Notifications | 🔴 | No table, no API, no UI. Low stock is pull-only. Admin's notification dropdown is two hardcoded fakes. |
| 51 | System health | ✅ | Online/sync/last-sync/pending count in `TopBar`; `/health` + `/ready`. |
| 52 | Updates | 🔴 | `electron-updater` is a dependency; no update flow, no version check, no rollback. |
| 53 | Backup & recovery | 🔴 | Nothing. |
| 54 | Multi-branch | ✅ | Tenant → branch → terminal throughout, RLS-enforced, branch-scoped ABAC. |
| 56 | Performance | ❓ | Never measured. FTS5 + indices suggest the targets are reachable; no benchmark exists. |
| 57 | Keyboard shortcuts | 🟡 | `Ctrl+1..8` navigation, `F1/F2/F4/F7/F8/Esc` on Sale, `F5/F6/F8` on drawer, PIN digits on login. **`F3` Discount, `F4` Refund and `Esc` Back are drawn on the key rail with no key bound** — they are click-only, which is worse than absent because the label promises a key that does nothing. |
| 58 | Touchscreen mode | 🔴 | No category grid, no product tiles. Search + list only. |
| 59 | POS UI layout | ✅ | Matches your sketch: search left, cart right, key rail beneath. |

### Admin panel

Twelve pages exist, ~5,700 lines. Real but shallow, and **there is no route
protection at all** — signed-out users render every page.

- **Real:** inventory (best page — balances, ledger, adjust, transfer), suppliers,
  sales list (read-only), branches, products (create-only), customers
  (create-only), users (create/deactivate).
- **Mocked or inert:** `/reports` falls back to hardcoded figures and its
  7d/30d/90d selector is never sent to the API; `/whatsapp` is entirely
  fabricated; `/settings` saves to `localStorage` and never reaches the backend;
  `/branches` substitutes two fake branches on fetch failure; login credentials
  are pre-filled and displayed on screen.
- **Absent:** purchase orders, price-list management, category/brand management,
  roles/permissions editor, device management, transfer approval, day-close
  review, audit-log viewer, product edit/delete.

---

## 5. Execution order

Dependency-ordered. Each step states its own acceptance criteria. Do not start a
later step to avoid an earlier one.

### Stage 0 — Stop the bleeding (do first, in one pass)

| # | Work | Accept when |
|---|---|---|
| 0.1 | Fix **B1** fresh-install crash | A test replays every POS migration against an empty database and passes; a new terminal boots |
| 0.2 | Fix **B3** manager-override session hijack | Override verifies a PIN without replacing the terminal session; a sale after an override is still attributed to the cashier |
| 0.3 | Remove **B7** demo-data fallbacks from Electron and API modes | An unsynced terminal shows an empty catalogue, not fake SKUs; seed PINs are unreachable outside browser dev mode |
| 0.4 | Correct the four false claims in §3 | `ROADMAP.md` and `modules/README.md` match the code |
| 0.5 | Add route protection to the admin | Signed-out access to any page redirects to `/login` |

### Stage 1 — Make the offline promise true

| # | Work | Accept when |
|---|---|---|
| 1.1 | **B4** offline auth: add a `user` sync entity; mirror users, PIN hashes (never plaintext) and permissions to SQLite; verify PIN locally | A terminal with the network unplugged from cold start can sign a cashier in and sell |
| 1.2 | **B6** sync ABAC limits with the user record and enforce them in the cart | An offline cashier is refused a discount above their ceiling, with the same message the API gives |
| 1.3 | Offline manager override on the local user mirror | Override works with the network unplugged and records who authorised what |
| 1.4 | Surface rejected outbox rows: an IPC channel, a Settings list, retry/discard | A rejected sale is visible with its reason and can be acted on |
| 1.5 | Handle `applied_with_warning`; stamp `local_quotations.synced_at` | A warned push settles instead of re-pushing forever; a synced quotation stops showing as unsynced |
| 1.6 | Restore a per-terminal offline stock ceiling using `devices.offlineStockAllocation` | A disconnected till refuses to oversell past its allocation |

### Stage 2 — Returns, and the documents that depend on them

| # | Work | Accept when |
|---|---|---|
| 2.1 | API: return + void + refund. Decide whether a return is a linked negative sale (the schema's current design) or a first-class `sale_returns` table with its own number series and per-line restock-vs-scrap disposition. **Write this decision into `docs/DECISIONS.md` before coding.** | `sale:return`/`sale:void` gate real routes; stock returns via `StockService`; refund is a negative payment; day close and drawer both see it |
| 2.2 | Add a `return` entity to sync push | A return created offline reaches the server exactly once |
| 2.3 | Wire `Returns.tsx` to it | Your §21 flow works: 100 AED back, stock restocked or scrapped, cash out of the drawer |
| 2.4 | Exchange | Your §22 flow: return 100, take 130, POS charges 30 |
| 2.5 | Record the price-override authoriser | `sale_items.floorPriceOverriddenBy` is written and visible in the audit log |

### Stage 3 — Units of measure (the hardware unlock)

| # | Work | Accept when |
|---|---|---|
| 3.1 | Carry `unitId` + `conversionFactor` through `LineInput`/`calculateDocument`, sale lines, and the stock ledger. **Stock always moves in base units**; the sold unit and factor are snapshotted on the line. | Selling 1 carton deducts 20 pieces; the receipt says "1 carton"; a later report reconciles |
| 3.2 | Pull `variant_units` into the POS mirror | Unit choices are available offline |
| 3.3 | Cart UI: unit selector per line, and a typed quantity field | 1.5 m of cable and 2 boxes of screws can both be entered |
| 3.4 | Admin: manage packagings per variant | An owner can define 1 carton = 20 pieces without SQL |

### Stage 4 — Receipts and hardware

| # | Work | Accept when |
|---|---|---|
| 4.1 | **B5** ESC/POS receipt rendering, 58 mm and 80 mm | A completed sale prints a compliant tax invoice: TRN, VAT breakdown, lines, tender, change |
| 4.2 | Wire the Print button and add reprint | `Sale.tsx` "Print receipt" prints; a past sale can be reprinted marked DUPLICATE |
| 4.3 | Cash drawer kick on cash tender, with the reason logged | Drawer opens on cash sale; every manual open is audited |
| 4.4 | A4 tax invoice | A wholesale customer gets an A4 invoice |

> Blocked on **open decision #2 and #3** in `docs/DECISIONS.md` — the scanner and
> printer models. Confirm the hardware before building against an assumption.

### Stage 5 — Fill the pricing and catalogue gaps

| # | Work | Accept when |
|---|---|---|
| 5.1 | A real `pricing` module: `@Module`, controller, CRUD for price lists / product prices / customer prices, using the four unused `price:*` permissions | Prices are managed after creation; bulk update works |
| 5.2 | Quantity-break pricing (`minQuantity` on `product_prices`) | 1–9 at 10.00, 10+ at 8.50, resolved by the same ladder, offline too |
| 5.3 | Typed variant attributes (size/colour/material/model) or an attribute-definition table + index | "All 1-inch elbows" is a query, not a scan |
| 5.4 | Product↔supplier link with supplier SKU and supplier barcode | Receiving can match a supplier's own barcode |
| 5.5 | Finish the product importer (`tools/import` is a documented scaffold) | 5,000 SKUs import idempotently, dry-run first, price changes as history |
| 5.6 | Admin: product edit/delete, category/brand management, image upload | The catalogue is maintainable without SQL |

### Stage 6 — Orders, and the quotation→order→invoice chain

| # | Work | Accept when |
|---|---|---|
| 6.1 | `orders` module using the existing tables and permissions | Create, confirm, cancel, partial fulfilment |
| 6.2 | Stock reservation on confirmation, release on cancel/expiry | `inventory.reservedQuantity` moves; available-to-sell drops |
| 6.3 | Quotation → order → invoice | Your §19 status chain works end to end |
| 6.4 | Quotation PDF | A quote can be printed and attached |

### Stage 7 — Admin depth

Purchase orders UI, transfer approval/shipping, day-close review, audit-log
viewer, device management, roles/permissions editor, real reports (remove every
hardcoded fallback; wire the date range), settings persisted to the API.

### Stage 8 — WhatsApp, then AI

Webhook with `X-Hub-Signature-256` verification and a 200 before any AI work;
send/receive; templates and the 24-hour window; conversation state; phone →
customer matching. Only then the LLM tool functions. Replace the mocked admin
page with the real thread view.

> Blocked on **open decision #4** — the LLM provider.

### Stage 9 — Commercial features

Bundles, promotions/coupons, loyalty tiers and expiry, commission (needs a
salesperson column on `sales` first), delivery, notifications, warranty claims,
customer statements with invoice allocation, cash denomination counting.

### Stage 10 — Operational hardening

Backup and restore, POS auto-update with rollback and offline-safe migration,
performance benchmarks against your §56 targets, and test coverage — **21 of 25
API modules and the entire POS have no tests today.**

---

## 6. Cross-cutting debt worth fixing opportunistically

- **18 of 60 permissions are attached to zero routes**: `product:import`,
  `price:*` (4), `order:*` (2), `sale:void`, `sale:return`, `sale:discount`,
  `payment:*` (2), `whatsapp:*` (3), `role:write`, `device:manage`, `audit:read`.
  Each is either a missing feature or a missing check.
- **Missing foreign keys**: `payments.saleId`, `payments.cashSessionId`,
  `customers.priceListId`, `serialNumbers.branchId`, `serialNumbers.saleItemId`
  are plain `uuid` columns with no FK.
- **`quotations` and `orders` carry `localId` with no unique index**, so the
  idempotency guarantee `syncable()` documents does not hold for them.
- **No line-item table is syncable** — `sale_items`, `order_items`,
  `quotation_items` have no `localId`.
- **Seven append-only tables have no `updatedAt`**, so the `updated_at`-ordered
  sync pull cannot page them.
- **Dead POS schema**: `local_orders`/`local_order_items` are never read or
  written; `deleted_records` is written and never read; `version` and
  `customers.sync_status` are never used.
- **Endpoint inconsistency**: `pos-data.ts` uses `/cash-register/...` for open and
  close but `/cash-registers/sessions/...` for movements.
- **Admin form bugs**: `/suppliers` never binds `contactPerson`; `/users` posts
  `canApproveRefund`/`canViewCost` with no controls and hardcodes `roleId`.
- **`pricing` has no `@Module`** — `PriceResolverService` is duplicated as a
  provider in three modules.

---

## 7. Open decisions that block work

From `docs/DECISIONS.md`. Resolve before the dependent stage, not during it.

| # | Question | Blocks |
|---|---|---|
| 1 | The real product price list | Stage 5 — final pricing schema and the importer |
| 2 | Barcode scanner model (USB HID assumed) | Stage 4 — scanner integration |
| 3 | Thermal printer models (58 mm / 80 mm) | Stage 4 — receipt rendering |
| 4 | LLM provider | Stage 8 — AI module |

New decision needed:

| # | Question | Blocks |
|---|---|---|
| 5 | Is a return a linked negative sale, or a first-class `sale_returns` document with its own number series? | Stage 2 — everything about returns, credit notes and VAT reporting |
