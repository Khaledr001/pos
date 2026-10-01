# Al-Lahiq — Building Materials Online Store (UAE)

## Context
The owner runs a building materials shop in the UAE (hardware, electrical, sanitary ware) and wants a full online store. What we know so far:
- **Market:** UAE. Prices in AED, 5% VAT, tax invoices must show the shop's TRN.
- **Language:** English only.
- **Selling:** full e-commerce with cart, checkout, online payment and cash on delivery (COD).
- **Fulfilment:** a courier partner delivers parcels, and customers can also pick up in store (click & collect).
- **Back office:** the owner is building their **own POS**. The POS will be the source of truth for SKUs, prices and stock. The website syncs with it.

**Architecture:** there are two apps.
- `al-lahiq/frontend`: **Next.js**, used for the storefront and the admin interface.
- `al-lahiq/backend`: a **NestJS** API that owns all business logic, the database, integrations with outside services, and background jobs.

The frontend never touches the database directly. Everything goes through the NestJS API.

Current code: `al-lahiq/frontend` is a fresh Next.js 16.3 + React 19 + Tailwind 4 scaffold (pnpm). Nothing is built yet, and `backend/` doesn't exist yet. Per `AGENTS.md`, read `node_modules/next/dist/docs/` before writing any frontend code, because Next 16 changes some APIs.

## Implementation status (30 Sep 2026)
Phase 0 and Phase 1 are built:
- **Backend** (`backend/`): catalog, search, pricing engine (price lists, quantity breaks, units, trade and promo prices), stock with safety buffer, cart, checkout (courier by emirate and weight, store pickup slots, COD and card), orders with the status workflow, tax invoice PDFs, promotions, notifications (email/WhatsApp adapters), customer accounts, content, the full admin API, and POS sync (signed webhooks, versioned updates, outbox with retries, nightly reconciliation). Seeded with a realistic demo catalog.
- **Frontend** (`frontend/`): storefront (home, departments, brands, search, product pages with the tile calculator, cart, checkout, test payment page, order tracking, account area, content pages, sitemap) and the admin panel.
- **Tests**: backend unit and e2e tests, the API contract test, and Playwright browser tests.

Known small gaps (next iteration): customers can't change their email; uploaded files can't be deleted; staff can be deactivated but not deleted; the admin order timeline shows "Staff member" instead of names; order tab counts ignore search filters; the POS connection page doesn't show the age of the oldest waiting event; settings values are type-checked in the admin UI only.

Still to connect or do before launch: real Stripe (or another UAE gateway) keys, a courier API adapter (Aramex/Quiqup; staff enter tracking numbers today), Resend and WhatsApp credentials with approved message templates, S3 storage for uploads, Sentry, product photos, and the POS side of the integration (`docs/pos-integration.yaml`).

---

## Feature List

### A. Storefront (customer-facing)
1. **Home page:** hero banners and offers, shop by category (Hardware / Electrical / Sanitary / Tools / Paints / Plumbing), featured brands, best sellers, new arrivals, trust badges (genuine products, VAT invoice, pickup available).
2. **Category and product listing:** multi-level categories, for example Electrical → Cables → Single-core. Filters for brand, price, size, colour, material, wattage, voltage, gauge and in-stock. Sorting options, and grid or list view.
3. **Search:** instant search as you type, with typo tolerance. Searches by SKU, model number or brand, and understands synonyms (e.g. "tap" = "faucet" = "mixer").
4. **Product page:**
   - Variants such as size, colour or length, each with its own SKU, price and stock
   - **Unit of measure:** per piece, metre, roll, box, bag or m²
   - **Tier and bulk pricing**, e.g. 1–9 pcs @ X, 10+ @ Y
   - Spec table plus downloadable datasheets and installation PDFs
   - Image gallery with zoom
   - Stock status shown per branch
   - "Frequently bought together" suggestions (pipe + fittings + solvent), related and alternative products
   - **Shipping badge:** "Courier" or "Pickup only" for heavy or bulky items such as cement, rebar or large sheets
