# Patterns

How to write code in this repo so twenty modules read like one codebase.

The worked example is `apps/api/src/modules/branches/`. Everything below is
that module, explained.

---

## Adding an API module

### 1. `dto.ts` — Zod schemas, types inferred

```ts
export const CreateBranchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  code: z.string().trim().min(2).max(20)
    .regex(/^[A-Z0-9]+$/)
    .transform((v) => v.toUpperCase()),
});
export type CreateBranchDto = z.infer<typeof CreateBranchSchema>;

// Derive update from create so the two can never disagree about validation.
export const UpdateBranchSchema = CreateBranchSchema.omit({ code: true }).partial();
export type UpdateBranchDto = z.infer<typeof UpdateBranchSchema>;
```

The schema is the single definition: it validates at the boundary and produces
the type. A hand-written `interface` alongside a schema drifts within a month.

### 2. `<module>.service.ts` — logic

```ts
@Injectable()
export class BranchesService {
  constructor(private readonly db: TenantDatabase) {}

  async findById(id: string): Promise<Branch> {
    const branch = await this.db.run((tx) =>
      tx.query.branches.findFirst({
        where: (t, { and, eq, isNull }) => and(eq(t.id, id), isNull(t.deletedAt)),
      }),
    );
    if (!branch) throw new AppError(ERROR_CODES.NOT_FOUND, `Branch ${id} not found`);
    return branch;
  }
}
```

Note what is absent: no `tenantId` in the predicate (RLS handles it), no
`NotFoundException` (services stay HTTP-free), no try/catch (the filter owns
error shaping).

### 3. `<module>.controller.ts` — HTTP only

```ts
@ApiTags("branches")
@Controller("branches")
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get(":id")
  @RequirePermissions("branch:read")
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.branches.findById(id);
  }

  @Post()
  @RequirePermissions("branch:write")
  @Audited("branches", "create")
  create(@Body(zodPipe(CreateBranchSchema)) dto: CreateBranchDto) {
    return this.branches.create(dto);
  }
}
```

### 4. `<module>.module.ts`

```ts
@Module({
  controllers: [BranchesController],
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
```

`TenantDatabase` is not listed — `DatabaseModule` is `@Global`.

### 5. Register and record it

Add to `imports` in `apps/api/src/app.module.ts`, then tick the row in
`apps/api/src/modules/README.md`.

---

## Money

```ts
import { Money, calculateDocument } from "@devsfleet/shared-utils";
```

| Do | Don't |
|---|---|
| `Money.toMinor("2.20")` | `parseFloat(row.price)` |
| `Money.multiplyByQuantity(p, qty)` | `price * qty` |
| `Money.percentOf(net, 5)` | `net * 0.05` |
| `Money.toDecimalString(x, 2)` for storage | `x.toFixed(2)` on a float |
| `calculateDocument({...})` for any total | hand-rolled subtotal + VAT |

Numeric columns are typed as `string` on purpose. Feed them straight to
`Money.toMinor` — never through `Number()`.

Splitting an amount across lines uses `Money.allocateByWeight`, which
guarantees the parts sum back exactly. Naive division loses a fils, and it
always shows up on the receipt.

---

## Errors

```ts
// Business failure — expected, the caller must handle it
throw new AppError(ERROR_CODES.CREDIT_LIMIT_EXCEEDED, "Limit is AED 5,000");

// Genuine fault — let it propagate to the filter
const row = rows[0];
if (!row) throw new Error("insert returned no row");  // a bug, not a business case
```

New codes go in `ERROR_CODES` (`shared-utils/src/result.ts`) and get a status
mapping in `AllExceptionsFilter.statusForCode`. The default for an unmapped code
is 422 — "well-formed request, business said no", which is right for stock,
credit and floor-price refusals.

Do not pre-check uniqueness with a SELECT. Let the unique index raise 23505; the
filter turns it into a 409 with the right code. A check-then-insert is a race.

### `Result<T, E>` on hot paths

