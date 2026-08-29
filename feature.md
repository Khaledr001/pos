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

### B1 ✅ A fresh POS install crashed on first launch — FIXED (commit 77969b4)

Migration v4 is now a function step (`up`, not `sql`) that checks
`table_info` before each statement, so it is correct whichever state a
database arrives in rather than assuming v3 never created `is_default`.
`ensureColumns()` — a prior defensive patch that ran AFTER `migrate()` and so
never actually fired before the crash — is removed as fully redundant.
`openDatabase()`'s call site now catches a genuine open failure and shows a
native error dialog instead of quitting with nothing visible.

Covered by `apps/pos/electron/db/__tests__/migrations.test.ts`, run via
`pnpm test:electron` (wired into `pnpm test`): it has to execute through
Electron's own Node, because the `better-sqlite3` binary this repo builds is
compiled for Electron's ABI and a plain `vitest run` cannot load it at all.

### B2 ✅ Returns and refunds did not exist — FIXED (Stage 2.1–2.5, commits 8e147b5, f50a2dd, 95c6e0e, 8a118c4, e45892a)

Void, return and exchange are all real now, end to end: `POST /sales/:id/void`
and `POST /sales/returns` (`sale:void`/`sale:return`, previously attached to
zero routes), a linked negative sale per D15, stock restored via
`StockService`, payments reversed or refunded as negative rows, the
customer's credit balance adjusted either direction. `sync.service.ts` accepts
a `return` push entity, so one created offline reaches the server exactly
once. `Returns.tsx`'s confirm button — previously `// TODO(phase-3)` — now
calls it, with the restock/scrap disposition toggle and refund-method
selector the UI never had, plus an exchange section that adds new items and
settles the net at the till. `saleItems.floorPriceOverriddenBy` is written
when a below-floor line actually needed a grant. All verified live against a
real Postgres + running API.

**Still open**: cross-terminal returns are not supported — `findSale` has no
path to a sale rung up on another till until both have synced, so today's
return (and exchange) is same-till-only; this is a real, documented scope
narrowing, not an oversight. A printed refund receipt waits on Stage 4
(hardware decisions). The POS UI wiring (2.3, 2.4) was verified by typecheck
and production build, not by running it in a browser — no browser-automation
tool was available when it was built.

`docs/ROADMAP.md:109`'s "[x] Returns and refunds against an original sale" and
`modules/README.md`'s "Sale creation, returns, voids" are now accurate for the
core flow; exchange is still not.

### B3 ✅ Manager override hijacks the terminal's session — FIXED (commit 194b33d)

The session-hijack half is closed. `POST /auth/verify-override` verifies the
PIN, checks the permission server-side, writes the `audit_log` row in the same
transaction, and **mints no tokens** — the cashier's session continues
untouched. It returns a short-lived signed grant (12h, `typ: "override"`, bound
to tenant and branch) which the sale carries in `overrideGrants[]`, so an
approval given at the counter still counts when the push lands hours later. An
unverifiable grant is discarded rather than fatal, so a forged one buys nothing.