5. **Quantity calculators:** tiles (m² → boxes, plus a wastage %), paint (m² → litres), cable (metres → rolls) and grout/adhesive.
6. **Brand pages:** a listing and description page for each brand (e.g. Grohe, RAK, Schneider, Legrand, Bosch, Makita).
7. **Cart:** mini-cart and full cart. Shows the VAT breakdown, delivery estimate and any pickup-only warnings. Customers can save the cart for later.
8. **Checkout:**
   - Guest checkout or login
   - Address with emirate/area and a map pin
   - Delivery method: courier (rate by emirate and weight) or store pickup (choose branch and time slot)
   - Payment by card or Apple Pay / Google Pay, **Tabby / Tamara** (buy now, pay later) or **COD** (with a limit)
   - Promo codes
   - Optional company name and TRN field, for a B2B tax invoice
9. **Customer account:** order history and tracking, **one-click reorder**, saved addresses, wishlist and **project lists** (e.g. "Villa bathroom"), and downloadable VAT invoices.
10. **Order tracking page:** status timeline (Placed → Confirmed → Packed → Shipped/Ready for pickup → Delivered). Includes the courier tracking link.
11. **Content and trust pages:** About, branches with Google Maps and opening hours, Contact, FAQ, Delivery & Returns, Warranty, Privacy, Terms. Also a blog or DIY guides, which help SEO.
12. **Notifications:** email, SMS and WhatsApp messages for order confirmation, dispatch, ready-for-pickup and delivery.
13. **WhatsApp chat button:** a floating button, plus "Ask about this product" on each product page.

### B. Trade / Contractor features (Phase 2)
1. Trade account application. The admin approves it and sets a price tier.
2. Customer-specific or tier pricing, received from the POS.
3. **Bulk quote request:** upload a BOQ (Excel/CSV) or build a list. The admin sends back a quote, which the customer converts into an order.
4. Credit terms, i.e. pay on invoice, with a credit limit tracked in the POS.
5. Quick order form: type SKUs and quantities to add them to the cart.

### C. Admin panel (website side)
The POS owns price and stock. The website admin owns **content and online operations**:
1. Product content: rich descriptions, images, datasheets, SEO title and meta, category mapping, "pickup only" flag, related products.
2. Categories, brands, filters and attributes.
3. Orders: view, confirm, print packing slip, book the courier, mark ready for pickup, cancel/refund. Status changes are pushed back to the POS.
4. Customers and trade account approval.
5. Promotions: coupon codes, flash sales, free-shipping threshold.
6. Banners and homepage sections, CMS pages, blog.
7. Delivery settings: courier rates by emirate and weight, pickup branches and time slots, COD limit.
8. Reports: sales, top products, abandoned carts, search terms with no results.
9. **Sync monitor:** last sync time, failed events, a "resync now" button.
10. Staff roles: Owner, Manager, Order staff, Content editor.

### D. Platform / non-functional
- SEO: server-rendered pages, `schema.org` Product and Offer markup, sitemap, clean URLs, Open Graph images, Google Merchant Center feed.
- Performance: optimised images through `next/image`, cached catalog pages, Core Web Vitals green on mobile.
- Mobile-first design, since most UAE shoppers browse on phones.
- Analytics: GA4 and Meta Pixel with e-commerce events.
- Security: rate limiting, CSRF protection and input validation. Card data stays with the payment provider (PCI SAQ-A).
- Compliance: 5% VAT on invoices with the shop's TRN, UAE PDPL privacy notice, cookie consent. **Also check whether the UAE's upcoming e-invoicing mandate applies to your turnover.** The invoice generator should be easy to extend if it does.

---

## System Architecture
```
 Browser ──► Next.js frontend (storefront + admin UI)
                 │  typed REST client (generated from OpenAPI)
                 ▼
             NestJS backend API ──► PostgreSQL (Prisma)
                 │   ▲                Redis (cache, queues, rate limits)
                 │   │                Meilisearch (product search)
   outbox queue  │   │ signed webhooks
                 ▼   │
               Your POS system
                 │
 NestJS also talks to: payment gateways, courier APIs, email/SMS/WhatsApp, file storage
```
- **Frontend (Next.js):** only handles screens, SEO and caching. It gets all its data from the NestJS API. It holds no business rules, has no database access and keeps no secrets except the revalidation secret.
- **Backend (NestJS):** the single source of logic.
  - Owns pricing, stock, cart, checkout, orders, VAT invoices and POS sync.
  - Receives webhooks from payment gateways, couriers and the POS.
  - Runs background jobs.
- **The POS never talks to Next.js.** It only talks to the NestJS backend.

---

## POS ↔ Website Integration (you build both sides)
**Principle:** the POS is the master for SKU, price and stock. The website is the master for content and online orders. Records are matched on **SKU**. The NestJS `PosSyncModule` handles all of it.

