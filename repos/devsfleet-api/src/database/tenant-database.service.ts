import {
  type Database,
  type Transaction,
  withPlatformAdmin,
  withTenant,
} from "@devsfleet/db";
import { Inject, Injectable } from "@nestjs/common";
import { RequestContext } from "../common/context/request-context.js";
import { DB } from "./tokens.js";

/**
 * The way application code talks to Postgres.
 *
 * Every call opens a transaction and sets `app.current_tenant_id` from the
 * request context before running your callback, which is what makes the RLS
 * policies do their job. Nothing else needs to remember to filter by tenant —
 * and more importantly, nothing else *can* forget to.
 *
 * Inject this, not the raw `DB` handle:
 *
 *     constructor(private readonly db: TenantDatabase) {}
 *
 *     async findAll() {
 *       return this.db.run((tx) => tx.query.branches.findMany());
 *     }
 *
 * The transaction is not an optimisation. `SET LOCAL` is transaction-scoped,
 * and the pool hands the same physical connection to unrelated requests; a GUC
 * set outside a transaction would leak one tenant's context into another
 * tenant's query.
 */
@Injectable()
export class TenantDatabase {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Run inside the current request's tenant context.
   *
   * Throws if there is no tenant in scope — see RequestContext.requireTenantId
   * for why that is a hard failure rather than a silent empty result.
   */
  async run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const tenantId = RequestContext.requireTenantId();
    const branchId = RequestContext.get()?.branchId ?? null;
    return withTenant(this.db, tenantId, fn, { branchId });
  }

  /**
   * Run in an explicitly named tenant, ignoring the request context.
   *
   * For background jobs and webhook handlers, which arrive with no session:
   * an inbound WhatsApp message resolves its tenant from the phone number ID
   * before it has a user.
   */
  async runAs<T>(
    tenantId: string,
    fn: (tx: Transaction) => Promise<T>,
    options: { branchId?: string | null } = {},
  ): Promise<T> {
    return withTenant(this.db, tenantId, fn, options);
  }

  /**
   * Run with RLS bypassed, across every tenant.
   *
   * Platform operations only: creating a tenant, cross-tenant reporting,
   * support tooling. If you are reaching for this from a controller, the
   * answer is `run()`.
   */
  async runAsPlatformAdmin<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withPlatformAdmin(this.db, fn);
  }

  /**
   * The unscoped handle, for liveness checks and migrations only.
   * Queries issued through it are still subject to RLS — with no tenant
   * context set, that means they return nothing.
   */
  get raw(): Database {
    return this.db;
  }
}
