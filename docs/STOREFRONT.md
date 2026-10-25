# Online store

Every tenant can sell online from the same catalogue, prices and stock the
counter uses. The website is a sales channel on the platform, not a second
system: there is no product, price, stock or order table that belongs only to
the shop, so there is nothing to sync and nothing to drift.

```
Browser ─▶ apps/storefront (Next.js, every tenant)
              │  /api/v1/* rewritten to the API's /api/v1/storefront/*
              ▼
           apps/api  ─ modules/storefront ─▶ Postgres (RLS)
              ▲          catalog, cart, checkout, accounts, payments
              │
           apps/admin ─ Online Store screens ─ /api/v1/storefront-admin/*
```

Why one backend and not the website's own: see
[DECISIONS.md D20](DECISIONS.md#d20--the-online-store-is-a-channel-on-the-platform-not-a-second-backend).

---

## How a request finds its tenant

The tenant comes from the **hostname**, never from a token or a body.

1. `storefront_domains` maps a hostname to a storefront and its tenant. It is
   unique across all tenants.
2. `StorefrontGuard` (on every `@StorefrontRoute()` controller) resolves the
   host through `StorefrontResolver` — with RLS bypassed, because there is no
   tenant yet, exactly like a WhatsApp phone number id — then sets the tenant
   on the request context. Every query after that is ordinary `db.run()` under
   RLS.
3. A host with no storefront, a suspended tenant, a lapsed trial or a plan
   without `onlineStore` gets `STOREFRONT_NOT_FOUND` (404).

The storefront server sends the shop's hostname as `x-storefront-host`
(server-side calls) or lets its rewrite proxy forward it as
`x-forwarded-host` (browser calls). Spoofing either buys another shop's
**public** catalogue and nothing else: shopper tokens carry their tenant and
are checked against the resolved one.

## What the shop adds to the POS data

| Table | Purpose |
|---|---|
| `storefronts`, `storefront_domains` | One per tenant; its hostnames and settings (delivery rates, COD limit, pickup slots, branches shown, synonyms) |
| `product_listings`, `product_links` | Which products are online, their web address, SEO copy, specs, related products. No row = not listed |
| `storefront_pages`, `storefront_banners` | Content pages, guides, home banners |
| `shopper_accounts`, `shopper_sessions`, `shopper_addresses`, `shopper_lists` | Shopper login (each backed by a `customers` row), rotating refresh tokens, addresses, wishlists |
| `carts`, `cart_items`, `coupons` | Variant + unit + quantity; never a price |
| `web_orders`, `web_order_events`, `web_payments`, `web_shipments` | The shopper's side of an `orders` row: contact, delivery, payment, timeline |
| `stock_alert_subscriptions` | "Notify me when it's back": variant, lowercased email, optional phone, status `pending` / `notified` / `cancelled`, unsubscribe token |
| `web_quotes`, `web_quote_items` | A trade buyer's request for a price, snapshotted like an order; staff-set `quoted_unit_price` per line |
| `storefront_payment_accounts` | The tenant's own Stripe account |

`categories` and `brands` gained `description`/SEO/`is_featured` columns.

## Money, stock and orders

- **Prices** come from `PriceResolverService`, the same ladder as the till.
  A packaging (a box of 50) is priced by `listedUnitPrice`, shared with
  `SalesService`. Display figures go through `calculateLine`; every total
  through `calculateDocument`.
- **Checkout** runs in one transaction. It re-prices, re-checks stock under
  row locks, redeems the coupon, then creates the POS order
  (`OrdersService.createInTransaction`, source `web`) and confirms it, which
  reserves the stock. The order total must equal the quote to the fils, or the
  transaction aborts.
- A moved price is refused with `PRICE_CHANGED` (409). The cart records that
  the shopper has now seen the new price, in its own committed transaction, so
  the retry goes through.
- **Idempotency**: the browser mints an `idempotencyKey` per checkout attempt.
  A retry returns the order already placed.
- **Delivery** is an order line on the tenant's non-stock `WEB-DELIVERY`
  product, so it is taxed and invoiced like goods.
- **Coupons** are percent or free-delivery, applied as a per-line percentage.
  That is what survives the hand-over into a sale exactly. Fixed-amount codes
  are refused online for now.
- **Reservations count base units**: a reserved box of 50 holds 50 pieces.
  This also fixed `OrdersService` for packaged lines generally.
- **Hand-over** (Delivered / Collected on the order desk) fulfils the POS
  order through `OrdersService.fulfill`, which goes through `SalesService`.
  That creates the sale, the tax invoice and the stock movement, under the
  staff member who handed it over. The shopper downloads that same invoice from the
  tracking page (`/orders/track/<token>/invoice.pdf`) or their account
  (`/me/orders/<id>/invoice.pdf`); it is rendered by `SalesService.invoicePdf`,
  the document the counter prints. Card orders settle as `card`; cash on
  delivery records how the money came in (cash into a till, card at the
  counter, or the courier's bank transfer).

## Shoppers

- Shopper tokens are signed with `STOREFRONT_JWT_SECRET` (or a key derived
  from `JWT_ACCESS_SECRET`). That is a different key from staff tokens, so a
  shopper token fails verification on every staff route outright.
- Access token in `sf_at`, refresh token in `sf_rt`, guest cart in `sf_cart`.
  All are httpOnly, first-party (the browser only ever talks to the shop's own
  origin) and `SameSite=Lax`.
- Refresh tokens rotate. Presenting an already-rotated token revokes the
  whole family, and that revocation commits before the refusal.
- Registering never links to an existing POS customer with the same email or
  phone; that would hand a stranger the customer's trade prices and credit.
  Staff approve trade applications, which assigns the customer a price list.

## Payments

- Each tenant connects **its own** Stripe account (Admin → Online Store). There
  is no platform-wide key. Stripe calls
  `/api/v1/storefront/payments/stripe/webhook/<account id>`. The id routes the
  webhook to its tenant, and the signature is checked with that account's own
  secret.
- Card orders reserve stock at placement. An unpaid one is cancelled, and its
  stock released, after the payment window (45 min) plus 15 min.
- `STOREFRONT_DEV_PAYMENTS=true` sends card checkouts to a test page with
  "Pay" and "Decline". The API refuses to boot with it in production.

## Back-in-stock alerts

- A sold-out option on the product page shows a form (guest or signed in).
  `POST /storefront/stock-alerts` is public, throttled (5/min), Zod-validated and
  has a hidden honeypot field. It answers `{ subscribed: true }` whether the
  address is new, already waiting, or a bot's honeypot hit, so it cannot be used
  to find out who asked about what. Unique on (tenant, variant, lowercased email):
  a repeat is the same row, and re-subscribing after an alert fired starts a new wait.
  `POST /storefront/stock-alerts/unsubscribe/:token` cancels by the row's token.
- `StockAlertSweepService` runs every 5 minutes (modelled on `PaymentExpiryService`; there
  is no "stock arrived" event to hook, only low-stock crossings). For each tenant
  with pending rows it asks `StorefrontCatalogService.availability` — the
  same answer the product page gives (free stock less the safety buffer, at the branches
  shown online) — and claims the rows whose variant is no longer sold out with one
  conditional update, so two API instances fire each subscription once.
- **Nothing is sent to the shopper.** There is no email transport in the platform, and the
  WhatsApp service can only send free text to a conversation with an open 24-hour
  window (templates are not built). The sweep records `status = notified`,
  `notified_at`, and leaves `delivered_at` null; a transport belongs at the end of
  `StockAlertsService.fireForTenant`.
- Staff: `GET /storefront-admin/stock-alerts` (`product:read`), pending subscribers
  per product, most wanted first. Admin → Online Store → Stock Alerts.

## Trade quotes

Cart → "Request a quote" (signed-in shoppers; any account, trade-approved or not,
because a quote is a request, and the prices are staff's) → staff price it → the shopper
accepts or declines from `/account/quotes`.

- `POST /storefront/quotes` takes the contact details and, optionally, explicit
  `lines` — by default it quotes the current cart. **The client never sends a price:**
  lines are priced server-side through the cart's own ladder (the shopper's trade list
  if they have one) and snapshotted (name, SKU, VAT rate, quantity, unit price, currency, tax
  mode). `clientId` makes the submit idempotent. Number: `QT-WEB-<year>-<seq>`, from the
  same `next_document_number` sequences as the till's quotations, with its own `WEB` counter.
- While `requested` the figures are a list-price **estimate**. Staff price every line
  (`POST /storefront-admin/quotes/:id/price`: `quoted_unit_price` per line, an optional
  document discount %, validity date, internal notes), which moves the quote to
  `quoted` and recomputes the totals through `calculateDocument`. Pricing below list, or a
  document discount, needs `sale:discount` and stays within the staff member's discount
  ceiling (`DISCOUNT_EXCEEDS_LIMIT`). Staff can also decline a request or lapse a sent quote.
- Shopper `accept` / `decline` work only from `quoted` and in date, as one conditional
  update (`QUOTE_INVALID_STATUS` / `QUOTE_EXPIRED` otherwise). A `quoted` quote past
  `valid_until` reads as `expired` everywhere, with no job needed.
- **Accepting does not create an order or fill the cart.** The cart holds no price and
  an order reserves stock and takes payment, which are the checkout's. Accepting
  records the decision; staff raise the order from the order desk and `converted_order_id` is
  where it is linked. Routes: `order:read` / `order:write`; pricing and closing are audited.
- No shopper or staff notification is sent when a quote is requested or priced (see Known gaps).

## Appearance, sections, navigation, region, headless

One storefront deployment serves every tenant, so a tenant's look and regional
rules are **data in `storefronts.settings`** (JSONB, no migration), never code.
Types and defaults: `packages/shared-types/src/storefront-appearance.ts`.
Shape rules: `apps/api/.../admin/appearance.dto.ts`. All of it is edited with
the existing `PATCH /storefront-admin/settings`, merged one level per block (arrays are
replaced wholesale), and published to the shop through `GET /content/store`
(theme, navigation, region, timezone) and `GET /content/home` (`sections`).

| Block | What a tenant controls | Guard rails |
|---|---|---|
| `theme` | preset, five colours (ink, accent, highlight, background, surface), font pair, radius, header / product-card / footer layout variants, favicon, share image, announcement bar, social links | colours are six-digit hex, fonts and layouts are closed enums the build ships, images are http(s) or site-relative, social links https only |
| `homeSections` | ordered list of `hero`, `trust_badges`, `categories`, `products`, `promo_banner`, `brands`, `banner_strip`, `rich_text`, `faq`, each with its own settings | max 20, unique ids, per-type strict schema, links are a site path or https URL, no HTML. Unknown types are skipped on render |
| `navigation` | extra header links, footer columns, legal links, footer note | max 12 links per list, 4 columns, same link rule |
| `region` | country, calling code, zone label ("Emirate", "Region"…), the delivery **zones**, tax labels, number-format locale | zone codes `[A-Z0-9_]{1,20}`, unique, 1–60 zones. Currency and timezone still come from the tenant's own settings |
| `headless` | on/off and the exact origins allowed to call the API from a browser | plan needs `apiAccess`; exact https origins (or `http://localhost`), no wildcards, max 10 |

**Zones.** The wire/DB field is still called `emirate` (`web_orders`,
`shopper_addresses`, shipping rates, branches). It now holds any zone code from
the tenant's `region.zones`; the UAE emirates are just the `AE` preset. Address,
checkout and quote schemas check the code against the shop's zones, and
`PATCH` refuses delivery rates or branches that name a zone the region lacks
(it never silently drops one). `setup` takes an optional `region` (a key of
`REGION_PRESETS`); omitted, it is inferred from the tenant's timezone, then
currency, then falls back to the UAE, and seeds one delivery rate per zone.

**Phone and tax id.** `shopperPhone` normalises to the shop's calling code
(UAE numbers keep the exact 8–9 digit rule; any other country 8–15 digits).
`shopperTaxId` is the strict 15-digit TRN for `AE` and a lenient 5–20
letters/digits elsewhere. Both read the region off the request context.

**Refresh.** A settings save moves `storefronts.updated_at`, which the
revalidation job turns into the `content` and `home` tags, so a theme change
reaches the shop within ~30 s.

**Headless.** See [HEADLESS.md](HEADLESS.md).

---

## Caching and refresh

Catalogue pages are cached by the storefront with tags (`product:<slug>`,
`category:<slug>`, `catalog`, `home`, `content`). Every 30 s the API looks at
`updated_at` on listings, products, variants, prices, inventory, categories,
brands, pages and banners. It POSTs the stale tags to the storefront's
`revalidateUrl`, authenticated with `STOREFRONT_REVALIDATE_SECRET`. Any write
path counts (till, admin, importer, a manual SQL fix), because a trigger
maintains `updated_at`. A missed push only means a page is stale until its
TTL; checkout always re-prices from the database.

## Rate limiting

All storefront traffic reaches the API from the storefront server. With
`STOREFRONT_PROXY_SECRET` set on both, the storefront names each shopper's IP
(`x-storefront-client-ip`) and proves itself (`x-storefront-proxy`), so limits
count shoppers. Cached catalogue reads carry the secret but no IP: Next keys
its fetch cache on headers, and a per-visitor header would defeat the cache.
Those reads are bounded by the cache instead. **Set the secret in production**,
or the whole shop shares one IP's limit.

---

## Running it locally

```bash
pnpm db:migrate
pnpm db:seed
# Put tenant devsfleet's shop on localhost:
pnpm db:seed:storefront -- --tenant devsfleet --domain localhost --site-url http://localhost:3002

pnpm --filter @devsfleet/api dev          # :3001
pnpm --filter @devsfleet/storefront dev   # :3002
pnpm --filter @devsfleet/admin dev        # :3000 → Online Store in the sidebar
```

`apps/storefront/.env.local` (copy `.env.example`) pins
`STOREFRONT_HOST=localhost`, since the browser's host is `localhost:3002`. For
card payments locally, start the API with `STOREFRONT_DEV_PAYMENTS=true`.

`db:seed:storefront` is idempotent and additive. Run it against a real tenant
to go live: it creates the storefront, attaches the domain, creates the
delivery line, and lists every active product that has no listing yet. It
never unpublishes or renames anything.

### Tests

```bash
pnpm --filter @devsfleet/api test                        # incl. storefront unit tests
pnpm --filter @devsfleet/storefront-client test          # compile-time API ⇄ website contract
pnpm --filter @devsfleet/storefront test:e2e             # Playwright, against a running stack
```

The contract test type-checks every storefront service's return type against
the types the website renders, so a change on either side fails the build.

## Going live for a tenant

1. Their plan must include `onlineStore` (trial, pro, enterprise).
2. Admin → Online Store → create the store with its domain, or run
   `db:seed:storefront`.
3. Point the domain's DNS at the platform. Caddy's catch-all issues the
   certificate on the first visit, after asking
   `/api/v1/storefront/domains/allowed` that the domain belongs to a live
   storefront.
4. Website Listings → publish products (or "Publish all unlisted").
5. Connect Stripe, set the webhook URL shown there, and tick card payments.

---

## Subdomain storefronts on the VPS

The VPS runs nginx + PM2 (`deploy/deploy.sh`), not the Caddy config, so a
tenant's free shop address is `<name>.devsfleet.com`, covered by **one wildcard
certificate**. One storefront process (PM2 `devsfleet-pos-storefront`, port
3002) serves every shop; nginx sends every `*.devsfleet.com` it doesn't have an
exact block for (`pos`, `pos-api`, `cdn`) to it, and the API picks the tenant
from the hostname.

**Platform subdomain rules.** With `STOREFRONT_BASE_DOMAIN=devsfleet.com` in
`apps/api/.env`, a storefront domain on that domain must be a single label of
3–40 characters (`a-z`, `0-9`, `-`), and the labels in `RESERVED_SUBDOMAINS`
(`apps/api/src/modules/storefront/platform-subdomain.ts` — `pos`, `pos-api`,
`api`, `cdn`, `www`, `admin`…) are refused. Add a label there BEFORE putting a
new platform site on the domain. Admin → Online Store offers a "Free shop
address" field with a live availability check
(`GET /storefront-admin/settings/subdomain-availability?label=`).

### One-time server setup

1. **DNS (Cloudflare).** Add a record `*` → the VPS's IPv4 (`A`) and, if it
   has one, IPv6 (`AAAA`), proxied. SSL/TLS mode: **Full (strict)**.
2. **Wildcard certificate.** The production VPS already has one: a
   Cloudflare Origin Certificate for `*.devsfleet.com, devsfleet.com` at
   `/etc/ssl/cloudflare/devsfleet.{pem,key}`, which every site on it uses and
   which `devsfleet-storefronts.conf` points at. Check a server with
   `openssl x509 -in /etc/ssl/cloudflare/devsfleet.pem -noout -ext subjectAltName`.
   It is trusted only by Cloudflare, so it needs the records proxied and SSL
   mode Full (strict). On a host without one — or for DNS-only records — issue
   a Let's Encrypt wildcard by DNS challenge (an HTTP challenge can't prove a
   wildcard) and change the two `ssl_certificate` lines to
   `/etc/letsencrypt/live/devsfleet.com/{fullchain,privkey}.pem`:
   ```bash
   sudo apt install python3-certbot-dns-cloudflare
   # Cloudflare → My Profile → API Tokens → Create token → "Edit zone DNS",
   # Zone Resources: Include → Specific zone → devsfleet.com
   sudo mkdir -p /root/.secrets
   echo 'dns_cloudflare_api_token = <TOKEN>' | sudo tee /root/.secrets/cloudflare.ini
   sudo chmod 600 /root/.secrets/cloudflare.ini
   sudo certbot certonly --dns-cloudflare \
     --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
     -d devsfleet.com -d '*.devsfleet.com' --cert-name devsfleet.com
   sudo certbot renew --dry-run   # renewal runs from certbot's own timer
   ```
3. **nginx:**
   ```bash
   sudo cp deploy/nginx/devsfleet-storefronts.conf /etc/nginx/sites-available/devsfleet-storefronts
   sudo ln -sf /etc/nginx/sites-available/devsfleet-storefronts /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
   If another enabled site already claims `*.devsfleet.com` or is the
   `default_server` for those names, remove that first (`nginx -t` warns about
   a conflicting server name).
4. **API env** — in `apps/api/.env`:
   ```
   STOREFRONT_BASE_DOMAIN=devsfleet.com
   STOREFRONT_PROXY_SECRET=<openssl rand -hex 32>
   STOREFRONT_REVALIDATE_SECRET=<openssl rand -hex 24>
   ```
5. **Storefront env:** `cp deploy/storefront.env.example apps/storefront/.env`
   and fill in the same two secrets (`STOREFRONT_PROXY_SECRET`,
   `REVALIDATE_SECRET`). Leave `STOREFRONT_HOST` and `NEXT_PUBLIC_SITE_URL`
   empty — either one pins every shop to one hostname.
6. **Deploy:** `./deploy/deploy.sh`. It builds and starts the storefront
   because `apps/storefront/.env` now exists, and checks it answers on :3002.

### Putting a tenant's shop on its address (e.g. Al Lahiq)

Preferred — **Admin**: sign in as the tenant (or impersonate it from Platform →
Tenants) → Online Store → Free shop address `allahiq` → Create online store.
Then Website Listings → publish products, Pages & Banners, payment settings.
The tenant's plan must include `onlineStore`.

Or on the VPS, from the repo:
```bash
DATABASE_URL_MIGRATOR=<migrator url> pnpm db:seed:storefront -- \
  --tenant al-lahiq-elect-sanitary-ware-trdg \
  --domain allahiq.devsfleet.com --site-url https://allahiq.devsfleet.com
```
That also publishes every unlisted product and adds starter pages, banners
**and two demo coupons** — delete the coupons (Online Store → Promo codes) on a
real shop. The script is an operator tool and does not apply the subdomain
rules; the admin path does.

Then open `https://allahiq.devsfleet.com`, and set the store's **Cache refresh
URL** to `https://allahiq.devsfleet.com/api/revalidate`.

### Custom domains later (shop.allahiq.ae)

nginx can't issue a certificate per tenant domain on demand. Two ways, when a
tenant wants their own domain:

- **Cloudflare for SaaS (custom hostnames)** — recommended while DNS is on
  Cloudflare: the tenant points a CNAME at a fallback origin on
  devsfleet.com, Cloudflare issues and renews their certificate, and the
  request arrives here with the tenant's Host, which the wildcard-style
  routing already handles. Needs a catch-all nginx server for those hosts.
- **Caddy** (`deploy/Caddyfile`) with on-demand TLS, which already asks
  `/api/v1/storefront/domains/allowed` before issuing — replaces nginx.

**Known gap — domain ownership isn't verified.** Any tenant can attach any
hostname outside the platform domain; uniqueness is the only check, so a
tenant could squat a domain another business will want. Add a DNS TXT
verification step before custom domains are offered widely.

---

## Known gaps

- **No shopper notifications.** Order confirmation, dispatch and ready-for-
  pickup emails and WhatsApp messages are not sent yet. The same goes for
  back-in-stock alerts (recorded, not sent) and for quote requested / quoted. The timeline is
  visible on the tracking page and the account area.
- **Fixed-amount coupons** are refused online (see Money above).
- **Tabby / Tamara** are not integrated.
- **Courier APIs** are not integrated; staff add the tracking number by hand.
- **Payment credentials are plaintext** in `storefront_payment_accounts`, the
  same known gap as `whatsapp_accounts`.
- **Theming** is name, tagline and logo per tenant; colours and fonts are the
  storefront's own.
- Settings changes reach shoppers within a minute: the API caches resolved
  storefronts for 60 s.
