/**
 * Profile an Excel/CSV price list before writing any import code.
 *
 * Run this FIRST, on the real file. It reports every column, its fill rate,
 * distinct-value count, inferred type, and a sample — which is exactly what the
 * products/categories/pricing schema has to be shaped against. The plan's
 * schema is a skeleton until this has been run.
 *
 *   pnpm --filter @devsfleet/import profile -- "/path/to/price-list.xlsx"
 *
 * Reads only. Touches no database.
 */
import ExcelJS from "exceljs";
import { resolve } from "node:path";

const file = process.argv[2];
if (!file) {
  console.error('Usage: pnpm --filter @devsfleet/import profile -- "<file.xlsx|file.csv>"');
  process.exit(1);
}

const path = resolve(process.cwd(), file);
const workbook = new ExcelJS.Workbook();

if (path.toLowerCase().endsWith(".csv")) {
  await workbook.csv.readFile(path);
} else {
  await workbook.xlsx.readFile(path);
}

const SAMPLE_LIMIT = 5;
const DISTINCT_LIMIT = 5000;

for (const sheet of workbook.worksheets) {
  if (sheet.rowCount <= 1) continue;

  console.log(`\n${"=".repeat(78)}`);
  console.log(`SHEET: ${sheet.name}  —  ${sheet.rowCount - 1} data rows, ${sheet.columnCount} columns`);
  console.log("=".repeat(78));

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col] = String(cell.value ?? `(unnamed col ${col})`).trim();
  });

  interface ColumnStats {
    header: string;
    filled: number;
    distinct: Set<string>;
    samples: string[];
    numeric: number;
    dateLike: number;
    maxLength: number;
  }

  const stats: ColumnStats[] = headers.map((header) => ({
    header,
    filled: 0,
    distinct: new Set(),
    samples: [],
    numeric: 0,
    dateLike: 0,
    maxLength: 0,
  }));

  let dataRows = 0;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    dataRows += 1;

    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const stat = stats[col];
      if (!stat) return;

      const raw = cell.value;
      if (raw === null || raw === undefined || raw === "") return;

      const text = String(typeof raw === "object" && "text" in raw ? raw.text : raw).trim();
      if (text === "") return;

      stat.filled += 1;
      stat.maxLength = Math.max(stat.maxLength, text.length);
      if (stat.distinct.size < DISTINCT_LIMIT) stat.distinct.add(text);
      if (stat.samples.length < SAMPLE_LIMIT) stat.samples.push(text);
      if (typeof raw === "number" || /^-?[\d,]+(\.\d+)?$/.test(text)) stat.numeric += 1;
      if (raw instanceof Date) stat.dateLike += 1;
    });
  });

  for (const [index, stat] of stats.entries()) {
    if (!stat.header || stat.filled === 0) continue;

    const fillRate = ((stat.filled / dataRows) * 100).toFixed(1);
    const type =
      stat.dateLike > stat.filled * 0.8
        ? "date"
        : stat.numeric > stat.filled * 0.8
          ? "numeric"
          : "text";

    // A column whose distinct count is a small fraction of its fill count is a
    // category, a brand or a unit — i.e. it wants its own table, not a string
    // column on `products`.
    const cardinality = stat.distinct.size / stat.filled;
    const hint =
      stat.distinct.size === stat.filled && stat.filled === dataRows
        ? "  ← unique across every row: candidate SKU / barcode"
        : cardinality < 0.1 && stat.distinct.size > 1
          ? `  ← low cardinality (${stat.distinct.size} values): candidate lookup table`
          : "";

    console.log(
      `\n[${index}] ${stat.header}\n` +
        `     type=${type}  filled=${fillRate}%  distinct=${stat.distinct.size}  maxLen=${stat.maxLength}${hint}\n` +
        `     e.g. ${stat.samples.map((s) => JSON.stringify(s)).join(", ")}`,
    );
  }
}

console.log(`\n${"=".repeat(78)}`);
console.log("Next: map these columns onto packages/db/src/schema/catalog.ts.");
console.log("Anything that does not need filtering or sorting can live in");
console.log("`products.attributes` (JSONB) rather than becoming a column.");
console.log("=".repeat(78));
