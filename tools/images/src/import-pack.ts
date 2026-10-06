/**
 * Supplier image-pack importer.
 *
 *   pnpm --filter @devsfleet/images import-pack -- --dir <folder> [--brand modi] [--apply]
 *
 * DRY RUN BY DEFAULT: matches every image file to a product and writes a CSV +
 * HTML report. With --apply, ONLY high-confidence matches are uploaded (through
 * the normal product-image endpoint, so checksum dedup applies); everything
 * else stays in the report for a person to handle.
 */
import { config as loadEnv } from "dotenv";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ApiClient, configFromEnv } from "./api-client.js";
import { matchFile, type MatchProduct, type MatchResult } from "./matcher.js";

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const MAX_BYTES = 5 * 1024 * 1024;

export async function scanImages(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (MIME[extname(entry.name).toLowerCase()]) found.push(full);
    }
  };
  await walk(dir);
  return found.sort();
}

const csvCell = (v: string | number | undefined): string => `"${String(v ?? "").replace(/"/g, '""')}"`;
const esc = (v: string): string => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export function renderCsv(results: MatchResult[]): string {
  const rows = results.map((r) =>
    [
      r.file, r.status, r.confidence ?? "", r.product?.sku ?? "", r.product?.name ?? "", r.score.toFixed(2), r.reason,
      r.alternatives.map((a) => `${a.product.name} (${a.score.toFixed(2)})`).join(" | "),
    ].map(csvCell).join(","),
  );
  return [["file", "status", "confidence", "sku", "product", "score", "reason", "alternatives"].map(csvCell).join(","), ...rows].join("\n");
}

export function renderHtml(results: MatchResult[], applied: Set<string>): string {
  const body = results
    .map(
      (r) => `<tr class="${r.status}${r.confidence ? ` ${r.confidence}` : ""}"><td>${esc(r.file)}</td><td>${r.status}</td><td>${r.confidence ?? ""}</td><td>${esc(r.product?.name ?? "")}</td><td>${r.score.toFixed(2)}</td><td>${esc(r.reason)}${r.alternatives.length ? `<br><small>${esc(r.alternatives.map((a) => a.product.name).join(" | "))}</small>` : ""}</td><td>${applied.has(r.file) ? "uploaded" : ""}</td></tr>`,
    )
    .join("\n");
  return `<!doctype html><meta charset="utf-8"><title>Image pack report</title><style>body{font:13px system-ui;margin:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}tr.high{background:#e6f6e6}tr.medium{background:#fff8dc}tr.low{background:#ffeede}tr.ambiguous{background:#e8eefc}tr.unmatched{background:#f5e6e6}</style><h1>Image pack report</h1><p>${results.length} file(s). Only <b>high</b> rows are uploaded with --apply.</p><table><tr><th>File</th><th>Status</th><th>Confidence</th><th>Product</th><th>Score</th><th>Why / alternatives</th><th>Applied</th></tr>${body}</table>`;
}

async function main(): Promise<void> {
  loadEnv({ path: resolve(process.cwd(), "../../.env") });
  const { values } = parseArgs({
    // pnpm forwards the literal "--" from `pnpm run x -- --flag`; drop it.
    args: process.argv.slice(2).filter((a, i) => !(a === "--" && i === 0)),
    options: {
      dir: { type: "string" },
      brand: { type: "string" },
      apply: { type: "boolean", default: false },
      "report-dir": { type: "string", default: "image-pack-report" },
    },
  });
  if (!values.dir) {
    console.error('Usage: pnpm --filter @devsfleet/images import-pack -- --dir <folder> [--brand modi] [--apply]');
    process.exit(1);
  }
  const dir = resolve(values.dir);
  const files = await scanImages(dir);
  const api = new ApiClient(configFromEnv());
  const products: MatchProduct[] = (await api.listProducts()).map((p) => ({ id: p.id, sku: p.sku, name: p.name, brand: p.brandName ?? null }));

  const results = files.map((f) => matchFile(relative(dir, f), basename(f), products, { brand: values.brand }));
  const counts = { high: 0, medium: 0, low: 0, ambiguous: 0, unmatched: 0 };
  for (const r of results) counts[r.status === "matched" ? (r.confidence ?? "low") : r.status] += 1;
  console.log(`${files.length} image(s): ${counts.high} high, ${counts.medium} medium, ${counts.low} low, ${counts.ambiguous} ambiguous, ${counts.unmatched} unmatched`);

  const applied = new Set<string>();
  if (values.apply) {
    const source = `Supplier pack${values.brand ? `: ${values.brand}` : ""} (${basename(dir)})`;
    let stored = 0;
    let duplicate = 0;
    for (const r of results) {
      if (r.status !== "matched" || r.confidence !== "high" || !r.product) continue;
      const path = join(dir, r.file);
      if ((await stat(path)).size > MAX_BYTES) {
        console.warn(`  skipped (over 5MB): ${r.file}`);
        continue;
      }
      const outcome = await api.uploadImage(
        r.product.id,
        { bytes: await readFile(path), filename: basename(path), mimeType: MIME[extname(path).toLowerCase()] ?? "image/jpeg" },
        { source, altText: r.product.name },
      );
      if (outcome === "stored") stored += 1;
      else duplicate += 1;
      applied.add(r.file);
    }
    console.log(`Uploaded ${stored}, already present ${duplicate}. Medium/low/ambiguous/unmatched were NOT uploaded.`);
  } else {
    console.log("Dry run: nothing uploaded. Re-run with --apply to upload the high-confidence matches.");
  }

  const reportDir = resolve(values["report-dir"] ?? "image-pack-report");
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, "report.csv"), renderCsv(results));
  await writeFile(join(reportDir, "report.html"), renderHtml(results, applied));
  console.log(`Report: ${join(reportDir, "report.html")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