Wired through: `price:override`, `price:override_floor`, `sale:discount` (which
lends the approver's own ceiling), and `customer:credit`.

**Still open: overrides need the network — and unlike B4, this does not
resolve by adding a local mirror.** B4 (Stage 1.1) shipped local PIN
verification for sign-in, which was the same underlying problem for THAT case.
Overrides looked identical at first glance but are not: verifying the
approver's identity locally is the easy half. The other half is the sale
carrying proof the SERVER will trust, and nothing on a terminal can sign a
grant the server would honour without a device-signing-key architecture that
does not exist. A local-only "approval" would let a cashier proceed believing
it worked, and the sale would be refused on push every single time — not
occasionally, always — discovered only once it lands in the rejected-items
list Stage 1.4 built, which is worse than refusing at the counter while the
manager approving it is standing right there. Traced through fully and
deliberately NOT built for this reason (see Stage 1.3).

The UI now says so, honestly, rather than surfacing a raw connectivity error:
`auth:manager-override` distinguishes a genuine server refusal (`ApiError` —
wrong PIN, insufficient permission) from the request never reaching the
server at all, and gives the latter its own clear message instead of
whatever a bare failed `fetch` happened to produce.

### B4 🟡 Offline login is impossible — PARTLY FIXED (Stage 1.1, commit 4cebfd3)

A cold-start, fully offline terminal can now sign a cashier in and sell.
`user` joined `SYNC_ENTITIES`; the API pulls branch-scoped staff plus
tenant-wide ones (owners, area managers), gated on nothing beyond the pull
route's own `product:read` — every terminal needs this to let any of its staff
sign in offline. `electron/db/local-auth.ts` verifies a PIN against the
mirrored hash with the same ambiguous-PIN refusal `resolvePinHolder` uses
online, and a per-terminal throttle (not a per-account lockout — a wrong PIN
identifies nobody, same reason the server doesn't track one either) stands in
for the route rate limit that has nothing to bind to offline.
`auth:pin-login` tries the network first and only falls back to the mirror
when the request never got an answer at all — a definitive server response
(wrong PIN, a lockout, a deactivated device) is trusted as-is.

**Scope was deliberately narrowed, confirmed with the user before building:**
sale attribution while fully offline is NOT solved. The local outbox still
never records who rang up a sale — attribution comes entirely from whichever
token the terminal is authenticated as when a sale eventually pushes, exactly
as it did before this fix. A sale rung up offline by cashier B, on a terminal
whose stored token belongs to cashier A, is still attributed to A. Fixing that
needs a device-level credential architecture that does not exist today: the
outbox would have to carry who rang each sale up, and the server would have
to trust a device to attest to it — a real, additive trust boundary, not a
patch. Worth its own decision and its own stage if it's wanted.

### B5 🔴 Receipt printing does not exist

`apps/pos/electron/hardware/index.ts` is 53 lines: `printer:receipt`,
`printer:test` and `cash-drawer:open` all `throw new Error("...lands in Phase
3")`; `printer:list` returns `[]`. No printing library is imported.

The renderer never calls it either — `Sale.tsx:744` "Print receipt" is wired to
`onClose`. A completed sale produces no customer document, online or offline.
For a VAT-registered UAE business this is a compliance problem, not a nicety.

### B6 🟡 Per-user ABAC limits never reach the POS — PARTLY FIXED (commit 63800f6)

`maxDiscountPercent` now travels in `AuthSession.user`, is held in
`store/auth.ts`, and gates the discount input in `Sale.tsx`'s line editor:
above the ceiling the cashier is asked for a manager's approval instead of
being allowed to type a figure the server will refuse after the receipt has
printed. Undercutting list price is gated the same way, via `price:override`.

**Still open:** `maxSaleAmount` and `canApproveRefund` are still enforced only
server-side, so a sale above a cashier's per-sale ceiling still completes at the
till and is rejected at push. Follow the pattern the discount ceiling now uses —
carry the value in the session, gate the control, and let the server remain the
authority.

### B7 ✅ Silent fallback to fake seed data on a real terminal — FIXED

`electronAdapter` and `apiAdapter` no longer call into `browserAdapter` for
any reason. An empty result is now answered with an empty result — an unsynced
terminal shows an empty catalogue, not ten fake demo SKUs — and a genuine error
is answered with an empty result (searches) or a rethrow (sign-in, customer
creation), never with fake data.

The worst instance was `apiAdapter.signIn`: ANY failure reaching the API — the
network down, a wrong PIN, a misconfigured terminal — fell through to checking
the hardcoded PINs 1234/2222/3333, and a match signed the cashier in as a fake
administrator with every permission granted. That path is gone; a failed
sign-in now surfaces the real reason. `SEED_STAFF`'s PINs are reachable only
through `browserAdapter` directly, which only runs in `dataMode === "browser"`
— no bridge and no `VITE_API_URL`, i.e. `pnpm dev:ui` and nothing a real
terminal can reach.

Found and fixed in the same pass: `Login.tsx`'s sign-in call never threaded
`maxDiscountPercent` through to the store, so every PIN sign-in read as a 0%
discount ceiling regardless of the cashier's real one — not a security gap
(the server was always the actual authority), but it meant the discount
ceiling built for **B6** asked every cashier for a manager's approval on every
discount, not just the ones actually over their line.

---

## 3. Documentation that currently misleads — CORRECTED

All six below are fixed. Left here as the record of what was wrong and why it
mattered, since the next reader who trusted one of these would have repeated
its mistake.

| File | Claim | Reality |
|---|---|---|
| `docs/ROADMAP.md:109` | `[x]` Returns and refunds | Do not exist (**B2**) — now `[ ]`, with a pointer to B2 |
| `modules/README.md` | `sales` — "Sale creation, returns, voids" | Creation only — now says so, with a pointer to B2 |
| `modules/README.md` | `pricing` ✅ done | No module, no controller, no routes — now 🟡 partial, describing exactly what exists (`PriceResolverService`, duplicated three times) and what does not |
| `modules/README.md` | `transfers` ⬜ todo | Implemented and registered — now ✅ done |
| `modules/README.md` | — | `devices` implemented but absent from the table — now listed |
| `serials.service.ts:23` | "`markReturned`/`restock` are written for when it does" | Neither method exists — comment now says so, and says where to build them (alongside the return service, same transaction) |
| `docs/PATTERNS.md` | — | Now has an **Authorisation** section covering all four checks (permission, branch scope, ABAC ceiling, override grant). Read it before touching a guard. |

---

## 4. Feature audit, mapped to your checklist

Numbering follows your list. "Where" cites the strongest evidence.

### Foundation

| # | Area | Status | Notes |
|---|---|---|---|
| 1 | POS auth & security | 🟡 | Login/PIN/roles/branch/device-auth/session/auto-logout ✅ (`useIdleTimer(5)`, `App.tsx:36`). Screen lock 🔴. Manager approval ✅ **B3**. Offline auth 🟡 **B4** — sign-in works, offline sale attribution does not. Failed-login tracking ✅ (`users.failedLoginCount`). |
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
| 21–22 | Returns, exchange | ✅ | See **B2**: void, linked-negative return, exchange, sync push, POS UI, floor-override attribution, all live-verified. Same-till only until `findSale` gets a cross-terminal path. |
| 35 | Credit sales | ✅ | Limit, available credit, hold, block, override path, outstanding balance. |
| 36 | Customer payment collection | 🟡 | Collection ✅ (API + POS, folds into the drawer and the day close). **Statement 🔴** — payments are not allocated to specific invoices, so a true aged statement cannot be produced. |
| 37 | Expenses / cash out | ✅ | Category, amount, reason, cash-vs-non-cash, day-close linkage. Receipt attachment 🔴. Not syncable from POS. |

### Inventory and operations

| # | Area | Status | Notes |
|---|---|---|---|
| 23 | Inventory visibility | 🟡 | Available/reserved ✅ locally and via API. On-order and damaged not surfaced. A local offline ceiling now refuses a sale past `quantity - reserved_qty + local_delta` (commit 55f1723) — single-terminal overselling is caught; the cross-terminal race `devices.offlineStockAllocation` describes (disjoint slices across a branch’s terminals) is a separate, larger decision the user deferred — see B4-adjacent note in Stage 1.6. |
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
| 50 | Notifications | 🟡 | `notifications` table, module, WebSocket push ✅ (D17). Admin navbar panel is real — list, unread badge, mark read/all-read, live via socket with a 60s poll fallback. Only emitter: low-stock threshold crossing, hooked into `StockService.post()`. Sale/order/system/due-reminder triggers, retention, `/notifications` page, dismiss and broadcast routes 🔴. POS side untouched — still row 3. |
| 51 | System health | ✅ | Online/sync/last-sync/pending count in `TopBar`; `/health` + `/ready`. |
| 52 | Updates | 🔴 | `electron-updater` is a dependency; no update flow, no version check, no rollback. |
| 53 | Backup & recovery | 🔴 | Nothing. |
| 54 | Multi-branch | ✅ | Tenant → branch → terminal throughout, RLS-enforced, branch-scoped ABAC. |
| 60 | Platform / SuperAdmin console | 🟡 | Stats, tenant directory + detail, provision, suspend/activate, change plan, audit trail, health, accountable impersonation — all ✅ and `@PlatformOnly()`-gated. Impersonation carries a signed `impersonatedBy` claim, mints no refresh token, and is ended by the server (D18). **Billing 🔴** — no checkout, no webhooks, `subscriptionEndsAt` gates nothing. `maxDevices` is defined on every plan and enforced nowhere. Platform access is all-or-nothing: no read-only operator role, so "view uptime" and "impersonate any tenant" are the same privilege. |
| 56 | Performance | ❓ | Never measured. FTS5 + indices suggest the targets are reachable; no benchmark exists. |
| 57 | Keyboard shortcuts | 🟡 | `Ctrl+1..8` navigation, `F1/F2/F4/F7/F8/Esc` on Sale, `F5/F6/F8` on drawer, PIN digits on login. **`F3` Discount, `F4` Refund and `Esc` Back are drawn on the key rail with no key bound** — they are click-only, which is worse than absent because the label promises a key that does nothing. |
| 58 | Touchscreen mode | 🔴 | No category grid, no product tiles. Search + list only. |
| 59 | POS UI layout | ✅ | Matches your sketch: search left, cart right, key rail beneath. |

### Admin panel

Twelve pages exist, ~5,700 lines. Real but shallow.

**Route protection landed in commit 194b33d** and is no longer a gap: `AppShell`
wraps every route except `/login` in `RequireAuth`, driven by one reviewable
`ROUTE_PERMISSIONS` map, the sidebar filters itself by permission, and
`api-client` does a single-flight refresh on 401 instead of silently breaking
fifteen minutes into every session. The pre-filled seed credentials are gone,
as is the `ChangeMe123!` default on new staff. A CSP and the usual security
headers are set in `next.config.ts`.

Note what that does NOT change: the guard is a courtesy, not a boundary. The
API decides. See rule 9 in CLAUDE.md.

- **Real:** inventory (best page — balances, ledger, adjust, transfer), suppliers,
  sales list (read-only), branches, products (create-only), customers
  (create-only), users (create/deactivate).
- **Mocked or inert:** `/reports` falls back to hardcoded figures and its
  7d/30d/90d selector is never sent to the API; `/whatsapp` is entirely
  fabricated; `/settings` saves to `localStorage` and never reaches the backend;
  `/branches` substitutes two fake branches on fetch failure.
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
| 0.1 | ~~Fix **B1** fresh-install crash~~ **DONE** (77969b4) | ~~A test replays every POS migration against an empty database and passes; a new terminal boots~~ — done |
| 0.2 | ~~Fix **B3** manager-override session hijack~~ **DONE** (194b33d) | ~~Override verifies a PIN without replacing the terminal session; a sale after an override is still attributed to the cashier~~ — done, and the approval now travels with the document so it survives an offline push |
| 0.3 | ~~Remove **B7** demo-data fallbacks from Electron and API modes~~ **DONE** | ~~An unsynced terminal shows an empty catalogue, not fake SKUs; seed PINs are unreachable outside browser dev mode~~ — done |
| 0.4 | ~~Correct the four false claims in §3~~ **DONE** | ~~ROADMAP.md and modules/README.md match the code~~ — done |
| 0.5 | ~~Add route protection to the admin~~ **DONE** (194b33d) | ~~Signed-out access to any page redirects to `/login`~~ — done, plus per-route permissions, a filtered sidebar, and refresh-on-401 |

### Stage 1 — Make the offline promise true

| # | Work | Accept when |
|---|---|---|
| 1.1 | ~~**B4** offline auth~~ **DONE** (4cebfd3) | ~~A terminal with the network unplugged from cold start can sign a cashier in and sell~~ — done. Offline sale attribution is a separate, still-open decision — see B4. |
| 1.2 | ~~**B6** sync ABAC limits with the user record and enforce them in the cart~~ **DONE** (63800f6, 4cebfd3) | ~~An offline cashier is refused a discount above their ceiling, with the same message the API gives~~ — done for `maxDiscountPercent` (the ceiling now travels through BOTH sign-in paths built in 1.1, gated proactively in the line editor rather than reactively after an attempt — the spirit, not the literal string, matches). `maxSaleAmount`/`canApproveRefund` are unchanged: the latter has nothing to gate until returns exist (**B2**); the former has no server-side override path to sync toward yet, so building POS gating for it now would be gating against a wall. |
| 1.4 | ~~Surface rejected outbox rows: an IPC channel, a Settings list, retry/discard~~ **DONE** | ~~A rejected sale is visible with its reason and can be acted on~~ — done, and widened to cover `applied_with_warning` too: both are "something a human has to look at", one queue in Settings. Built and shipped BEFORE 1.3, out of the plan's own stated order — see the note below. |
| 1.5 | ~~Handle `applied_with_warning`; stamp `local_quotations.synced_at`~~ **DONE** | ~~A warned push settles instead of re-pushing forever; a synced quotation stops showing as unsynced~~ — done, and `local_customer_payments.synced_at` fixed alongside it: same bug, same fix, found while touching the same function. |
| 1.3 | ~~Offline manager override on the local user mirror~~ **CONCLUDED: not buildable as scoped, honest fallback shipped instead** | Traced through fully rather than attempted: verifying an approver's PIN locally is the easy half; the sale still needs proof the SERVER will trust, and nothing on a terminal can sign a grant it would honour without a device-signing-key architecture that does not exist. A local-only "approval" would fail on push every time, not occasionally — discovered only in 1.4's rejected list, which is worse than refusing at the counter. Shipped instead: `auth:manager-override` now tells a cashier plainly that this needs the network, instead of surfacing a raw connectivity error. Building the real thing is a new device-credential subsystem, not an extension of Stage 1 — see B3. |
| 1.6 | ~~Restore a per-terminal offline stock ceiling~~ **DONE, narrowed scope (confirmed with the user)** | ~~A disconnected till refuses to oversell past its allocation~~ — done for the SINGLE-terminal case: `commitSale` refuses a line past `quantity - reserved_qty + local_delta` for that variant, skipped when the tenant's own `sales.allowNegativeStock` says to allow it (now pulled on every sync as a top-level `SyncPullResponse` field, the same pattern `stockAllocation` itself uses). **NOT built**: the disjoint cross-terminal slice `devices.offlineStockAllocation` describes — two different offline terminals can still both sell the last unit of one SKU. That needs a server-side division algorithm (equal split? by recent velocity? a walk-in floor?) that is a product decision, not an engineering one, and does not exist. If wanted, it is a new subsystem, not an extension of this fix. |

### Stage 2 — Returns, and the documents that depend on them

| # | Work | Accept when |
|---|---|---|
| 2.1 | ~~API: return + void + refund, as a linked negative sale~~ **DONE** (8e147b5) | ~~`sale:return`/`sale:void` gate real routes; stock returns via `StockService`; refund is a negative payment; day close and drawer both see it~~ — done. `sale:void` fully restocks and reverses payments, refused once any line has a return against it. `sale:return` writes a new negative `sales` row (`returnOfSaleId`) priced at each line's own historical snapshot, per-line `restock`/`scrap` disposition, refund as a negative payment, uncovered amount reduces the customer's credit balance. Both idempotent on `localId`, same pattern as `create()`. Verified live: stock, sale status/`returnedQuantity`, and credit balance all correct through a full void and a partial credit-sale return; every refusal path (over-return, return-a-return, void-after-return, missing permission) confirmed with the right error code and HTTP status. Day-close/drawer visibility not separately re-verified — payments are ordinary rows in the same table, so the existing day-close query already sees them; flag if that assumption turns out wrong in practice. |
| 2.2 | ~~Add a `return` entity to sync push~~ **DONE** (f50a2dd) | ~~A return created offline reaches the server exactly once~~ — done. `local_returns`/`local_return_items` mirror a return offline, naming each line by its position on the original sale (neither end ever learns a `sale_items.id` for a till-rung sale); `sync.service.ts` resolves that back to a real `saleItemId` server-side and calls the same `createReturn` a direct API caller would. Restocked lines credit `local_delta` back so the unit is sellable again before the next sync; scrapped lines move nothing. Verified live: same-batch push resolves the original by `localId`, retries return the same duplicate, a stale line is permanently rejected. **Not done**: wiring `Returns.tsx`'s own confirm button to this — that is 2.3. Scope note: only a same-till original is supported (`sales:find` has no cross-terminal path yet); a return against another terminal's sale needs 2.3 to actually search one down first. |
| 2.3 | ~~Wire `Returns.tsx` to it~~ **DONE** (95c6e0e) | ~~Your §21 flow works: 100 AED back, stock restocked or scrapped, cash out of the drawer~~ — done. Confirm button calls `posData.commitReturn`; added the disposition toggle (restock/scrap) and refund-method selector the UI never had; a cash refund records a `cash_out` cash_movement so the drawer total reflects it. Verified: typecheck, production build (non-minified diff reviewed), 9 electron tests. **Not verified**: this UI in a running browser/Electron window — no browser-automation tool available in this environment; the data path it calls was verified live end-to-end in 2.2. **Not done**: cross-terminal returns (same `findSale` limitation as 2.2) and a printed refund receipt (Stage 4, blocked on hardware decisions). |
| 2.4 | ~~Exchange~~ **DONE** (e45892a) | ~~Your §22 flow: return 100, take 130, POS charges 30~~ — done, in `Returns.tsx` (confirmed with the user rather than a new page). Modeled as two independent, fully self-settled documents (return refunds in full, new sale paid in full) rather than one blended tender — no customer required for a walk-in, nothing left "uncovered". The net figure ("Customer pays 30") is what the cashier sees and collects; the drawer's actual cash movement lands on the same number either way. Also fixed a real gap found while building this: `createReturn` let an uncovered refund vanish untracked with no customer attached — now mirrors `create()`'s own "needs a customer for what isn't paid in cash" rule. Verified live (walk-in refusal, and a full return + full new sale leaving credit balance and both variants' stock exactly right). Not verified in a running browser — see 2.3's same note. |
| 2.5 | ~~Record the price-override authoriser~~ **DONE** (8a118c4) | ~~`sale_items.floorPriceOverriddenBy` is written and visible in the audit log~~ — done. Written only when a grant, not the cashier's own permission, was what let a genuinely-below-floor line through — a cashier who already holds `price:override_floor` outright has nobody to attribute. Verified live with a real override grant (stamped with the approving manager's id) and both negative cases (at/above floor; a manager's own permission). `sale:create`'s existing `@Audited` row plus this column together give a reviewer both "a sale happened" and "who approved this specific line" — no separate audit-log entry needed. |

### Stage 3 — Units of measure (the hardware unlock)

| # | Work | Accept when |
|---|---|---|
| 3.1 | ~~Carry `unitId` + `conversionFactor` through `LineInput`/`calculateDocument`, sale lines, and the stock ledger. **Stock always moves in base units**; the sold unit and factor are snapshotted on the line.~~ **DONE** (63facca) | ~~Selling 1 carton deducts 20 pieces; the receipt says "1 carton"; a later report reconciles~~ — done. `calculateDocument`/`LineInput` needed no change at all: a line's `quantity`/`unitPrice` already meant "sold quantity, price per sold unit" regardless of which unit that is, so packaging math (resolve `variant_units`, scale the listed price and floor by the conversion factor, or use a flat `priceOverride`) lives entirely in `create()`, ahead of the existing per-line checks. Stock deducts `quantity × conversionFactor`. Found and fixed two real, pre-existing bugs while wiring the OTHER end of the same lines: `void()` and `createReturn()` both restocked in the SOLD unit, not base units — voiding or returning "1 box" would have put back 1 piece. Both now scale correctly, and a return also carries the original line's `unitId`/`unitConversionFactor` forward. All verified live (sell 1 box of 50 → deducts 50, floor scales, undercut still refused; void and return both restock 50). |
| 3.2 | ~~Pull `variant_units` into the POS mirror~~ **DONE** (72db795) | ~~Unit choices are available offline~~ — done. New `variant_unit` sync entity, no branch scope (catalogue data) and no tombstone (the server row carries no `deletedAt` — a retired packaging flips `isSellable` instead). Local `variant_units` table mirrors `variant_prices`; exposed as `unitsForVariant(variantId)` through IPC/preload/bridge/pos-data. Verified live via `/sync/pull`. **Not done, deliberately**: not yet attached to product search results or any UI — that is 3.3, once the cart actually offers a choice. |
| 3.3 | ~~Cart UI: unit selector per line, and a typed quantity field~~ **DONE** (c3ba28d) | ~~1.5 m of cable and 2 boxes of screws can both be entered~~ — done. `CartLine.unit` snapshots the chosen packaging like `product` already was; a unit dropdown appears per line once `unitsForVariant` has options, and the quantity display became a real editable input (committed on blur/Enter, revert-not-delete on an invalid mid-edit value). Found and fixed a real bug while wiring this: `LineEditor`'s floor/undercut checks used the unscaled base price even for a packaged line, disagreeing with the receipt panel's own (correctly scaled) violation flag — both now share one `scaledFloor`/`scaledListPrice` pair. `commitSale`'s offline stock ceiling and `local_delta` decrement now scale by the conversion factor too (same bug class as 3.1's void/return fix, offline this time); `local_sale_items` gained the matching columns. Verified: 6 unit tests, and a live push through `/sync/push` shaped exactly like the real outbox payload. Not verified: the UI itself in a running browser — no browser-automation tool available here. |
| 3.4 | ~~Admin: manage packagings per variant~~ **DONE** (b4830b7) | ~~An owner can define 1 carton = 20 pieces without SQL~~ — done. New CRUD in the products module (`/products/variants/:variantId/units`, `/products/variant-units/:id`), gated by the existing `product:read`/`product:write`. A real delete, not a soft one — the row is pure config, and a sale already snapshots its own conversion factor (3.1), so nothing historical depends on this row surviving. Admin UI: a "Packagings" action per product row, following the existing page's own conventions throughout. Verified live: full CRUD cycle, duplicate rejection, permission gating. **Stage 3 (units of measure) is now fully done, 3.1–3.4.** |

### Stage 4 — Receipts and hardware

| # | Work | Accept when |
|---|---|---|
| 4.1 | ~~**B5** ESC/POS receipt rendering, 58 mm and 80 mm~~ **DONE** (fa66942) | ~~A completed sale prints a compliant tax invoice: TRN, VAT breakdown, lines, tender, change~~ — done. `receipt-template.ts`'s `buildReceipt()` renders a snapshotted sale onto a `node-thermal-printer` buffer: business identity + TRN, lines, subtotal/discount/VAT, bold double-height total, per-tender lines, change. Talks to the printer via the library's own `File` interface against a raw USB device path (`printer.ts`) — no native binding, no second Electron-ABI rebuild after `better-sqlite3`. Found and fixed a real, silent bug while building this: no `characterSet` configured meant any non-ASCII product name (a degree sign, an accent) printed as a literal "?", with `iconv-lite` catching the encoding error internally and never surfacing it — fixed with `characterSet: CharacterSet.WPC1252`. Verified: byte-level ESC/POS assertions (exact command bytes, both widths, WPC1252 encoding confirmed against the raw buffer) against a scratch file standing in for the device path. **Not verified**: real thermal hardware — none available in this environment. |
| 4.2 | ~~Wire the Print button and add reprint~~ **DONE** (fa66942) | ~~`Sale.tsx` "Print receipt" prints; a past sale can be reprinted marked DUPLICATE~~ — done. The button now calls `printer.printReceipt(saleId)`; Settings gained a "Reprint a Receipt" search-by-reference flow that always passes `duplicate: true`. Found and fixed a real, pre-existing gap while wiring this: `findSale`/`recentSales` always returned `payments: []` — no per-tender breakdown was ever persisted locally, so a receipt (or reprint) could never show what was actually tendered. New `local_sale_payments` table, populated in `commitSale`, queried back by both. Verified: 7 new electron tests covering single/split tenders and the reprint path. |
| 4.3 | ~~Cash drawer kick on cash tender, with the reason logged~~ **DONE** (fa66942) | ~~Drawer opens on cash sale; every manual open is audited~~ — done. A cash sale kicks the drawer as part of the same ESC/POS buffer as its receipt — no separate audit row, the sale already is the record. A manual "no sale" open requires a non-empty reason and is fully audited: local-first (`local_drawer_opens`, so the reason survives if offline when the drawer opens) → outbox → new `drawer_open` sync entity → written straight into `audit_log`. Deliberately not a `cash_movements` row — that table is money-shaped and feeds day-close reconciliation, with no "just checking the till" type. Verified: local write + outbox enqueue + distinct local ids across opens (electron tests); API-side `applyItem` case follows the exact pattern already established for other entities. **Not verified live end-to-end**: no ephemeral Postgres available in this environment to push a `drawer_open` item through a running API and confirm the `audit_log` row — same limitation as the rest of this session's Docker-dependent verification. |
| 4.4 | ~~A4 tax invoice~~ **DONE** (fa66942) | ~~A wholesale customer gets an A4 invoice~~ — done. `a4-invoice.ts` renders the same snapshotted sale data as a real PDF via `pdfkit` — the same library the API already uses for quotation PDFs, so there's one PDF-rendering approach in the codebase, not two (and no headless-browser/`printToPDF` runtime to manage). Saved under `userData/invoices` and handed to the OS's default PDF viewer via `shell.openPath` — printing to an actual A4 printer is that viewer's own native Print command. `Sale.tsx`'s complete-sale dialog shows a "Print A4 invoice" button whenever the sale has a customer attached. Verified: 5 tests confirming a real, well-formed PDF (`%PDF-` header) across single/multi-line, discounted, multi-tender and duplicate-marked inputs — same testing posture as `quotation-pdf.spec.ts`, since `pdfkit`'s stream is compressed and cannot be grepped for rendered text. **Stage 4 (receipts and hardware) is now fully done, 4.1–4.4.** Not built: refund-receipt printing (still open, tracked against Stage 2.3) and barcode-scanner integration (open decision #2 in `docs/DECISIONS.md` — genuinely separate from anything Stage 4's four rows required). |

> Was blocked on open decisions #2 and #3 in `docs/DECISIONS.md`. Narrower
> than it looked: none of the four rows above touch the scanner (a USB HID
> scanner needs no main-process code at all), so only #3 (the printer) was a
> real blocker — resolved as **D16**: USB, via a raw device file. #2 remains
> open for whenever scanner integration is actually built.

### Stage 5 — Fill the pricing and catalogue gaps

| # | Work | Accept when |
|---|---|---|
| 5.1 | ~~A real `pricing` module: `@Module`, controller, CRUD for price lists / product prices / customer prices, using the four unused `price:*` permissions~~ **DONE** (4e9da78) | ~~Prices are managed after creation; bulk update works~~ — done. `PriceResolverService` (already solid) now lives in its own `PricingModule`, imported by orders/products/quotations/sales instead of each re-declaring it as a provider. New price-list CRUD and effective-dated writes for `product_prices`/`customer_prices`: a price is never edited in place, only closed and superseded (a same-day correction amends in place instead, since there's no room for two rows sharing one effective date) — and every real change lands a `price_history` row, including the very first price a variant ever gets. Found and fixed a real bug while testing this: the "did the price actually change?" check compared `"10.00"` to `String(10)` as raw strings — unequal, despite being the same amount — which would have logged a spurious history row on every single write. Fixed via `Money.toMinor` comparison. Verified: 8 unit tests, full typecheck, full existing suite, boundary check. **Not built, deliberately**: no admin UI for this surface yet — the acceptance criterion is API-shaped, and a screen for it is more naturally 5.6's job if wanted. **Update**: apps/api's own `DATABASE_URL` turned out to reach a real local Postgres this whole session had mistakenly written off as unreachable (Docker's daemon isn't running, and only the interactive `psql` login had been tried, which needs a password this session doesn't have — the app's own connection string works non-interactively and needed no password prompt). Once found, `pnpm db:migrate` brought it current and this exact close/insert/history algorithm was proven correct live via Stage 5.5's importer, which duplicates it — including the effectiveTo date-math bug described there. `PricingService`'s own HTTP-facing methods are still only unit-tested, not called live. |
| 5.2 | ~~Quantity-break pricing (`minQuantity` on `product_prices`)~~ **DONE** (544551d) | ~~1–9 at 10.00, 10+ at 8.50, resolved by the same ladder, offline too~~ — done. Each variant can now hold several independent, effective-dated tiers on one list; the resolver picks the highest-threshold tier a requested quantity actually reaches, and the floor always comes from the base tier even when a bulk tier answers the selling price. Sales/orders/quotations now pass each line's real quantity through, so the undercut check compares against the price at the quantity actually being bought. Offline: the POS pulls every tier (not just one row) via a `json_group_array` aggregate, and the cart store re-prices a line onto the right tier as its quantity is edited — while protecting a manually-typed price from being clobbered — using the identical highest-qualifying-tier rule the API applies. Found and fixed two more instances of 5.1's same money-as-string bug class: a server-side "changed?" check and a client-side "still on-ladder?" check, both comparing differently-formatted-but-equal amounts with `===`. Verified: 8 resolver tests (tier selection, floor fallback, negotiated-price precedence), 4 SQLite tests against real better-sqlite3, 9 cart-store tests, full typecheck, full existing suites, boundary check. **Scope decision**: a tier applies to the quantity as entered on the line, in whatever unit was chosen — not converted to a base-unit equivalent for packaged sales, matching how `discountPercent`/`unitPrice` already work per line regardless of unit. **Update**: a live Postgres was found after all (see 5.1's update) — added a second tier (10+ units) to a real seeded variant and confirmed the exact tier-selection query picks the base price below the threshold and the tiered price at and above it, then removed the test row. A physical terminal remains unverified. |
| 5.3 | ~~Typed variant attributes (size/colour/material/model) or an attribute-definition table + index~~ **DONE** (cf8e18a) | ~~"All 1-inch elbows" is a query, not a scan~~ — done, via the attribute-definition table (chosen over fixed columns: this catalogue's categories don't share a vocabulary — paint needs sheen, pipe needs diameter, cable needs gauge — so a handful of hardcoded columns would only ever fit some of them). New `attribute_definitions` (scoped to one category, typed, `allowedValues` enforced for `select`) and `variant_attribute_values` (indexed on `attribute_definition_id, value`), CRUD'd through the existing `catalog` module. Additive, not a replacement: `products.attributes`/`product_variants.attributes` JSONB is untouched, and `create()` additionally writes a normalized row for any key matching a defined attribute — anything undefined stays exactly as free-form as before. `products.list()` gained an `attributes` filter matching one variant against every requested value together, not different values scattered across variants. Verified: 5 unit tests, full typecheck, existing suite, boundary check, migration SQL reviewed. **Not built**: an admin UI for defining attributes (the criterion is query-shaped, not UI-shaped) and editing a variant's attributes after creation (products.service.ts's `update()` has never touched variants at all — pre-existing, not new). **Update**: verified live (see 5.1) — created a real category-scoped attribute definition and two variant values against seeded data, then confirmed `products.list()`'s exact attribute-filter query returns only the matching product and nothing for a value that isn't there, before removing the test rows. |
| 5.4 | ~~Product↔supplier link with supplier SKU and supplier barcode~~ **DONE** (e0fd9cc) | ~~Receiving can match a supplier's own barcode~~ — done. New `product_supplier_links` (one row per supplier+variant, indexed on the supplier's own barcode and SKU), CRUD'd under `products` (`variants/:id/suppliers`), gated on `supplier:*` since this is supplier-relationship data, not catalogue data. `ReceiveGoodsSchema`'s line now accepts a `supplierSku`/`supplierBarcode` as an alternative to `variantId`; `PurchasesService.receive()` resolves whichever is given against the receipt's supplier before anything else runs, so the rest of the method never has to know a line arrived without a resolved variant. New `GET /purchases/supplier-lookup` lets a receiving screen check a scanned code before submitting a whole receipt. Verified: 2 unit tests (resolves / refuses on a miss), full typecheck, existing suite, boundary check, migration SQL reviewed. **Not built**: no admin UI wires a barcode-entry field into receiving — that screen doesn't support direct (no-PO) receipts in the UI at all today, a pre-existing gap this doesn't introduce; 5.6 is the dedicated admin-UI stage. **Update**: verified live (see 5.1) — created a real supplier link against seeded data and confirmed the exact resolution query matches on both the supplier's barcode and their SKU, returns nothing for an unknown code, and that the unique (supplier, variant) index rejects a duplicate. |
| 5.5 | ~~Finish the product importer (`tools/import` is a documented scaffold)~~ **DONE** (3703504) | ~~5,000 SKUs import idempotently, dry-run first, price changes as history~~ — done. Implemented against a canonical column-header schema (no real supplier price list exists in this environment to profile — see this file's own "Not yet decided" list), documented in the header comment. One row = one product with exactly one variant; unmapped columns land in `attributes`. Dry run by default; idempotent on the variant's own SKU, touching only price/barcode on a re-import (product-level fields are set once, at creation, never re-touched — re-comparing and overwriting them on every run risks clobbering a hand edit made in the admin panel since the last import); a price change closes the current row and writes `price_history` rather than ever updating in place; duplicate SKUs within one file are rejected outright; writes chunk at 500 rows/transaction. Row parsing is pure and fully unit tested (10 tests) independent of any database. **This is the stage that surfaced the live-Postgres discovery** (see 5.1's update) — and was the first thing actually run against it: a dry run against real seeded data correctly reported created/updated/unchanged/rejected and wrote nothing; `--commit` correctly created a product+variant+price+history row, correctly changed a real price (closing the old row exactly one day before the new one starts, confirmed by direct query), and correctly left an unchanged row untouched; **re-running the identical file a second time reported 0 created and 0 updated** — idempotency proven by actually running it twice, not just by inspection. Found and fixed a real bug in the process: the same-tier-close logic set `effectiveTo` to the new row's OWN `effectiveFrom` (today) instead of one day before it — since the resolver's date bound is inclusive on both ends, that would have made both rows match "today" at once. Test data was cleaned up afterward: the disposable test product was deactivated (its `price_history` row is append-only and blocks a hard delete, exactly as designed), and the real product's price was restored via a proper correcting entry rather than any deletion — so the tenant's `price_history` now honestly shows both changes, today's date, no reason given. |
| 5.6 | ~~Admin: product edit/delete, category/brand management, image upload~~ **DONE** (c4861c4) | ~~The catalogue is maintainable without SQL~~ — done. Edit/Delete wired into the products table via the `PATCH`/`DELETE /products/:id` routes that already existed (product-level fields only — variant pricing stays on the pricing module's own surface from 5.1, sku/unitId stay fixed at creation, matching what the service has always actually applied). New Categories page (tree, indent-by-depth, create/edit/move) and Brands page (flat CRUD) — both call CRUD the `catalog` module has had since Stage 1 with no UI in front of it until now. New image upload: multipart endpoint, SHA-256 deduped (a collision is refused naming which product already has it, not auto-linked), first photo auto-primary, `products.imageUrl` kept in sync; `products.findById()` now actually returns its images — zero code touched that table before this. `api-client.ts` gained `postForm()` since `apiFetch` previously JSON-stringified every body, which corrupts a `FormData` upload. Verified: 6 unit tests, full typecheck (API + admin), full existing suite, clean production admin build. **Live-verified against the real running API with a real JWT** (see 5.1's discovery): created/renamed/deleted a category, created/deleted a brand, edited and soft-deleted a real seeded product (confirmed deactivated rather than hard-deleted, since it holds stock/sales history) then reactivated it, and exercised the real multipart endpoint — confirmed it rejects a non-image mime type before touching the database, and reaches the storage call and fails ONLY there (`ECONNREFUSED` on MinIO's port, not running in this environment) — proving the whole validation/dedup/checksum pipeline correct up to the one boundary this sandbox can't reach. Test data cleaned up afterward. **Not verified**: the actual object-storage upload (no MinIO reachable here) and this UI in a real browser (no browser-automation tool available). **Stage 5 (pricing and catalogue gaps) is now fully done, 5.1–5.6.** |

### Stage 6 — Orders, and the quotation→order→invoice chain

| # | Work | Accept when |
|---|---|---|
| 6.1 | ~~`orders` module using the existing tables and permissions~~ **DONE** (75dc43a) | ~~Create, confirm, cancel, partial fulfilment~~ — done. Every fulfilment is its own sale via `SalesService.create()` (same checks a walk-in gets), linked back with `sales.orderId`, charged at the price the order quoted. Verified live: full create→confirm→partial-fulfil→fulfil-remainder→completed lifecycle, over-fulfilment refused, double-confirm/cancel guarded. |
| 6.2 | ~~Stock reservation on confirmation, release on cancel/expiry~~ **DONE, expiry excepted** (75dc43a) | ~~`inventory.reservedQuantity` moves; available-to-sell drops~~ — done for confirm/fulfil/cancel: `StockService.reserveStock`/`releaseReservedStock` are new, cancel releases only the unfulfilled remainder (never double-releasing an already-fulfilled line). **Not done**: release-on-EXPIRY, which needs a scheduled job that doesn't exist yet — deferred to Stage 10 (operational hardening), where a job runner would first need to exist for anything to schedule. |
| 6.3 | ~~Quotation → order → invoice~~ **DONE** (13e085b) | ~~Your §19 status chain works end to end~~ — done. New `POST /quotations/:id/convert-to-order`, alongside the existing straight-to-sale `convert()`. Found and noted (not fixed, to avoid touching a working path): `quotations.convertedToOrderId` had always held a SALE's id from `convert()` — the only path its name ever anticipated; this is the first path where it holds what it says. Verified live end to end: quotation → order (reserves nothing) → confirm (reserves) → fulfil in full → order completed → the resulting sale joins back through both the order and the originating quotation. |
| 6.4 | ~~Quotation PDF~~ **DONE** (3689756) | ~~A quote can be printed and attached~~ — done. First real use of the `S3_*` env vars that existed since the start: a new `StorageService` (`@aws-sdk/client-s3`, MinIO-compatible) and `pdfkit` for a coded (not HTML) layout. `POST /quotations/:id/pdf` renders, uploads to `{tenantId}/quotations/{number}.pdf`, records `pdfUrl`. Verified live against a stand-in HTTP server (no MinIO available in this environment) — a real quotation's PDF uploaded with the correct bucket/key/content-type and a valid `%PDF-` header. **Stage 6 (orders) is now fully done, 6.1–6.4.** |

### Stage 7 — Admin depth

Broken out into a table (was a flat paragraph) once work on it started, so
each piece can be tracked and committed independently rather than as one
undifferentiated blob.

| # | Work | Accept when |
|---|---|---|
| 7.1 | ~~Purchase orders UI~~ **DONE** (746d670) | ~~Create a PO, receive against it, see landed cost~~ — done. New `/purchases` page: create (draft), send, receive (partial or full, with damaged quantity and a freight override), cancel (refused once anything is received). The receive dialog shows the resulting receipt's landed unit cost per line before closing. **Scope narrowing, deliberate**: no serial-number entry on receiving — a real capability of the API, but a rare-enough product type not to justify the UI for this pass. Verified live: full create→send→partial-receive→complete-receive lifecycle, landed cost and weighted-average inventory cost both correct, cancel refused after partial receipt. **Stage 7 (admin depth) is now fully done, 7.1–7.8.** |
| 7.2 | ~~Transfer approval/shipping UI (the real request→approve→ship→receive workflow — `inventory.tsx`'s "Transfer Stock" dialog is a separate, immediate-move bypass around it)~~ **DONE** (5728685) | ~~The four-state workflow is usable end to end, not just the immediate-move shortcut~~ — done. New `/transfers` page: request (line-item search + add), approve, ship, receive, one action button per status. Found and fixed a response-shape bug: `TransformInterceptor` hoists a `{items, meta}` response so `data` IS the array directly — my first draft expected a nested object. Verified live: full lifecycle, ship-before-approval refused, stock actually moves branch to branch. |
| 7.3 | ~~Day-close review UI~~ **DONE** (7c1726f) | ~~A manager can open, preview, and close a day, and read back history~~ — done. New `/day-close` page: live preview, open with a float, count and close, frozen figures once closed, history table. Verified live: a real cash sale moves the live preview, a short close with no notes is refused, closing at the exact expected amount succeeds. |
| 7.4 | ~~Audit-log viewer~~ **DONE** (b38335b) | ~~Needs a read endpoint first — writes only exist today via `@Audited`~~ — done. New `GET /audit-log` (filterable, paginated) and `/audit-log/entity-types`, both gated `audit:read` (declared, enforced nowhere until now). Deliberately no changes/reason column — the interceptor never populates either. Verified live: real create/delete actions show up correctly attributed. |
| 7.5 | ~~Device management UI~~ **DONE** (e0e42e2) | ~~List, register, update a terminal~~ — done. New `/devices` page: list, register (activates immediately), toggle active/deactivated. Verified live. |
| 7.6 | ~~Roles/permissions editor~~ **DONE** (85035fc) | ~~Needs a roles API first — none exists; also fixes a real bug: user creation hardcodes `roleId` to a magic UUID with no picker~~ — done. New roles module (list/create/update/delete), every write through the existing `assertMayGrantPermissions`. New `/roles` page. Fixed the real bug found: every new hire silently got whichever role loaded first in the staff list (a magic-UUID fallback with no picker at all) — could become a full admin by accident depending on sort order. Verified live: full CRUD, in-use and seeded-role delete refusals, a user created with a real picked role. |
| 7.7 | ~~Real reports — remove every hardcoded fallback, wire the date range~~ **DONE** (df86313) | ~~No mock top-products array, no hardcoded revenue/margin/stock numbers, the 7d/30d/90d buttons actually change what the three report calls return~~ — done. Found the date-range buttons updated a state variable nothing read — now computed `from`/`to` reach `/reports/financial` and `/reports/top-products`. Found `financial.taxCollected` didn't exist server-side at all (the admin page expected a field the API never returned); added it to `reports.service.ts`, summed from `sale_items.taxAmount` over the same window/scope as the other trading figures. Verified live: a window excluding today's sales returns a genuine 0.00, proving the filter is real. |
| 7.8 | ~~Settings persisted to the API~~ **DONE** (2de20d7) | ~~Editing and saving actually changes what the server has~~ — done. `GET /tenant`/`PATCH /tenant/settings` were fully built and completely unused; the page only wrote to `localStorage`. Also fixed a second, separate lie found while touching this: the "Central API Endpoint" field changed nothing about which backend the app talked to (`api-client.ts`'s `BASE_URL` was a module constant) — now a real, working per-browser override, kept in `localStorage` on purpose since it configures this browser's connection, not tenant data. |

### Stage 8 — WhatsApp, then AI

Webhook with `X-Hub-Signature-256` verification and a 200 before any AI work;
send/receive; templates and the 24-hour window; conversation state; phone →
customer matching. Only then the LLM tool functions. Replace the mocked admin
page with the real thread view.

> Provider decided — DeepSeek (D19) — and `LlmService` exists
> (`apps/api/src/modules/ai/llm.service.ts`, chat completions + tool calling +
> per-call cost estimate). Everything else in this stage — the webhook,
> conversation state, the 24-hour window, the tool implementations, the real
> admin thread view — is still not built.

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

Auth-specific debt that survived the audit (commits 194b33d, 63800f6):

- **The POS stores its refresh token in plaintext** in SQLite `device_state`.
  Electron's `safeStorage` is not used anywhere. A stolen till hands over a
  90-day credential to anyone who opens the file.
- **Both clients keep tokens in JS-readable storage** — POS in `localStorage`,
  admin in `localStorage`. Moving to httpOnly cookies means CSRF protection and
  a change to how the POS authenticates; it is a design decision, not a patch.
- **`store/auth.ts` persists `permissions` with no expiry**, so a POS UI gate
  reflects the role as it was at last sign-in. Harmless while the server is the
  authority (rule 9), misleading once someone treats it as one.
- **`maxSaleAmount` and `canApproveRefund` still do not reach the POS** — see B6.

Everything else:

- **Unattached permissions.** Was 18 of 60; commits 194b33d and 63800f6 wired
  up `device:manage`, `price:override` and `price:override_floor`, and
  `sale:discount` now has a ceiling that means something. Stage 2.1 (8e147b5)
  wired up `sale:void` and `sale:return`. Still attached to no route:
  `product:import`, `price:read`/`price:write`, `order:*` (2), `payment:*` (2),
  `whatsapp:*` (3), `role:write`, `audit:read`. Each is either a missing
  feature or a missing check — decide which before building on top of it.
- **`PriceResolverService.resolveMany` compares dates across two different
  clocks.** `product_prices.effective_from` is seeded (and presumably written
  elsewhere) from Postgres `now()::date`, in the server's session timezone;
  the resolver's own `asOf` comes from `new Date().toISOString().slice(0, 10)`
  in Node, which is always UTC. Found live while verifying Stage 2.5: a price
  row seeded at `2026-08-20` (Gulf Standard Time, UTC+4) failed to resolve at
  all — `NO_PRICE_FOR_PRODUCT` — for roughly the first four hours after
  midnight Gulf time, because Node's UTC `asOf` still read `2026-08-19`. Not
  fixed here — out of scope for that stage — but worth knowing before it reads
  as "the price list is broken" during a Gulf-timezone morning. Fix is
  probably `asOf` computed however the DB's `now()::date` would be, or storing
  `effective_from`/`to` as `timestamptz` instead of `date`.
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
  Note the server now refuses to grant either to somebody who lacks it, so the
  form silently fails for a non-superuser rather than silently succeeding —
  give it real controls.
- **`pricing` has no `@Module`** — `PriceResolverService` is duplicated as a
  provider in three modules.

---

## 7. Open decisions that block work

From `docs/DECISIONS.md`. Resolve before the dependent stage, not during it.

| # | Question | Blocks |
|---|---|---|
| 1 | The real product price list | Stage 5 — final pricing schema and the importer |
| 2 | Barcode scanner model (USB HID assumed) | Stage 4 — scanner integration |

Resolved: #3, thermal printer connection method, as D16 (exact model still
unconfirmed but no longer blocking). #4, LLM provider, as D19 — DeepSeek,
client built; the AI/WhatsApp module around it (Stage 8) is still open work.

~~New decision needed~~ — resolved, confirmed with the user, written into
`docs/DECISIONS.md` as **D15**:

| # | Question | Resolution |
|---|---|---|
| 5 | Is a return a linked negative sale, or a first-class `sale_returns` document with its own number series? | **Linked negative sale**, per the existing schema (`returnOfSaleId`, `returnedQuantity`, the `SaleStatus` enum) — see D15. Reopen if UAE VAT credit-note numbering turns out to require a distinguishable series; not confirmed either way yet. |