**POS → NestJS** (`POST /api/v1/pos/webhooks`: signed webhooks, plus REST for pulling full snapshots):
- `product.upsert`: SKU, name, barcode, unit, VAT class, weight, active flag
- `stock.updated`: SKU, branch, quantity available
- `price_list.upserted`, `price_items.changed`, `customer_price_list.assigned`

**NestJS → POS** (sent from a queue):
- `order.created`: lines, prices, totals, payment status, delivery method. The POS reserves or deducts stock.
- `order.status_changed`, `order.cancelled`, `refund.created`

**How NestJS handles incoming webhooks:**
1. Start the app with `NestFactory.create(AppModule, { rawBody: true })`. The raw request body is needed to check signatures.
2. `PosSignatureGuard` checks the HMAC-SHA256 signature and timestamp headers, and rejects stale or replayed requests.
3. The controller saves the event in `inbound_events` with a **unique `event_id`**, so a duplicate is ignored, then responds **202** right away.
4. A BullMQ worker (`pos-inbound` queue) processes the event and updates the tables. It ignores events whose `version` is older than what's stored.
5. After the change, NestJS calls the frontend's `POST /api/revalidate` with a secret and cache tags (e.g. `sku:ABC123`). Next.js then refreshes those pages.

**How NestJS sends events (transactional outbox):**
1. The order and its `outbox_events` row are written in **one Prisma transaction**, so an order can't be saved without its event.
2. The `pos-outbox` BullMQ worker sends pending events to the POS, with exponential backoff retries. Events that keep failing go to a dead-letter list, which appears on the admin sync monitor.

**Reconciliation:**
- An `@nestjs/schedule` cron job runs nightly. It pulls a full product, stock and price snapshot from the POS, fixes anything that doesn't match, and writes the results to `sync_log`.
- Stock is re-checked at checkout. Online stock = POS stock minus a safety buffer, so an item sold in-store can't also be sold online.

**Contract:** write it once as an OpenAPI spec (`docs/pos-integration.yaml`), and build both the POS and the NestJS module against it.

---

## Price List Handling
**Rule:** all prices are created and edited **only in the POS**. NestJS keeps a read-only copy of the price lists in PostgreSQL and works out prices from that copy. The website never changes a price.

**Price list tables (the same in the POS and the NestJS copy):**
```
price_lists       id, code, name, type(retail|trade|promo), channel(all|pos|online),
                  priority, valid_from, valid_to, active, version, updated_at
price_list_items  price_list_id, sku, uom, min_qty, net_price_fils, updated_at
                  UNIQUE(price_list_id, sku, uom, min_qty)
customer_price_lists  customer_id, price_list_id      -- trade/contract customers
products          sku, vat_class(standard_5|zero|exempt), base_uom, uom_conversions
```
- Store money as **integer fils** (1 AED = 100 fils). This avoids rounding errors.
- Store prices **without VAT**. The API returns both net and VAT-inclusive prices, because UAE rules require customer-facing prices to include VAT.
- `min_qty` rows give quantity breaks, e.g. 1+ = 12.00, 10+ = 11.00, 50+ = 10.00.
- Units: a SKU can have a separate price per unit (e.g. per piece and per box). Otherwise price by the base unit × a conversion factor.

**How a price is chosen:** `PricingService.getPrice(sku, uom, qty, customerId?, at?)`, in the `PricingModule`:
1. Collect the lists that apply: the **Retail** base list, the customer's assigned trade lists, and any **promo** list whose dates are active. Only include lists with channel `all` or `online`.
2. In each list, take the row for that SKU and unit with the highest `min_qty` that is ≤ qty.
3. Return the **lowest** of those prices, plus the retail price so the frontend can show it crossed out.
4. Add VAT from the product's `vat_class`. Round each line to 2 decimals.

Active price lists are cached in Redis. When a price webhook arrives, that cache entry is cleared.

**Checkout and orders:**
- `CheckoutService` recalculates every line with `PricingService`. If a price changed since the item went into the cart, the API returns `409 PRICE_CHANGED` with the new prices, and the frontend shows them before the customer pays.
- Each `order.created` event sent to the POS carries `unit_net_price`, `price_list_id` and `price_version` for every line. The POS **accepts the price the website charged** and does not recalculate it. That way the paid amount and the POS invoice always match.
- Coupons and cart-level discounts are handled by NestJS (`PromotionsModule`). They reach the POS as a separate discount line on the order.
- Online-only prices are set up in the POS as a price list with channel = `online`, so the POS still controls them.

