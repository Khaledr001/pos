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
