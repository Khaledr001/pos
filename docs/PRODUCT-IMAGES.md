# Product images without photographing anything

Goal: give the catalogue photos while a person stays in control of every
image that is published. Products with no image keep the department-icon
placeholder (`apps/storefront/lib/department-icon.ts`).

```
 finder CLI ──candidates (links only)──▶ product_image_candidates ─┐
                                                                   ├─ admin "Image review" ─approve─▶ product_images ─▶ storefront
 supplier pack ──import-pack --apply (high confidence only)────────┘            (download, dedup, attribution)
```

## 1. Find candidates

`pnpm --filter @devsfleet/images run find -- --sheet "AL lahiq Products.xlsx"`
(setup, keys, flags: [tools/images/README.md](../tools/images/README.md)).
It reads products from the API, searches the web through a pluggable provider
(Brave or SerpAPI), scores, and submits up to 5 candidates per product to
`POST /product-image-candidates/bulk`. Submitting is idempotent: the table is
unique on (tenant, product, image URL), so a re-run adds only new URLs and never
resets a decision. The server derives the source domain from the page URL itself.

## 2. Review

Admin panel > Products > **Image Review** (`/products/image-review`). Left: products
that still need a decision, with filters (search, category incl. sub-categories,
brand, "only products with no image") and a progress bar. Right: the candidate
photos with source domain, "Open source page", size and score.

Keys: Up/Down (or j/k) product, Left/Right or 1-9 photo, Enter approve, R reject
the photo, X reject all ("none of these"), S skip. Viewing needs `product:read`;
deciding needs `product:write`, enforced by the API as well as the buttons.

API (all under `/product-image-candidates`):

| Route | Permission | Does |
|---|---|---|
| `POST /bulk` | `product:write` | submit candidates (idempotent) |
| `GET /` | `product:read` | products with candidates (`status`, `categoryId`, `brandId`, `q`, `onlyWithoutImage`, paging) |
| `GET /summary` | `product:read` | counts for the progress bar |
| `POST /:id/approve` | `product:write` | download, store, attach |
| `POST /:id/reject` | `product:write` | reject one |
| `POST /products/:productId/reject-all` | `product:write` | reject every pending candidate of a product |

Approve fetches the image on the server, then calls the **existing**
`ProductsService.addImage`, so SHA-256 dedup per tenant, the 5 MB cap, and "the
first image becomes primary (and `products.imageUrl`)" are the same as a manual
upload. If the product already has a primary image the new one is added but
not made primary. Other pending candidates stay pending. If the same bytes are
already attached to a different product the approval is refused (`DUPLICATE_IMAGE`).
A failed download leaves the candidate pending and the screen shows why.

## 3. Supplier packs

Ask brands for official photos ([supplier-image-request.md](supplier-image-request.md)),
then `import-pack` (dry run first, report in `image-pack-report/`). Only high
confidence matches upload with `--apply`; size tokens are hard constraints.

## Attribution

Every approved or imported image stores `product_images.source` (domain or
"Supplier pack: brand (folder)") and `source_url` (the page it came from).
Candidates are third-party material: the shop owner is responsible for having
the right to use them, and brand or manufacturer sources with written
permission are the safe choice.

## SSRF rules for the approve download

The URL is attacker-influenced (it came from a web search), so
`product-image-candidates/ssrf-guard.ts` and `image-fetcher.ts` enforce:

- `https` only, no `user:pass@`, port 443 only, no `localhost`/`.local`/`.internal` names.
- DNS is resolved by us and **every** returned address must be public. Blocked:
  0/8, 10/8, 100.64/10, 127/8, 169.254/16 (cloud metadata), 172.16/12,
  192.168/16, 198.18/15, documentation and multicast ranges, `::1`, `::`,
  `fc00::/7`, `fe80::/10`, and IPv4 hidden inside IPv6 (`::ffff:a.b.c.d`,
  NAT64, 6to4). Numeric host tricks (`2130706433`, `0x7f.0.0.1`) are normalised
  before the check.
- The socket is **pinned** to the validated address (no second DNS lookup, so no
  DNS rebinding); TLS still verifies the certificate for the original host name.
- Redirects are followed manually, at most 3, and each hop goes through the same
  checks.
- 15 s timeout per hop, 5 MB cap (counted while streaming, not just by header),
  `Content-Type` must be JPEG/PNG/WebP **and** the magic bytes must agree (the
  stored type is the sniffed one), no cookies, no credentials, no referer.
- Failures surface as `IMAGE_URL_BLOCKED`, `IMAGE_FETCH_FAILED`, `IMAGE_TOO_LARGE`
  or `IMAGE_TYPE_UNSUPPORTED`.

The thumbnails the review screen shows are loaded **by the reviewer's browser**
directly from the third-party host (`referrerPolicy="no-referrer"`); the server is
not involved until approval.

## Data

Migration `0004_product_image_candidates.sql`: table `product_image_candidates`
(tenant-scoped, RLS applied by `pnpm db:migrate`) and nullable `source` /
`source_url` on `product_images`.
