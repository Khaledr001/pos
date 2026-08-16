/**
 * Bulk product importer — Phase 1.
 *
 * Scaffold. Do not finish this before running `profile.ts` against the real
 * price list: the column mapping below is a guess until that output exists, and
 * writing it from a guess means importing 5,000 products twice.
 *
 *   pnpm --filter @devsfleet/import import -- "/path/to/list.xlsx" --dry-run
 *
 * Requirements this must satisfy, all of them learned the expensive way:
 *
 *  1. DRY RUN FIRST, always. Report what would change — created, updated,
 *     price-changed, skipped, rejected — and write nothing until `--commit`.
 *
 *  2. IDEMPOTENT on SKU. Re-importing the same file changes nothing. This is
 *     what makes "fix three rows in Excel and re-run" a safe operation rather
 *     than a duplication event.
 *
 *  3. PRICE CHANGES ARE HISTORY. Never UPDATE a `product_prices` row. Close the
 *     current one with `effective_to = today`, insert a new one, and write a
 *     `price_history` entry tagged with this batch id. Last year's invoices must
 *     still reprice correctly.
 *
 *  4. VALIDATE THE WHOLE FILE, THEN WRITE. Collect every row error and report
 *     them together. Aborting on row 3,847 after committing 3,846 leaves the
 *     catalogue in a state nobody can reason about.
 *
 *  5. REPORT DUPLICATES rather than silently keeping the last one. The same SKU
 *     twice in one sheet with two different prices is a question for the person
 *     who produced the file, not something to resolve by row order.
 *
 *  6. NORMALISE with `searchKey()` and `normalizeBarcode()` from
 *     @devsfleet/shared-utils, so `3/4"` and `3/4 inch` land on one product.
 *
 *  7. CHUNK the writes (~500 rows per transaction). One transaction over 5,000
 *     rows holds locks long enough to stall the POS terminals.
 */
import { config } from "dotenv";
import { resolve } from "node:path";

config({ path: resolve(process.cwd(), "../../.env") });

console.error(
  [
    "The product importer is not implemented yet.",
    "",
    "Run the profiler against the real price list first:",
    '  pnpm --filter @devsfleet/import profile -- "/path/to/price-list.xlsx"',
    "",
    "Then finalise packages/db/src/schema/catalog.ts against its output and",
    "implement this file. See the header comment for the required behaviour.",
  ].join("\n"),
);

process.exit(1);
