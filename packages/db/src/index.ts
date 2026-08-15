/**
 * @devsfleet/db
 *
 * Drizzle schema, connection factory, and the tenant-context helpers that make
 * row-level security work.
 *
 * Rule of thumb: this package owns *how* to talk to Postgres. It owns no
 * business logic — a function that decides which price applies belongs in
 * apps/api, not here.
 */

export * as schema from "./schema/index.js";
export * from "./schema/index.js";
export * from "./client.js";

// Re-exported so callers can build predicates without adding drizzle-orm to
// their own package.json.
export {
  and,
  asc,
  between,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
  sum,
} from "drizzle-orm";
