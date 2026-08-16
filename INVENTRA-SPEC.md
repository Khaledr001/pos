# Inventra — Complete Product Specification

> **A build-ready, technology-agnostic specification for a multi-tenant POS + Inventory Management System.**
> Version 1.0 · Specification date: 2026-08-16

---

## 0. How To Use This Document

**You are being given this document as a build brief.** It describes *what* to build, not *how*. It contains no framework-specific instructions, no language bindings, and no library names in the normative sections. Every entity, field, rule, endpoint, screen, and acceptance criterion needed to construct the product is here.

### Your instructions

1. **Read the entire document before writing any code.** Sections 3, 5, and 6 contain invariants that constrain every later decision. Violating them produces a system that looks correct and corrupts data under load.
2. **Choose your own stack.** Any server language, any web framework, any relational database, any frontend framework. The specification assumes only: a relational database with transactions, an HTTP/JSON API, and a browser client.
3. **Do not "improve" the architectural invariants in §3.** They are the result of decisions made deliberately. In particular: *products do not store a quantity*. If you add a quantity column because it seems simpler, you will reintroduce the exact race condition the design exists to prevent.
4. **Status markers** appear on every feature:
   - ✅ **IMPLEMENTED** — exists and works in the reference system. Build it.
   - 🟡 **PARTIAL** — backend or data model exists, one layer is missing. Build it completely.
   - ⬜ **PLANNED** — designed and specified, not yet built. Build it.
   All three are in scope. The markers tell you where the reference implementation stands, not what to skip.
5. **Section 16 gives a dependency-ordered build sequence.** Follow it unless you have a reason not to.
6. **Section 17 is the definition of done.** The product is complete when every checkbox passes.

### What this document is not

It is not a UI mockup set, not a database migration script, and not an API client. It specifies behaviour precisely enough that two independent teams building from it would produce functionally equivalent systems.

---

## 1. Product Overview

### 1.1 What Inventra Is

Inventra is a **point-of-sale and inventory management system** for physical retail businesses that sell countable goods across multiple storage locations. It is delivered as **multi-tenant SaaS**: many independent businesses share one deployment, with complete data isolation between them.

### 1.2 Target Market

Retail verticals where inventory accuracy and multi-location stock matter more than e-commerce features:

- **Electronics** — serial-number tracking, warranty periods
- **Hardware / building materials** — high SKU count, bulk units, wholesale pricing tiers
- **Sanitary ware** — variant-heavy catalogs (sizes, finishes)
- **Paint** — custom colour mixing with formula recipes

The common thread: a physical counter, a cashier, a stockroom, and a business owner who needs to know what was sold, what is left, and what it was worth.

### 1.3 Core Value Propositions

| Proposition | How the system delivers it |
|---|---|
| **Stock you can trust** | Every stock change is an immutable ledger entry. Balances are derived, never stored. Full audit trail is a free byproduct. |
| **Sell without internet** | The POS terminal caches catalog and customers locally, queues sales offline, and syncs on reconnect. |
| **Control what staff can do** | Role-based permissions plus per-user attribute limits (max discount, max sale value, warehouse scope). |
| **Know the numbers daily** | Day-close cash reconciliation freezes a signed-off snapshot per calendar day. |
| **Multi-location native** | Stock is per warehouse from the ground up; transfers are first-class operations. |
| **Bilingual, right-to-left ready** | Full English/Arabic UI with layout mirroring. |

### 1.4 Primary User Journeys

1. **Business owner signs up** → gets a trial tenant, a default warehouse, a default unit, and an admin account, in one step.
2. **Owner builds the catalog** → creates categories, brands, units, then products with variants; or bulk-imports a spreadsheet with opening stock.
3. **Owner orders stock** → creates a purchase order to a supplier, approves it, receives goods (partially or fully); stock rises.
4. **Cashier opens the day** → declares the opening cash float.
5. **Cashier sells** → scans or searches products, builds a cart, applies discounts within their limit, takes split payment, prints a receipt; stock falls.
6. **Cashier handles a return** → selects lines from an original sale, marks restockable or not, issues a refund; stock rises for restockable lines only.
7. **Manager counts stock** → generates a count sheet, staff enter physical counts, manager approves; variances post to the ledger.
8. **Cashier closes the day** → counts the drawer; the system computes expected cash and records the variance.
9. **Owner reads reports** → sales trends, top products, low stock, gross margin.

---

## 2. Glossary

| Term | Definition |
|---|---|
| **Tenant** | One independent business using the system. The unit of data isolation. |
| **Product** | A catalog entry. Not directly sellable — its variants are. |
| **Variant** | The independently sellable unit. Carries barcode, prices, and low-stock threshold. A product without real variants still has exactly one "Default" variant. |
| **SKU** | Stock-keeping unit code. Lives on the product. |
| **Barcode** | Scannable code. Lives on the **variant**, not the product. |
| **Warehouse** | A physical or logical stock location. Stock quantities are always per (variant, warehouse). |
| **Ledger** | The append-only table of stock movements. The single source of truth for stock. |
| **Stock balance** | A derived value: the sum of signed ledger quantities for a (variant, warehouse) pair. Never stored as an authoritative field. |
| **Sale** | A completed or pending retail transaction. |
| **Held cart** | A parked, incomplete cart saved for later retrieval. |
| **Quotation** | A priced offer to a customer with an expiry date. Does not affect stock. |
| **Purchase Order (PO)** | A commitment to buy from a supplier. Does not affect stock until goods are received. |
| **Receipt (goods)** | A record of physically receiving some or all of a PO. Affects stock. |
| **Stock take** | A physical count of a warehouse (or one category within it), reconciled against the ledger. |
| **Variance** | Counted quantity minus expected quantity. Negative = shrinkage. |
| **Day close** | The daily cash reconciliation record. |
| **Opening float** | Cash physically in the drawer when the day opens. |
| **ABAC attribute** | A per-user numeric or boolean limit (e.g. max discount %) carried in the auth token. |
| **Walk-in sale** | A sale with no linked customer. Must be fully paid. |
| **Credit sale** | A sale left partially unpaid. Requires a linked customer. |

---

## 3. Architectural Invariants

**These nine rules are non-negotiable. Every other part of the specification assumes they hold.**

---

### INV-1 — Products and variants have NO quantity field

Neither the product entity nor the variant entity may carry a stock quantity, on-hand count, running total, or any equivalent column.

**Stock is derived exclusively by summing the inventory ledger.**

```
stock(variant, warehouse) = SUM(ledger.quantity)
                            WHERE ledger.variant_id  = variant
                              AND ledger.warehouse_id = warehouse
```

**Rationale.** A stored quantity column is a shared mutable counter. Two concurrent sales read the same value, both decrement, and one write is lost — the classic lost-update race. In a POS with several terminals on one counter, this happens routinely and silently. A ledger makes concurrent writes purely additive: two inserts never conflict, and the sum is always correct regardless of interleaving.

**Consequence.** Anything that displays stock reads the derived balance. Anything that changes stock inserts a ledger row.

---

### INV-2 — The inventory ledger is append-only

Ledger rows are **never updated and never deleted**. Not for corrections, not for voids, not for admin cleanup.

- A correction is a new compensating row.
- A voided sale is a new row restoring the stock, not a deletion of the original.
- The database layer must **actively reject** update and delete operations on this table — enforce it in code, and additionally at the database level via trigger or permission if your platform allows.

**Rationale.** The ledger is the audit trail. A mutable audit trail is not an audit trail. Rejecting mutation at the persistence layer means no future feature can quietly break the guarantee.

---

### INV-3 — All stock mutations pass through a single stock service

Exactly one component in the system may insert ledger rows. Every module that changes stock — sales, returns, purchases, transfers, adjustments, stock takes, paint orders — calls that component. No module writes the ledger directly, ever.

The service exposes exactly these operations:

| Operation | Signature (conceptual) | Semantics |
|---|---|---|
| `addStock` | variant, warehouse, qty, referenceType, referenceId, notes | Inserts a positive row. Type inferred from referenceType. |
| `deductStock` | variant, warehouse, qty, referenceType, referenceId | Inserts a negative row. Type inferred from referenceType. |
| `adjustStock` | variant, warehouse, **newAbsoluteQty**, reason, userId | Reads current balance, inserts a single row for the *delta*. No-op if delta is zero. Reason is mandatory. |
| `transferStock` | variant, fromWarehouse, toWarehouse, qty, userId | Validates source has enough. Inserts **two** rows (out + in) sharing one reference id, in one transaction. |
| `getCurrentStock` | variant, warehouse | Returns the derived balance. |
| `postStockTakeVariances` | warehouse, stockTakeId, variances[], userId | Inserts one row per non-zero **delta**, all sharing the stock take as reference. |

**Rationale.** One choke point means one place to enforce sign conventions, tenant stamping, immutability, and future concerns (reservations, costing). Scattered ledger writes guarantee eventual inconsistency.

---

### INV-4 — Stock balance may be materialized, but only as a cache

A materialized view or cache table over the ledger is permitted and encouraged for read performance. It must satisfy:

- It is **read-only** to all application code. No feature writes to it.
- It is refreshed inside the same database transaction as the ledger insert, or refreshed by a mechanism that cannot diverge.
- Correctness never depends on it. If it is dropped, the system still computes correct balances from the ledger.

Recommended definition:

```sql
CREATE MATERIALIZED VIEW stock_balance AS
  SELECT variant_id, warehouse_id, SUM(quantity)::int AS quantity
  FROM inventory_transactions
  GROUP BY variant_id, warehouse_id;

CREATE UNIQUE INDEX ON stock_balance (variant_id, warehouse_id);
```

---

### INV-5 — Tenant isolation is enforced at the data-access layer, not per query

Every business record carries a tenant identifier. Isolation is enforced by a **global filter applied automatically to every read**, derived from the authenticated principal — not by developers remembering to add `WHERE tenant_id = ?` to each query.

- New records are stamped with the caller's tenant automatically on insert.
- A designated platform-operator role bypasses the filter for cross-tenant administration.
- Additionally enforce at the database level (row-level security or equivalent) as defence in depth.

**Rationale.** Per-query filtering fails on the first forgotten query, and that failure leaks another business's data. Default-deny at the infrastructure layer means a forgotten filter is impossible rather than merely discouraged.

---

### INV-6 — Deletion is soft

Business records are never physically deleted. A delete sets a deleted flag and a deletion timestamp; the global read filter excludes flagged rows.

**Rationale.** Historical documents — sales, ledger rows, purchase orders — reference catalog entities. Hard deletion breaks history. A five-year-old invoice must still render the product name it was sold under.

Entities additionally carrying an independent **active/inactive** flag (a business state, distinct from deletion): user, product, variant, category, brand, customer, supplier, warehouse.

---

### INV-7 — Completed financial documents are immutable

- A **completed sale** is never edited. Reversal happens by creating a return or a void, both of which are new records.
- A **closed day** is never reopened, and its monetary figures are a frozen snapshot taken at close time — deliberately *not* recomputed on read. A sale voided next week must not retroactively rewrite a reconciliation somebody signed off on.
- A **completed or cancelled stock take** is immutable.

---

### INV-8 — Authentication uses short-lived access tokens with single-use refresh rotation

- Access token lifetime: **15 minutes**. Held in memory on the client, never in persistent browser storage.
- Refresh token lifetime: **7 days**. Delivered as an HTTP-only, secure, same-site cookie. Not readable by client script.
- Refresh is **single-use**: presenting a refresh token issues a new pair and immediately invalidates the presented token.
- Logout revokes the stored refresh token server-side.

---

### INV-9 — Read and write paths are separated

Every state-changing operation is a **command**; every read is a **query**. Both are handled outside the HTTP layer. Controllers/route handlers do input binding, dispatch, and response shaping — no business logic. Cross-cutting concerns (validation, logging, performance measurement, plan-limit enforcement) sit in a pipeline that wraps every command and query uniformly.

---

## 4. Multi-Tenancy & SaaS Model

### 4.1 Isolation Strategy

**Shared schema, row-level isolation.** One database, one set of tables, a tenant discriminator column on every business table.

Alternatives rejected: database-per-tenant (operationally expensive at small tenant sizes, painful migrations) and schema-per-tenant (same problems, less tooling support).

### 4.2 Tenant Lifecycle

```
   self-registration
          │
          ▼
    ┌──────────┐  14 days  ┌───────────┐  payment   ┌────────────┐
    │  TRIAL   │──────────▶│  EXPIRED  │───────────▶│ SUBSCRIBED │
    └──────────┘           └───────────┘            └────────────┘
          │                                                │
          │            operator action                     │
          └──────────────────┬─────────────────────────────┘
                             ▼
                       ┌───────────┐
                       │ SUSPENDED │ ◀──▶ reactivate
                       └───────────┘
```

### 4.3 Self-Service Registration ✅ IMPLEMENTED

A single unauthenticated endpoint creates everything a new business needs.

**Input:** business name, URL slug, owner email, owner full name, password.

**Algorithm — order matters:**

1. Validate slug is globally unique (case-insensitive, excluding soft-deleted tenants). Reject with `DUPLICATE_SLUG`.
2. Validate email is not already registered anywhere in the system. Reject with `DUPLICATE_EMAIL`.
3. Create the tenant. **The tenant's own tenant-discriminator equals its own id** (self-reference) so the global filter treats it uniformly with every other row.
   - plan = `trial`, active = true, trial ends 14 days from now.
4. Create the owner user with the **Admin** role inside that tenant.
   - If user creation fails, soft-delete the tenant and return the failure. Registration is all-or-nothing.
5. Seed per-tenant defaults:
   - One warehouse: name `Main Warehouse`, location `Default`, marked as default.
   - One unit of measure: name `Piece`, abbreviation `pc`.
6. Issue an access token and refresh token so the owner is signed in immediately — no second login step.
7. Send a welcome email **fire-and-forget**. Email delivery failure must never fail registration.

**Validation rules:**

| Field | Rules |
|---|---|
| businessName | required, 2–200 chars |
| slug | required, 2–60 chars, lowercase alphanumeric + hyphens only, globally unique |
| ownerEmail | required, valid email format, globally unique |
| ownerFullName | required, 2–200 chars |
| password | required, min 8 chars, at least one uppercase, one lowercase, one digit, one non-alphanumeric |

### 4.4 Subscription Plans ✅ IMPLEMENTED (limits) · 🟡 PARTIAL (billing)

| Plan id | Name | Max users | Max warehouses | Monthly price |
|---|---|---|---|---|
| `free` | Free | 1 | 1 | 0 |
| `trial` | Trial | 5 | 2 | 0 |
| `starter` | Starter | 5 | 2 | 29 |
| `pro` | Pro | 20 | 10 | 79 |
| `enterprise` | Enterprise | unlimited | unlimited | custom |

- `-1` denotes unlimited.
- An unknown plan id resolves to `free` (fail-closed).
- Plans are **code constants**, not database rows. Changing a plan is a deployment, not a data edit.

**Limit enforcement.** A pipeline stage inspects every command before it executes. If the command would create a resource beyond the tenant's plan limit, it is rejected with `PLAN_LIMIT_EXCEEDED` and a message naming the limit and the plan. The platform-operator role is exempt.

> 🟡 In the reference system the enforcement stage exists and is wired into the pipeline, but the user-count check is stubbed. **Build it fully:** count active users for the tenant, compare against `plan.maxUsers`, reject when the limit is met. Same for warehouse creation against `plan.maxWarehouses`.

**Billing.** ⬜ PLANNED. The tenant record reserves fields for an external payment-processor customer id and subscription id. Checkout session creation and webhook handling for subscription lifecycle events are specified but not built.

### 4.5 Platform Operator Console ✅ IMPLEMENTED

A dedicated **SuperAdmin** role operates the platform itself. SuperAdmin users belong to no tenant, bypass the tenant read filter entirely, and are exempt from plan limits.

Capabilities:

| Capability | Behaviour |
|---|---|
| Platform statistics | Total tenants, active tenants, total users, plan distribution |
| List all tenants | Across every tenant, with plan and status |
| List a tenant's users | Drill into any tenant |
| Create a tenant manually | Same effect as self-registration, operator-initiated |
| Suspend a tenant | Sets inactive. All that tenant's users are refused authentication. |
| Activate a tenant | Reverses suspension |
| Change a tenant's plan | Immediate effect on limits |
| Create a subscription | Attaches billing identifiers |
| **Impersonate a tenant** | Issues a token scoped to that tenant for support purposes |

**Impersonation is a high-risk capability.** It must: be restricted to SuperAdmin, write an audit log entry recording operator, target tenant, and timestamp, display a persistent visual banner in the UI for the entire impersonated session, and expire with the normal short access-token lifetime.

### 4.6 Tenant URL Strategy

- **Phase 1 (build this):** path-based or single-host. The tenant is resolved from the authenticated token, not the URL.
- **Phase 2 ⬜ PLANNED:** subdomain-based (`{slug}.app.example.com`), resolving the tenant from the host header before authentication.

---

## 5. Identity, Roles & Permissions

### 5.1 Authentication ✅ IMPLEMENTED

| Operation | Auth required | Behaviour |
|---|---|---|
| Register tenant | no | §4.3 |
| Login | no | Email + password → access token (body) + refresh token (HTTP-only cookie) |
| Refresh | no (cookie) | Reads the refresh cookie, rotates it, returns a new access token |
| Current user | yes | Returns the authenticated principal's profile, roles, permissions, ABAC attributes |
| Revoke | yes | Invalidates the stored refresh token; clears the cookie |

**Login failure modes** — all return the *same* generic message to the client to avoid account enumeration, while logging the specific cause server-side:

| Condition | Error code |
|---|---|
| Email not found | `INVALID_CREDENTIALS` |
| Password wrong | `INVALID_CREDENTIALS` |
| User deactivated | `ACCOUNT_DISABLED` |
| Tenant suspended | `TENANT_SUSPENDED` |
| Too many failed attempts | `ACCOUNT_LOCKED` |

**Account lockout:** 5 consecutive failures locks the account for 15 minutes. The counter resets on success.

**Password storage:** a modern memory-hard or iterated hash with a per-user salt. Never reversible encryption, never a bare fast hash.

### 5.2 Token Payload

The access token carries everything needed for authorization so that no permission check requires a database round trip.