For operations whose failure is routine and frequent — validating 5,000 rows in
the importer, resolving a price per cart line — return a `Result` instead of
throwing. A throw costs a stack unwind, and more importantly a `Result` forces
the caller to write the branch.

---

## Database

### Reads and writes

```ts
this.db.run(async (tx) => { ... });                  // request-scoped tenant
this.db.runAs(tenantId, async (tx) => { ... });      // jobs, webhooks
this.db.runAsPlatformAdmin(async (tx) => { ... });   // cross-tenant: see below
```

Everything inside a callback is one transaction. Multi-table writes are already
atomic — a sale, its items, the payment, and the inventory ledger rows go
together or not at all.

`runAsPlatformAdmin` **bypasses tenant isolation entirely**. It is not only
for provisioning: `auth.service.ts` uses it on the login and refresh paths to
resolve a tenant before there is a session to scope by, and the whole
`platform` module runs on it. What matters is not which module you are in but
that you cannot reach it from a tenant-facing route — the callers above are
either pre-authentication or `@PlatformOnly()`. If you are adding a third
kind of caller, that is a decision, not a detail.

### Adding a table

```ts
export const widgets = pgTable(
  "widgets",
  {
    id: primaryId(),
    ...tenantScope,          // earns the table an RLS policy
    name: varchar({ length: 255 }).notNull(),
    price: money(),          // DECIMAL(12,4) as string
    qty: quantity(),
    ...activeFlag,
    ...timestamps,           // updated_at maintained by trigger
    ...softDelete,           // required if the POS syncs it
  },
  (t) => [uniqueIndex("uq_widgets_tenant_name").on(t.tenantId, t.name)],
);

export type Widget = typeof widgets.$inferSelect;
export type NewWidget = typeof widgets.$inferInsert;
```

Re-export from `packages/db/src/schema/index.ts`, run `pnpm db:generate`, read
the SQL, then `pnpm db:migrate`.

**`tenantScope` is imported from `./tenants.js`, not `./_shared.js`.** It has to
reference `tenants.id`, and putting it in `_shared.ts` — which every schema file
imports — makes the graph cyclic. drizzle-kit transpiles to CJS before
evaluating, where that surfaces as a confusing `ReferenceError` at generate time.

### Indexes worth copying

```ts
// Only live rows participate — a soft-deleted user frees its email
uniqueIndex("uq_users_tenant_email").on(t.tenantId, t.email)
  .where(sql`deleted_at IS NULL`)

// Current price only; history stays out of the index
index("idx_product_prices_current").on(t.productId, t.priceListId)
  .where(sql`effective_to IS NULL`)

// Tenant-scoped full-text (needs btree_gin)
index("idx_products_search").using("gin", t.tenantId, t.nameSearch)

// Fuzzy / multilingual
index("idx_products_trgm").using("gin", t.searchKey.op("gin_trgm_ops"))
```

---

## Testing

```ts
const withContext = <T>(fn: () => T): T =>
  RequestContext.run(
    { requestId: "test", startedAt: Date.now(), tenantId: TEST_TENANT, branchId: null },
    fn,
  );
```

Services read the tenant from AsyncLocalStorage, so a unit test has to open a
context — the same way production does. Stub `TenantDatabase` so `run()` hands
the callback a fake transaction.

That RLS genuinely isolates tenants is proved once, in the integration suite,
not re-asserted in every service test.

---

## Gotchas

Traps this scaffold already hit. Each one compiles, type-checks, and then
fails somewhere unhelpful.

### Drizzle column groups must be functions

```ts
export const timestamps = () => ({ createdAt: ..., updatedAt: ... });   // ✅
export const timestamps  =    { createdAt: ..., updatedAt: ... };       // ❌
```

Column builders are mutable and carry per-table state. A shared object literal
hands every table the *same* builder instances, so anything resolved at build
time — most visibly a constraint name — is computed once and reused.
`clientId: uuid().unique()` in a shared literal emitted
`payments_clientId_unique` on all four syncable tables, and the migration died
on the second `CREATE TABLE`. Nothing warns you; the SQL just has duplicates.

