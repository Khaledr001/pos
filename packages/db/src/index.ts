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
export { runMigrations, type MigrateOptions, type MigrateResult } from "./migrator.js";

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

/**
 * Self-join helper. Lives in `pg-core` rather than the root, but callers need
 * it for the same reason as the operators above: joining one table twice (an
 * audit row's subject user AND the operator who impersonated them) without
 * taking a direct drizzle-orm dependency.
 */
export { alias } from "drizzle-orm/pg-core";
