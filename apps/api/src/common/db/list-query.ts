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