### `incremental: true` + `--noEmit` silently empties `dist/`

A `tsc --noEmit` typecheck writes a `.tsbuildinfo` marking the project up to
date. The next real build reads it, decides there is nothing to do, emits
nothing, and **exits 0**. `pnpm typecheck && pnpm build` then ships an empty
`dist` with a green CI run.

`incremental` is off in `tsconfig.base.json` for exactly this reason. Turbo
caches task output anyway.

### NestJS DI tokens need their own file

`DB` and `DB_CLIENT` live in `src/database/tokens.ts`, not in
`database.module.ts`. Otherwise the service imports the module (for the token)
while the module imports the service (to provide it). TypeScript compiles it;
at runtime CJS hands one side a half-built module, the token is `undefined`
when `@Inject()` runs, and Nest fails at boot with
*"can't resolve dependencies of TenantDatabase (?)"*.

Same class of problem in the schema: `tenantScope` lives in `tenants.ts`
because `_shared.ts` cannot import a table.

### Correlated subqueries must qualify the outer column by name

```ts
// ❌ silently returns 0 for everything
sql`(SELECT sum(i.quantity) FROM inventory i WHERE i.variant_id = ${schema.productVariants.id})`

// ✅
sql`(SELECT sum(i.quantity) FROM inventory i WHERE i.variant_id = product_variants.id)`
```

Drizzle omits the table qualifier when a query has **no joins**, so the first
form renders as `WHERE i.variant_id = "id"`. Inside the subquery a bare `"id"`
binds to `inventory`.`id`, the predicate becomes `i.variant_id = i.id`, and it
matches nothing — every row reports zero, with no error and no warning.

The same code is correct in a query that happens to have a join, because the
join forces drizzle to qualify. That is what makes it dangerous: it works until
someone removes a join.

Write the outer table name out in full in any correlated subquery.

### Cast parameters into overloaded SQL functions

```sql
-- ❌ sets the whole subtree's path to NULL
SET path = $1 || substring(path FROM $2)

-- ✅
SET path = $1 || substring(path FROM $2::int)
```

Postgres overloads `substring`. A bare parameter arrives as `unknown`, and the
planner resolves to `substring(text FROM pattern)` — the **regex** form. A
pattern that does not match returns NULL rather than erroring, so a category
move silently nulled `path` for every descendant.

Anywhere a parameter feeds an overloaded function (`substring`, `trim`,
`overlay`, `position`), cast it. The failure is a wrong answer, not an error.

### Zod applies checks in declaration order

```ts
z.string().toUpperCase().regex(/^[A-Z0-9]+$/)   // ✅ "auh" → "AUH"
z.string().regex(/^[A-Z0-9]+$/).toUpperCase()   // ❌ rejects "auh"
```

Normalise before you validate, or you reject exactly what users type.

### A sync high-water mark must never round-trip through `Date`

```ts
// ❌ every pull re-sent the entire catalogue, forever
mark = { at: row.updatedAt, id: row.id };        // Date — millisecond precision
sql`(t.updated_at, t.id) > (${mark.at}, ${mark.id})`

// ✅
updatedAtRaw: sql<string>`product_prices.updated_at::text`,
mark = { at: row.updatedAtRaw, id: row.id };     // raw Postgres text
```

Postgres `timestamptz` keeps microseconds; a JavaScript `Date` keeps
milliseconds. `2026-08-16 19:42:56.117434+04` becomes `...117Z`, so the mark
lands **434 µs behind** the row it was taken from and matches it again on the
next pull. The terminal never converges, the catalogue is resent on every
sync, and nothing anywhere reports an error.

The same reasoning applies to the mark per entity: entities are unrelated
timelines, so the checkpoint carries a **map**, not one shared keyset. It stays
opaque to the terminal — base64url over `{entity: "<raw timestamp>|<uuid>"}` —
so the shape can change without a client release.

