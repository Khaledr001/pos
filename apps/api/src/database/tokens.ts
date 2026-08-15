/**
 * DI tokens, in their own file on purpose.
 *
 * If these lived in database.module.ts, then tenant-database.service.ts would
 * import the module (for the token) while the module imports the service (to
 * provide it) — a cycle. TypeScript compiles it happily; at runtime the CJS
 * loader hands one side a partially-initialised module, the token evaluates to
 * `undefined` when the `@Inject()` decorator runs, and Nest fails at boot with
 * "can't resolve dependencies of TenantDatabase (?)".
 *
 * A leaf file with no imports of its own cannot participate in a cycle.
 */

/** The DbClient: pool + drizzle handle + close(). */
export const DB_CLIENT = Symbol("DB_CLIENT");

/**
 * The raw drizzle Database.
 *
 * Injecting this directly bypasses tenant scoping and is almost always wrong —
 * inject `TenantDatabase` instead.
 */
export const DB = Symbol("DB");
