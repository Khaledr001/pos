# Roadmap

Phase order follows [implementation_plan.md](../implementation_plan.md). Tick
items here and in [apps/api/src/modules/README.md](../apps/api/src/modules/README.md)
as they land.

---

## Phase 0 — Scaffold ✅ done

- [x] Turborepo + pnpm workspace, shared TypeScript config
- [x] Docker Compose: PostgreSQL 18, Redis 8, MinIO (+ bucket bootstrap)
- [x] Two Postgres roles, RLS helper functions, extensions
- [x] `packages/shared-types` — enums, permissions, tenant settings, API + sync contracts
- [x] `packages/shared-utils` — exact money, tax totals, document numbers, text normalisation (27 tests)
- [x] `packages/db` — 44 tables, RLS generator, triggers, migrate/seed/reset
- [x] `apps/api` — NestJS core: config validation, request context, tenant DB, guards, filter, interceptor
- [x] `apps/api` — auth (password, PIN, refresh rotation) + health + `branches` reference module
- [x] `apps/admin` — Next.js 16, Tailwind v4, typed API client
- [x] `apps/pos` — Electron main/preload/renderer, SQLite with FTS5, electron-builder
- [x] `tools/import` — price-list profiler
- [x] Docs: CLAUDE.md, DECISIONS, PATTERNS, DATABASE, ROADMAP

**Verified against a live PostgreSQL 18.4 instance**, not just compiled:

- [x] 44 tables migrate clean; triggers and RLS reapply idempotently
- [x] Seed runs and is re-runnable
- [x] RLS isolation — no tenant context returns 0 rows; scoped to tenant A
      returns only A's rows and zero of tenant B's, and vice versa
- [x] RLS `WITH CHECK` — inserting a row stamped with another tenant's id is
      rejected
- [x] Ledger immutability — UPDATE on `inventory_transactions` and DELETE on
      `audit_log` both refused by trigger
- [x] Gapless numbering — a rolled-back transaction reuses its number, leaving
      no hole in the invoice series
- [x] `updated_at` trigger fires on real changes
- [x] API boots, `/health` and `/ready` correct
- [x] Login → JWT → authenticated tenant-scoped query
- [x] Refresh rotation, and replay of a rotated token rejected (401)
- [x] Duplicate key → 409 `CONFLICT` (not a 500)
- [x] Field-level validation errors
- [x] RBAC — cashier token gets 403 with the missing permission named, while
      `/auth/me` still works

## SaaS foundation ✅ done

- [x] **Product variants** — `product_variants` is now the sellable unit; barcode,
      stock, price and every document line repoint to it. `products` stays the
      catalogue entry. Migration regenerated clean (no production data existed).
- [x] Subscription plans as code constants (free/trial/starter/pro/enterprise),
      failing closed to `free` on an unknown id
- [x] Tenant subscription fields: `planId`, `trialEndsAt`, `subscriptionEndsAt`,
      payment references, suspension reason
- [x] ABAC on users: `maxDiscountPercent`, `maxSaleAmount`, `canApproveRefund`,
      `canViewCost`, `allowedBranchIds`, plus lockout counters
- [x] Access token carries permissions + ABAC + plan + trial, so no check costs
      a query; unknown claims default closed
- [x] Self-service registration — tenant, 4 roles, branch, unit, default price
      list and a signed-in session, in one transaction
- [x] Reserved slugs shared by the schema and the availability check
- [x] Plan-limit enforcement with live usage counts, wired into branch creation
- [x] Trial expiry blocks writes but never reads

Verified against live PostgreSQL 18: two tenants fully isolated, plan limit
refuses the 3rd branch on a 2-branch plan with `PLAN_LIMIT_EXCEEDED`, 11/11 RLS
checks pass.

### Still to do in this phase

- [ ] SuperAdmin platform console (suspend/activate, change plan, impersonate)
- [ ] Billing: checkout session + webhook handling
- [ ] Users module with ABAC editing
- [ ] ABAC enforcement at sale time (discount cap, sale ceiling, branch scope)

## Phase 1 — Foundation (weeks 1–3)

**Blocked on the real price list** for the last three items.