Verify convergence explicitly, never by eye: pull, pull again with the returned
checkpoint (**must be 0**), change exactly one row, pull again (**must be 1**).
Bump a value the row does not already hold — `set_updated_at` skips a no-op
UPDATE, and a test that re-sets the same value reads as a broken sync.

### Never send a terminal a value that means "look it up"

`products.tax_rate` is nullable, meaning *use the tenant default*. Sending the
raw null gave the POS a 0% rate, so an offline receipt totalled **23.31** where
the server's invoice for the same basket said **24.48**. Two documents, one
sale, and the customer holding the wrong one.

Resolve before sending. The same applies to any field a terminal cannot
resolve for itself: the effective tax rate, the tax mode, and which price list
is the default — a variant carries one price row per list, and without
`isDefault` the till shows whichever the join happened to return.

### Offline records reference each other by `clientId`

A sale rung up against a drawer opened offline names that drawer by the id the
*terminal* minted. The server has its own. Push applies items in `sequence`
order, so the session exists by then — but only under the server's id.

```ts
where: (t, { eq: e, or: o }) => o(e(t.id, reference), e(t.clientId, reference))
```

Accept both forms on every cross-record reference. The terminal then never has
to rewrite an identifier under a running shift, which would orphan every local
row already pointing at it.

Not every missing reference is equal. A sale whose drawer cannot be found is
still a sale — it lands with `applied_with_warning`, because discarding
takings over missing metadata is the worse failure. A cash movement with no
drawer *is* nothing, and is rejected.

### Never divide two `Minor4` values

```ts
Money.divideRoundHalfUp(totalMinor, Money.toMinor(quantity))  // ❌ 2.8571 -> 0.0003
Money.divideByQuantity(totalMinor, quantity)                  // ✅
```

Both operands carry the 10^4 scale, so it cancels and the answer comes back
ten thousand times too small — still shaped like money, and wrong by four
orders of magnitude. A landed cost of `2.8571` was stored as `0.0003`, which
then quietly poisoned the weighted-average cost of everything received.

The same trap with a percentage needs `100n * SCALE`, not `SCALE`:

```ts
Money.divideRoundHalfUp(margin * 1_000_000n, revenue)   // 41.82%
Money.divideRoundHalfUp(margin * 10_000n, revenue)      // 0.42% — same bug
```

Reach for a named helper rather than raw division. `multiplyByQuantity`,
`divideByQuantity`, `percentOf` and `allocateByWeight` all know where the scale
goes; open-coded arithmetic does not.

### `numeric(12,4) * numeric(12,4)` is `numeric(_,8)`

```sql
sum(quantity * cost)            -- 28617.27940000
round(sum(quantity * cost), 4)  -- 28617.2794
```

Postgres widens the scale on multiplication. Any money figure built by
multiplying two money columns has to be rounded back, or a stock valuation
reaches the UI with eight decimal places and reads as a bug.

### Weighted average cost moves only on the way IN

```sql
new = (GREATEST(onHand, 0) * oldAverage + arriving * arrivingCost)
      / NULLIF(GREATEST(onHand, 0) + arriving, 0)
```

Computed in SQL against the row the upsert is already locking, so two receipts
landing together cannot both read the same "old" average and overwrite each
other. Selling changes nothing — letting an outbound movement rewrite the
average would make margin depend on the order things were sold in. The
`GREATEST(..., 0)` guards a variant whose on-hand went negative through an
out-of-order sale, which would otherwise divide by less than what is arriving
and produce an average above anything ever paid.

### A server-computed value is not a tender a client may claim

```ts
// ❌ a terminal could invent this payment with no points ever spent
{ method: "loyalty_points", amount: "50.00" }

// ✅ the server computes the value FROM the points and writes the ledger row itself
{ redeemPoints: 100 }   // -> resolved to 5.00 server-side, backed by a
                         //    loyalty_transactions row and a real deduction
```

Any tender whose value the server itself derives from other state — loyalty
points, a stored-value balance, a computed discount — must never be accepted
as a plain `{ method, amount }` line in the same array as cash and card. If it
is, the endpoint has to explicitly reject that method when it shows up there,
or a client can fabricate revenue-reducing payments that correspond to nothing.