| Claim | Type | Meaning |
|---|---|---|
| subject / user id | uuid | Authenticated user |
| email | string | Login identity |
| token id | uuid | Unique per token, for revocation lists |
| `tenant_id` | uuid | Absent for SuperAdmin |
| `plan_id` | string | Current plan, for limit checks |
| role (repeatable) | string | One claim per assigned role |
| `permission` (repeatable) | string | One claim per granted permission |
| `max_discount_pct` | numeric string | ABAC — see §5.5 |
| `max_sale_amount` | numeric string | ABAC — empty string = unlimited |
| `can_approve_refund` | `"true"`/`"false"` | ABAC |
| `can_view_cost` | `"true"`/`"false"` | ABAC |
| `warehouse_ids` | `"*"` or comma-separated uuids | ABAC — `*` = all warehouses |

**Refresh flow.** The client never parses or stores the refresh token. On a 401 the client calls refresh once, retries the original request on success, and redirects to login on failure. Concurrent 401s must trigger exactly one refresh — queue the rest behind it.

### 5.3 Roles

Five roles. Roles are fixed in code, not user-editable.

| Role | Scope | Description |
|---|---|---|
| **SuperAdmin** | platform | Operates the SaaS. Belongs to no tenant. |
| **Admin** | tenant | Business owner. Everything within their tenant. |
| **Manager** | tenant | Runs operations. Cannot manage users or edit settings. |
| **Cashier** | tenant | Sells, counts, records expenses. Cannot approve, void ledger variances, or close the day. |
| **Viewer** | tenant | Read-only across the business. |

### 5.4 Permission Catalog — all 40 permissions

Permissions are strings in `Resource.Action` form.

| Group | Permissions |
|---|---|
| **Products** | `Products.Read`, `Products.Create`, `Products.Edit`, `Products.Delete` |
| **Sales** | `Sales.Read`, `Sales.Create`, `Sales.Void`, `Sales.Refund` |
| **Purchases** | `Purchases.Read`, `Purchases.Create`, `Purchases.Edit`, `Purchases.Receive`, `Purchases.Approve` |
| **Inventory** | `Inventory.Read`, `Inventory.Adjust` |
| **Stock take** | `StockTake.Read`, `StockTake.Create`, `StockTake.Count`, `StockTake.Approve` |
| **Day close** | `DayClose.Read`, `DayClose.Manage` |
| **Expenses** | `Expenses.Read`, `Expenses.Create`, `Expenses.Edit`, `Expenses.Delete` |
| **Customers** | `Customers.Read`, `Customers.Create`, `Customers.Edit` |
| **Reports** | `Reports.Read`, `Reports.Financial` |
| **Users** | `Users.Read`, `Users.Create`, `Users.Edit`, `Users.Deactivate` |
| **Settings** | `Settings.Read`, `Settings.Edit` |
| **Quotations** | `Quotations.Read`, `Quotations.Create`, `Quotations.Edit`, `Quotations.Delete` |

**Two deliberate separations — do not collapse them:**

- `StockTake.Count` (entering physical counts) is separate from `StockTake.Approve` (posting variances to the ledger). In a shop that cares about shrinkage, the person entering numbers should not be the person who commits them.
- `Reports.Read` (operational reports) is separate from `Reports.Financial` (cost, margin, profit). Staff may see what sold without seeing what it cost.

### 5.5 Role → Permission Matrix

Legend: ● granted · ○ not granted

| Permission | Admin | Manager | Cashier | Viewer |
|---|:--:|:--:|:--:|:--:|
| Products.Read | ● | ● | ● | ● |
| Products.Create | ● | ● | ○ | ○ |
| Products.Edit | ● | ● | ○ | ○ |
| Products.Delete | ● | ○ | ○ | ○ |
| Sales.Read | ● | ● | ● | ○ |
| Sales.Create | ● | ● | ● | ○ |
| Sales.Void | ● | ● | ○ | ○ |
| Sales.Refund | ● | ● | ○ | ○ |
| Purchases.Read | ● | ● | ○ | ● |
| Purchases.Create | ● | ● | ○ | ○ |
| Purchases.Edit | ● | ● | ○ | ○ |
| Purchases.Receive | ● | ● | ○ | ○ |
| Purchases.Approve | ● | ● | ○ | ○ |
| Inventory.Read | ● | ● | ● | ● |
| Inventory.Adjust | ● | ● | ○ | ○ |
| StockTake.Read | ● | ● | ● | ● |
| StockTake.Create | ● | ● | ○ | ○ |
| StockTake.Count | ● | ● | ● | ○ |
| StockTake.Approve | ● | ● | ○ | ○ |
| DayClose.Read | ● | ● | ● | ● |
| DayClose.Manage | ● | ● | ○ | ○ |
| Expenses.Read | ● | ● | ● | ● |
| Expenses.Create | ● | ● | ● | ○ |
| Expenses.Edit | ● | ● | ○ | ○ |
| Expenses.Delete | ● | ● | ○ | ○ |
| Customers.Read | ● | ● | ● | ● |
| Customers.Create | ● | ● | ● | ○ |
| Customers.Edit | ● | ● | ○ | ○ |
| Reports.Read | ● | ● | ○ | ● |
| Reports.Financial | ● | ● | ○ | ○ |
| Users.Read | ● | ● | ○ | ○ |
| Users.Create | ● | ○ | ○ | ○ |
| Users.Edit | ● | ○ | ○ | ○ |
| Users.Deactivate | ● | ○ | ○ | ○ |
| Settings.Read | ● | ● | ○ | ● |
| Settings.Edit | ● | ○ | ○ | ○ |
| Quotations.Read | ● | ● | ● | ○ |
| Quotations.Create | ● | ● | ● | ○ |
| Quotations.Edit | ● | ● | ○ | ○ |
| Quotations.Delete | ● | ● | ○ | ○ |

### 5.6 Attribute-Based Access Control (ABAC)

Permissions answer *"may this user perform this kind of action?"*. Attributes answer *"how far may they go?"*. Both are enforced.

| Attribute | Type | Meaning | Empty/`*` means |
|---|---|---|---|
| `max_discount_pct` | decimal | Highest discount percentage the user may apply, per line and in aggregate | — |
| `max_sale_amount` | decimal | Highest permitted sale total | unlimited |
| `can_approve_refund` | boolean | May approve refunds | — |
| `can_view_cost` | boolean | May see purchase price, cost, and margin anywhere in the UI or API | — |
| `warehouse_ids` | list of uuid | Warehouses the user may operate in | all warehouses |

**Role defaults** — applied at user creation, overridable per user:

| Attribute | Admin | Manager | Cashier | Viewer |
|---|---|---|---|---|
| max_discount_pct | 100 | 20 | 5 | 0 |
| max_sale_amount | unlimited | unlimited | 50 000 | 0 |
| can_approve_refund | true | true | false | false |
| can_view_cost | true | true | false | false |
| warehouse_ids | all | all | all | all |

**Enforcement is server-side and mandatory.** The client may hide controls the user cannot use, but every ABAC constraint is re-checked in the command handler. A hidden button is a courtesy, not a control.

### 5.7 Authorization Failure Semantics

| Situation | HTTP | Error code |
|---|---|---|
| No token, or expired/invalid token | 401 | `UNAUTHORIZED` |
| Valid token, missing permission | 403 | `FORBIDDEN` |
| Valid token, ABAC limit exceeded | 422 | `DISCOUNT_EXCEEDED` / `AMOUNT_EXCEEDED` |
| Valid token, warehouse not in scope | 422 | `FORBIDDEN` (with warehouse-specific message) |
| Tenant suspended | 403 | `TENANT_SUSPENDED` |
| Plan limit reached | 422 | `PLAN_LIMIT_EXCEEDED` |

### 5.8 Client-Side Authorization Support

The client must provide:

- A **route guard** requiring authentication.
- A **permission guard** parameterized by permission string, applied per route.
- A **role guard** parameterized by role list, for operator-only and admin-only routes.
- A **structural directive / component wrapper** that conditionally renders UI based on a permission the current user holds.
- A reactive **auth store** exposing: current user, roles, permission set, and each ABAC attribute as an observable/computed value, so components react to changes without manual subscription.

---

## 6. Domain Model

Type notation used below is platform-neutral:

`uuid` · `string(n)` (max length) · `text` (unbounded) · `int` · `decimal(18,4)` · `bool` · `date` (no time) · `timestamp` (UTC instant) · `enum` · `json`

All timestamps are **UTC**. Localization to business timezone happens at the presentation layer only.

---

### 6.0 Base Entity Contract

**Every business entity carries these fields.** They are not repeated in the tables below.

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `id` | uuid | ✔ | Primary key. Generated client-side or server-side; must be collision-free without a round trip. |
| `tenant_id` | uuid | ✔ | Tenant discriminator. Stamped automatically on insert. Indexed on every table. |
| `created_at` | timestamp | ✔ | Set once on insert. Never modified. |
| `updated_at` | timestamp | ✔ | Refreshed on every modification. |
| `is_deleted` | bool | ✔ | Soft-delete flag. Default false. Global read filter excludes true. |
| `deleted_at` | timestamp | ✖ | Set when `is_deleted` becomes true. |

**Domain events.** Every entity can accumulate domain events during a unit of work; they are dispatched after the transaction commits and cleared. See §8.16.

---

### 6.1 Tenancy & Configuration

#### `tenants`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `name` | string(200) | ✔ | Business display name |
| `slug` | string(60) | ✔ | **Globally unique**, lowercase, alphanumeric + hyphen. Reserved for future subdomain routing. |
| `plan_id` | string(30) | ✔ | Default `trial`. One of the plan ids in §4.4. |
| `is_active` | bool | ✔ | Default true. False = suspended; all users refused login. |
| `trial_ends_at` | timestamp | ✖ | Set to now + 14 days on self-registration |
| `subscription_ends_at` | timestamp | ✖ | Paid period end |
| `payment_customer_id` | string(100) | ✖ | External payment-processor customer reference |
| `payment_subscription_id` | string(100) | ✖ | External payment-processor subscription reference |

> A tenant row's own `tenant_id` equals its `id` (self-reference), so the global tenant filter applies uniformly.

#### `tenant_settings` — exactly one row per tenant

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `business_name` | string(200) | ✔ | Printed on receipts and documents |
| `address` | text | ✖ | Printed on receipts |
| `phone` | string(40) | ✖ | |
| `email` | string(200) | ✖ | |
| `logo_url` | text | ✖ | Receipt and UI branding |
| `receipt_footer` | text | ✖ | Free text at the bottom of every receipt |
| `currency_code` | string(3) | ✔ | ISO 4217. Default `USD`. |
| `currency_symbol` | string(8) | ✔ | Default `$` |
| `tax_enabled` | bool | ✔ | Master switch. When false, all tax computations yield zero. |
| `tax_pct` | decimal(18,4) | ✔ | 0–100. Applied to sales and quotations. |
| `tax_label` | string(40) | ✔ | Display name, e.g. `VAT`, `GST`. Default `Tax`. |
| `tax_inclusive` | bool | ✔ | True = listed prices already contain tax; tax is extracted rather than added. |

**Rule:** exactly one settings row per tenant. Reads return the row or a defaults object; writes are upsert semantics — create if absent, update if present.

#### `documents` — content-addressed file metadata

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `content_hash` | string(64) | ✔ | SHA-256 hex of the file bytes. Determines the physical filename. |
| `url` | text | ✔ | Publicly resolvable URL returned to clients |
| `original_file_name` | string(255) | ✔ | As uploaded |
| `content_type` | string(100) | ✔ | MIME type |
| `file_size_bytes` | int | ✔ | |
| `folder` | string(50) | ✔ | Logical bucket, e.g. `products` |

**Content addressing:** the physical file is named from its content hash, so uploading identical bytes twice produces one physical file and two metadata rows (or one reused row). Deduplication is free.

---

### 6.2 Catalog

#### `categories` — hierarchical

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `name` | string(120) | ✔ | Unique per tenant per parent |
| `sku_prefix` | string(16) | ✔ | Used to auto-generate product SKUs |
| `description` | text | ✖ | |
| `parent_id` | uuid → categories | ✖ | Null = root. **Cycles must be rejected.** |
| `sort_order` | int | ✔ | Default 0. Ascending display order. |
| `is_active` | bool | ✔ | Default true |

**Rules:**
- A category with child categories or with products cannot be deleted → `CATEGORY_IN_USE`.
- Maximum nesting depth: 5 levels.
- Setting a category's parent to itself or to any of its descendants → `CIRCULAR_REFERENCE`.

#### `brands`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `name` | string(120) | ✔ | Unique per tenant |
| `is_active` | bool | ✔ | Default true |

Deleting a brand referenced by products → `BRAND_IN_USE`.

#### `units` — units of measure

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `name` | string(60) | ✔ | e.g. `Piece`, `Meter`, `Kilogram`, `Liter`. Unique per tenant. |
| `abbreviation` | string(10) | ✔ | e.g. `pc`, `m`, `kg`, `L` |

Deleting a unit referenced by products → `UNIT_IN_USE`.

#### `products`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `name` | string(200) | ✔ | Searchable |
| `sku` | string(64) | ✔ | **Unique per tenant.** Auto-generated as `{category.sku_prefix}-{sequence}`, manually overridable. |
| `description` | text | ✖ | |
| `category_id` | uuid → categories | ✔ | |
| `brand_id` | uuid → brands | ✖ | |
| `unit_id` | uuid → units | ✔ | |
| `has_variants` | bool | ✔ | False = single sellable form; one internal "Default" variant still exists |
| `track_serial` | bool | ✔ | Enables per-unit serial capture at sale time |
| `track_expiry` | bool | ✔ | Enables expiry-date capture |
| `warranty_months` | int | ✖ | Warranty period printed on the receipt |
| `image_url` | text | ✖ | Primary display image (denormalized from the image collection for list performance) |
| `is_active` | bool | ✔ | Default true |

> **INV-1: there is no quantity field here, and there must never be one.**

**Rules:**
- Every product has **at least one** variant. A product with `has_variants = false` still has exactly one, named `Default`.
- SKU is unique per tenant and case-insensitive for uniqueness purposes.
- A product's category **cannot be changed once it has completed sales** — the SKU prefix would no longer match the category → `CATEGORY_LOCKED`.
- Deletion is soft. A product referenced by any sale or ledger row can never be hard-deleted.

#### `product_variants`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `product_id` | uuid → products | ✔ | Cascade with the parent's soft-delete |
| `variant_name` | string(120) | ✔ | Default `"Default"`. e.g. `Red / 500ml` |
| `barcode` | string(64) | ✖ | **Unique per tenant when present.** Lives here, not on the product. |
| `purchase_price` | decimal(18,4) | ✔ | Cost. Visible only to users with `can_view_cost`. |
| `selling_price` | decimal(18,4) | ✔ | Retail price. Must be > 0. |
| `wholesale_price` | decimal(18,4) | ✔ | Bulk/trade price. May be 0 if unused. |
| `min_stock` | int | ✔ | Low-stock alert threshold. Default 0. |
| `is_active` | bool | ✔ | Default true |

> **INV-1: no quantity field here either.**

**Rules:**
- `selling_price > 0` always.
- `purchase_price >= 0`.
- Barcode uniqueness is enforced per tenant across all variants; blank/null barcodes do not collide.
- A variant referenced by any sale item or ledger row is never hard-deleted.
- Warn (do not block) when `selling_price < purchase_price`.

#### `product_images`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `product_id` | uuid → products | ✔ | |
| `document_id` | uuid → documents | ✔ | |
| `display_order` | int | ✔ | Ascending. Order 0 is the primary image. |

#### `serial_numbers` ⬜ PLANNED (data model exists; no operations yet)

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `variant_id` | uuid → product_variants | ✔ | |
| `serial` | string(120) | ✔ | Unique per tenant |
| `status` | enum SerialNumberStatus | ✔ | Default `Available` |
| `sale_item_id` | uuid → sale_items | ✖ | Set when sold |
| `warehouse_id` | uuid → warehouses | ✔ | Current location |
| `expiry_date` | date | ✖ | For expiry-tracked goods |

**Rules to build:**
- Only variants whose product has `track_serial = true` may have serial rows.
- Selling a serial-tracked variant requires selecting exactly `quantity` available serials; the sale is rejected otherwise.
- Selling sets status `Sold` and links the sale item. Returning sets `Returned` (restockable) or `Damaged` (not restockable).
- Serial status transitions: `Available → Sold → Returned → Available`; any state → `Damaged` (terminal).

---

### 6.3 Inventory

#### `warehouses`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `name` | string(120) | ✔ | Unique per tenant |
| `location` | string(200) | ✖ | |
| `is_default` | bool | ✔ | **Exactly one default per tenant.** Setting a new default clears the previous one atomically. |
| `is_active` | bool | ✔ | Default true |

**Rules:**
- A tenant always has at least one warehouse; the last one cannot be deleted or deactivated.
- A warehouse holding non-zero stock cannot be deactivated → `WAREHOUSE_NOT_EMPTY`.
- Warehouse count is capped by the tenant's plan.

#### `inventory_transactions` — THE LEDGER

**Append-only. Never updated. Never deleted. See INV-2.**

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `variant_id` | uuid → product_variants | ✔ | Indexed |
| `warehouse_id` | uuid → warehouses | ✔ | Indexed |
| `transaction_type` | enum TransactionType | ✔ | See §7.1 |
| `quantity` | int | ✔ | **SIGNED.** Positive = stock in, negative = stock out. Never zero. |
| `reference_type` | string(40) | ✔ | Source document kind: `Sale`, `SaleVoid`, `Return`, `Purchase`, `PurchaseReceipt`, `Adjustment`, `Transfer`, `StockTake`, `Damage`, `OpeningStock` |
| `reference_id` | uuid | ✔ | Source document id. For adjustments and transfers, a generated correlation id. |
| `notes` | text | ✖ | **Mandatory for adjustments, damage, and stock-take variances.** |
| `user_id` | uuid → users | ✔ | Who caused the movement |

**Composite index:** `(tenant_id, variant_id, warehouse_id)` — this is the hot read path for balance computation.

> **Sign convention — get this right.** The reference implementation stores the quantity *signed* (a sale writes `-5`), which makes the balance a plain `SUM`. An alternative convention stores magnitude only and derives direction from the type. **Pick one and enforce it in the single stock service (INV-3).** Mixing them silently corrupts every balance. This specification mandates the **signed** convention.

#### `stock_balance` — derived read model (INV-4)

| Field | Type | Notes |
|---|---|---|
| `variant_id` | uuid | Composite key part 1 |
| `warehouse_id` | uuid | Composite key part 2 |
| `quantity` | int | `SUM(inventory_transactions.quantity)` for the pair |

