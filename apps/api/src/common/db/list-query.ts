import { and, eq, sql, type SQL } from "@devsfleet/db";
import { z } from "zod";

/**
 * `%` and `_` are wildcards to ILIKE. Unescaped, a search for "10%" matched
 * every row with "10" in it, and a lone "_" matched the whole table.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `%term%` for a substring search, or null when there is nothing to search for. */
export function containsPattern(q: string | undefined): string | null {
  const term = q?.trim();
  return term ? `%${escapeLike(term)}%` : null;
}

/**
 * The sort half of a list query. Each list names its own sortable columns —
 * a free-form `sortBy` would let a caller order by any column, including ones
 * the list never selects.
 */
export function sortSchema<const K extends readonly [string, ...string[]]>(
  keys: K,
  defaults: { sortBy: K[number]; sortOrder: "asc" | "desc" },
) {
  return {
    sortBy: z.enum(keys).default(defaults.sortBy),
    sortOrder: z.enum(["asc", "desc"]).default(defaults.sortOrder),
  };
}

/**
 * A `from`/`to` date range on the business's own calendar.
 *
 * Comparing a timestamp with a bare date cuts days in the DATABASE's zone —
 * UTC — so for a Dubai shop the four hours after local midnight belonged to
 * the previous day, and a VAT return for October lost the early hours of the
 * 1st to September. Local midnight is converted to an instant instead, which
 * also leaves the column bare and an index on it usable.
 */
export function localDateRange(
  column: Parameters<typeof eq>[0],
  range: { from?: string | null; to?: string | null },
  timeZone: string,
): SQL | undefined {
  return and(
    range.from ? sql`${column} >= (${range.from}::date::timestamp AT TIME ZONE ${timeZone})` : undefined,
    range.to ? sql`${column} < ((${range.to}::date + 1)::timestamp AT TIME ZONE ${timeZone})` : undefined,
  );
}
