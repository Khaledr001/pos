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
this.db.runAsPlatformAdmin(async (tx) => { ... });   // provisioning only
```

Everything inside a callback is one transaction. Multi-table writes are already
atomic — a sale, its items, the payment, and the inventory ledger rows go
together or not at all.

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

Four traps this scaffold already hit. Each one compiles, type-checks, and then
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

### Zod applies checks in declaration order

```ts
z.string().toUpperCase().regex(/^[A-Z0-9]+$/)   // ✅ "auh" → "AUH"
z.string().regex(/^[A-Z0-9]+$/).toUpperCase()   // ❌ rejects "auh"
```

Normalise before you validate, or you reject exactly what users type.

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