Read-only to all application code.

#### `stock_takes` 🟡 PARTIAL — entities and contracts exist, operations not built

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `reference_no` | string(40) | ✔ | Human-readable, unique per tenant, e.g. `ST-0001` |
| `warehouse_id` | uuid → warehouses | ✔ | The warehouse being counted |
| `category_id` | uuid → categories | ✖ | **Null = whole warehouse.** Set = partial count of one category. |
| `status` | enum StockTakeStatus | ✔ | Default `InProgress` |
| `notes` | text | ✖ | |
| `started_by` | uuid → users | ✔ | |
| `started_at` | timestamp | ✔ | |
| `approved_by` | uuid → users | ✖ | Set at approval |
| `completed_at` | timestamp | ✖ | Set at approval or cancellation |
| `total_items` | int | ✔ | Denormalized roll-up |
| `counted_items` | int | ✔ | Denormalized roll-up |
| `variance_items` | int | ✔ | Denormalized roll-up — lines where variance ≠ 0 |
| `variance_value` | decimal(18,4) | ✔ | Σ(variance × unit_cost). **Negative = shrinkage.** |

Roll-ups are recomputed on every count entry so the list screen never has to load line items.

#### `stock_take_items`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `stock_take_id` | uuid → stock_takes | ✔ | |
| `variant_id` | uuid → product_variants | ✔ | |
| `expected_qty` | int | ✔ | Ledger balance **snapshotted at sheet generation**. Never recomputed. |
| `counted_qty` | int | ✖ | **Nullable and it matters:** null = "nobody has walked that aisle yet", which is a different fact from "counted, found zero". |
| `variance` | int | ✔ | `counted_qty - expected_qty`, or 0 while uncounted |
| `unit_cost` | decimal(18,4) | ✔ | Purchase price snapshotted at sheet generation, used to value the variance |
| `notes` | text | ✖ | |
| `counted_by` | uuid → users | ✖ | |
| `counted_at` | timestamp | ✖ | |

> **Critical rule:** approval **skips null `counted_qty` lines entirely**. Treating an uncounted line as zero would wipe real stock off the books.

---

### 6.4 Sales

#### `sales`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `invoice_no` | string(40) | ✔ | Unique per tenant. See numbering rules below. |
| `customer_id` | uuid → customers | ✖ | **Null = walk-in.** |
| `warehouse_id` | uuid → warehouses | ✔ | Stock deducted from here |
| `subtotal` | decimal(18,4) | ✔ | Σ(unit_price × qty) before any discount |
| `discount_amount` | decimal(18,4) | ✔ | Line discounts + order-level discount, combined |
| `discount_pct` | decimal(18,4) | ✔ | Order-level percentage, if expressed that way |
| `tax_amount` | decimal(18,4) | ✔ | |
| `total` | decimal(18,4) | ✔ | `subtotal - discount_amount + tax_amount` |
| `paid_amount` | decimal(18,4) | ✔ | Σ of payments |
| `change_amount` | decimal(18,4) | ✔ | `max(0, paid - total)` |
| `due_amount` | decimal(18,4) | ✔ | `max(0, total - paid)` |
| `status` | enum SaleStatus | ✔ | |
| `notes` | text | ✖ | |
| `user_id` | uuid → users | ✔ | Cashier |
| `daily_closing_id` | uuid → daily_closings | ✖ | Linked when the day is closed |

**Invoice numbering.** Two acceptable schemes:
- **Specified (preferred):** `{YYYYMMDD}-{SEQUENCE}` where the sequence resets at midnight in the business timezone. Human-readable, sortable, gapless per day.
- **Reference implementation:** `INV{yyMMdd}{6 random uppercase alphanumerics}` — collision-resistant without a sequence lock, which matters when offline terminals generate invoice numbers.

If you support **offline sales** (§13), the daily-sequence scheme requires server-side renumbering on sync. The random-suffix scheme does not. Choose accordingly and document the choice.

#### `sale_items`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `sale_id` | uuid → sales | ✔ | |
| `variant_id` | uuid → product_variants | ✔ | |
| `quantity` | int | ✔ | > 0 |
| `unit_price` | decimal(18,4) | ✔ | **Snapshotted at sale time.** Later catalog price changes never alter historical sales. |
| `discount_amount` | decimal(18,4) | ✔ | Absolute, on this line |
| `discount_pct` | decimal(18,4) | ✔ | Percentage, on this line |
| `tax_amount` | decimal(18,4) | ✔ | |
| `tax_pct` | decimal(18,4) | ✔ | Snapshotted from settings at sale time |
| `subtotal` | decimal(18,4) | ✔ | `(unit_price × quantity) - discount_amount` |

#### `sale_payments` — split payment supported

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `sale_id` | uuid → sales | ✔ | |
| `payment_method` | enum PaymentMethod | ✔ | |
| `amount` | decimal(18,4) | ✔ | > 0 |
| `reference_no` | string(80) | ✖ | Card auth code, transfer reference, cheque number |

A sale may carry several payment rows — e.g. 100 cash + 250 card.

#### `sale_returns`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `sale_id` | uuid → sales | ✔ | The original sale |
| `return_no` | string(40) | ✔ | Unique per tenant, e.g. `RET-{yyyyMMddHHmmss}` |
| `refund_method` | enum PaymentMethod | ✔ | How the money went back |
| `refund_amount` | decimal(18,4) | ✔ | Computed proportionally — see §8.5 |
| `reason` | text | ✔ | **Mandatory** |
| `user_id` | uuid → users | ✔ | |

#### `sale_return_items`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `sale_return_id` | uuid → sale_returns | ✔ | |
| `sale_item_id` | uuid → sale_items | ✔ | The original line |
| `variant_id` | uuid → product_variants | ✔ | |
| `return_qty` | int | ✔ | > 0, and ≤ (original qty − already returned) |
| `reason` | text | ✖ | Per-line reason |
| `is_restockable` | bool | ✔ | Default true. **False = goods are damaged; no stock is added back.** |

#### `held_carts`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `label` | string(80) | ✖ | Cashier-supplied name, e.g. "Blue van guy" |
| `cart_data` | json | ✔ | Serialized cart: items, quantities, prices, discounts, customer |
| `user_id` | uuid → users | ✔ | Owner. A cashier sees only their own held carts. |

Held carts do **not** reserve stock. A held cart may become unfulfillable if stock sells out meanwhile; the stock check happens at completion.

---

### 6.5 Quotations

#### `quotations`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `quotation_no` | string(40) | ✔ | Unique per tenant, format `QT-{0000}` from a per-tenant sequence |
| `customer_id` | uuid → customers | ✖ | Optional link to a registered customer |
| `customer_name` | string(200) | ✔ | **Always stored**, even when linked — a quote must render standalone |
| `customer_phone` | string(40) | ✖ | |
| `customer_email` | string(200) | ✖ | |
| `warehouse_id` | uuid → warehouses | ✔ | Pricing/availability context |
| `valid_until` | timestamp | ✔ | Default: now + 30 days |
| `subtotal` | decimal(18,4) | ✔ | Σ of line subtotals after line discounts |
| `discount_amount` | decimal(18,4) | ✔ | Order-level discount |
| `tax_pct` | decimal(18,4) | ✔ | **Snapshotted from tenant settings at creation** |
| `tax_amount` | decimal(18,4) | ✔ | |
| `total` | decimal(18,4) | ✔ | |
| `status` | enum QuotationStatus | ✔ | Default `Draft` |
| `notes` | text | ✖ | |
| `user_id` | uuid → users | ✔ | |
| `sale_id` | uuid → sales | ✖ | Set when converted to a sale |

#### `quotation_items`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `quotation_id` | uuid → quotations | ✔ | |
| `variant_id` | uuid → product_variants | ✔ | |
| `product_name` | string(200) | ✔ | **Denormalized snapshot** — the quote must still read correctly if the product is later renamed |
| `variant_name` | string(120) | ✔ | Denormalized snapshot |
| `quantity` | int | ✔ | > 0 |
| `unit_price` | decimal(18,4) | ✔ | |
| `discount_amount` | decimal(18,4) | ✔ | |
| `discount_pct` | decimal(18,4) | ✔ | Derived: `discount_amount / (unit_price × qty) × 100` |
| `tax_pct` | decimal(18,4) | ✔ | |
| `subtotal` | decimal(18,4) | ✔ | `max(0, unit_price × qty − discount_amount)` |

**Quotations never touch stock.**

---

### 6.6 Purchases

#### `suppliers`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `name` | string(200) | ✔ | Unique per tenant |
| `contact_name` | string(120) | ✖ | |
| `phone` | string(40) | ✖ | |
| `email` | string(200) | ✖ | |
| `address` | text | ✖ | |
| `payment_terms_days` | int | ✔ | Default 30 |
| `balance` | decimal(18,4) | ✔ | Amount owed to this supplier. **Positive = we owe them.** |
| `is_active` | bool | ✔ | Default true |

#### `purchase_orders`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `po_number` | string(40) | ✔ | Unique per tenant |
| `supplier_id` | uuid → suppliers | ✔ | |
| `warehouse_id` | uuid → warehouses | ✔ | Destination for received goods |
| `status` | enum PurchaseOrderStatus | ✔ | Default `Draft` |
| `order_date` | date | ✔ | Default today |
| `expected_date` | date | ✖ | |
| `total_amount` | decimal(18,4) | ✔ | Σ of line totals |
| `notes` | text | ✖ | |
| `user_id` | uuid → users | ✔ | |

#### `purchase_order_lines`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `purchase_order_id` | uuid → purchase_orders | ✔ | |
| `variant_id` | uuid → product_variants | ✔ | |
| `ordered_qty` | int | ✔ | > 0 |
| `received_qty` | int | ✔ | Default 0. Never exceeds `ordered_qty`. |
| `unit_cost` | decimal(18,4) | ✔ | |
| `line_total` | decimal(18,4) | ✔ | `ordered_qty × unit_cost` |

#### `purchase_receipts`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `purchase_order_id` | uuid → purchase_orders | ✔ | |
| `receipt_no` | string(40) | ✔ | Unique per tenant, e.g. `RCV{yyMMdd}{5 alphanumerics}` |
| `received_date` | date | ✔ | Default today |
| `notes` | text | ✖ | |
| `user_id` | uuid → users | ✔ | |

#### `purchase_receipt_items`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `receipt_id` | uuid → purchase_receipts | ✔ | |
| `po_line_id` | uuid → purchase_order_lines | ✔ | |
| `variant_id` | uuid → product_variants | ✔ | |
| `received_qty` | int | ✔ | > 0 |

#### `supplier_payments` ⬜ PLANNED (entity exists; no operations)

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `supplier_id` | uuid → suppliers | ✔ | |
| `amount` | decimal(18,4) | ✔ | > 0 |
| `payment_method` | enum PaymentMethod | ✔ | |
| `reference_no` | string(80) | ✖ | |
| `notes` | text | ✖ | |
| `user_id` | uuid → users | ✔ | |

Recording a payment decreases `supplier.balance` by `amount` in the same transaction.

---

### 6.7 Customers

#### `customers`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `name` | string(200) | ✔ | |
| `phone` | string(40) | ✖ | Unique per tenant when present. Primary lookup key at the counter. |
| `email` | string(200) | ✖ | |
| `address` | text | ✖ | |
| `trn` | string(40) | ✖ | Tax registration number, printed on tax invoices |
| `credit_limit` | decimal(18,4) | ✔ | Default 0. Maximum permitted outstanding balance. |
| `balance` | decimal(18,4) | ✔ | Outstanding amount. **Positive = customer owes us.** |
| `loyalty_points` | int | ✔ | Default 0 |
| `is_active` | bool | ✔ | Default true |

#### `customer_payments` ⬜ PLANNED (entity exists; no operations)

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `customer_id` | uuid → customers | ✔ | |
| `amount` | decimal(18,4) | ✔ | > 0 |
| `payment_method` | enum PaymentMethod | ✔ | |
| `reference_no` | string(80) | ✖ | |
| `notes` | text | ✖ | |
| `user_id` | uuid → users | ✔ | |

Recording a payment decreases `customer.balance` by `amount` in the same transaction.

#### `loyalty_transactions` ⬜ PLANNED (entity exists; no operations)

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `customer_id` | uuid → customers | ✔ | |
| `points` | int | ✔ | Signed: positive earned, negative redeemed |
| `type` | enum LoyaltyType | ✔ | `Earned` / `Redeemed` |
| `reference_type` | string(40) | ✖ | e.g. `Sale` |
| `reference_id` | uuid | ✖ | |

Ledger-style, like inventory: `customer.loyalty_points` should be reconcilable against the sum of these rows.

---

### 6.8 Financial Operations

#### `daily_closings` — one row per tenant per calendar day

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `closing_date` | date | ✔ | **Unique per tenant** |
| `status` | enum DayCloseStatus | ✔ | Default `Open` |
| `opening_float` | decimal(18,4) | ✔ | Cash physically in the drawer at open |
| `total_sales` | decimal(18,4) | ✔ | ❄ Frozen at close |
| `total_returns` | decimal(18,4) | ✔ | ❄ Frozen at close |
| `total_expenses` | decimal(18,4) | ✔ | ❄ Frozen at close |
| `cash_total` | decimal(18,4) | ✔ | ❄ Cash tender, net of cash refunds |
| `card_total` | decimal(18,4) | ✔ | ❄ Card tender, net of card refunds |
| `bank_total` | decimal(18,4) | ✔ | ❄ Bank transfer tender, net |
| `credit_total` | decimal(18,4) | ✔ | ❄ Customer-credit tender, net |
| `expected_cash` | decimal(18,4) | ✔ | ❄ `opening_float + cash_total − cash_expenses` |
| `counted_cash` | decimal(18,4) | ✔ | What was physically counted |
| `cash_variance` | decimal(18,4) | ✔ | `counted_cash − expected_cash`. **Negative = drawer is short.** |
| `sale_count` | int | ✔ | ❄ |
| `notes` | text | ✖ | |
| `opened_by` | uuid → users | ✔ | |
| `opened_at` | timestamp | ✔ | |
| `closed_by` | uuid → users | ✖ | |
| `closed_at` | timestamp | ✖ | |

❄ = snapshot, frozen at close, never recomputed on read (INV-7).

#### `expenses`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `title` | string(200) | ✔ | |
| `amount` | decimal(18,4) | ✔ | > 0 |
| `category` | string(80) | ✖ | Free text; the distinct set is offered as autocomplete |
| `expense_date` | date | ✔ | Default today |
| `notes` | text | ✖ | |
| `user_id` | uuid → users | ✔ | |
| `daily_closing_id` | uuid → daily_closings | ✖ | Linked when the covering day is closed |

---

### 6.9 Paint

#### `paint_formulas`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `color_code` | string(40) | ✔ | Manufacturer code, e.g. `RAL 5010`. Unique per tenant per size. |
| `color_name` | string(120) | ✔ | Human name, e.g. `Gentian Blue` |
| `base_variant_id` | uuid → product_variants | ✔ | The base paint container being tinted |
| `size_ml` | int | ✔ | Can size in millilitres, e.g. 1000 / 4000 / 20000 |
| `notes` | text | ✖ | Mixing instructions |

#### `formula_components`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `formula_id` | uuid → paint_formulas | ✔ | |
| `component_name` | string(80) | ✔ | Tint code, e.g. `B1`, `KX` |
| `quantity_ml` | decimal(18,4) | ✔ | Dosage in millilitres. > 0. |
| `sort_order` | int | ✔ | Dispensing order |

> Tint components are **informational dosages only** — tint materials are not tracked as inventory.

#### `paint_orders`

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `formula_id` | uuid → paint_formulas | ✖ | Null for a fully custom mix |
| `sale_id` | uuid → sales | ✖ | Link to the sale that paid for it |
| `custom_notes` | text | ✖ | Free-form instructions for a custom colour |
| `user_id` | uuid → users | ✔ | |

---

### 6.10 System

#### `notifications` ⬜ PLANNED (entity exists; no operations)

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `user_id` | uuid → users | ✔ | Recipient |
| `title` | string(200) | ✔ | |
| `message` | text | ✔ | |
| `type` | enum NotificationType | ✔ | |
| `is_read` | bool | ✔ | Default false |
| `reference_type` | string(40) | ✖ | |
| `reference_id` | uuid | ✖ | |

#### `audit_logs` 🟡 PARTIAL (entity exists; no write path or read API)

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `user_id` | uuid → users | ✖ | Null for system actions |
| `action` | string(60) | ✔ | e.g. `Create`, `Update`, `Delete`, `Login`, `Impersonate` |
| `entity_type` | string(80) | ✔ | |
| `entity_id` | uuid | ✖ | |
| `old_values` | json | ✖ | Before state |
| `new_values` | json | ✖ | After state |
| `ip_address` | string(45) | ✖ | IPv4 or IPv6 |

**Build the write path** as an automatic interceptor on the persistence layer, not as scattered manual calls. **Minimum coverage:** every write to sales, returns, ledger, stock takes, day closings, users, roles, settings, and every impersonation.

#### `users` (identity)

| Field | Type | Req | Constraints / Notes |
|---|---|:--:|---|
| `email` | string(200) | ✔ | **Globally unique across all tenants.** Login identity. |
| `full_name` | string(200) | ✔ | |
| `password_hash` | string | ✔ | Memory-hard or iterated hash, per-user salt |
| `tenant_id` | uuid → tenants | ✖ | **Null for SuperAdmin** |
| `is_active` | bool | ✔ | Default true. False = login refused. |
| `refresh_token` | string | ✖ | Current valid refresh token (or a hash of it) |
| `refresh_token_expiry` | timestamp | ✖ | |
| `failed_login_count` | int | ✔ | Reset on success |
| `lockout_end` | timestamp | ✖ | |
| `email_confirmed` | bool | ✔ | |

Roles and ABAC attributes are stored as user claims/attributes and projected into the token at issue time.

---

## 7. Enumerations

Values are listed in canonical order. Persist as strings or as stable integers — but if integers, **never renumber**.

### 7.1 TransactionType — ledger movement kinds

