import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = PostgresJsDatabase<typeof schema>;
/** A transaction handle. Any repository function should accept `Database | Transaction`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Use this as the parameter type wherever a function may run inside or outside a transaction. */
export type DbExecutor = Database | Transaction;

export interface DbClientConfig {
  url: string;
  /** Connections in the pool. Keep well under Postgres `max_connections`. */
  max?: number;
  ssl?: boolean;
  /** Log every statement. Development only — statements contain customer data. */
  debug?: boolean;
  /** Seconds a connection may sit idle before it is closed. */
  idleTimeout?: number;
  /** Seconds a single statement may run before Postgres cancels it. */
  statementTimeout?: number;
}

export interface DbClient {
  db: Database;
  /** The raw postgres.js handle, for LISTEN/NOTIFY and `COPY`-based bulk import. */
  client: postgres.Sql;
  close: () => Promise<void>;
}

/**
 * Build a connection pool and a drizzle instance.
 *
 * Two things here are load-bearing and easy to get wrong:
 *
 *  - `casing: "snake_case"` MUST match drizzle.config.ts. drizzle-kit and
 *    drizzle-orm read the setting independently; a mismatch produces queries
 *    referencing columns that do not exist, and only at runtime.
 *
 *  - `transform` is deliberately NOT set. postgres.js hands DECIMAL back as a
 *    string, which is exactly what we want — see packages/shared-utils money.ts
 *    for why numeric columns must never become JS numbers.
 */
export function createDbClient(config: DbClientConfig): DbClient {
  const client = postgres(config.url, {
    max: config.max ?? 10,
    ssl: config.ssl ? "require" : false,
    idle_timeout: config.idleTimeout ?? 30,
    connect_timeout: 10,
    /** Applied to every connection; stops one runaway query holding a pool slot. */
    connection: {
      statement_timeout: (config.statementTimeout ?? 30) * 1000,
      application_name: "devsfleet",
    },
    ...(config.debug
      ? {
          debug: (_conn: number, query: string, params: unknown[]) => {
            // eslint-disable-next-line no-console
            console.log("[sql]", query, params);
          },
        }
      : {}),
  });

  const db = drizzle(client, { schema, casing: "snake_case", logger: config.debug ?? false });

  return {
    db,
    client,
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}

// -----------------------------------------------------------------------------
// Tenant context
// -----------------------------------------------------------------------------

/**
 * Run `fn` inside a transaction with the tenant RLS context set.
 *
 * EVERY runtime query must go through this. The `devsfleet_app` role has RLS
 * enforced against it, and every policy compares `tenant_id` to
 * `current_tenant_id()`. Without the context set, that function returns NULL,
 * NULL matches no row, and the query reads nothing — a failure that is loud and
 * safe rather than a silent cross-tenant read.
 *
 * The transaction is not optional. `SET LOCAL` is scoped to a transaction, and
 * the pool hands the same physical connection to unrelated requests; setting
 * the GUC outside a transaction would leak one tenant's context into another
 * tenant's query.
 *
 * @param branchId  When provided, also sets app.current_branch_id — used by the
 *                  branch-scoped policies on inventory and cash sessions.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
  options: { branchId?: string | null } = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config(..., true) is SET LOCAL, but accepts a bind parameter.
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`);
    if (options.branchId) {
      await tx.execute(
        sql`SELECT set_config('app.current_branch_id', ${options.branchId}, true)`,
      );
    }
    return fn(tx);
  });
}

/**
 * Run `fn` with RLS deliberately bypassed, across every tenant.
 *
 * For platform operations only: cross-tenant reporting, the tenant creation
 * flow itself, and support tooling. Never reachable from a request handler —
 * if you are reaching for this inside a controller, the answer is `withTenant`.
 */
export async function withPlatformAdmin<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.is_platform_admin', 'on', true)`);
    return fn(tx);
  });
}

/**
 * Cheap liveness probe. Used by the API's /health endpoint and by the POS to
 * decide whether it is online.
 */
export async function ping(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}