### Cap a redemption; don't partially honour it

```
customer wants to redeem 300 points (worth 15.00) against a 2.00 basket
```

Silently capping the redeemed VALUE at the total while still deducting all 300
points burns 260 points of value nobody received. Refusing the request and
naming the amount actually owed — "redeem fewer points" — is simpler than
inventing fractional-point rounding, and is what a cashier can act on.

### A cash payment must move the drawer, or the close-out can't explain itself

```ts
// A customer settles an old invoice in cash. If this only writes to
// customer_payments, the day-close and the till close-out have no idea
// that cash exists — the drawer counts over at the end of the day with
// nothing in the system to explain why.
if (dto.method === "cash" && dto.cashSessionId) {
  await tx.insert(schema.cashMovements).values({ type: "cash_in", ... });
}
```

Any code path that puts real cash in a drawer — not just a sale — has to be
visible to both reconciliation points: the till's own close-out
(`CashRegisterService`) and the branch's day-close (`DayCloseService`). Both
already summed `cash_movements` for exactly this reason; a new kind of cash
receipt that skips writing one is invisible to both, silently, until someone
counts the drawer.

Do **not** call another service's method to write that row from inside your
own transaction if that method opens its own transaction (i.e. calls
`this.db.run(...)` itself) — `TenantDatabase.run()` always starts a fresh
`db.transaction()`, so a nested call runs on a second connection with no
shared atomicity. The payment could commit while the drawer entry silently
doesn't. Either take the caller's `tx` as a parameter (see `StockService`), or
call the other service as a genuinely separate, subsequent transaction (see
`QuotationsService.convert`, which calls `SalesService.create` this way on
purpose) — never nest one `db.run()` inside another.

### `tsc -b --dry` never actually type-checks anything

```json
"typecheck": "tsc -b --dry"                                              // ❌
"typecheck": "tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.electron.json --noEmit"  // ✅
```

`--dry` on a project-references build means "tell me whether a real build
would run," not "check the types." It prints `A non-dry build would build
project 'X'` and exits 0 **regardless of how many errors the code has** — it
is not even reading the diagnostics, let alone failing on them. On a
multi-tsconfig app (POS has one config for the renderer, one for the Electron
main process, joined by an empty root solution file) reach for `-p <config>
--noEmit` per project, the same invocation every other package in this repo
already uses — not `-b`, which exists for incremental multi-project *builds*
with real output, not for a plain type-check.

This one is worth taking seriously: it means every "typecheck passed" from
this script was true only by accident, never by verification. Confirm the fix
actually catches something — delete the `.tsbuildinfo` files under
`node_modules/.tmp/` and rerun; a script that still reports clean against code
you know is broken is not fixed yet.

---

## Authorisation

Four separate things decide whether a request may proceed. They are not
interchangeable, and most of the holes found in the audit came from one being
used where another was meant.

### 1. Permissions — what a role may do

`@RequirePermissions("product:write")` on every route. `JwtAuthGuard` is global
so authentication is automatic; authorisation is explicit, so a missing line is
visible in review.

Enforce with `hasPermission(...)`, never `permissions.includes("*") || ...` by
hand — the superuser grant is one place, not a pattern to reproduce.

### 2. Branch scope — which shops a user may act on

```ts
assertBranchInScope(dto.branchId);   // a branch the caller NAMED
const scope = branchScope();         // a filter for a list they did NOT
const where = and(..., scope ? inArray(table.branchId, scope) : undefined);
```

Both are needed. `assertBranchInScope` guards an explicit `branchId`; it does
nothing about the far more common case of a list called with no filter, which
is what the UI sends by default. Several endpoints returned the whole estate
that way — every sale, every drawer count, every terminal.

**An empty `allowedBranchIds` means EVERY branch.** That is how an owner is
represented. There is therefore no value that means "nowhere", which is why
`jwt.strategy.ts` refuses a token with no ABAC claims rather than defaulting
them: the "safe" default was silently the widest possible scope.

### 3. ABAC ceilings — how far a user may go

`maxDiscountPercent`, `maxSaleAmount`, `canApproveRefund`, `canViewCost`. Carried
in the token so no check costs a query, and always re-checked server-side — the
POS greys out the control, but a client can be modified.

A permission and a ceiling are different questions, and gating on only the first
is a bug that surfaces late. `sale:discount` says a cashier may discount at all;
`maxDiscountPercent` says how far. The POS gated the button on the permission
and left the input free, so somebody capped at 5% could type 50%, the receipt
printed, and the sale was refused when it pushed — hours later.

`AuthSession.user.maxDiscountPercent` therefore travels with the session, purely
so a client can gate the control. It is the only ABAC attribute that does.

### 4. Grants — a supervisor approving one action

An override is approved at the counter and the sale may not reach the server for
hours, on a terminal that was offline in between. It arrives on the CASHIER's
token. Without something verifiable travelling with the document, the manager's
approval is simply not present when the decision is made, and the sale is
refused after the goods have gone.

```
POST /auth/verify-override  { pin, permission }
  → { approvedBy: { id, name }, grant, expiresIn }     // no tokens, ever