**Caching:**
- Public catalog endpoints return the retail price. Next.js caches those pages and refreshes them by tag when prices change.
- Trade customers' prices come from authenticated endpoints and are fetched per request. They are never cached for everyone.

---

## Recommended Tech Stack
| Layer | Choice |
|---|---|
| Frontend | Next.js 16 (App Router, Server Components) + TypeScript + Tailwind 4, in the existing `al-lahiq/frontend` |
| Backend | **NestJS 12** (ESM) + TypeScript, in `al-lahiq/backend`. REST API under `/api/v1`, with OpenAPI docs via `@nestjs/swagger` at `/api/docs` |
| Validation | `class-validator` / `class-transformer` DTOs, plus a global `ValidationPipe` (whitelist, forbidNonWhitelisted) |
| DB / ORM | PostgreSQL + **Prisma 7** (driver adapter `@prisma/adapter-pg`) |
| Cache & queues | Redis + **BullMQ**, through a small `JobsService` (jobs run inline when `QUEUES_ENABLED=false`, e.g. in tests). Scheduled jobs with `cron` + Redis locks |
| Auth | JWT guards on `@nestjs/jwt` (no Passport). A 15-minute access token and a rotating refresh token (reuse revokes the session family), both httpOnly cookies. Separate cookies for customers and staff. `@Roles()` for staff roles. The Next.js proxy renews expired sessions on page loads. Phone OTP login later |
| Rate limiting | `@nestjs/throttler` (in-memory per instance; switch to Redis storage when running several instances) |
| Search | PostgreSQL `pg_trgm` (typo tolerant) + admin-editable synonyms and fuzzy synonym correction, behind a `SearchEngine` interface so Meilisearch can be added later |
| Payments | **Stripe** or **Checkout.com / Telr / Network International** for card, Apple Pay and Google Pay. Plus Tabby, Tamara and COD. Each sits behind a `PaymentProvider` interface |
| Courier | Aramex / Quiqup / Jeebly API, behind a `ShippingProvider` interface |
| Media | `StorageService`: local `uploads/` served at `/uploads` today; swap the driver for S3/Cloudinary in production |
| Email/SMS/WA | Resend (email), WhatsApp Business Cloud API, SMS gateway. Sent through the `notifications` queue |
| PDF invoices | Generated on demand in NestJS with `pdfmake`; invoice numbers issued when the order is placed |
| API client | `packages/api-client`: shared response types + a small fetch client. A compile-time **contract test** checks every backend response type against it, so the two apps can't drift |
| Logging | `nestjs-pino` (cookies and auth headers redacted). Sentry still to add |
| Hosting | Docker images for both apps (`docker-compose.yml`), Postgres and Redis, in a UAE region (e.g. AWS me-central-1) |
| Testing | Backend: Vitest (Nest 12 default) + Supertest against a real test database and a mock POS server. Frontend: Playwright with the system Chrome. CI in GitHub Actions |

---

