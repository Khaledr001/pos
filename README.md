# DevsFleet Business Platform

Multi-tenant, multi-branch, offline-first retail platform combining a POS
terminal, a WhatsApp AI assistant, and an admin panel — built for
hardware / electrical / sanitary / paint retail.

```
┌─ apps/pos ────────┐   ┌─ apps/admin ──┐   ┌─ WhatsApp ────┐
│ Electron + SQLite │   │  Next.js 16   │   │ Meta Cloud API│
│ works offline     │   │               │   │               │
└─────────┬─────────┘   └───────┬───────┘   └───────┬───────┘
          │ sync (REST)         │ REST              │ webhook
          └─────────────────────┴───────────────────┘
                                │
                     ┌──────────┴──────────┐
                     │   apps/api          │
                     │   NestJS 11         │
                     └──────────┬──────────┘
                                │
                ┌───────────────┼───────────────┐
           PostgreSQL 18      Redis           MinIO
           (RLS per tenant)   (queues)        (images, PDFs)
```

## Getting started

```bash
# Node comes from nvm and is not on PATH in a non-interactive shell
export PATH="$HOME/.nvm/versions/node/v24.11.1/bin:$PATH"

cp .env.example .env
pnpm install

pnpm infra:up          # Postgres + Redis + MinIO
pnpm db:migrate        # schema, RLS policies, triggers
pnpm db:seed           # tenant #1, branches, roles, sample catalogue

pnpm dev               # all apps
```

| Service | URL |
|---|---|
| API | http://localhost:3001/api/v1 |
| API docs | http://localhost:3001/api/v1/docs |
| Admin panel | http://localhost:3000 |
| POS | Electron window |
| MinIO console | http://localhost:9001 |

Seeded login: `admin@devsfleet.com` / `ChangeMe123!` · POS PIN `1234`.
Change both before deploying.

> **Docker**: the active context is `desktop-linux` and its daemon is not
> running. Either start Docker Desktop, or run `sudo usermod -aG docker $USER`
> once and `docker context use default`.

## Workspace

| Package | Purpose |
|---|---|
| `apps/api` | NestJS REST API — the only thing that talks to Postgres |
| `apps/admin` | Next.js 16 admin panel |
| `apps/pos` | Electron POS terminal with local SQLite |
| `packages/db` | Drizzle schema, migrations, RLS, seed |
| `packages/shared-types` | Enums, permissions, settings, API + sync contracts |
| `packages/shared-utils` | Exact money maths, tax totals, document numbers |
| `tools/import` | Price-list profiler and product importer |

## Commands

```bash
pnpm build / test / typecheck / lint     # everything, via turbo
pnpm --filter @devsfleet/api dev         # one workspace

pnpm db:generate    # after editing packages/db/src/schema/**
pnpm db:migrate     # apply, then reapply RLS + triggers, then verify
pnpm db:studio
pnpm db:reset       # DESTRUCTIVE, dev only

pnpm infra:up / infra:down / infra:logs
pnpm infra:nuke     # also drops volumes
```

## Documentation

| | |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Working rules — read first |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Settled choices and why |
| [docs/PATTERNS.md](docs/PATTERNS.md) | How to add a module, handle money, write tests |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema map, RLS, migrations |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phase-by-phase checklist |
| [implementation_plan.md](implementation_plan.md) | Original spec |

## Status

Phase 0 (scaffold) complete. All three apps build, 31 tests pass, and the data
layer was verified against a live PostgreSQL 18.4 instance — tenant isolation,
ledger immutability, gapless invoice numbering, login, refresh rotation and RBAC
all confirmed working, not just compiling. Full list in
[docs/ROADMAP.md](docs/ROADMAP.md).

Phase 1 is next.

The product and pricing schema is a **skeleton** until the real price list is
profiled:

```bash
pnpm --filter @devsfleet/import profile -- "/path/to/price-list.xlsx"
```
