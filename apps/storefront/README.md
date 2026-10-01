# @devsfleet/storefront

Every tenant's online shop, from one Next.js deployment. The tenant comes from
the hostname the shopper visits; all data — catalogue, prices, stock, cart,
orders — is the POS's own, served by the API's `storefront` module.

Architecture, data model, payments and operations: [docs/STOREFRONT.md](../../docs/STOREFRONT.md).

```bash
cp .env.example .env.local           # STOREFRONT_HOST=localhost for local work
pnpm --filter @devsfleet/storefront dev        # http://localhost:3002
pnpm --filter @devsfleet/storefront test:e2e   # Playwright, against a running stack
```

The browser only ever talks to this origin: `/api/v1/*` is rewritten to the
API's `/api/v1/storefront/*`, so shopper cookies are first-party and there is
no CORS. Server components call the API directly and name the shop in
`x-storefront-host`.

No total a shopper sees is computed here. Line totals, VAT and order totals
all come from the API, which computes them with `calculateDocument` — the
same function the till uses.