| Value | Direction | Triggered by |
|---|:--:|---|
| `PurchaseIn` | + | Purchase receipt confirmed |
| `SaleOut` | − | Sale completed |
| `AdjustmentIn` | + | Manual increase, or positive stock-take variance |
| `AdjustmentOut` | − | Manual decrease, or negative stock-take variance |
| `TransferIn` | + | Stock arriving at the destination warehouse |
| `TransferOut` | − | Stock leaving the source warehouse |
| `ReturnIn` | + | Customer return of restockable goods |
| `ReturnOut` | − | Return to supplier |
| `Damage` | − | Damaged goods written off |
| `OpeningStock` | + | Initial stock at setup or bulk import |

**Reference-type → transaction-type mapping** (the single stock service owns this):

| Direction | reference_type | → transaction_type |
|---|---|---|
| Add | `Purchase`, `PurchaseReceipt` | `PurchaseIn` |
| Add | `Return`, `SaleReturn` | `ReturnIn` |
| Add | `Transfer` | `TransferIn` |
| Add | `OpeningStock` | `OpeningStock` |
| Add | *(anything else)* | `AdjustmentIn` |
| Deduct | `Sale` | `SaleOut` |
| Deduct | `Return`, `PurchaseReturn` | `ReturnOut` |
| Deduct | `Transfer` | `TransferOut` |
| Deduct | `Damage` | `Damage` |
| Deduct | *(anything else)* | `AdjustmentOut` |

### 7.2 SaleStatus

| Value | Meaning |
|---|---|
| `Draft` | Cart under construction; not persisted as a real sale |
| `Pending` | Persisted but not fully paid — a credit sale with an outstanding balance |
| `Completed` | Fully paid. **Immutable.** |
| `Voided` | Cancelled; stock restored |
| `PartiallyReturned` | Some lines returned |
| `FullyReturned` | Every line fully returned |

Legal transitions:
```
Draft → Pending → Completed
Draft → Completed                     (paid in full at once)
Pending | Completed → Voided
Completed → PartiallyReturned → FullyReturned
```
Illegal: anything → `Draft`; `Voided` → anything; `FullyReturned` → anything.

### 7.3 PaymentMethod

| Value | Notes |
|---|---|
| `Cash` | Affects the drawer and day-close cash reconciliation |
| `Card` | |
| `BankTransfer` | |
| `CustomerCredit` | **Requires a linked customer.** Increases `customer.balance`. |

### 7.4 PurchaseOrderStatus

| Value | Meaning |
|---|---|
| `Draft` | Editable; no stock effect |
| `Approved` | Committed; may now receive goods |
| `PartiallyReceived` | Some lines partly received |
| `Received` | All lines fully received |
| `Closed` | Finalized and archived |
| `Cancelled` | Terminated. Only from `Draft` or `Approved`, and only if nothing has been received. |

```
Draft → Approved → PartiallyReceived → Received → Closed
  │         │
  └─────────┴──→ Cancelled
```

### 7.5 QuotationStatus

`Draft` → `Sent` → `Accepted` | `Rejected` · any → `Expired` (automatic when `valid_until` passes)

### 7.6 StockTakeStatus

| Value | Meaning |
|---|---|
| `InProgress` | Counting under way; expected quantities already snapshotted |
| `PendingApproval` | Counting finished; awaiting someone with `StockTake.Approve` |
| `Completed` | Variances posted to the ledger. **Immutable.** |
| `Cancelled` | Abandoned without posting anything. **Immutable.** |

### 7.7 DayCloseStatus

| Value | Meaning |
|---|---|
| `Open` | Sales and expenses may still be recorded against this day |
| `Closed` | Cash counted, day reconciled. Totals are a frozen snapshot. **Never reopened.** |

### 7.8 SerialNumberStatus

`Available` → `Sold` → `Returned` → `Available` · any → `Damaged` (terminal)

### 7.9 LoyaltyType

`Earned` · `Redeemed`

### 7.10 NotificationType

`LowStock` · `DueReminder` · `System`

### 7.11 UserRole

`SuperAdmin` (platform) · `Admin` · `Manager` · `Cashier` · `Viewer` (tenant)

---

## 8. Module Feature Specification

Each module below states: purpose, status, features, business rules, screens, and acceptance criteria.

---

### 8.1 Authentication & Registration ✅ IMPLEMENTED

**Purpose.** Establish and maintain identity; onboard new businesses.

**Features**
1. Tenant self-registration (§4.3)
2. Email + password login
3. Silent token refresh via HTTP-only cookie
4. Current-user profile retrieval
5. Logout with server-side refresh-token revocation
6. Account lockout after repeated failures
7. Welcome email on registration
8. ⬜ **PLANNED:** email verification, password reset, change password

**Business rules**
- Email is globally unique across all tenants.
- Login is refused if the user is inactive **or** their tenant is suspended.
- All login failure reasons return an identical client-facing message (§5.1).
- Refresh tokens are single-use; presenting one invalidates it immediately.
- Access token is never persisted to browser storage.

**Screens**

| Screen | Route | Contents |
|---|---|---|
| Login | `/login` | Email, password, submit, error banner, link to register |
| Register | `/register` | Business name, slug (auto-derived from name, editable, live availability check), owner name, email, password, confirm password |

**Acceptance criteria**
- [ ] Registering creates tenant + admin user + default warehouse + default unit, and returns a signed-in session.
- [ ] A failure at user creation leaves no orphaned tenant.
- [ ] Duplicate slug and duplicate email are each rejected with their specific code.
- [ ] 5 wrong passwords lock the account for 15 minutes.
- [ ] A refresh token cannot be reused; the second attempt fails.
- [ ] Access token is absent from local storage and session storage.
- [ ] Suspending a tenant blocks its users' next login attempt.

---

### 8.2 Users & Access Control ✅ IMPLEMENTED

**Purpose.** Manage who works in the business and what they may do.

**Features**
1. Paginated user list with search and role filter
2. User detail
3. Create user — email, name, role, password, ABAC attribute overrides
4. Edit user — name, role, ABAC attributes, active flag
5. Deactivate user (soft)
6. Role defaults auto-applied on creation, individually overridable

**Business rules**
- Only `Admin` may create, edit, or deactivate users.
- A user cannot deactivate their own account.
- The last active `Admin` in a tenant cannot be deactivated or demoted → `LAST_ADMIN`.
- New-user email must be globally unique.
- ABAC attributes default from the role table (§5.6) and may be overridden per user.
- User count is capped by the tenant's plan.

**Screens** — `/users`: table (name, email, role, status, actions), create/edit dialog with an ABAC section, deactivate confirmation.

**Acceptance criteria**
- [ ] A Manager receives 403 attempting to create a user.
- [ ] Deactivating the last Admin is rejected.
- [ ] A created Cashier's token carries `max_discount_pct = 5` unless overridden.
- [ ] Overridden ABAC values appear in the token on the user's next login.
- [ ] Exceeding the plan's user limit is rejected with `PLAN_LIMIT_EXCEEDED`.

---

### 8.3 Product Catalog ✅ IMPLEMENTED

**Purpose.** Define what the business sells.

**Features**
1. Paginated, searchable product list — search across name, SKU, and barcode
2. Filter by category, brand, active status
3. Product detail with variants, images, and per-warehouse stock
4. Create product with one or more variants in a single operation
5. Optional **opening stock per variant** at creation — posts `OpeningStock` ledger rows
6. Edit product and variants
7. Soft delete
8. Category CRUD (hierarchical) + activate/deactivate
9. Brand CRUD + activate/deactivate
10. Unit CRUD
11. **Bulk import from spreadsheet** with per-row validation
12. Multi-image upload with content-addressed deduplication

**Business rules**
- Every product has ≥ 1 variant; single-form products get one named `Default`.
- SKU auto-generates as `{category.sku_prefix}-{sequence}`, manually overridable, unique per tenant.
- Barcode lives on the variant and is unique per tenant when present.
- Category cannot change after the product has completed sales.
- Deleting a category/brand/unit that is referenced fails with the corresponding `*_IN_USE` code.
- `purchase_price`, and any margin derived from it, is hidden from users without `can_view_cost` — **filtered server-side**, not merely hidden in the UI.
- Opening stock goes through the stock service like any other movement (INV-3).

**Bulk import specification**

Input rows carry: row number, name, SKU, category *(by name)*, unit *(by name)*, brand *(by name, optional)*, barcode, description, purchase price, selling price, wholesale price, min stock, opening stock.

Algorithm:
1. Match category, unit, and brand **by name**, case-insensitively.
2. **Auto-create missing categories and brands.** Do not auto-create units — an unknown unit is a row error.
3. Validate each row independently. A bad row is skipped, never aborts the batch.
4. Create the product with one `Default` variant.
5. If `opening_stock > 0`, post an `OpeningStock` ledger row to the specified (or default) warehouse.
6. Return: imported count, skipped count, per-row errors (row number, name, reason), count of new categories, count of new brands.

Row-level rejection reasons: missing name, missing SKU, duplicate SKU, unknown unit, non-positive selling price, negative prices, malformed numbers.

**Screens**

| Screen | Route |
|---|---|
| Product list | `/products` |
| Product detail | `/products/:id` |
| Create / edit product | `/products/new`, `/products/:id/edit` |
| Bulk import | `/products/import` |
| Categories | `/products/categories` |
| Brands | `/products/brands` |
| Units | `/products/units` |

**Acceptance criteria**
- [ ] Creating a product with `hasVariants = false` produces exactly one `Default` variant.
- [ ] Duplicate SKU within a tenant is rejected; the same SKU in a different tenant succeeds.
- [ ] Duplicate barcode within a tenant is rejected.
- [ ] Opening stock creates `OpeningStock` ledger rows and the product detail shows that stock.
- [ ] A user without `can_view_cost` receives no purchase price in any API response.
- [ ] Bulk import of 100 rows with 3 invalid rows imports 97 and reports 3 errors with row numbers.
- [ ] Bulk import auto-creates unknown categories and brands, and reports the counts.
- [ ] Deleting a category with products is rejected.
- [ ] Changing the category of a product with completed sales is rejected.

---

### 8.4 Inventory ✅ IMPLEMENTED (core) · 🟡 PARTIAL (warehouse CRUD, alerts)

**Purpose.** The stock authority. Every other module's stock change routes through here.

**Features**
1. **Stock view** — current quantity per variant per warehouse, filterable by warehouse, category, and search; with a low-stock-only toggle
2. **Transaction history** — the ledger, filterable by variant, warehouse, type, and date range; paginated
3. **Warehouse list**
4. **Stock adjustment** — set an absolute new quantity with a mandatory reason
5. **Stock transfer** — move quantity between warehouses
6. 🟡 **Warehouse create / edit / deactivate** — the entity exists, only a read endpoint is built. **Build the full CRUD.**
7. ⬜ **Low-stock alerts** — real-time push when a movement drops a variant below its `min_stock`
8. ⬜ **Damage write-off** — a dedicated flow producing `Damage` ledger rows with a mandatory reason

**Business rules**
- Adjustments require a written reason. Blank reason → `VALIDATION_ERROR`.
- An adjustment computes `delta = newQuantity − currentBalance` and writes **one** row for the delta. Zero delta is a silent no-op.
- New absolute quantity may not be negative.
- Transfers validate the source balance first; insufficient stock → `INSUFFICIENT_STOCK`.
- Transfers write exactly two rows (out, then in) sharing one correlation reference id, in one database transaction. A partial transfer is impossible.
- Source and destination warehouses must differ.
- Transfer quantity must be positive.
- Stock may not go negative as a result of a completed sale — the check happens before commit.
- ABAC `warehouse_ids` restricts which warehouses a user may read or operate on.

**Screens** — `/inventory` with two tabs: **Stock** (table: product, variant, SKU, barcode, warehouse, quantity, min stock, status chip) and **Transactions** (table: date, product, warehouse, type, quantity, reference, user, notes). Adjust and Transfer are dialogs.

**Acceptance criteria**
- [ ] Adjusting from 10 to 7 writes one `AdjustmentOut` row of −3, not a row of 7.
- [ ] Adjusting to the same value writes nothing.
- [ ] Adjustment without a reason is rejected.
- [ ] Transferring more than the source holds is rejected, and writes zero rows.
- [ ] A successful transfer writes exactly two rows with a shared reference id.
- [ ] Any attempt to UPDATE or DELETE a ledger row raises an error at the persistence layer.
- [ ] Balance shown equals the `SUM` of ledger quantities for that pair.
- [ ] A user scoped to warehouse A sees no warehouse-B stock.

---

### 8.5 Sales & Returns ✅ IMPLEMENTED

**Purpose.** The record of everything sold, and the mechanism for reversing it.

**Features**
1. Paginated sale list — filter by date range, status, customer, cashier; search by invoice number
2. Sale detail — lines, payments, returns, totals
3. **Void a sale** — restores stock
4. **Process a return** — partial or full, per line, with restockable flag
5. Receipt reprint from any sale
6. ⬜ **PLANNED:** exchange (return + new sale in one operation)

#### Void algorithm

1. Load the sale with its items.
2. Reject if already `Voided` → `ALREADY_VOIDED`.
3. Reject if the sale has any returns → `CANNOT_VOID` ("a sale with returns cannot be voided").
4. For every line, add stock back via the stock service with reference type `SaleVoid` and a note naming the invoice.
5. Set status `Voided`.
6. Save in one transaction.

Requires `Sales.Void`.

#### Return algorithm

1. Reject an empty item list, or a blank reason → `VALIDATION_ERROR`.
2. Reject an unparseable refund method.
3. Load the sale with items and existing returns; 404 if absent.
4. Reject if the sale is `Voided` or `Draft` → `CANNOT_RETURN`.
5. Build a map of already-returned quantity per original line, summed across all prior returns.
6. For each requested line:
   - Reject if the line is not on this sale → `ITEM_NOT_FOUND`.
   - `maxReturnable = originalQty − alreadyReturned`.
   - Reject if `returnQty ≤ 0` or `returnQty > maxReturnable` → `INVALID_QTY`, naming the maximum.
   - **Proportional refund:** `unitRefund = line.subtotal / line.quantity`, contribution `= round(unitRefund × returnQty, 4)`. This correctly refunds the discounted price actually paid, not the list price.
7. Create the return header with number `RET-{yyyyMMddHHmmss}`.
8. For each line, create a return item; **if restockable**, add stock back with reference type `Return` and a note carrying the return number and reason. Non-restockable lines add no stock.
9. Recompute sale status: `FullyReturned` if every original line's cumulative returned quantity now meets its original quantity, otherwise `PartiallyReturned`.
10. Save in one transaction. Return the return number.

Requires `Sales.Refund`. If ABAC `can_approve_refund` is false, the operation is refused regardless of permission.

**Business rules**
- A completed sale is never edited — only voided or returned (INV-7).
- Returns cannot exceed the original quantity, cumulatively across multiple returns.
- Refunds are proportional to the discounted line subtotal.
- Non-restockable returns refund money but return no stock.
- A sale with returns cannot be voided.
- Line prices are historical snapshots; catalog price changes never alter past sales.

**Screens** — `/sales` list; sale detail drawer/page; return dialog (line table with returnable quantity, per-line quantity input, restockable checkbox, reason, refund method, computed refund total).

**Acceptance criteria**
- [ ] Voiding restores exactly the sold quantity to the sale's warehouse.
- [ ] Voiding twice is rejected.
- [ ] Voiding a sale that has a return is rejected.
- [ ] Returning 2 of 5 units sets `PartiallyReturned`; returning the remaining 3 sets `FullyReturned`.
- [ ] Returning more than remains is rejected with the correct maximum in the message.
- [ ] A line sold at 100 with a 10% discount refunds 90 per unit, not 100.
- [ ] A non-restockable return adds no ledger row.
- [ ] A user with `can_approve_refund = false` is refused.

---

### 8.6 POS Terminal ✅ IMPLEMENTED

**Purpose.** The cashier's primary tool. The most performance- and reliability-critical screen in the product.

**Features**
1. Warehouse selector, restricted to the user's ABAC warehouse scope
2. Product grid/list with live search across name, SKU, and barcode
3. Category filter chips
4. Barcode scanner input — an exact barcode match adds to the cart immediately
5. Cart: add, change quantity, remove, clear
6. **Per-line price override** (both "set unit price" and "set line total", which back-computes the unit price)
7. **Order-level discount** with live validation against the ABAC cap
8. Automatic tax computation from tenant settings, inclusive or exclusive
9. Customer selection with search; walk-in is the default
10. Payment dialog: method, amount tendered, computed change
11. Split payment across multiple methods
12. **Hold cart** with an optional label; **restore held cart**; delete held cart
13. Receipt preview and print in **two formats: 80 mm thermal and A4 invoice**
14. Full offline operation (§13)
15. Mobile-responsive: a products/cart view toggle on narrow screens

#### Sale creation algorithm — this is the critical path

```
INPUT: customerId?, warehouseId, notes?, items[], payments[], orderDiscountAmount

 1. REJECT if items is empty                          → VALIDATION_ERROR
 2. REJECT if no authenticated user                   → UNAUTHORIZED

 3. ABAC — warehouse scope:
      if user.warehouseIds is non-empty
         and warehouseId not in user.warehouseIds     → FORBIDDEN

 4. ABAC — per-line discount cap:
      for each item:
        if item.discountPct > user.maxDiscountPct     → DISCOUNT_EXCEEDED

 5. REJECT if orderDiscountAmount < 0                 → VALIDATION_ERROR

 6. ABAC — order-level discount cap:
      preSubtotal = Σ(unitPrice × qty)
      maxAllowed  = round(preSubtotal × maxDiscountPct / 100, 4)
      if orderDiscountAmount > maxAllowed             → DISCOUNT_EXCEEDED

 7. PRE-VALIDATE STOCK — before writing anything:
      for each item:
        if currentStock(variant, warehouse) < qty     → INSUFFICIENT_STOCK
                                                        (message states available qty)

 8. COMPUTE TOTALS:
      for each item:
        lineSubtotal = round(unitPrice × qty, 4)
        lineDiscount = round(lineSubtotal × discountPct / 100, 4)
        lineTotal    = lineSubtotal − lineDiscount
        subtotal       += lineSubtotal
        discountAmount += lineDiscount

      discountAmount += round(orderDiscountAmount, 4)
      taxAmount       = tax per §8.6.1
      total           = round(subtotal − discountAmount + taxAmount, 4)
      paid            = round(Σ payments.amount, 4)
      change          = round(max(0, paid − total), 4)
      due             = round(max(0, total − paid), 4)
      status          = due <= 0 ? Completed : Pending

 9. ABAC — sale amount cap:
      if user.maxSaleAmount is set and total > maxSaleAmount
                                                      → AMOUNT_EXCEEDED

10. REJECT if due > 0 and customerId is null          → CREDIT_REQUIRES_CUSTOMER
11. REJECT if due > 0 and (customer.balance + due) > customer.creditLimit
                                                      → CREDIT_LIMIT_EXCEEDED

12. GENERATE invoice number
13. PERSIST sale header and line items
14. DEDUCT stock for every line via the stock service (referenceType "Sale")
15. PERSIST payments; unknown method                  → INVALID_PAYMENT
16. If any payment is CustomerCredit or due > 0: increase customer.balance
17. COMMIT — everything in ONE transaction
18. RETURN saleId and invoiceNo
```

