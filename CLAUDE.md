# DevsFleet Business Platform

Multi-tenant, multi-branch, offline-first retail platform: POS + WhatsApp AI +
admin panel. Built for hardware/electrical/sanitary/paint retail, starting with
a 5,000+ SKU catalogue.

Full spec: [implementation_plan.md](implementation_plan.md).
Locked decisions: [docs/DECISIONS.md](docs/DECISIONS.md).
What to build next: [docs/ROADMAP.md](docs/ROADMAP.md).

---

## Environment

Node is installed through nvm and is **not on PATH in a non-interactive shell**.
Prefix commands, or the tooling will appear to be missing:

```bash
export PATH="$HOME/.nvm/versions/node/v24.11.1/bin:$PATH"
```

Node 24.11.1 · pnpm 11.2.2 · PostgreSQL 18 · Docker Compose v5

**Docker**: the active context is `desktop-linux`, whose daemon is not running,
and this user is not in the `docker` group. Start Docker Desktop before
`pnpm infra:up`, or run `sudo usermod -aG docker $USER` once and switch with
`docker context use default`.

**The repo path contains a space** (`DevsFleet POS`). Quote paths in shell
commands.

## Layout

```
apps/
  api/        NestJS 11 — REST API, the only thing that talks to Postgres
  admin/      Next.js 16 — admin panel (Phase 6)
  pos/        Electron + React + SQLite — offline terminal (Phase 3)
packages/
  db/           Drizzle schema, migrations, RLS policies, seed
  shared-types/ enums, permissions, tenant settings, API + sync contracts
  shared-utils/ money, tax totals, document numbers, text normalisation
tools/
  import/     Excel/CSV price-list profiler and product importer
```

## Commands

```bash
pnpm infra:up          # Postgres + Redis + MinIO
pnpm db:migrate        # drizzle migrations, then RLS + triggers, then verify
pnpm db:seed           # tenant #1, 2 branches, roles, admin, sample catalogue
pnpm dev               # everything, via turbo
pnpm build             # everything
pnpm test              # everything

pnpm --filter @devsfleet/api dev        # API only, port 3001
pnpm --filter @devsfleet/admin dev      # admin only, port 3000
pnpm --filter @devsfleet/pos dev        # POS only, Electron window

pnpm db:generate       # after editing packages/db/src/schema/**
pnpm db:studio         # drizzle studio
pnpm db:reset          # DESTRUCTIVE — drops the public schema
```

Seeded login: `admin@devsfleet.com` / `ChangeMe123!`, POS PIN `1234`.

---

## Rules

These are not style preferences. Each one exists because breaking it produces a
specific, expensive failure.

### 1. Money is never a `number`

JavaScript floats cannot represent `0.1`. On a 40-line wholesale invoice with
5% VAT, that produces a receipt whose lines do not sum to its total.

```ts
import { Money, calculateDocument } from "@devsfleet/shared-utils";

const price = Money.toMinor("2.20");            // bigint, scaled by 10^4
const line  = Money.multiplyByQuantity(price, 50);
const out   = Money.toDecimalString(line, 2);   // "110.00"
```

Any total a customer will see comes from `calculateDocument` — the same
function in the API, the POS and the admin panel. Never reimplement
"subtotal minus discount plus VAT".

Numeric columns arrive from Postgres as **strings**, deliberately. Do not
`Number()` them.

### 2. Never write `tenantId` into a WHERE clause

Row-level security applies it. Query through `TenantDatabase`:

```ts
constructor(private readonly db: TenantDatabase) {}

async findAll() {
  return this.db.run((tx) => tx.query.branches.findMany());
}
```

`run()` opens a transaction and sets `app.current_tenant_id` from the request
context. A filter you have to remember is one you will eventually forget, and
forgetting it here leaks another business's data.

Background jobs and webhooks use `runAs(tenantId, fn)`. `runAsPlatformAdmin` is
for tenant provisioning and cross-tenant reporting only — never from a
controller.

### 3. Services throw `AppError`, not `HttpException`

```ts
throw new AppError(ERROR_CODES.INSUFFICIENT_STOCK, "Only 12 units in Sharjah");
```

`AllExceptionsFilter` maps the code to an HTTP status. Services get called from
queue workers and the WhatsApp bot, where status codes mean nothing. Add new
codes to `ERROR_CODES` in `shared-utils/result.ts` — never inline a string.

### 4. Ledgers are append-only

`inventory_transactions`, `price_history` and `audit_log` reject UPDATE and
DELETE at the database level. Correct a mistake with a compensating entry: a
return, a void, or an `adjustment` row. An audit trail that can be edited is
not an audit trail.

### 5. Every document snapshots what it needs

`sale_items` stores `productName`, `productSku`, `taxPercent` and `costPrice` as
they were at the time of sale. Renaming a product or changing the VAT rate must
not silently rewrite a tax document from last year.

### 6. Offline-created records carry a `clientId`

The POS mints a UUID for anything it creates offline and sends it on every push
attempt. The server upserts on it. That, and only that, is what stops a retry
after a timeout from double-booking a sale.

### 7. Controllers hold no logic

Validate (Zod), delegate to the service, return. No database access, no
try/catch, no business `if`.

### 8. Every route declares its permission

```ts
@RequirePermissions("product:write")
```

`JwtAuthGuard` is global, so authentication is automatic and `@Public()` is the
exception. Authorisation is explicit, so a missing line is visible in review.

---

## Adding a module

`apps/api/src/modules/branches/` is the worked reference — read it first, and
[docs/PATTERNS.md](docs/PATTERNS.md) for the full walkthrough.

```
<module>/
├── <module>.module.ts
├── <module>.controller.ts   # HTTP only
├── <module>.service.ts      # logic, via TenantDatabase
├── dto.ts                   # Zod schemas + z.infer types
└── <module>.service.spec.ts
```

Then register it in `apps/api/src/app.module.ts` and tick it off in
`apps/api/src/modules/README.md`.

## Changing the schema

1. Edit `packages/db/src/schema/<domain>.ts`. Spread `...tenantScope` — that
   column is what earns the table an RLS policy.
2. `pnpm db:generate`, then **read the generated SQL** before committing.
3. `pnpm db:migrate` — reapplies RLS and triggers, and fails if any
   tenant-scoped table ended up unprotected.

Columns are camelCase in TypeScript and snake_case in Postgres, via
`casing: "snake_case"`. It is set in **both** `drizzle.config.ts` and
`src/client.ts`; changing one without the other produces queries referencing
columns that do not exist, at runtime only.

## Conventions

- **Comments** explain *why*, never *what*. No comment is better than one that
  restates the code.
- **Zod, not class-validator.** The same schema validates in the API, types the
  admin form, and checks a row in the Excel importer.
- **Soft delete** anything a document references. Hard deletes break history and
  break POS sync tombstones.
- **Tests** with Vitest everywhere. The API needs `unplugin-swc` for decorator
  metadata — already configured.

## Not yet decided

- Product/pricing schema is a **skeleton** until the real price list is
  profiled: `pnpm --filter @devsfleet/import profile -- "<file.xlsx>"`.
  Unmapped columns go in `products.attributes` (JSONB) for now.
- Barcode scanner model (USB HID assumed — renderer reads it as keyboard input).
- Thermal printer models for 58mm and 80mm.
