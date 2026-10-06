# @devsfleet/images

Two command-line tools that get product photos into the catalogue without
anyone photographing anything. Full flow: [docs/PRODUCT-IMAGES.md](../../docs/PRODUCT-IMAGES.md).

| Tool | What it does | Writes |
|---|---|---|
| `find` | Searches the web for each product, scores the results, submits the best ~5 as **candidates** | `product_image_candidates` (links only) |
| `import-pack` | Matches a supplier's folder of images to products; `--apply` uploads the confident matches | `product_images` (real uploads) |

Nothing is ever published automatically by `find`: a person approves each photo
in the admin panel (Products > Image Review).

## Set up once

```bash
export PATH="$HOME/.nvm/versions/node/v24.11.1/bin:$PATH"
pnpm install                       # registers this package

# API login the tools use (the same account you use in the admin panel;
# it needs product:read and product:write)
export DEVSFLEET_API_URL=http://localhost:3001/api/v1   # default
export DEVSFLEET_EMAIL=admin@devsfleet.com              # default
export DEVSFLEET_PASSWORD='...'                         # required
export DEVSFLEET_TENANT=<slug>                          # only if your login needs it
```

The API must be running and migrated (`pnpm db:migrate`).

### Getting a search key

**Brave (default)**: create an account at <https://api-dashboard.search.brave.com>,
subscribe to a Search plan (there is a free tier; check the dashboard for
the current plans), create an API key, then `export BRAVE_SEARCH_API_KEY=...`.

**Serper.dev (default, free to start)**: sign up at <https://serper.dev>, copy the key, add `SERPER_API_KEY=...` to `.env`. About 2,500 free searches at sign-up, no card. Response fields were taken from third-party docs, not tested live.

**SerpAPI (alternative)**: sign up at <https://serpapi.com>, copy the key from
the dashboard, `export SERPAPI_KEY=...`, and pass `--provider serpapi`.

With no key the tool stops immediately and prints these instructions.

## Find candidates

```bash
# Note: `pnpm find` alone is a pnpm built-in (search), so use `run find`.
pnpm --filter @devsfleet/images run find -- --sheet "AL lahiq Products.xlsx" --limit 10 --dry-run
pnpm --filter @devsfleet/images run find -- --sheet "AL lahiq Products.xlsx"
```

| Flag | Meaning |
|---|---|
| `--sheet <xlsx>` | The price list; fills in brand/sub-category the catalogue lacks. Optional. |
| `--limit N` | Search only the first N products (try 10 first). |
| `--dry-run` | Search and print, submit nothing. |
| `--provider serper\|brave\|serpapi` | Default `serper` (free credits, no card; key in `SERPER_API_KEY`). Brave ended its free tier in Feb 2026. |
| `--include-with-image` | Also search products that already have an image (default: only products without one). |
| `--reset-progress` | Forget which products were already submitted. |
| `--cache-dir`, `--interval-ms` | Where responses are cached (default `.cache/images`), pause between calls (default 1100 ms). |

How it behaves:

- **Queries**: the name is cleaned with a small explicit typo dictionary
  (`src/query.ts`, e.g. `haed` -> `head`), "Placed in ..." notes are dropped, then
  it tries `brand + name`, then `name`, stopping once 3 usable results exist.
- **Scoring** (`src/scoring.ts`): brand/retailer domains up; stock-photo
  (watermark) sites and social media down; images under 400 px dropped; square
  preferred; words and sizes in the title compared with the product (a 18 inch
  fan photo for a 16 inch fan is penalised). Top 5 kept, max 2 per site.
- **Cost control**: every provider response is cached on disk by query, so
  re-runs and resumes are free. Progress is saved per product, so an
  interrupted run resumes where it stopped. Calls are spaced out and retried
  with back-off on HTTP 429/5xx (honouring `Retry-After`). A 401/402/403
  (bad key, quota used up) stops the run.
- **No image bytes** are downloaded and no third-party web pages are fetched
  (so there is no robots.txt to honour here); it only calls the search API and
  sends URLs plus attribution to the DevsFleet API. The server downloads a photo
  only when a person approves it.

### What was verified and what was assumed

Verified against the providers' public documentation: the Brave endpoint
(`https://api.search.brave.com/res/v1/images/search`), the `X-Subscription-Token`
header, `count` (default 50, max 200), `safesearch`, and that results carry the
original image URL plus width/height in `properties`; and SerpAPI's
`engine=google_images` with `original`, `original_width/height`, `thumbnail`, `link`.

**Assumed, not verified** (no key was available, so nothing was run live):
the exact name of the source-page field in a Brave image result (`url`), the
current free quota and price per 1,000 queries of either service (look at the
provider's pricing page before a full run), and rate limits (the default
1.1 s spacing suits a 1 request/second plan). A full pass over ~365 products
makes roughly 365 to 730 searches (one or two queries each), and `--limit 10`
is the cheap way to check quality first.

## Import a supplier pack

```bash
pnpm --filter @devsfleet/images run import-pack -- --dir ~/Downloads/modi-pack --brand modi          # dry run + report
pnpm --filter @devsfleet/images run import-pack -- --dir ~/Downloads/modi-pack --brand modi --apply  # upload HIGH matches
```

Writes `image-pack-report/report.html` and `report.csv`. Matching: exact SKU in
the file name first, then word similarity (forgives typos and word order, adds
the brand when `--brand` is given). **Sizes such as 20mm, 1.5mm, 16 inch must
be identical** or the product is not a candidate, so a 20mm photo cannot land
on a 25mm product. Only `high` confidence is uploaded; `medium`, `low`,
`ambiguous` and `unmatched` stay in the report for manual handling (upload in
the admin panel). Re-running is safe: the server skips an identical file by
checksum. Files over 5 MB are skipped.

## Copyright

Candidates come from third-party websites. A photo being findable does not
mean you may use it. **The shop owner is responsible for having the right to
publish each photo.** Prefer manufacturer and brand sources and ask permission
(see [docs/supplier-image-request.md](../../docs/supplier-image-request.md));
avoid stock-photo sites. The source domain and page are stored on every
approved image (`product_images.source`, `source_url`) so you can show where it
came from, credit it, or remove it on request.

## Tests

```bash
pnpm --filter @devsfleet/images test
```