> **Steps 13–17 must be atomic.** A crash between persisting the sale and deducting stock produces a sale that never left the shelf. Wrap the whole block in one database transaction.

> **Steps 10–11 and 16** are specified but **not present in the reference implementation** — a credit sale currently succeeds without a customer and without touching the customer balance. **Build them.**

#### 8.6.1 Tax computation

Read `tax_enabled`, `tax_pct`, `tax_inclusive` from tenant settings.

```
if not tax_enabled:            taxAmount = 0

else if tax_inclusive:
    # listed prices already contain tax — extract it
    taxable   = subtotal − discountAmount
    taxAmount = round(taxable − (taxable / (1 + tax_pct/100)), 4)
    total     = taxable                      # unchanged; tax is a component

else:  # exclusive
    taxable   = subtotal − discountAmount
    taxAmount = round(taxable × tax_pct / 100, 4)
    total     = taxable + taxAmount
```

The tax percentage is **snapshotted onto the sale and its lines**, so a later settings change never rewrites historical documents.

**Screens** — `/pos`, a full-height three-region layout: left = product grid with search and category chips; right = cart with lines, totals, and actions; bottom bar = customer, hold, pay. Dialogs: payment, held carts, edit line, receipt preview.

**Keyboard support** (⬜ PLANNED — specify and build): `F2` focus search · `F4` open payment · `F8` hold cart · `Esc` close dialog · `Enter` on an exact barcode match adds it.

**Acceptance criteria**
- [ ] Scanning a barcode adds the matching variant and clears the search box.
- [ ] A cashier capped at 5% is rejected at 6% on a line, and at an order discount above 5% of subtotal.
- [ ] A cashier capped at 50 000 is rejected on a 50 001 total.
- [ ] Selling 5 when 3 are in stock is rejected and writes nothing.
- [ ] A completed sale deducts exactly the sold quantity from the correct warehouse.
- [ ] Split payment of 100 cash + 250 card on a 350 total completes with zero change and zero due.
- [ ] Overpaying 400 on a 350 total records change of 50.
- [ ] Underpaying 300 on a 350 total sets status `Pending` and due 50.
- [ ] A held cart restores with the exact lines, quantities, prices, and customer.
- [ ] The receipt renders correctly in both thermal and A4 formats.
- [ ] Inclusive tax leaves the total unchanged and reports the tax component.

---

### 8.7 Quotations ✅ IMPLEMENTED

**Purpose.** Priced offers with an expiry, convertible to sales.

**Features**
1. Paginated list — filter by status, customer, date range; search by number or customer
2. Detail view
3. Create — with or without a linked customer
4. Edit while in `Draft`
5. Status transitions: Draft → Sent → Accepted / Rejected
6. Delete (soft)
7. Print / PDF export
8. ⬜ **PLANNED:** one-click conversion to a sale (the `sale_id` link field already exists)

**Business rules**
- Number auto-generates as `QT-{0000}` from a per-tenant sequence.
- Default validity is 30 days from creation.
- Tax percentage is snapshotted from tenant settings at creation.
- Product and variant names are **denormalized onto the line** so a later rename does not alter the quote.
- `discount_pct` on a line is derived: `discountAmount / (unitPrice × qty) × 100`.
- Line subtotal is floored at zero: `max(0, unitPrice × qty − discountAmount)`.
- Quotation total: `taxable = max(0, itemsSubtotal − orderDiscount)`; `tax = round(taxable × taxPct/100, 4)`; `total = max(0, taxable + tax)`.
- **Quotations never affect stock.**
- A quotation past `valid_until` displays as `Expired` regardless of stored status.
- Only `Draft` quotations may be edited.

**Screens** — `/quotations` (list), `/quotations/new`, `/quotations/:id/edit`, `/quotations/:id` (detail with print).

**Acceptance criteria**
- [ ] Creating a quotation writes no ledger rows.
- [ ] Numbers increment per tenant without gaps.
- [ ] Tax is computed from settings at creation and frozen thereafter.
- [ ] Renaming a product does not change an existing quotation's displayed line.
- [ ] A quotation past its validity date shows as expired.
- [ ] Editing an `Accepted` quotation is rejected.

---

### 8.8 Purchases & Suppliers ✅ IMPLEMENTED (core) · ⬜ PLANNED (payments, returns)

**Purpose.** Bring stock into the business and track what is owed for it.

**Features**
1. Supplier CRUD with search and activate/deactivate
2. Supplier detail with purchase history
3. Paginated purchase-order list — filter by status, supplier, date range
4. Purchase-order detail with lines and receipt history
5. Create purchase order (Draft)
6. **Approve** purchase order
7. **Receive goods** — partial or full, per line
8. **Cancel** purchase order
9. ⬜ **PLANNED:** supplier payment recording (entity exists)
10. ⬜ **PLANNED:** purchase returns to supplier (`ReturnOut` ledger type is defined and unused)

#### Receive-goods algorithm

1. Filter to lines with `receivedQty > 0`; reject if none remain → `VALIDATION_ERROR`.
2. Load the PO with its lines; 404 if absent.
3. Reject unless status is `Approved` or `PartiallyReceived` → `INVALID_STATUS`, naming the current status.
4. Validate every line **before writing anything**:
   - Line must belong to this PO → `INVALID_LINE`.
   - `remaining = orderedQty − receivedQty`; reject `receivedQty > remaining` → `OVER_RECEIVE`, naming the remaining amount.
5. Create the receipt header, number `RCV{yyMMdd}{5 alphanumerics}`.
6. For each line: create a receipt item and increment the PO line's `received_qty`.
7. Recompute PO status: `Received` if every line is fully received, else `PartiallyReceived`.
8. Add stock for every received line via the stock service, reference type `PurchaseReceipt`, destination = the PO's warehouse.
9. ⬜ **Build:** increase `supplier.balance` by the value received.
10. Commit in one transaction; return the receipt number.

**Business rules**
- **Stock rises only on receipt, never on PO creation or approval.**
- Only `Draft` POs may be edited.
- Only `Approved` or `PartiallyReceived` POs may receive goods.
- Cannot receive more than ordered, per line, cumulatively.
- Cancellation is allowed only from `Draft` or `Approved`, and only if nothing has been received.
- Receiving requires `Purchases.Receive`; approving requires `Purchases.Approve`. These are separate permissions and must stay separate.

**Screens** — `/purchases` (list), `/purchases/new`, purchase detail with a receive dialog; `/suppliers`, `/suppliers/new`, `/suppliers/:id/edit`.

**Acceptance criteria**
- [ ] Creating a PO writes no ledger rows.
- [ ] Approving a PO writes no ledger rows.
- [ ] Receiving 5 of 10 sets `PartiallyReceived` and adds exactly 5 to stock.
- [ ] Receiving the remaining 5 sets `Received`.
- [ ] Attempting to receive 6 more after 5 of 10 is rejected with "only 5 remaining", and writes nothing.
- [ ] Receiving against a `Draft` PO is rejected.
- [ ] Cancelling a partially received PO is rejected.

---

### 8.9 Customers ✅ IMPLEMENTED (CRUD) · ⬜ PLANNED (credit, loyalty)

**Purpose.** Know who buys, and track what they owe.

**Features**
1. Paginated list with search by name, phone, or email
2. Detail with purchase history and balance
3. Create / edit customer
4. Activate / deactivate
5. ⬜ **PLANNED:** record a customer payment against outstanding balance
6. ⬜ **PLANNED:** credit-limit enforcement at sale time
7. ⬜ **PLANNED:** loyalty points earning and redemption
8. ⬜ **PLANNED:** statement of account / ageing report

**Business rules**
- Phone is unique per tenant when present, and is the primary counter lookup.
- `balance > 0` means the customer owes the business.
- A credit sale requires a linked customer — walk-in sales must be fully paid.
- A credit sale that would push `balance` beyond `credit_limit` is rejected → `CREDIT_LIMIT_EXCEEDED`.
- Recording a payment decreases the balance in the same transaction as the payment row.
- A customer with a non-zero balance cannot be deactivated → `CUSTOMER_HAS_BALANCE`.
- Loyalty points are a ledger (`loyalty_transactions`); the denormalized `loyalty_points` must reconcile against their sum.

**Screens** — `/customers`, `/customers/new`, `/customers/:id/edit`, customer detail with balance and history.

**Acceptance criteria**
- [ ] Duplicate phone within a tenant is rejected.
- [ ] A credit sale without a customer is rejected.
- [ ] A credit sale exceeding the credit limit is rejected.
- [ ] Recording a payment reduces the balance by exactly the amount paid.
- [ ] Deactivating a customer with a balance is rejected.

---

### 8.10 Stock Take 🟡 PARTIAL — model complete, operations not built

**Purpose.** Reconcile the ledger against physical reality.

**Status.** The entities, DTOs, repository contract, permission set, and the stock-service variance-posting operation all exist. **The commands, queries, endpoints, and UI do not. Build them.**

**Features to build**
1. Create a stock take for a warehouse, optionally scoped to one category
2. Auto-generate the count sheet from the current ledger, snapshotting expected quantity and unit cost per line
3. List stock takes with roll-up figures
4. Detail view with all lines
5. Enter counts, line by line or in bulk
6. Submit for approval
7. **Approve** — post variances to the ledger
8. **Cancel** — abandon without posting anything
9. Export the count sheet for offline paper counting
10. Variance report

#### Sheet generation

For every active variant in scope (whole warehouse, or one category):
- `expected_qty` = current ledger balance for (variant, warehouse) — **snapshotted, never recomputed**
- `unit_cost` = the variant's purchase price at this moment — **snapshotted**
- `counted_qty` = **null**
- `variance` = 0

Set `total_items` on the header. Status = `InProgress`.

#### Count entry

On each entry: set `counted_qty`, `counted_by`, `counted_at`; recompute `variance = counted_qty − expected_qty`; recompute the header roll-ups (`counted_items`, `variance_items`, `variance_value = Σ(variance × unit_cost)`).

#### Approval — the critical operation

1. Require `StockTake.Approve`.
2. Reject unless status is `InProgress` or `PendingApproval`.
3. Collect variances **only from lines where `counted_qty` is not null and `variance ≠ 0`**.
4. Call the stock service's variance-posting operation with the collected list.
5. Set status `Completed`, record `approved_by` and `completed_at`.
6. Commit in one transaction.

> **Two rules that must not be compromised:**
>
> **(a) Uncounted lines are skipped entirely.** A null `counted_qty` means "not yet visited", not "found zero". Posting a null line as zero would erase real stock.
>
> **(b) Variances post as DELTAS, never as absolute values.** Selling continues while staff walk the aisles. Forcing the ledger to the counted number would erase every sale made between the count and the approval. The variance is the discrepancy actually observed, and it remains correct however much legitimate movement follows.

**Business rules**
- One `InProgress` stock take per warehouse at a time → `STOCK_TAKE_IN_PROGRESS`.
- `StockTake.Count` (entering numbers) and `StockTake.Approve` (posting them) are separate permissions and must stay separate.
- `Completed` and `Cancelled` stock takes are immutable.
- Cancelling posts nothing to the ledger.
- Variance value is negative for shrinkage.
- Posted variance rows reference the stock take id, so a whole count is traceable — and reversible — as one event.

**Screens to build** — `/stock-takes` (list with status, warehouse, progress bar, variance value), `/stock-takes/new` (warehouse + optional category), `/stock-takes/:id` (line table with expected, counted input, variance, value; submit and approve actions; export).

**Acceptance criteria**
- [ ] Creating a stock take snapshots expected quantities that do not change when stock later moves.
- [ ] Approving a sheet with 10 lines where only 6 were counted posts variances for at most those 6.
- [ ] An uncounted line produces no ledger row.
- [ ] A line counted at 8 against expected 10 posts exactly one row of −2.
- [ ] If 3 units sell between counting and approval, the resulting balance is `expected − 3 + variance`, not the counted number.
- [ ] A Cashier can enter counts but is refused approval.
- [ ] Cancelling writes no ledger rows.
- [ ] A completed stock take cannot be edited.

---

### 8.11 Day Close & Expenses 🟡 PARTIAL — backend complete, UI not built

**Purpose.** Daily cash reconciliation and out-of-pocket spending records.

**Status.** All backend operations exist and work. **No UI exists. Build the screens.**

**Features**
1. **Open the day** — declare the opening cash float
2. **Live preview** — uncommitted figures for a date, so the cashier sees what the drawer *should* hold before typing what it *does* hold
3. **Close the day** — enter counted cash; the system freezes totals and computes the variance
4. Day-close history with variance highlighting
5. Day-close detail with the expense list
6. Expense CRUD with a category autocomplete sourced from existing distinct categories

#### Open-day algorithm

1. Resolve the date (supplied or today).
2. Reject if a record already exists for that date → `DAY_ALREADY_OPEN` or `DAY_ALREADY_CLOSED` ("has already been closed and cannot be reopened").
3. Create the record: status `Open`, the given float, opened-by and opened-at.
4. Validate: float ≥ 0; notes ≤ 1000 chars.

#### Close-day algorithm

1. Load the record; 404 if absent.
2. Reject if already `Closed` → `DAY_ALREADY_CLOSED`.
3. Compute the day's totals from live data:
   - `totalSales`, `totalReturns`, `totalExpenses`, `saleCount`
   - tender split: `cashTotal`, `cardTotal`, `bankTotal`, `creditTotal` — each **net of refunds issued through the same tender**
   - `cashExpenses` — expenses paid in cash
4. **Freeze** all of the above onto the record.
5. `expectedCash = openingFloat + cashTotal − cashExpenses`
6. `countedCash = input`
7. `cashVariance = countedCash − expectedCash` (negative = short)
8. Status `Closed`; record closed-by and closed-at.
9. Save.
10. **After saving**, link that day's sales and expenses to this closing record — after, so the foreign key points at a row that definitely exists.

#### Preview

- If the day is **already closed**, return its **frozen snapshot**, not a recomputation. Otherwise the preview and the signed-off record could disagree.
- Otherwise compute live totals, using the opening float if the day is open and zero if it has not been opened. Report status `NotOpened` when no record exists.

**Business rules**
- One day-close record per tenant per calendar day.
- A closed day is never reopened (INV-7).
- Closed figures are frozen and never recomputed on read.
- Negative variance = drawer short; surface it prominently.
- Expenses may only be recorded against an open day (or a day not yet opened, dated appropriately).
- Cash expenses reduce expected cash; non-cash expenses do not.
- `DayClose.Read` for viewing; `DayClose.Manage` for opening and closing. **A Cashier can read but cannot close the day they were selling on.**

**Screens to build**

| Screen | Route | Contents |
|---|---|---|
| Day close | `/day-close` | Open-day card (float input); live preview panel (sales, returns, expenses, tender split, expected cash); counted-cash input; variance display with colour; close button; history table |
| Day detail | `/day-close/:id` | Frozen snapshot, expense list, opened/closed by and at |
| Expenses | `/expenses` | List with date range and category filters; create/edit dialog; delete confirmation |

**Acceptance criteria**
- [ ] Opening a day twice is rejected.
- [ ] Opening a closed day is rejected with the "cannot be reopened" message.
- [ ] Preview of an unopened day reports status `NotOpened` and a zero float.
- [ ] Preview of a closed day returns the frozen snapshot, byte-identical to the stored record.
- [ ] Expected cash = opening float + cash sales − cash expenses.
- [ ] Counting 100 short records a variance of −100.
- [ ] Voiding a sale from a closed day does not change that day's stored totals.
- [ ] After close, that day's sales and expenses carry the closing record's id.
- [ ] A Cashier can view but not close.

---

### 8.12 Paint ✅ IMPLEMENTED

**Purpose.** Custom colour mixing for paint retail.

**Features**
1. Formula list with **partial search on colour code and colour name** — customers usually know only one of them, and often only approximately
2. Formula detail with its component list
3. Create formula — colour code, name, base variant, size, components
4. Edit / delete formula
5. Paint order list
6. Create paint order — from a formula or fully custom

**Business rules**
- Every formula links to a base paint variant — the container being tinted.
- Component records are **informational dosages**; tint materials are not inventory-tracked.
- `size_ml` is the can size (e.g. 1000 / 4000 / 20000).
- **On paint-order completion, the base paint variant's stock is deducted via the stock service** (INV-3).
- Colour-code lookup must support partial and fuzzy matching.
- Formula creation requires `Products.Create`; custom formulas are typically created by Managers.

**Screens** — `/paint` with two tabs: **Formulas** (searchable, detail dialog showing the component list in dispensing order) and **Orders** (list, create dialog).

**Acceptance criteria**
- [ ] Searching a partial colour name returns matches.
- [ ] Searching a partial colour code returns matches.
- [ ] Formula detail lists components in `sort_order`.
- [ ] Completing a paint order deducts exactly one base container from stock.
- [ ] A custom order with no formula is accepted with its notes.

---

### 8.13 Reports ✅ IMPLEMENTED

**Purpose.** Turn transactions into decisions.

#### Sales report — `Reports.Read`

Date-range filtered. Returns: total revenue, sale count, average order value, total items sold, total discount, total tax; breakdown **by status** (status, count, amount); breakdown **by payment method** (method, count, amount); **daily revenue series** (date, revenue, count).

#### Top products report — `Reports.Read`

Date-range filtered, limit configurable. Per row: product name, variant name, category, units sold, revenue. Sorted by units sold descending.

#### Inventory report — `Reports.Read`

Total variant count, low-stock count, out-of-stock count, and a low-stock list (product, variant, category, current stock, min stock).

- Low stock = `balance > 0 AND balance <= min_stock`
- Out of stock = `balance <= 0`

#### Financial report — `Reports.Financial` ONLY

Date-range filtered. Total revenue, total cost, gross profit, gross margin percentage, and a monthly series (label, revenue, cost, profit).

