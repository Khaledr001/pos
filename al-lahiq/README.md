# Al-Lahiq — building materials online store (UAE)

Online store for a hardware, electrical, sanitary ware and building materials
shop. Prices in AED with 5% VAT, courier delivery to all emirates, store
pickup, cash on delivery and card payments, trade (contractor) pricing, and a
two-way sync with the shop's own POS.

See [PLAN.md](PLAN.md) for the product plan and [docs/pos-integration.yaml](docs/pos-integration.yaml)
for the POS contract.

## Layout

```
al-lahiq/
├── backend/               NestJS 12 API (Prisma 7 + PostgreSQL, Redis/BullMQ)
├── frontend/              Next.js 16 storefront and admin panel (Tailwind 4)
├── packages/api-client/   Shared response types + fetch client; contract test
├── docs/                  POS integration spec (OpenAPI)
└── docker-compose.yml     Postgres + Redis for dev; full stack with --profile app
```

**How the pieces talk**

- The browser only talks to Next.js. Next rewrites `/api/v1/*` and
  `/uploads/*` to the NestJS API, so auth cookies are first-party (no CORS).
- Server components fetch from the API directly: public catalog data is
  cached with tags; per-visitor data forwards the visitor's cookies.
- The POS sends signed webhooks to `POST /api/v1/pos/webhooks`. The API sends
  orders and status changes to the POS from a transactional outbox, and pulls
  a full snapshot nightly to fix drift.
- When prices, stock or content change, the API calls the frontend's
  `/api/revalidate` with cache tags, so cached pages refresh within seconds.

## Requirements

- Node.js 24 and pnpm 11 (`corepack enable`)
- PostgreSQL 16+ with the `pg_trgm` extension (standard in most distributions)
- Redis 7+

Or run Postgres and Redis with Docker: `docker compose up -d postgres redis`.

## First run

```bash
pnpm install

# 1. Configure the API
cp backend/.env.example backend/.env      # set DATABASE_URL, secrets
# generate secrets with:  openssl rand -hex 32

# 2. Create the schema and load demo data
pnpm --filter backend db:migrate
pnpm --filter backend seed

# 3. Configure the frontend
cp frontend/.env.example frontend/.env.local   # REVALIDATE_SECRET must match the API

# 4. Start both apps (two terminals)
pnpm dev:backend     # http://localhost:4000  (API docs: /api/docs)
pnpm dev:frontend    # http://localhost:3000  (admin: /admin)
```

Demo logins (password `Demo@12345`):

| Who | Email |
|---|---|
| Owner (admin) | owner@al-lahiq.test |
| Manager | manager@al-lahiq.test |
| Order desk | orders@al-lahiq.test |
| Content editor | content@al-lahiq.test |
| Retail customer | customer@al-lahiq.test |
| Trade customer (TRADE-A prices) | contractor@al-lahiq.test |

Promo codes: `WELCOME10` (10% over AED 100), `FREESHIP` (free delivery over AED 200).

With `DEV_PAYMENTS=true` and no Stripe key, card payments go to a test page
where you choose "Pay now" or "Decline payment".

## Tests

```bash
pnpm --filter backend test          # unit tests (pricing, VAT, signatures, order rules…)
pnpm --filter backend test:e2e      # API end-to-end against al_lahiq_test + a mock POS
pnpm --filter @al-lahiq/api-client test   # compile-time contract: API responses vs frontend types
pnpm --filter frontend typecheck && pnpm --filter frontend lint
pnpm --filter frontend test:e2e     # Playwright (needs both apps running with seeded data)
```

The API e2e tests expect a database `al_lahiq_test` (override with
`TEST_DATABASE_URL`) and Redis (`TEST_REDIS_URL`, default db 6). Migrations
are applied automatically.

## Configuration

Key API settings (`backend/.env`, validated at startup — see
`backend/src/config/env.ts`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Data stores |
| `JWT_SECRET` | Signs access tokens (15 min); refresh tokens rotate and are revocable |
| `FRONTEND_URL`, `REVALIDATE_SECRET` | Where to send cache revalidation |
| `POS_WEBHOOK_SECRET` | Verifies POS → website webhooks |
| `POS_OUTBOUND_SECRET`, `POS_BASE_URL` | Signs and sends website → POS events; unset URL keeps events queued |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Card, Apple Pay, Google Pay (webhook: `/api/v1/payments/stripe/webhook`) |
| `RESEND_API_KEY`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Email and WhatsApp notifications (logged when unset) |
| `COOKIE_DOMAIN`, `COOKIE_SECURE` | Set `.yourdomain.ae` and `true` in production |

Shop settings (store TRN, COD limit, stock safety buffer, pickup slots, search
synonyms, courier rates, branches) are edited in the admin panel.

## Connecting the POS

1. Create the branches in **Admin → Settings → Branches** with the same codes
   the POS uses.
2. Give the POS developer [docs/pos-integration.yaml](docs/pos-integration.yaml)
   and the two secrets.
3. From the POS, send `product.upsert`, `price_list.upserted`,
   `price_items.changed` and `stock.updated` events. New SKUs appear in
   **Admin → Products** as drafts; add photos and a description, then publish.
4. Implement `POST /website/events` and `GET /website/snapshot` on the POS,
   then set `POS_BASE_URL`. Watch **Admin → POS connection** for failures.

## Deployment

`docker compose --profile app up --build` runs the whole stack. In
production, put both apps behind one domain (or set `COOKIE_DOMAIN`), run
the API with `NODE_ENV=production`, apply migrations with
`prisma migrate deploy` (the API image does this on start), and back up
PostgreSQL and the `uploads/` volume (or switch `StorageService` to S3).
Only one API instance needs to run the scheduler; the Redis locks make
several safe.
