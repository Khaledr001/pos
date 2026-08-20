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
| `audit` | 1 | ✅ done | Read side of `audit_log` — `AuditInterceptor` is the only writer |
| `health` | 1 | ✅ done | Liveness and readiness probes |
| `auth` | 1 | ✅ done | JWT login, PIN login, refresh rotation |
| `branches` | 1 | ✅ done | Branch CRUD — **the reference module** |
| `tenants` | 1 | ✅ done | Tenant provisioning, settings (VAT, currency, locales) |
| `users` | 1 | ✅ done | Users, permission assignment |
| `roles` | 1 | ✅ done | Role CRUD — permission grants, `assertMayGrantPermissions` on every write |
| `categories` | 1 | ✅ done | Hierarchical tree with materialised `path` |
| `brands` | 1 | ✅ done | Brand CRUD |
| `units` | 1 | ✅ done | Units and packaging conversions |
| `products` | 1 | ✅ done | CRUD, full-text + trigram search, barcode lookup, images, per-variant packagings |
| `pricing` | 1 | ✅ done | Price lists, per-variant/per-list prices (with history), negotiated customer prices, bulk update — all through `price:read`/`price:write`. `PriceResolverService` now lives here as the one shared provider, imported by orders/products/quotations/sales rather than re-declared in each. |
| `customers` | 1 | ✅ done | CRUD, credit settlement, loyalty ledger |
| `inventory` | 2 | ✅ done | Per-branch stock, the append-only ledger, adjustments |
| `serials` | 2 | ✅ done | Check in at receipt, assign at sale, warranty lookup |
| `stock-take` | 2 | ✅ done | Count sheet → count → submit → approve, posts variances |
| `suppliers` | 2 | ✅ done | Supplier CRUD, outstanding balance |
| `purchases` | 2 | ✅ done | Purchase orders, goods receipts, landed cost |
| `transfers` | 2 | ✅ done | Inter-branch request → approve → ship → receive, implemented and registered |
| `devices` | 3 | ✅ done | Terminal registration, activation, `device:manage` |
| `sync` | 3 | ✅ done | POS push/pull, idempotency, per-entity checkpoints |
| `cash-register` | 3 | ✅ done | Drawer sessions, movements, close-out variance |
| `sales` | 3 | 🟡 partial | Sale creation only — 3 routes, 3 methods. `sale:void`/`sale:return` exist and are attached to zero routes; no return, void or refund of any kind exists yet. See feature.md B2. |
| `held-carts` | 3 | ✅ done | Park a cart, restore it, discard it |
| `day-close` | 3 | ✅ done | Per-branch daily reconciliation, frozen at close |
| `expenses` | 3 | ✅ done | Out-of-pocket spending, cash vs non-cash |
| `payments` | 3 | ⬜ todo | Split tender, credit settlement, refunds |
| `whatsapp` | 4 | ⬜ todo | Meta Cloud API webhook, send/receive, templates |
| `ai` | 4 | ⬜ todo | LLM tools, intent extraction, escalation |
| `quotations` | 5 | ✅ done | Quote at snapshotted prices, convert to a sale |
| `orders` | 5 | ✅ done | Create, confirm (reserves stock), cancel (releases it), partial fulfilment — each a real sale linked back via `sales.orderId` |
| `reports` | 6 | ✅ done | Sales, top products, stock health, financial |
| `paint` | 7 | ✅ done | Formulas, dosages, mix orders that deduct the base can |

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