POST /sales  { ..., overrideGrants: [grant] }
  → OverrideGrantsService.verify() → extra authority, this request only
```

The grant is a short-lived JWT: signature, `typ: "override"`, tenant and branch
all checked. An unverifiable one is **discarded, not fatal** — the caller's own
permissions then decide, so a forged grant buys nothing and an expired one
produces the same refusal as no approval at all.

Never accept an `approvedBy` user id in a request body. That is not an approval,
it is a field where a terminal names the owner and inherits their authority.

### Never grant more than you hold

`user:write` was a complete escalation on its own: assign the owner's role to a
new account, or reset the owner's password, and sign in. Both routes now go
through `common/context/authority.ts`:

```ts
assertMayGrantPermissions(role.permissions, "That role");  // GRANT
assertMayGrantAbac(dto);                                   // ceilings
await this.assertMayManage(tx, targetUserId);              // MANAGE
```

The consequence is deliberate: **a role that manages staff must hold every
permission it hands out.** An "HR" role that creates cashiers without being able
to do anything a cashier does is not supportable without a separate "may grant
these roles" concept — and it is exactly the shape that opened the hole.

### Separation of duties

A permission that gates an approval is worthless if another route reaches the
same effect. Two examples the audit found:

- `transfers ship` accepted status `requested` as well as `approved`, so one
  permission could move stock between branches unreviewed.
- `POST /inventory/transfer` moved stock immediately under `transfer:request` —
  a second door into the cupboard `transfers` guards with four.

When you add a route that reaches an approved outcome by a shorter path, it
needs the permission that names the authority being exercised, not the one that
names the shape of the request.

---

## Frontend

### Admin (Next.js 16, App Router)

Server Components by default; `"use client"` only where interactivity demands
it. Data through `apiFetch` in `src/lib/api-client.ts`, which unwraps the
`ApiSuccess` envelope and rethrows `ApiError` as an `AppError` carrying the
server's stable code:

```ts
try {
  await api.post("/sales", cart);
} catch (e) {
  if (e instanceof AppError && e.code === ERROR_CODES.CREDIT_LIMIT_EXCEEDED) {
    // switch on the code, never on the message text
  }
}
```

Tailwind v4: tokens live in `src/app/globals.css` under `@theme`. There is no
`tailwind.config.js`.

### POS (Electron)

The renderer has **no Node access**. Everything privileged goes through the
allowlist in `electron/preload.ts` — add a named method there rather than a
generic `invoke(channel, args)` passthrough, which would undo context isolation.

Local SQLite splits into two halves that must not be confused:

- **mirror** (products, prices, customers, inventory) — pulled, read-only,
  disposable, re-pullable.
- **outbox** (sales, payments, cash movements) — created here, authoritative
  until acknowledged. Losing it loses a day's takings. Never cleared on a schema
  mismatch; the app refuses to start instead.
