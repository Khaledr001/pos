# API modules

One folder per bounded context. Each contains exactly:

```
<module>/
├── <module>.module.ts      # wiring
├── <module>.controller.ts  # HTTP only — validate, delegate, return
├── <module>.service.ts     # business logic, tenant-scoped queries
├── dto.ts                  # Zod schemas + inferred types
└── <module>.service.spec.ts
```

**`branches/` is the reference implementation.** Read it and
[docs/PATTERNS.md](../../../../docs/PATTERNS.md) before writing a new one.
Copying its shape is what keeps twenty modules looking like one codebase.

## Status

| Module | Phase | Status | Responsibility |
|---|---|---|---|
| `platform` | 1 | ✅ done | SuperAdmin console, plans, impersonation |
| `health` | 1 | ✅ done | Liveness and readiness probes |
| `auth` | 1 | ✅ done | JWT login, PIN login, refresh rotation |
| `branches` | 1 | ✅ done | Branch CRUD — **the reference module** |
| `tenants` | 1 | ✅ done | Tenant provisioning, settings (VAT, currency, locales) |
| `users` | 1 | ✅ done | Users, roles, permission assignment |
| `categories` | 1 | ✅ done | Hierarchical tree with materialised `path` |
| `brands` | 1 | ✅ done | Brand CRUD |
| `units` | 1 | ✅ done | Units and packaging conversions |
| `products` | 1 | ✅ done | CRUD, full-text + trigram search, barcode lookup, images |
| `pricing` | 1 | ✅ done | Price lists, customer prices, floor enforcement, history |
| `customers` | 1 | ⬜ todo | Customers, credit limits, balance |
| `inventory` | 2 | ✅ done | Per-branch stock, the append-only ledger, adjustments |
| `suppliers` | 2 | ⬜ todo | Supplier CRUD |
| `purchases` | 2 | ⬜ todo | Purchase orders, goods receipts, landed cost |
| `transfers` | 2 | ⬜ todo | Inter-branch request → approve → ship → receive |
| `sync` | 3 | ✅ done | POS push/pull, idempotency, per-entity checkpoints |
| `cash-register` | 3 | ✅ done | Drawer sessions, movements, close-out variance |
| `sales` | 3 | ✅ done | Sale creation, returns, voids |
| `held-carts` | 3 | ✅ done | Park a cart, restore it, discard it |
| `day-close` | 3 | ✅ done | Per-branch daily reconciliation, frozen at close |
| `expenses` | 3 | ✅ done | Out-of-pocket spending, cash vs non-cash |
| `payments` | 3 | ⬜ todo | Split tender, credit settlement, refunds |
| `whatsapp` | 4 | ⬜ todo | Meta Cloud API webhook, send/receive, templates |
| `ai` | 4 | ⬜ todo | LLM tools, intent extraction, escalation |
| `quotations` | 5 | ⬜ todo | Quotation → PDF → stock reservation → order |
| `orders` | 5 | ⬜ todo | Order lifecycle, POS pickup, fulfilment |
| `reports` | 6 | ⬜ todo | Sales, margin, stock, cash reporting |

## Rules

1. **Never put a `tenantId` in a WHERE clause.** Row-level security does it.
   Query through `TenantDatabase.run()` and let Postgres enforce isolation.
2. **Services throw `AppError`, not `HttpException`.** Services get called from
   queue workers and the WhatsApp bot, where HTTP status codes are meaningless.
3. **Controllers hold no logic.** If there is an `if` about business rules in a
   controller, it belongs in the service.
4. **Money is never a `number`.** Use `Money` from `@devsfleet/shared-utils`,
   and `calculateDocument` for any total that a customer will see.
5. **Every route declares `@RequirePermissions`** unless it is genuinely
   `@Public()`.
