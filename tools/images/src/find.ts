/**
 * Candidate finder.
 *
 *   pnpm --filter @devsfleet/images find -- --sheet "AL lahiq Products.xlsx" [--limit N] [--dry-run] [--provider serper|brave|serpapi]
 *
 * Reads products from the API, searches the web for each, scores the hits and
 * submits the best few (URL + attribution only, never image bytes) to
 * POST /product-image-candidates/bulk for a human to review in the admin panel.
 */
import { config as loadEnv } from "dotenv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ApiClient, configFromEnv, type ApiProduct, type CandidateSubmission } from "./api-client.js";
import { BraveProvider } from "./providers/brave.js";
import { CachedProvider } from "./providers/cache.js";
import { SerperProvider } from "./providers/serper.js";
import { SerpApiProvider } from "./providers/serpapi.js";
import { ProviderConfigError, ProviderFatalError, type ImageSearchProvider } from "./providers/types.js";
import { buildQueries } from "./query.js";
import { pickTop, scoreHit, type ScoredHit } from "./scoring.js";
import { readSheet, type SheetRow } from "./sheet.js";
import { normalizeKey } from "./text.js";

export interface FindOptions {
  provider: ImageSearchProvider;
  minUsable: number;
  perProduct: number;
  sleep: (ms: number) => Promise<void>;
  minIntervalMs: number;
}

/** Try queries best-first; stop once enough usable hits were scored. */
export async function findForProduct(
  product: { name: string; brand?: string | null | undefined; category?: string | null | undefined; subCategory?: string | null | undefined },
  options: FindOptions,
): Promise<ScoredHit[]> {
  const scored: ScoredHit[] = [];
  for (const query of buildQueries(product)) {
    const hits = await options.provider.search(query);
    for (const hit of hits) {
      const s = scoreHit(hit, product, query);
      if (s) scored.push(s);
    }
    if (pickTop(scored, options.perProduct).length >= options.minUsable) break;
    await options.sleep(options.minIntervalMs);
  }
  return pickTop(scored, options.perProduct);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  loadEnv({ path: resolve(process.cwd(), "../../.env") });
  const { values } = parseArgs({
    // pnpm forwards the literal "--" from `pnpm run x -- --flag`; drop it.
    args: process.argv.slice(2).filter((a, i) => !(a === "--" && i === 0)),
    options: {
      sheet: { type: "string" },
      limit: { type: "string" },
      "only-missing": { type: "boolean", default: true },
      "include-with-image": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      provider: { type: "string", default: "serper" },
      "cache-dir": { type: "string", default: ".cache/images" },
      "interval-ms": { type: "string", default: "1100" },
      "reset-progress": { type: "boolean", default: false },
    },
  });

  let inner: ImageSearchProvider;
  try {
    inner =
      values.provider === "serpapi"
        ? new SerpApiProvider(process.env.SERPAPI_KEY)
        : values.provider === "brave"
          ? new BraveProvider(process.env.BRAVE_SEARCH_API_KEY)
          : new SerperProvider(process.env.SERPER_API_KEY);
  } catch (error) {
    if (error instanceof ProviderConfigError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  }
  const cacheDir = resolve(values["cache-dir"] ?? ".cache/images");
  const provider = new CachedProvider(inner, resolve(cacheDir, "responses"));

  const sheet: Map<string, SheetRow> = values.sheet ? await readSheet(resolve(values.sheet)) : new Map();
  const api = new ApiClient(configFromEnv());
  let products: ApiProduct[] = await api.listProducts();
  if (!values["include-with-image"]) products = products.filter((p) => !p.imageUrl);

  const progressFile = resolve(cacheDir, `progress-${provider.name}.json`);
  await mkdir(cacheDir, { recursive: true });
  const done = new Set<string>(
    values["reset-progress"] ? [] : (JSON.parse(await readFile(progressFile, "utf8").catch(() => "[]")) as string[]),
  );
  products = products.filter((p) => !done.has(p.id));
  if (values.limit) products = products.slice(0, Number(values.limit));

  console.log(`${products.length} product(s) to search with ${provider.name}${values["dry-run"] ? " (dry run: nothing is submitted)" : ""}`);
  const interval = Number(values["interval-ms"]);
  let submitted = 0;
  let withCandidates = 0;

  for (const [i, product] of products.entries()) {
    const fromSheet = sheet.get(normalizeKey(product.name));
    let top: ScoredHit[];
    try {
      top = await findForProduct(
        { name: product.name, brand: product.brandName ?? fromSheet?.brand, category: product.categoryName, subCategory: fromSheet?.subCategory },
        { provider, minUsable: 3, perProduct: 5, sleep, minIntervalMs: interval },
      );
    } catch (error) {
      if (error instanceof ProviderFatalError) {
        console.error(`\nStopping: ${error.message}`);
        break;
      }
      console.warn(`  ! ${product.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    console.log(`[${i + 1}/${products.length}] ${product.name} -> ${top.length} candidate(s)${top[0] ? ` (best ${top[0].score} ${top[0].sourceDomain})` : ""}`);
    if (top.length > 0) withCandidates += 1;

    if (!values["dry-run"]) {
      if (top.length > 0) {
        const batch: CandidateSubmission[] = top.map((h) => ({
          productId: product.id,
          imageUrl: h.imageUrl,
          sourcePageUrl: h.pageUrl,
          matchScore: h.score,
          query: h.query,
          ...(h.thumbnailUrl ? { thumbnailUrl: h.thumbnailUrl } : {}),
          ...(h.title ? { title: h.title.slice(0, 500) } : {}),
          ...(h.width ? { width: h.width } : {}),
          ...(h.height ? { height: h.height } : {}),
        }));
        const result = await api.submitCandidates(batch);
        submitted += result.inserted;
      }
      done.add(product.id);
      await writeFile(progressFile, JSON.stringify([...done]));
    }
  }

  console.log(`\nDone. ${withCandidates} product(s) got candidates; ${submitted} new candidate(s) submitted; ${provider.liveCalls} live search call(s) (the rest came from cache).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