- `cost = Σ(saleItem.quantity × variant.purchasePrice)`
- `grossProfit = revenue − cost`
- `grossMarginPct = grossProfit / revenue × 100` (guard division by zero → 0)

> **This endpoint exposes cost.** It requires the separate `Reports.Financial` permission and must additionally respect ABAC `can_view_cost`. A user with the permission but without the attribute is refused.

**Features**
1. All four reports with a date-range picker
2. ⬜ **PLANNED:** CSV export
3. ⬜ **PLANNED:** PDF export
4. ⬜ **PLANNED:** scheduled email delivery

**Screens** — `/reports` with a tab per report, a shared date-range control, chart plus table per tab. The financial tab is hidden entirely from users lacking the permission.

**Acceptance criteria**
- [ ] Sales report totals reconcile exactly against the sale list for the same range.
- [ ] Voided sales are excluded from revenue.
- [ ] Returns reduce reported revenue.
- [ ] The financial report is refused with 403 for a user lacking `Reports.Financial`.
- [ ] Low-stock counts match the inventory screen's low-stock filter.
- [ ] Zero revenue in a range yields margin 0, not a division error.

---

### 8.14 Dashboard ✅ IMPLEMENTED

**Purpose.** The landing screen: today at a glance, plus trend.

**Contents**

| Element | Detail |
|---|---|
| 4 KPI cards | Gross sales · Average sale · Sale count · Gross profit. Each: label, value, icon, **percent change vs. the previous comparable period**, and today's value. |
| Monthly revenue chart | Month label, revenue, cost — 12-month rolling window |
| Top products list | Name, brand, current stock, units sold, category |
| Unit counters | Total units sold (all time) and today's units sold |

**Business rules**
- Requires `Reports.Read`.
- **Gross profit and cost are suppressed for users without `can_view_cost`** — the card is hidden and the value omitted from the response.
- Percent change guards division by zero.
- All figures are tenant-scoped.

**Acceptance criteria**
- [ ] KPI values match the sales report for the same period.
- [ ] A Cashier without `can_view_cost` sees no gross-profit card and receives no cost figures.
- [ ] A first-day tenant with no sales sees zeros, not errors.

---

### 8.15 Settings & File Uploads ✅ IMPLEMENTED

**Settings**
1. Read tenant settings
2. Upsert tenant settings — creates the row if absent
3. Sections: business identity, currency, tax, receipt

Requires `Settings.Read` / `Settings.Edit`.

**Business rules**
- Exactly one settings row per tenant; reads return defaults when absent.
- `tax_pct` between 0 and 100.
- `currency_code` is a valid ISO 4217 code.
- Changing tax settings affects **only future** documents — existing sales and quotations keep their snapshotted rate.

**File uploads**
1. Multi-file product image upload
2. Content-addressed storage: SHA-256 of the bytes determines the physical filename; identical content uploaded twice yields one physical file
3. Returns document metadata (id, url, filename, content type, size)

**Upload constraints**
- Allowed types: JPEG, PNG, WebP.
- Max file size: 5 MB.
- Max files per request: 10.
- Validate by **magic bytes**, not by file extension or the client-supplied content type.
- Strip EXIF metadata.
- Serve from a path that cannot execute code.

**Screens** — `/settings` with tabs: Business, Currency, Tax, Receipt.

**Acceptance criteria**
- [ ] Saving settings for the first time creates the row.
- [ ] Uploading the same image twice produces one physical file and the same content hash.
- [ ] A file renamed to `.jpg` but containing an executable is rejected.
- [ ] A 6 MB file is rejected.
- [ ] Changing the tax rate does not alter existing sales.

---

### 8.16 Cross-Cutting Concerns

#### Domain events ✅ (contract) · 🟡 (dispatch)

Every state-mutating command produces a domain event (INV-9 corollary). Events accumulate on the entity during the unit of work, are dispatched **after the transaction commits**, and are then cleared.

Minimum event set:

| Module | Events |
|---|---|
| Products | `ProductCreated`, `ProductDeactivated` |
| Inventory | `StockAdded`, `StockDeducted`, `LowStockThresholdReached` |
| Sales | `SaleCompleted`, `SaleVoided`, `SaleReturnProcessed` |
| Purchases | `PurchaseOrderApproved`, `GoodsReceived` |
| Stock take | `StockTakeApproved` |
| Day close | `DayClosed` |
| Paint | `PaintOrderCompleted` |

Modules communicate **only through events**, never by calling into each other's services directly. The sole exception is the stock service, which is deliberately a shared kernel (INV-3).

#### Request pipeline

Every command and query passes through, in order:

1. **Logging** — request name, correlation id, user, tenant
2. **Validation** — declarative rules; failures return 422 with a per-field error list
3. **Plan limits** — reject operations exceeding the tenant's plan
4. **Performance monitoring** — log a warning for any request over 500 ms
5. **Handler**

#### Error handling

A single global handler converts every unhandled failure into the standard error envelope (§9), logs the full detail server-side with a correlation id, and returns **no stack trace, no SQL, and no internal type name** to the client. The correlation id appears in both the log and the response so a user report maps to a log line.

#### Audit logging 🟡 PARTIAL

Build the automatic write path described in §6.10.

#### Real-time notifications ⬜ PLANNED

A push channel (websocket or equivalent) delivering: low-stock alerts when a movement drops a variant below `min_stock`; payment-due reminders; system messages. Plus in-app notification list, unread badge, and mark-as-read.

---

## 9. API Contract Conventions

### 9.1 Base

- Base path: `/api/v1/`
- Auth: `Authorization: Bearer {access_token}`
- Content type: `application/json` (multipart only for uploads)
- Route style: kebab-case, plural nouns — `/api/v1/purchase-orders`
- Property style in JSON: camelCase
- All timestamps: ISO 8601 UTC with `Z`

### 9.2 Response Envelope

**Every** response uses the same shape.

Single item:
```json
{ "success": true, "data": { "id": "…", "name": "…" }, "error": null, "meta": null }
```

Paginated list:
```json
{
  "success": true,
  "data": [ { }, { } ],
  "error": null,
  "meta": { "page": 1, "pageSize": 20, "total": 154, "totalPages": 8 }
}
```

Error:
```json
{
  "success": false,
  "data": null,
  "error": { "code": "PRODUCT_NOT_FOUND", "message": "No product found with the given ID." },
  "meta": null
}
```

Validation error (422):
```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more validation errors occurred.",
    "details": [
      { "field": "name",         "message": "'Name' must not be empty." },
      { "field": "sellingPrice", "message": "'Selling Price' must be greater than 0." }
    ]
  },
  "meta": null
}
```

### 9.3 Status Codes

| Code | Meaning | When |
|---|---|---|
| 200 | OK | GET, PUT, PATCH, and POST actions returning a result |
| 201 | Created | POST creating a resource — include a `Location` header |
| 204 | No Content | DELETE |
| 400 | Bad Request | Malformed JSON, wrong content type |
| 401 | Unauthorized | Missing, invalid, or expired token |
| 403 | Forbidden | Valid token, insufficient permission or role |
| 404 | Not Found | Resource absent — `error.code = "NOT_FOUND"` |
| 409 | Conflict | Uniqueness violation |
| 422 | Unprocessable Entity | Validation failure or business-rule rejection |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unexpected — logged with a correlation id |

### 9.4 Query Parameters

| Concern | Format | Notes |
|---|---|---|
| Pagination | `?page=1&pageSize=20` | Default page 1, size 20. **Max size 100** — clamp, do not error. |
| Sorting | `?sortBy=name&sortDir=asc` | `sortDir` ∈ {asc, desc}, default asc |
| Search | `?search=keyword` | Full-text / trigram across the resource's searchable fields |
| Exact filter | `?categoryId={uuid}` | |
| Boolean filter | `?isActive=true` | |
| Date range | `?from=2026-01-01&to=2026-01-31` | Inclusive both ends |

### 9.5 Error Code Registry

| Code | HTTP | Meaning |
|---|:--:|---|
| `VALIDATION_ERROR` | 422 | Input failed declarative validation |
| `NOT_FOUND` | 404 | Resource absent |
| `UNAUTHORIZED` | 401 | Auth missing or invalid |
| `FORBIDDEN` | 403 | Permission or scope denied |
| `INVALID_CREDENTIALS` | 401 | Login failed |
| `ACCOUNT_LOCKED` | 401 | Too many failed attempts |
| `ACCOUNT_DISABLED` | 401 | User deactivated |
| `TENANT_SUSPENDED` | 403 | Tenant inactive |
| `DUPLICATE_SLUG` | 409 | Tenant slug taken |
| `DUPLICATE_EMAIL` | 409 | Email already registered |
| `DUPLICATE_SKU` | 409 | SKU exists in this tenant |
| `DUPLICATE_BARCODE` | 409 | Barcode exists in this tenant |
| `PLAN_LIMIT_EXCEEDED` | 422 | Plan quota reached |
| `INSUFFICIENT_STOCK` | 422 | Not enough stock — message states the available quantity |
| `DISCOUNT_EXCEEDED` | 422 | Above the user's ABAC discount cap |
| `AMOUNT_EXCEEDED` | 422 | Above the user's ABAC sale-amount cap |
| `INVALID_PAYMENT` | 422 | Unknown payment method |
| `CREDIT_REQUIRES_CUSTOMER` | 422 | Credit sale without a customer |
| `CREDIT_LIMIT_EXCEEDED` | 422 | Would exceed the customer's credit limit |
| `ALREADY_VOIDED` | 422 | Sale already voided |
| `CANNOT_VOID` | 422 | Sale has returns |
| `CANNOT_RETURN` | 422 | Sale is voided or draft |
| `ITEM_NOT_FOUND` | 422 | Line not on this document |
| `INVALID_QTY` | 422 | Quantity outside the permitted range |
| `INVALID_STATUS` | 422 | Operation illegal for the current status |
| `INVALID_LINE` | 422 | Line does not belong to this document |
| `OVER_RECEIVE` | 422 | Receiving more than ordered |
| `DAY_ALREADY_OPEN` | 422 | Day already opened |
| `DAY_ALREADY_CLOSED` | 422 | Day closed; cannot reopen |
| `STOCK_TAKE_IN_PROGRESS` | 422 | A count is already running for this warehouse |
| `CATEGORY_IN_USE` / `BRAND_IN_USE` / `UNIT_IN_USE` | 422 | Referenced by existing records |
| `CATEGORY_LOCKED` | 422 | Product has completed sales |
| `CIRCULAR_REFERENCE` | 422 | Category cycle |
| `WAREHOUSE_NOT_EMPTY` | 422 | Warehouse holds stock |
| `CUSTOMER_HAS_BALANCE` | 422 | Customer owes money |
| `LAST_ADMIN` | 422 | Cannot remove the final admin |

### 9.6 Idempotency ⬜ PLANNED

Sale creation must accept an `Idempotency-Key` header. A repeated key within 24 hours returns the original result instead of creating a duplicate sale. **This matters specifically for offline sync**, where a network failure after the server commits but before the client sees the response would otherwise double-record a sale.

---

## 10. Complete Endpoint Catalog

Legend: 🔓 anonymous · 🔒 authenticated · `[X]` = required permission · `{R}` = required role

### Auth — `/api/v1/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register-tenant` | 🔓 | Create tenant + owner + defaults; returns tokens |
| POST | `/login` | 🔓 | Returns access token; sets refresh cookie |
| POST | `/refresh` | 🔓 (cookie) | Rotates the refresh token; returns a new access token |
| GET | `/me` | 🔒 | Current user profile, roles, permissions, ABAC |
| POST | `/revoke` | 🔒 | Revokes the refresh token; clears the cookie |

### Users — `/api/v1/users`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[Users.Read]` | Paginated list; `search`, `role` |
| GET | `/{id}` | `[Users.Read]` | Detail |
| POST | `/` | `[Users.Create]` | Create |
| PUT | `/{id}` | `[Users.Edit]` | Update |
| DELETE | `/{id}/deactivate` | `[Users.Deactivate]` | Soft deactivate |

### Products — `/api/v1/products`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[Products.Read]` | Paginated; `search`, `categoryId`, `brandId`, `isActive` |
| GET | `/{id}` | `[Products.Read]` | Detail with variants, images, per-warehouse stock |
| POST | `/` | `[Products.Create]` | Create with variants and optional opening stock |
| PUT | `/{id}` | `[Products.Edit]` | Update |
| DELETE | `/{id}` | `[Products.Delete]` | Soft delete |
| POST | `/bulk-import` | `[Products.Create]` | Spreadsheet import |
| GET | `/categories` | `[Products.Read]` | Category options |
| GET | `/brands` | `[Products.Read]` | Brand options |
| GET | `/units` | `[Products.Read]` | Unit options |
| POST | `/units` | `[Products.Create]` | Create unit |
| PUT | `/units/{id}` | `[Products.Edit]` | Update unit |
| DELETE | `/units/{id}` | `[Products.Delete]` | Delete unit |

### Categories — `/api/v1/categories`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[Products.Read]` | All, with hierarchy |
| POST | `/` | `[Products.Create]` | Create |
| PUT | `/{id}` | `[Products.Edit]` | Update |
| POST | `/{id}/toggle-active` | `[Products.Edit]` | Toggle active |
| DELETE | `/{id}` | `[Products.Delete]` | Soft delete |

### Brands — `/api/v1/brands`

Same five operations as categories, gated on the same permissions.

### Inventory — `/api/v1/inventory`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/stock` | `[Inventory.Read]` | Current stock; `warehouseId`, `categoryId`, `search`, `lowStockOnly` |
| GET | `/transactions` | `[Inventory.Read]` | Ledger history; `variantId`, `warehouseId`, `type`, `from`, `to` |
| GET | `/warehouses` | `[Inventory.Read]` | Warehouse list |
| POST | `/adjust` | `[Inventory.Adjust]` | Absolute adjustment with mandatory reason |
| POST | `/transfer` | `[Inventory.Adjust]` | Warehouse-to-warehouse transfer |
| POST | `/warehouses` ⬜ | `[Inventory.Adjust]` | **Build:** create warehouse |
| PUT | `/warehouses/{id}` ⬜ | `[Inventory.Adjust]` | **Build:** update warehouse |
| POST | `/warehouses/{id}/toggle-active` ⬜ | `[Inventory.Adjust]` | **Build:** toggle active |

### POS — `/api/v1/pos`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/products` | `[Sales.Create]` | Sellable products with stock for a warehouse |
| GET | `/customers` | `[Sales.Create]` | Customer lookup for the terminal |
| GET | `/held-carts` | `[Sales.Create]` | Current user's held carts |
| POST | `/sale` | `[Sales.Create]` | **Create a sale** — §8.6 |
| POST | `/hold` | `[Sales.Create]` | Hold the current cart |
| DELETE | `/held-carts/{id}` | `[Sales.Create]` | Restore (and remove) a held cart |

### Sales — `/api/v1/sales`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[Sales.Read]` | Paginated; `from`, `to`, `status`, `customerId`, `search` |
| GET | `/{id}` | `[Sales.Read]` | Detail with items, payments, returns |
| POST | `/{id}/void` | `[Sales.Void]` | Void and restore stock |
| POST | `/{id}/return` | `[Sales.Refund]` | Process a return |

### Quotations — `/api/v1/quotations`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[Quotations.Read]` | Paginated; `status`, `customerId`, `from`, `to`, `search` |
| GET | `/{id}` | `[Quotations.Read]` | Detail with items |
| POST | `/` | `[Quotations.Create]` | Create |
| PUT | `/{id}` | `[Quotations.Edit]` | Update (Draft only) |
| PATCH | `/{id}/status` | `[Quotations.Edit]` | Change status |
| DELETE | `/{id}` | `[Quotations.Delete]` | Soft delete |
| POST | `/{id}/convert-to-sale` ⬜ | `[Sales.Create]` | **Build:** convert to a sale |

### Purchases — `/api/v1/purchases`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[Purchases.Read]` | Paginated; `status`, `supplierId`, `from`, `to` |
| GET | `/{id}` | `[Purchases.Read]` | Detail with lines and receipts |
| GET | `/suppliers` | `[Purchases.Read]` | Supplier options |
| POST | `/` | `[Purchases.Create]` | Create PO (Draft) |
| POST | `/{id}/approve` | `[Purchases.Approve]` | Approve |
| POST | `/{id}/receive` | `[Purchases.Receive]` | Receive goods — full or partial |
| POST | `/{id}/cancel` | `[Purchases.Create]` | Cancel |

### Suppliers — `/api/v1/suppliers`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[Purchases.Read]` | Paginated; `search`, `isActive` |
| GET | `/{id}` | `[Purchases.Read]` | Detail with purchase history |
| POST | `/` | `[Purchases.Create]` | Create |
| PUT | `/{id}` | `[Purchases.Edit]` | Update |
| POST | `/{id}/toggle-active` | `[Purchases.Edit]` | Toggle active |
| POST | `/{id}/payments` ⬜ | `[Purchases.Edit]` | **Build:** record a supplier payment |

### Customers — `/api/v1/customers`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[Customers.Read]` | Paginated; `search`, `isActive` |
| GET | `/{id}` | `[Customers.Read]` | Detail with history and balance |
| POST | `/` | `[Customers.Create]` | Create |
| PUT | `/{id}` | `[Customers.Edit]` | Update |
| POST | `/{id}/toggle-active` | `[Customers.Edit]` | Toggle active |
| POST | `/{id}/payments` ⬜ | `[Customers.Edit]` | **Build:** record a customer payment |
| GET | `/{id}/statement` ⬜ | `[Customers.Read]` | **Build:** statement of account |

### Stock takes — `/api/v1/stock-takes` 🟡 BUILD ALL OF THESE

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[StockTake.Read]` | Paginated; `warehouseId`, `status` |
| GET | `/{id}` | `[StockTake.Read]` | Detail with lines |
| POST | `/` | `[StockTake.Create]` | Create and generate the sheet |
| PATCH | `/{id}/items/{itemId}` | `[StockTake.Count]` | Enter a count |
| POST | `/{id}/submit` | `[StockTake.Count]` | Submit for approval |
| POST | `/{id}/approve` | `[StockTake.Approve]` | **Post variances to the ledger** |
| POST | `/{id}/cancel` | `[StockTake.Create]` | Cancel without posting |
| GET | `/{id}/export` | `[StockTake.Read]` | Export the count sheet |

### Day close — `/api/v1/day-close`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[DayClose.Read]` | Paginated history; `from`, `to` |
| GET | `/preview` | `[DayClose.Read]` | Live (or frozen) figures for `date` |
| GET | `/{id}` | `[DayClose.Read]` | Detail with expenses |
| POST | `/open` | `[DayClose.Manage]` | Open a day with a float |
| POST | `/{id}/close` | `[DayClose.Manage]` | Close with counted cash |