## Project Structure
The project is a pnpm workspace at `al-lahiq/`:
```
al-lahiq/
├── pnpm-workspace.yaml          # frontend, backend, packages/* (move from frontend/)
├── docker-compose.yml           # postgres, redis, meilisearch for local dev
├── docs/pos-integration.yaml    # POS contract (OpenAPI)
├── packages/api-client/         # generated typed client from backend Swagger
├── frontend/                    # Next.js
│   ├── app/(store)/             home, category/[...slug], product/[slug], brand/[slug],
│   │                            search, cart, checkout, account/*, track
│   ├── app/(admin)/admin/*      dashboard, products, orders, customers, promotions, settings, sync
│   ├── app/api/revalidate/      called by backend with secret → revalidateTag
│   ├── lib/api.ts               wraps api-client, forwards auth cookies
│   └── components/              ProductCard, Filters, PriceTiers, UnitSelector, Calculator…
└── backend/                     # NestJS
    ├── prisma/schema.prisma
    └── src/
        ├── main.ts              rawBody, global ValidationPipe, filters, Swagger, helmet, CORS
        ├── config/              env schema, validated at boot
        ├── common/              guards (Jwt, Roles, PosSignature), filters, interceptors, decorators
        ├── prisma/              PrismaService
        └── modules/
            ├── auth/            login, register, refresh, OTP, staff roles
            ├── customers/       profile, addresses, trade applications
            ├── catalog/         products, variants, categories, brands, attributes, media
            ├── search/          Meilisearch sync + query endpoint
            ├── pricing/         PricingService, price lists (read-only mirror)
            ├── inventory/       stock levels per branch, safety buffer, reservation
            ├── cart/            cart, saved carts, project lists, wishlist
            ├── checkout/        re-pricing, stock check, delivery options, place order
            ├── orders/          lifecycle, tracking, reorder, admin actions
            ├── payments/        PaymentProvider adapters + webhook controller
            ├── shipping/        ShippingProvider adapters, rates by emirate/weight, pickup slots
            ├── invoices/        VAT calc, TRN, tax invoice PDF
            ├── promotions/      coupons, flash sales, free-shipping rules
            ├── content/         pages, banners, blog
            ├── notifications/   email / SMS / WhatsApp templates + queue
            ├── pos-sync/        webhook controller, inbound processor, outbox, reconciliation cron
            ├── reports/         sales, top products, abandoned carts, failed searches
            └── health/          @nestjs/terminus checks (db, redis, meilisearch)
```
Core tables in the Prisma schema:
- **Catalog and pricing:** `products`, `variants`, `categories`, `brands`, `attributes`, `stock_levels` (per branch), `price_lists`, `price_list_items`, `customer_price_lists`
- **Customers and orders:** `customers`, `staff_users`, `addresses`, `carts`, `cart_items`, `orders`, `order_lines`, `payments`, `shipments`, `invoices`, `coupons`
- **Content:** `pages`, `banners`
- **Sync:** `inbound_events`, `outbox_events`, `sync_log`

**API conventions:**
- All routes are under `/api/v1`. Public routes: `/catalog`, `/search`, `/cart`, `/checkout`. Customer routes: `/me/*`. Admin routes: `/admin/*`, protected by `RolesGuard`.
- Every error uses the same shape: `{ code, message, details }`.
- Money is always returned as integer fils, alongside a formatted string.

---

## Delivery Phases
**Phase 0 — Foundation:**
- pnpm workspace and docker-compose
- NestJS skeleton: config validation, Prisma, Swagger, auth, health checks
- Generated API client, CI running lint + test + build on both apps

**Phase 1 — MVP (launch):**
- Catalog, search, product pages with units and variants
- Cart and checkout (card, Apple Pay, COD), courier + pickup
- Customer accounts and order tracking, VAT invoice PDF
- Admin: content, orders, delivery settings, sync monitor
- POS sync: products, stock, price lists and orders (inbound webhooks, outbox, reconciliation)
- Email and WhatsApp notifications, SEO basics, analytics

**Phase 2 — Growth:**
- Trade/contractor accounts and tier pricing, BOQ quote requests, quick order
- Tabby/Tamara, promotions engine, reviews and ratings, quantity calculators
- Blog/DIY guides, Google Merchant feed, abandoned cart recovery

**Phase 3 — Scale:**
- Credit terms, multi-branch stock routing, loyalty points
- PWA / mobile app. The same NestJS API serves it.
- Arabic (RTL), if needed later. Keep all text in translatable strings from day 1 so it's cheap to add.

---

## Verification
- `pnpm -r lint`, `pnpm -r test` and `pnpm -r build` pass for both apps.
- **Backend unit tests (Jest):**
  - `PricingService`: quantity breaks, trade versus promo prices, channel filtering, date windows, VAT rounding
  - VAT invoice totals: line totals + 5%, with the TRN shown
  - Outbox retry logic
- **Backend e2e tests (Supertest + Testcontainers):**
  - A POS webhook with a bad signature is rejected with 401
  - A duplicate `event_id` is ignored
  - An older `version` is ignored
  - Checkout returns `409 PRICE_CHANGED` when a price has changed
  - A placed order creates an outbox event
  - The reconciliation job fixes stock and price drift against a mock POS server
- **Frontend Playwright e2e tests:** browse → filter → add to cart → checkout for each method (card in test mode, COD, pickup), plus order tracking, reorder and an admin order update.
- **Revalidation:** a price webhook shows up on the cached product page within seconds.
- **Performance:** Lighthouse mobile scores ≥ 90 for performance and SEO on the home, category and product pages.
