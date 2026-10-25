# Headless storefront access

A tenant on a plan with `apiAccess` (Pro, Enterprise) can build its own front
end — an agency site, a mobile app, a kiosk — on the same catalogue, prices,
stock and orders as the hosted shop. There is no second API and no API key: the
storefront API is already public, tenant-scoped by hostname, and read-only for
anonymous callers. Headless mode only adds **browser** access (CORS) for the
origins the tenant lists.

## Two ways to call it

**1. From your own server (recommended — nothing to configure).** Proxy the
storefront API through your server, exactly as the hosted shop does with its
`/api/v1/*` rewrite. Send the shop's registered domain in `x-storefront-host`.
Cookies stay first-party to your site, so shopper sign-in, cart and checkout all
work. Register your front end's domain under Online Store → Domains first; the
host is how the API finds the tenant.

**2. Straight from the browser (public catalogue).** Turn on *Headless access*
in Admin → Online Store → Appearance → Developers and list the exact origins
(`https://app.example.com`, no wildcard, no path; `http://localhost:5173` is
allowed for development). The page then calls the API directly:

```ts
const res = await fetch("https://pos-api.devsfleet.com/api/v1/storefront/catalog/categories", {
  headers: { "x-storefront-host": "shop.example.ae" },
  credentials: "omit",
});
```

Rules for browser access:

- `x-storefront-host` is **required** and must be a domain registered to the
  shop. `Host` and `X-Forwarded-Host` are ignored for this check.
- **No credentials.** Pass `credentials: "omit"` (the bundled client defaults to `include`, which a credential-less response makes the browser reject).
  `Access-Control-Allow-Credentials` is never sent to a
  listed origin, so shopper cookies cannot ride along. Anything that needs a
  signed-in shopper (account, checkout, quotes) must go through option 1.
- Allowed headers: `content-type`, `x-storefront-host`, `idempotency-key`,
  `accept`, `accept-language`. A browser preflight (`OPTIONS`) succeeds when any
  shop lists the origin; the real request is checked again against its own shop.
- If the plan loses `apiAccess`, the shop goes dark or headless is switched off,
  the origin stops being allowed within about a minute (cached 60 s).
- CORS only ever opens `/api/v1/storefront/*`. Staff routes are unaffected.

## What is exposed

The shop-window endpoints, all under `/api/v1/storefront`:

| Area | Endpoints (prefix `/catalog`, `/content`, …) |
|---|---|
| Shop config | `GET /content/store` — name, logo, contact, currency, timezone, **theme, navigation, region** |
| Home page | `GET /content/home` — banners, categories, brands, product rows, and `sections` (the tenant's ordered, enabled home sections) |
| Content | `GET /content/pages/:slug`, `/content/blog`, `/content/branches` |
| Catalogue | `GET /catalog/categories[/:slug]`, `/catalog/brands[/:slug]`, `/catalog/products`, `/catalog/products/:slug`, `/catalog/suggest`, `/catalog/prices` |
| Cart & checkout | `/cart/*`, checkout (need the shopper cookie → server proxy) |
| Shopper | `/auth/*`, `/me/*`, `/quotes` (cookie → server proxy); `/stock-alerts` is public |

Responses are JSON; amounts are decimal strings and whole fils. Never compute a
total on the client — the checkout quote is the authority.

## Using the typed client

`@devsfleet/storefront-client` has every response type (`StoreInfo`,
`HomeData`, `ProductDetail`, …) and a small fetch client. The types are
contract-tested against the API, so a change on either side fails the build.

```ts
import { createApiClient } from "@devsfleet/storefront-client";
const api = createApiClient({
  baseUrl: "https://pos-api.devsfleet.com/api/v1/storefront",
  headers: () => ({ "x-storefront-host": "shop.example.ae" }),
});
const store = await api.get<StoreInfo>("/content/store", { credentials: "omit" });
```

`StoreInfo.theme` and `HomeData.sections` carry the same appearance data the
hosted shop renders, so a custom front end can follow the tenant's colours,
navigation and section order, or ignore them and design its own.

## Configuring it

`PATCH /api/v1/storefront-admin/settings` with
`{ "headless": { "enabled": true, "allowedOrigins": ["https://app.example.com"] } }`.
Enabling without `apiAccess` fails with `PLAN_LIMIT_EXCEEDED`; switching it off
always works. `GET /storefront-admin/settings` returns `planAllowsHeadless` so a UI can
disable the switch.