### Expenses — `/api/v1/expenses`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[Expenses.Read]` | Paginated; `from`, `to`, `category` |
| GET | `/categories` | `[Expenses.Read]` | Distinct categories for autocomplete |
| POST | `/` | `[Expenses.Create]` | Create |
| PUT | `/{id}` | `[Expenses.Edit]` | Update |
| DELETE | `/{id}` | `[Expenses.Delete]` | Soft delete |

### Paint — `/api/v1/paint`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/formulas` | `[Products.Read]` | Search by colour code or name (partial) |
| GET | `/formulas/{id}` | `[Products.Read]` | Detail with components |
| POST | `/formulas` | `[Products.Create]` | Create |
| PUT | `/formulas/{id}` | `[Products.Edit]` | Update |
| DELETE | `/formulas/{id}` | `[Products.Delete]` | Delete |
| GET | `/orders` | `[Products.Read]` | Paint order list |
| POST | `/orders` | `[Products.Create]` | Create order; deducts base paint stock |

### Reports — `/api/v1/reports`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/sales` | `[Reports.Read]` | Sales report; `from`, `to` |
| GET | `/top-products` | `[Reports.Read]` | Top products; `from`, `to`, `limit` |
| GET | `/inventory` | `[Reports.Read]` | Stock health |
| GET | `/financial` | `[Reports.Financial]` | Revenue, cost, profit, margin |

### Dashboard — `/api/v1/dashboard`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[Reports.Read]` | KPIs, monthly series, top products |

### Settings — `/api/v1/settings`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | `[Settings.Read]` | Tenant settings |
| PUT | `/` | `[Settings.Edit]` | Upsert |

### Uploads — `/api/v1/uploads`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/products` | `[Products.Create]` | Multipart image upload; returns document metadata |

### Platform admin — `/api/v1/admin` · `{SuperAdmin}` on every route

| Method | Path | Description |
|---|---|---|
| GET | `/stats` | Platform statistics |
| GET | `/tenants` | All tenants |
| GET | `/tenants/{id}/users` | A tenant's users |
| POST | `/tenants` | Create a tenant |
| POST | `/tenants/{id}/suspend` | Suspend |
| POST | `/tenants/{id}/activate` | Activate |
| POST | `/tenants/{id}/plan` | Change plan |
| POST | `/tenants/{id}/subscription` | Create a subscription |
| POST | `/tenants/{id}/impersonate` | Issue an impersonation token |

### System

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | 🔓 | Liveness + database connectivity |
| GET | `/openapi` or `/scalar` | 🔓 (non-prod) | Interactive API documentation |

---

## 11. User Interface Specification

### 11.1 Application Shell

```
┌──────────────────────────────────────────────────────────────────┐
│  TOPBAR   [logo] [global search]      [🌐 lang] [🌓] [🔔] [avatar]│
├────────────┬─────────────────────────────────────────────────────┤
│            │                                                     │
│  SIDEBAR   │                 ROUTED CONTENT                      │
│  260px     │                 max-width container                 │
│            │                 32px padding                        │
│  Dashboard │                                                     │
│  POS       │                                                     │
│  Products ▾│                                                     │
│  Inventory │                                                     │
│  Sales     │                                                     │
│  Quotations│                                                     │
│  Purchases │                                                     │
│  Customers │                                                     │
│  Suppliers │                                                     │
│  Paint     │                                                     │
│  Reports   │                                                     │
│  Users     │                                                     │
│  Settings  │                                                     │
└────────────┴─────────────────────────────────────────────────────┘
```

- Sidebar items are **filtered by the current user's permissions** — a Cashier never sees Users or Reports.
- Sidebar collapses to icons below 1280 px, becomes an overlay drawer below 768 px.
- In RTL the sidebar moves to the right and the entire layout mirrors.
- The POS screen uses a **full-bleed variant** with no sidebar — maximum screen area for the terminal.

### 11.2 Complete Screen Inventory

| # | Screen | Route | Guard | Status |
|---|---|---|---|---|
| 1 | Login | `/login` | anonymous | ✅ |
| 2 | Register | `/register` | anonymous | ✅ |
| 3 | Dashboard | `/dashboard` | authenticated | ✅ |
| 4 | POS terminal | `/pos` | `Sales.Create` | ✅ |
| 5 | Product list | `/products` | `Products.Read` | ✅ |
| 6 | Product detail | `/products/:id` | `Products.Read` | ✅ |
| 7 | Add / edit product | `/products/new`, `/products/:id/edit` | `Products.Create` / `.Edit` | ✅ |
| 8 | Bulk import | `/products/import` | `Products.Create` | ✅ |
| 9 | Categories | `/products/categories` | `Products.Read` | ✅ |
| 10 | Brands | `/products/brands` | `Products.Read` | ✅ |
| 11 | Units | `/products/units` | `Products.Read` | ✅ |
| 12 | Inventory | `/inventory` | `Inventory.Read` | ✅ |
| 13 | Sales list | `/sales` | `Sales.Read` | ✅ |
| 14 | Quotation list | `/quotations` | `Quotations.Read` | ✅ |
| 15 | Add / edit quotation | `/quotations/new`, `/quotations/:id/edit` | `Quotations.Create` / `.Edit` | ✅ |
| 16 | Quotation detail | `/quotations/:id` | `Quotations.Read` | ✅ |
| 17 | Purchases | `/purchases` | `Purchases.Read` | ✅ |
| 18 | Add purchase | `/purchases/new` | `Purchases.Create` | ✅ |
| 19 | Customers | `/customers` | `Customers.Read` | ✅ |
| 20 | Add / edit customer | `/customers/new`, `/customers/:id/edit` | `Customers.Create` / `.Edit` | ✅ |
| 21 | Suppliers | `/suppliers` | `Purchases.Read` | ✅ |
| 22 | Add / edit supplier | `/suppliers/new`, `/suppliers/:id/edit` | `Purchases.Create` | ✅ |
| 23 | Paint | `/paint` | `Products.Read` | ✅ |
| 24 | Reports | `/reports` | `Reports.Read` | ✅ |
| 25 | Users | `/users` | role Admin | ✅ |
| 26 | Settings | `/settings` | `Settings.Read` | ✅ |
| 27 | Platform console | `/admin` | role SuperAdmin | ✅ |
| 28 | Add company | `/admin/companies/new` | role SuperAdmin | ✅ |
| 29 | Plans | `/admin/plans` | role SuperAdmin | ✅ |
| 30 | **Day close** | `/day-close` | `DayClose.Read` | 🟡 **BUILD** |
| 31 | **Day close detail** | `/day-close/:id` | `DayClose.Read` | 🟡 **BUILD** |
| 32 | **Expenses** | `/expenses` | `Expenses.Read` | 🟡 **BUILD** |
| 33 | **Stock takes** | `/stock-takes` | `StockTake.Read` | 🟡 **BUILD** |
| 34 | **New stock take** | `/stock-takes/new` | `StockTake.Create` | 🟡 **BUILD** |
| 35 | **Stock take detail** | `/stock-takes/:id` | `StockTake.Read` | 🟡 **BUILD** |
| 36 | **Warehouses** | `/inventory/warehouses` | `Inventory.Read` | 🟡 **BUILD** |
| 37 | Notifications | `/notifications` | authenticated | ⬜ PLANNED |
| 38 | Audit log | `/audit` | role Admin | ⬜ PLANNED |
| 39 | Profile / change password | `/profile` | authenticated | ⬜ PLANNED |
| 40 | Forgot / reset password | `/forgot-password`, `/reset-password` | anonymous | ⬜ PLANNED |

### 11.3 Design System

Light mode is the default; dark mode is a first-class peer, not an afterthought.

**Aesthetic:** modern corporate, soft minimalism. Light mode reads as a clean professional tool; dark mode ("Obsidian Core") uses **tonal layering instead of shadows**.

#### Light palette

| Token | Hex | Usage |
|---|---|---|
| `--surface` / `--background` | `#f9f9fe` | Page canvas |
| `--surface-container-lowest` | `#ffffff` | Cards |
| `--surface-container-low` | `#f3f3f8` | Inputs, search bars |
| `--surface-container` | `#ededf2` | Subtle containers |
| `--surface-container-high` | `#e8e8ed` | Table headers, dividers |
| `--surface-container-highest` | `#e2e2e7` | Borders |
| `--on-surface` | `#1a1c1f` | Primary text |
| `--on-surface-variant` | `#484554` | Secondary text |
| `--outline` | `#797585` | Borders, icons |
| `--outline-variant` | `#c9c4d6` | Subtle borders, muted text |
| `--primary` | `#4b2ab8` | Brand, primary actions |
| `--on-primary` | `#ffffff` | Text on primary |
| `--primary-container` | `#6347d1` | Contained primary, chart series 1 |
| `--primary-fixed` | `#e6deff` | Active nav background |
| `--on-primary-fixed-variant` | `#4927b6` | Active nav text |
| `--secondary` | `#006972` | Positive trend, chart series 2 |
| `--secondary-container` | `#8ff2ff` | Secondary highlight |
| `--error` | `#ba1a1a` | Destructive, errors |
| `--error-container` | `#ffdad6` | Error background |

#### Dark palette

| Token | Hex |
|---|---|
| `--surface` / `--background` | `#131316` |
| `--surface-container-lowest` | `#0e0e11` |
| `--surface-container-low` | `#1b1b1e` |
| `--surface-container` | `#1f1f22` |
| `--surface-container-high` | `#2a2a2d` |
| `--surface-container-highest` | `#353438` |
| `--on-surface` | `#e4e1e6` |
| `--on-surface-variant` | `#c9c4d6` |
| `--outline` | `#938e9f` |
| `--outline-variant` | `#484554` |
| `--primary` | `#cabeff` |
| `--on-primary` | `#32009a` |
| `--primary-container` | `#6347d1` |
| `--secondary` | `#a6e6ff` |
| `--error` | `#ffb4ab` |

Dark mode activates via a class or data attribute on the document root, toggled by the user and persisted.

#### Typography

Primary family: a geometric humanist sans (reference uses Plus Jakarta Sans). Arabic switches to **Cairo**.

| Style | Size | Weight | Line height | Tracking |
|---|---|---|---|---|
| display-lg | 32 | 700 | 40 | −0.02em |
| headline-md | 24 | 600 | 32 | −0.01em |
| headline-sm | 20 | 600 | 28 | — |
| body-lg | 16 | 400 | 24 | — |
| body-md | 14 | 400 | 20 | — |
| label-bold | 12 | 600 | 16 | 0.05em |
| label-sm | 12 | 500 | 16 | — |
| data-tabular | 18 | 700 | 24 | — (tabular figures) |

**All monetary and quantity figures use tabular/lining numerals** so columns align.

#### Spacing & radius

| Token | Value |
|---|---|
| spacing base | 8px |
| sidebar width | 260px |
| container padding | 32px |
| gutter / card gap | 24px |
| stack sm / md / lg | 4 / 12 / 24px |
| radius-sm | 4px (badges) |
| radius | 8px (buttons, inputs) |
| radius-md | 12px (cards) |
| radius-lg | 16px (large containers) |
| radius-xl | 24px (sections) |
| radius-full | 9999px (pills, search) |

#### Component patterns

| Component | Specification |
|---|---|
| **Primary button** | primary background, on-primary text, 8px radius |
| **Ghost button** | 1px outline-variant border, primary text, transparent |
| **Danger button** | error background, on-error text |
| **KPI card** | lowest-surface background, shadow `0 4px 15px rgba(28,0,98,0.04)`, icon chip on `--primary-fixed`, value at 32px/700, trend up in `--secondary`, trend down in `--error` |
| **Sidebar nav** | active = `--primary-fixed` background + `--on-primary-fixed-variant` text + 600 weight; hover = `--surface-container-high`; 20px icons, 14px labels |
| **Data table** | flat, no vertical borders; row height ≥ 56px; 1px `--surface-container-high` dividers; header 12px uppercase `--outline`; row hover `--surface-container-low` |
| **Search bar** | `--surface-container-low` background, full pill radius, persistent leading icon |
| **Input** | `--surface-container-low` background, 1px `--outline-variant` border; focus = primary border + `0 0 0 2px rgba(75,42,184,0.15)` ring |
| **Status chip** | pill; success `rgba(0,105,114,0.12)` on `--secondary`; error `--error-container`; warning `rgba(255,179,0,0.12)` on `#8a5700` |
| **Charts** | series 1 `--primary-container`, series 2 `--secondary`; grid `#e5e5e5` light / `rgba(255,255,255,0.1)` dark |
| **Modal** | backdrop blur 8px; light = elevated surface + shadow; dark = level-2 surface + 1px `#353438` border |

#### Elevation

- **Light:** cards float on shadow.
- **Dark:** **no box shadows.** Depth comes purely from tonal surface steps — level 0 `#0e0e11`, level 1 `#1b1b1e`, level 2 `#1f1f22` with a 1px border.

### 11.4 Frontend Architecture Requirements

Framework-agnostic, but these properties are required:

1. **Reactive state primitives** — a signal/observable model. **Component state must live in the state primitives, never in plain mutable component fields.** Derived values are computed, not manually recalculated.
2. **Lazy loading per feature** — each route loads its own bundle.
3. **A shared auth store** exposing user, roles, permission set, and each ABAC attribute reactively.
4. **HTTP interceptors**, in this order:
   - **Auth** — attach the bearer token; on 401, refresh once and retry; queue concurrent 401s behind the single refresh.
   - **Offline** — serve from cache or enqueue when offline (§13).
   - **Error** — map the error envelope to localized toasts.
5. **Route guards** — auth, permission, role.
6. **A permission directive/wrapper** for conditional rendering.
7. **Reactive forms with declarative validation** — no template-driven two-way binding for business forms.
8. **Skeleton loaders** for every list and detail view — never a bare spinner over a blank page.
9. **Optimistic UI** where safe (toggles, reorders); never for stock-affecting operations.

### 11.5 Accessibility

- Every interactive element reachable by keyboard, in a sensible tab order.
- Visible focus indicators — never `outline: none` without a replacement.
- Text contrast ≥ 4.5:1 (WCAG AA) in **both** themes.
- Form inputs have associated labels; errors are programmatically linked to their field.
- Dialogs trap focus and restore it on close.
- Toasts announce via a live region.
- Data tables use proper header semantics and scope.
- **The POS terminal is fully operable by keyboard** — a cashier must not need a mouse.

### 11.6 Responsive Behaviour

| Breakpoint | Behaviour |
|---|---|
| ≥ 1280px | Full sidebar; multi-column forms; POS shows products and cart side by side |
| 768–1279px | Icon-only sidebar; two-column forms; POS remains split |
| < 768px | Drawer sidebar; single-column forms; **POS toggles between a products view and a cart view**; tables become card lists |

---

## 12. Internationalization & RTL ✅ IMPLEMENTED

### 12.1 Requirements

- **Runtime** language switching — no page reload, no separate build per locale.
- Languages: **English (LTR)** and **Arabic (RTL)**, extensible.
- Arabic requires **full layout mirroring**, not just translated strings.

### 12.2 Translation Files

Flat dot-notation keys grouped by feature — searchable, greppable, no deep nesting.

```json
{
  "nav.dashboard":      "Dashboard",
  "nav.pos":            "POS Terminal",
  "common.save":        "Save",
  "common.cancel":      "Cancel",
  "products.count":     "{{ filtered }} of {{ total }} products",
  "errors.INVALID_CREDENTIALS": "Invalid email or password."
}
```

Rules:
- One file per language, loaded on demand.
- **Every API error code has a translation key** under `errors.*` — the client displays the localized message, never the raw server string.
- Interpolation placeholders use a delimiter that does not clash with your template engine's own syntax.
- A missing key falls back to English, and logs a warning in development.

### 12.3 Locale Service

A singleton exposing:
- `language` — reactive current language
- `direction` — computed `ltr` | `rtl`
- `isRtl` — computed boolean
- `setLanguage(lang)`
- `formatCurrency(amount, currency)` — locale-aware, using the platform's Intl facilities
- `formatDate(date)` — locale-aware

On language change it must:
1. Set `lang` and `dir` on the document root element.
2. Swap the font family — **Cairo** for Arabic, the Latin family otherwise.
3. Load the translation bundle.
4. Persist the choice to local storage.

### 12.4 RTL Layout Rules

- **Use CSS logical properties everywhere** — `margin-inline-start` not `margin-left`, `padding-inline-end` not `padding-right`, `inset-inline-start` not `left`. This makes most mirroring automatic.
- Where a utility framework is used, pair each directional utility with its RTL counterpart.
- **Do not mirror:** icons that depend on real-world direction (play, media controls), logos, phone numbers, or numerals.
- **Do mirror:** sidebar position, chevrons and arrows, progress direction, table column order, drawer entry side.
- Charts flip their axis order in RTL.
- Numbers remain Western Arabic numerals unless the business explicitly wants Eastern Arabic.

### 12.5 Currency & Dates

- Currency symbol and code come from **tenant settings**, not from the locale — a Saudi business may price in USD.
- Number and date *formatting* follow the locale; the *currency* follows settings.
- All dates are stored as UTC and rendered in the business timezone.

---

## 13. Offline Mode ✅ IMPLEMENTED

**The POS terminal must sell without internet.** This is a hard requirement, not a nicety: a shop counter with a flaky connection cannot stop taking money.

### 13.1 Local Store Schema

A browser-side indexed key-value store with these collections:

| Store | Key | Contents |
|---|---|---|
| `products` | composite (warehouseId, variantId) | Cached sellable products, indexed by warehouse |
| `customers` | id | Cached customer list |
| `warehouses` | id | Cached warehouse list |
| `settings` | fixed key | Cached tenant settings |
| `heldCarts` | localId | Locally held carts, with a `synced` flag |
| `pendingSales` | localId | Queued sales awaiting sync, with attempt count and last error |
| `tokens` | fixed key | Access token + expiry, so a page refresh while offline does not log the cashier out |

> The `synced` flag is stored as `0`/`1`, not as a boolean — most indexed browser stores cannot index booleans.

### 13.2 Connectivity Detection

