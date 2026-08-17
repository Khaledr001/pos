/**
 * The complete database schema.
 *
 * drizzle-kit reads this file to generate migrations, and the runtime client
 * passes it to `drizzle({ schema })` to enable the relational query API. A
 * table that is not re-exported here does not exist as far as either is
 * concerned.
 *
 * Adding a table:
 *   1. Put it in the right domain file below (or add a new one).
 *   2. Spread `...tenantScope` unless it is genuinely global — that column is
 *      what gets it an RLS policy.
 *   3. Spread `...timestamps`, and `...softDelete` if the POS must sync it.
 *   4. Re-export from here.
 *   5. `pnpm db:generate` then review the SQL before committing it.
 */

export * from "./_shared.js";
export * from "./tenants.js";
export * from "./auth.js";
export * from "./catalog.js";
export * from "./pricing.js";
export * from "./partners.js";
export * from "./inventory.js";
export * from "./sales.js";
export * from "./payments.js";
export * from "./financial.js";
export * from "./loyalty.js";
export * from "./paint.js";
export * from "./purchasing.js";
export * from "./whatsapp.js";
export * from "./sync.js";