- [ ] `tenants` module — provisioning, settings (VAT, currency, locales)
- [ ] `users` module — CRUD, role assignment, PIN management
- [ ] `categories` module — hierarchical tree, maintain `path` and `depth` on move
- [ ] `brands`, `units` modules
- [ ] `products` module — CRUD, full-text + trigram search, barcode lookup
- [ ] Product images — upload to MinIO, SHA-256 dedup, thumbnail generation
- [ ] `pricing` module — resolution ladder (customer → tier → default), floor enforcement, history on every change
- [ ] `customers` module — CRUD, credit limit, balance
- [ ] **Profile the real price list** → `pnpm --filter @devsfleet/import profile -- "<file>"`
- [ ] Finalise `products` / `categories` / pricing schema against that output
- [ ] Product importer — dry-run, idempotent on SKU, price changes as history

## Phase 2 — Inventory (weeks 4–5)

- [ ] `inventory` module — per-branch balance + append-only ledger, `balanceAfter` in-transaction
- [ ] Stock adjustments with mandatory reason, low-stock alerts
- [x] `suppliers` module
- [x] `purchases` module — PO → goods receipt → stock in, weighted-average landed cost
- [ ] `transfers` module — request → approve → ship → receive (stock in transit belongs to neither branch)
- [ ] Stock counts — count sheet → variance → manager approval → adjustments

## Phase 3 — POS (weeks 6–9)

- [x] Login (PIN, verified server-side), device activation flow
- [x] Product search against local FTS5, barcode scan
- [x] Cart, unit picker, discounts with floor-price enforcement
- [x] Payments: cash, card, split tender, credit
- [x] Cash register — open, movements, close with variance
- [ ] Receipt rendering: thermal 58mm, thermal 80mm (ESC/POS), A4 tax invoice
- [ ] Cash drawer kick, with reason logged
- [x] Returns and refunds against an original sale
- [x] **Sync engine** — push outbox (idempotent on `clientId`), pull by checkpoint, tombstones
- [x] Offline stock, decremented locally before any sync, released once acknowledged
- [x] Held carts — park, list, restore, discard
- [x] Day close and expenses — per branch, frozen at close
- [ ] Conflict handling per the table in the implementation plan
- [x] `sync` module in the API, matching `shared-types/sync.ts` exactly

## Phase 4 — WhatsApp AI (weeks 10–12)

- [ ] Meta Cloud API webhook — `X-Hub-Signature-256` verification, 200 before any AI work
- [ ] Message send/receive, media to MinIO (Meta's URLs expire in minutes)
- [ ] Template messages + 24-hour window tracking
- [ ] Conversation state, phone → customer matching
- [ ] LLM tool functions: `search_products`, `check_price`, `check_stock`,
      `create_quotation`, `confirm_order`, `get_customer_info`,
      `get_order_status`, `escalate_to_human`
- [ ] Multi-language replies (en / ar / hi / ur / bn)
- [ ] Human takeover, auto-escalation after N turns
- [ ] Per-conversation token and cost accounting

## Phase 5 — Quotation → Order (weeks 13–14)

- [ ] `quotations` module — create, PDF, send via WhatsApp, expiry
- [ ] Stock reservation on confirmation, release on expiry or cancel
- [ ] Convert quotation → order
- [ ] `orders` module — lifecycle, partial fulfilment, POS pickup
- [ ] Stock deduction on completion

## Phase 6 — Admin panel (weeks 15–18)

- [ ] Auth pages, session handling, refresh rotation
- [ ] Dashboard KPIs — sales, orders, stock alerts
- [ ] Products: CRUD, bulk import UI, bulk price update
- [ ] Inventory: per-branch view, stock movements, transfers
- [ ] Customers, credit management
- [ ] Sales history, returns, reporting (margin behind `report:financial`)
- [ ] Orders and quotations
- [ ] WhatsApp conversation viewer with takeover
- [ ] Branches, users, roles, settings
- [ ] Arabic/Urdu RTL support

---

## Cross-cutting, not phase-bound

- [ ] Integration test suite proving RLS actually isolates tenants
- [ ] `@Audited()` interceptor writing `audit_log` rows
- [ ] BullMQ workers (PDF generation, WhatsApp send, nightly reconciliation)
- [ ] Nightly job: replay the inventory ledger, flag drift against `inventory`
- [ ] Backup strategy — `pg_dump` + MinIO snapshot, restore rehearsed
- [ ] CI: typecheck, test, build on every push
- [ ] Deployment to `pos.devsfleet.com`