A reactive service exposing `isOnline` / `isOffline`, seeded from the browser's online state and updated from online/offline events. Every component reads it reactively; the UI shows a persistent offline banner and the count of queued sales.

### 13.3 Offline Interceptor Behaviour

When **online**, pass every request through untouched and opportunistically refresh the cache from successful responses.

When **offline**:

| Request | Behaviour |
|---|---|
| `GET /pos/products` | Serve cached products for the requested warehouse |
| `GET /pos/customers` | Serve cached customers |
| `GET /pos/held-carts` | Serve local held carts, shaped exactly like the server response |
| `GET /settings` | Serve cached settings; if none cached, fail with a clear "offline, no cached settings" error |
| `POST /pos/sale` | **Enqueue.** Generate a temporary invoice number `OFF-{base36 timestamp}`. Return a success response flagged `offline: true` so the UI prints a receipt marked as offline. |
| `POST /pos/hold` | Save the cart locally, return the local id |
| `DELETE /pos/held-carts/:id` | Remove the local cart and return its data for restoration |
| Anything else | Fail immediately with a clear offline error — do not hang |

### 13.4 Sync On Reconnect

When connectivity returns, automatically:

1. Read every queued sale in creation order.
2. Skip any sale that has already failed **5 times** — surface it for manual resolution rather than retrying forever.
3. POST each one to the real endpoint.
4. On success, remove it from the queue.
5. On failure, increment its attempt count and store the error message.
6. Refresh the pending count, which is displayed in the UI.

**Order matters:** replay in creation order so stock deductions apply in the sequence they happened.

### 13.5 Known Trade-offs — document these for the operator

- **Stock is not validated offline.** A sale may be queued that the server later rejects for insufficient stock. The reference behaviour surfaces the failure on sync for manual resolution. An acceptable alternative is to accept the sale and post a compensating adjustment. **Choose one and document it.**
- **Offline invoice numbers are temporary.** The server assigns the authoritative number on sync. The offline receipt must be visibly marked as provisional.
- **ABAC caps are enforced client-side only while offline**, then re-enforced on sync. A sale that violates a cap will be rejected at sync time.
- **Idempotency is essential** (§9.6). Without it, a sync that succeeds server-side but fails to return a response will double-record on retry.

### 13.6 Progressive Web App ⬜ PLANNED

Add a service worker, an app manifest, an install prompt, and offline shell caching so the terminal launches with no network at all.

---

## 14. Non-Functional Requirements

### 14.1 Performance

| Operation | Target |
|---|---|
| POS product search keystroke → rendered results | < 100 ms (client-side over cached data) |
| Sale completion, end to end | < 500 ms |
| Any list endpoint, page of 20 | < 300 ms p95 |
| Dashboard load | < 1 s |
| Report generation, 1-year range | < 3 s |
| Initial app bundle | < 500 KB gzipped |
| Time to interactive, cold | < 2 s on broadband |

**Required indexes:**

```
inventory_transactions  (tenant_id, variant_id, warehouse_id)   -- balance hot path
inventory_transactions  (tenant_id, created_at)                 -- history
sales                   (tenant_id, created_at)
sales                   (tenant_id, invoice_no)          UNIQUE
sales                   (tenant_id, customer_id)
sale_items              (sale_id)
products                (tenant_id, sku)                 UNIQUE
product_variants        (tenant_id, barcode)             UNIQUE WHERE barcode IS NOT NULL
daily_closings          (tenant_id, closing_date)        UNIQUE
+ every table:          (tenant_id)
+ full-text / trigram:  products(name), products(sku), product_variants(barcode)
```

Anything over **500 ms** is logged as a performance warning by the pipeline.

### 14.2 Scalability

- Stateless API — horizontally scalable behind a load balancer. No in-process session state.
- Read replicas may serve reports and dashboards.
- The stock-balance cache absorbs the read load that would otherwise aggregate the ledger.
- Target: **500 tenants, 50 concurrent terminals, 100 000 ledger rows per tenant per year**, without architectural change.

### 14.3 Security

**Mandatory:**

- [ ] Passwords hashed with a memory-hard or iterated algorithm and a per-user salt.
- [ ] Access token 15 min, in memory only.
- [ ] Refresh token 7 days, HTTP-only + Secure + SameSite cookie, single-use rotation.
- [ ] HTTPS enforced; HSTS enabled.
- [ ] CORS restricted to known origins; no wildcard with credentials.
- [ ] Security headers: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`.
- [ ] Rate limiting: 5 login attempts per minute per IP; 100 requests per minute per authenticated user.
- [ ] All queries parameterized — never string-concatenated SQL.
- [ ] Output encoded; no raw HTML injection from user data.
- [ ] Uploads validated by magic bytes, size-capped, EXIF-stripped, served from a non-executable path.
- [ ] Tenant isolation enforced at the data-access layer **and** at the database layer (row-level security).
- [ ] Secrets from environment or a secret manager — never committed, never in config files in source control.
- [ ] Error responses reveal no stack traces, SQL, or internal type names.
- [ ] Dependencies scanned for known vulnerabilities in CI.
- [ ] Audit log covering all financial and administrative mutations.
- [ ] Impersonation logged and visibly banner-flagged.

**Tenant isolation test (must pass):** authenticate as tenant A, request every resource id belonging to tenant B, and confirm every single one returns 404 — not 403, which would confirm existence.

### 14.4 Reliability

- Every multi-write operation is transactional. Sale creation, goods receipt, stock transfer, and stock-take approval are all atomic or they are broken.
- Health endpoint checks database connectivity, not just process liveness.
- Structured logging with a correlation id per request.
- Graceful degradation: report failures must not take down the POS.
- **Backups:** daily full, hourly incremental, 30-day retention, **and a tested restore procedure** — an untested backup is a hypothesis.

### 14.5 Data Integrity

- Foreign keys enforced at the database level, not merely in application code.
- Unique constraints enforced at the database level.
- Check constraints: quantities positive where required, prices non-negative, percentages between 0 and 100.
- Monetary values `decimal(18,4)` — **never floating point**.
- All rounding to 4 decimal places, applied consistently, using a documented rounding mode.
- The ledger's immutability is enforced by the persistence layer and, where available, by a database trigger.

### 14.6 Observability

Log at minimum: every request (method, path, status, duration, user, tenant, correlation id); every authentication event; every authorization denial; every stock mutation; every slow request; every unhandled exception with full context.

Metrics: request rate and latency by endpoint, error rate by code, sales per minute, queue depth for offline sync, database connection pool utilization.

### 14.7 Deployment

- Containerized, multi-stage builds, non-root runtime user.
- Configuration entirely through environment variables.
- Database migrations version-controlled and applied on deploy.
- Zero-downtime deploys: migrations must be backward-compatible with the previous application version for one release cycle.
- CI pipeline: build → unit tests → integration tests → security scan → deploy.
- Separate development, staging, and production environments.

### 14.8 Testing

| Level | Coverage requirement |
|---|---|
| **Unit** | Every command and query handler. **100% of the algorithms in §8.5, §8.6, §8.8, §8.10, §8.11.** |
| **Integration** | Every endpoint, against a real database, including permission and tenant-isolation matrices |
| **End-to-end** | The full flows in §1.4 |
| **Concurrency** | Simultaneous sales of the last unit; simultaneous receipts against one PO |
| **Tenant isolation** | The cross-tenant probe in §14.3 |

---

## 15. Seed Data

### 15.1 Platform

One SuperAdmin account, credentials supplied by environment variables. **Never hard-code them, and force a password change on first login.**

### 15.2 Per Tenant, On Registration

Created automatically (§4.3):

| Entity | Values |
|---|---|
| Warehouse | name `Main Warehouse`, location `Default`, `is_default = true` |
| Unit | name `Piece`, abbreviation `pc` |
| Owner user | supplied email/name, role `Admin`, Admin ABAC defaults |
| Settings | created lazily on first save, or seeded with currency `USD`, symbol `$`, tax disabled |

### 15.3 Optional Demo Data

A separate, explicitly-invoked seeder for demonstration tenants only. **Never runs automatically in production.**

Suggested content: 5 categories with SKU prefixes, 10 brands, 6 units (Piece/Meter/Kilogram/Liter/Box/Set), ~50 products with variants and opening stock, 2 warehouses, 10 customers, 5 suppliers, 20 paint formulas, 30 days of historical sales.

---

## 16. Recommended Build Order

Each phase depends on those before it. Do not start a phase until its predecessor's definition of done passes.

### Phase 1 — Foundation
1. Project structure with strict layer boundaries (INV-9)
2. Base entity contract, result type, paged-list type
3. Command/query dispatch with the validation, logging, and performance pipeline
4. Database access, repository abstraction, unit of work
5. Global filters: soft delete + tenant isolation (INV-5, INV-6)
6. Global error handling and the response envelope (§9.2)
7. Health endpoint and API documentation

**DoD:** the app starts, connects to the database, `/health` reports healthy, an error returns the standard envelope.

### Phase 2 — Identity & Tenancy
8. User store, roles, claims
9. Token issue, refresh rotation, revocation (INV-8)
10. Permission and role authorization gates
11. ABAC attributes in the token and a current-user accessor
12. Tenant entity, self-registration, per-tenant seeding
13. Plan definitions and the limit-enforcement pipeline stage

**DoD:** register a tenant, log in, receive a token carrying permissions and ABAC claims, refresh once, and confirm the old refresh token is dead.

### Phase 3 — Frontend Foundation
14. App shell, sidebar, topbar, routing
15. Auth store, interceptors, guards, permission directive
16. Design tokens, both themes, theme toggle
17. Login and registration screens
18. i18n with English and Arabic, RTL layout

**DoD:** log in, see a permission-filtered sidebar, toggle theme and language, and have Arabic mirror the layout.

### Phase 4 — Catalog
19. Category, brand, unit entities and CRUD
20. Product and variant entities and CRUD
21. Product list, detail, and forms
22. Image upload with content addressing
23. Bulk import

**DoD:** create a product with variants and images; bulk-import a spreadsheet with a mix of valid and invalid rows and get a correct report.

### Phase 5 — Inventory ← the keystone
24. Warehouse entity and full CRUD
25. Ledger entity with **immutability enforced at the persistence layer** (INV-2)
26. **The single stock service** (INV-3)
27. Stock balance cache (INV-4)
28. Stock and transaction screens
29. Adjustment and transfer

**DoD:** every invariant test in §8.4 passes. **Do not proceed until it does — everything after this depends on the ledger being correct.**

### Phase 6 — POS Terminal
30. Sale, item, and payment entities
31. Sale creation with the full algorithm in §8.6, including ABAC and stock pre-validation
32. Tax computation from settings
33. Held carts
34. POS UI: search, cart, payment, receipt
35. Receipt rendering in both formats

**DoD:** every acceptance criterion in §8.6 passes, including the concurrency test on the last unit in stock.

### Phase 7 — Purchases
36. Supplier entity and CRUD
37. Purchase order, lines, receipts
38. Approve, receive (partial and full), cancel
39. Purchase screens

**DoD:** every acceptance criterion in §8.8 passes.

### Phase 8 — Customers, Returns, Quotations, Paint
40. Customer CRUD; credit limit enforcement; payments
41. Sale void and returns
42. Quotations
43. Paint formulas and orders

**DoD:** §8.5, §8.7, §8.9, §8.12 pass.

### Phase 9 — Operations
44. Day close: open, preview, close
45. Expenses
46. Stock takes: create, count, approve, cancel
47. All the UI listed as 🟡 in §11.2

**DoD:** §8.10 and §8.11 pass, **including the delta-not-absolute variance test**.

### Phase 10 — Insight
48. Dashboard
49. All four reports
50. Export

**DoD:** report totals reconcile against transaction lists.

### Phase 11 — Offline
51. Local store and connectivity service
52. Offline interceptor
53. Sync queue with retry and backoff
54. Idempotency keys on sale creation
55. Progressive web app packaging

**DoD:** disconnect, complete 5 sales, reconnect, and confirm all 5 sync exactly once.

### Phase 12 — Platform & Production
56. Platform console
57. Impersonation with audit and banner
58. Audit log write path and viewer
59. Notifications
60. Security hardening pass against §14.3
61. Containerization, CI/CD, monitoring, backups

**DoD:** the §17 checklist passes end to end.

---

## 17. Global Acceptance Checklist

### Architectural invariants
- [ ] No quantity field exists on any product or variant entity, anywhere.
- [ ] Ledger UPDATE and DELETE are rejected by the persistence layer.
- [ ] Every stock change in the entire codebase routes through the single stock service.
- [ ] Stock balance equals `SUM(ledger.quantity)` for every pair, verified against a materialized cache if one is used.
- [ ] Tenant isolation is applied globally by default, not per query.
- [ ] Business records are soft-deleted, never hard-deleted.
- [ ] Completed sales, closed days, and completed stock takes are immutable.
- [ ] Refresh tokens are single-use.
- [ ] Controllers contain no business logic.

### Security
- [ ] Cross-tenant probe: authenticated as tenant A, every tenant-B resource id returns 404.
- [ ] Access token absent from local and session storage.
- [ ] Refresh cookie is HTTP-only, Secure, SameSite.
- [ ] Every endpoint enforces its permission; a matrix test covers all four roles against all endpoints.
- [ ] ABAC limits are enforced server-side even when the client sends values that bypass the UI.
- [ ] `can_view_cost = false` strips cost from every response, on every endpoint.
- [ ] Rate limits active on login and on general API traffic.
- [ ] Uploads validated by magic bytes and size-capped.
- [ ] No secret is present in source control.

### Correctness
- [ ] Concurrent sales of the last unit: one succeeds, one is rejected, the balance never goes negative.
- [ ] Concurrent receipts against one PO never exceed the ordered quantity.
- [ ] Stock-take approval posts deltas, and remains correct when stock moves between counting and approval.
- [ ] Uncounted stock-take lines post nothing.
- [ ] Return refunds are proportional to the discounted line price.
- [ ] A voided sale restores exactly the sold quantity.
- [ ] Closed-day totals do not change when a sale from that day is later voided.
- [ ] Every monetary calculation uses decimal arithmetic and rounds consistently to 4 places.
- [ ] Transfers write exactly two rows or zero rows — never one.

### Functionality
- [ ] Every screen in §11.2 exists and is reachable, including all 🟡 entries.
- [ ] Every endpoint in §10 exists and returns the standard envelope, including all ⬜ entries.
- [ ] Offline: 5 sales completed while disconnected sync exactly once each on reconnect.
- [ ] The full journey list in §1.4 completes without a defect.

### Quality
- [ ] Performance targets in §14.1 met at p95.
- [ ] Both themes meet WCAG AA contrast.
- [ ] The POS terminal is fully keyboard-operable.
- [ ] Arabic mirrors the layout completely, with no clipped or overlapping elements.
- [ ] Every user-facing string is translated in both languages, including every error code.
- [ ] Test coverage requirements in §14.8 met.

---

## 18. Appendix — Reference Implementation

**Informational only.** Nothing in this section is normative; it exists so you can compare decisions if useful. Build with whatever stack you prefer.

The reference system is called **Inventra**.

| Concern | Reference choice |
|---|---|
| Backend runtime | .NET 10 / ASP.NET Core 10 |
| Architecture | Clean Architecture, modular monolith — Domain ← Application ← Infrastructure ← API |
| ORM | EF Core 10 |
| Database | PostgreSQL 18 |
| Dispatch | MediatR 12 (commands/queries + pipeline behaviors) |
| Validation | FluentValidation 12 |
| Mapping | Mapster 7 |
| Auth | ASP.NET Identity + JWT |
| Logging | Serilog → console + rolling file |
| API docs | OpenAPI via Scalar |
| Frontend | Angular 21, standalone components only |
| UI kit | PrimeNG 21 |
| State | NgRx SignalStore + Angular signals |
| Offline | IndexedDB |
| i18n | ngx-translate, runtime switching |
| Containers | Docker Compose |

**Repository layout**

```
apps/pos-backend/src/
  Inventra.Domain/          entities, enums, interfaces — zero outward dependencies
  Inventra.Application/     commands, queries, DTOs, validators, pipeline behaviors
  Inventra.Infrastructure/  EF Core, identity, JWT, repositories, stock service
  Inventra.API/             controllers, middleware, composition root
apps/pos-frontend/src/app/
  core/                     auth, interceptors, guards, locale, models
  layout/                   shell, sidebar, topbar
  features/                 one folder per module
  offline/                  connectivity, local store, sync, interceptor
  shared/                   reusable components, directives
```

**Naming conventions in the reference system**

- Database tables: snake_case plural — `inventory_transactions`, `sale_items`
- API routes: kebab-case plural nouns — `/api/v1/purchase-orders`
- Backend classes: PascalCase; namespaces `Inventra.<Layer>.<Module>`
- Frontend files: kebab-case; classes PascalCase; reactive state camelCase

**Divergences between the reference implementation and this specification** — where they differ, **this specification is authoritative**:

| Area | Reference behaviour | This specification requires |
|---|---|---|
| Credit sales | A sale with an outstanding balance is accepted without a customer, and the customer balance is not updated | Require a customer, enforce the credit limit, update the balance (§8.6 steps 10–11, 16) |
| Sale atomicity | Stock deduction saves independently before the final commit | Wrap sale header, lines, payments, and every ledger row in one transaction |
| Plan limits | The pipeline stage exists; the user-count check is stubbed | Enforce user and warehouse counts fully (§4.4) |
| Stock take | Entities, DTOs, repository contract, and the variance-posting operation exist; commands, endpoints, and UI do not | Build the module completely (§8.10) |
| Day close / expenses | Backend complete; no UI | Build the screens (§8.11, §11.2) |
| Warehouses | Read endpoint only | Full CRUD (§8.4) |
| Invoice numbering | `INV{yyMMdd}{6 random}` | Either scheme, chosen deliberately with the offline trade-off documented (§6.4) |
| Stock balance | The materialized view exists in migrations, but reads aggregate the ledger directly | Either is correct; if the cache is used, it must satisfy INV-4 |
| Audit log | Entity exists; no write path | Automatic interception on all financial and administrative mutations (§6.10) |
| Low-stock alerts | Specified in module docs; not built | Build (§8.4, §8.16) |
| Serial numbers, loyalty, customer/supplier payments | Entities exist; no operations | Build (§6.2, §6.6, §6.7) |
| Idempotency | Not implemented | Required on sale creation (§9.6) |

---

*End of specification.*
