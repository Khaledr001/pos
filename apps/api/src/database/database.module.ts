import { createDbClient, sql, type Database, type DbClient } from "@devsfleet/db";
import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type Provider,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../config/env.js";
import { TenantDatabase } from "./tenant-database.service.js";
import { DB, DB_CLIENT } from "./tokens.js";

/**
 * One connection pool for the whole process.
 *
 * The pool connects as `devsfleet_app`, which has RLS enforced. That is the
 * point: even a query that forgets tenant scoping cannot read another tenant's
 * rows — it reads nothing instead.
 *
 * Injecting the raw `DB` handle is possible but almost always wrong. Use
 * `TenantDatabase` (below), which sets the RLS context for you. See
 * docs/PATTERNS.md.
 */
const dbClientProvider: Provider = {
  provide: DB_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>): DbClient => {
    const url = config.get("DATABASE_URL", { infer: true });
    const isProd = config.get("NODE_ENV", { infer: true }) === "production";

    if (url.includes("devsfleet_migrator")) {
      throw new Error(
        "DATABASE_URL points at the migrator role, which bypasses row-level " +
          "security. Point it at devsfleet_app.",
      );
    }

    return createDbClient({
      url,
      max: config.get("DATABASE_POOL_MAX", { infer: true }),
      ssl: config.get("DATABASE_SSL", { infer: true }),
      debug: !isProd && process.env.DB_DEBUG === "1",
    });
  },
};

const dbProvider: Provider = {
  provide: DB,
  inject: [DB_CLIENT],
  useFactory: (client: DbClient): Database => client.db,
};

@Global()
@Module({
  providers: [dbClientProvider, dbProvider, TenantDatabase],
  exports: [DB_CLIENT, DB, TenantDatabase],
})
export class DatabaseModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @Inject(DB_CLIENT) private readonly client: DbClient,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Row-level security does nothing for a superuser or a BYPASSRLS role: every
   * tenant's rows are returned to every query, with no error anywhere. The
   * URL check above catches only the migrator by name, so ask the database who
   * we actually are.
   */
  async onApplicationBootstrap(): Promise<void> {
    const rows = await this.client.db.execute<{ role: string; bypass: boolean }>(
      sql`select current_user as role, (rolsuper or rolbypassrls) as bypass from pg_roles where rolname = current_user`,
    );
    const row = [...rows][0];
    if (!row?.bypass) return;

    const message =
      `The database role "${row.role}" bypasses row-level security, so every tenant can see every other ` +
      "tenant's data. Point DATABASE_URL at the devsfleet_app role (a role without SUPERUSER or BYPASSRLS).";
    if (this.config.get("NODE_ENV", { infer: true }) === "production") throw new Error(message);
    this.logger.error(`TENANT ISOLATION IS OFF: ${message}`);
  }

  async onApplicationShutdown(): Promise<void> {
    this.logger.log("closing database pool");
    await this.client.close();
  }
}
