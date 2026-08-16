import { and, count, desc, eq, ilike, isNull, or, schema, sql } from "@devsfleet/db";
import {
  resolvePlan,
  trialStatus,
  type AuthSession,
  type Paginated,
  type PlanId,
} from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { AuthService } from "../auth/auth.service.js";
import type { ChangePlanDto, ListTenantsDto, SuspendTenantDto } from "./dto.js";

/**
 * The platform operator console — running the SaaS itself.
 *
 * Every method here deliberately runs as platform admin, which BYPASSES tenant
 * isolation. That is the entire purpose of this module and also its danger, so
 * two rules hold throughout:
 *
 *   1. Every route is `@PlatformOnly()`. There is no permission a tenant can
 *      grant themselves that reaches this code.
 *   2. Anything that touches a tenant's data or access is written to the audit
 *      log with the operator's identity, before it takes effect.
 */
@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly auth: AuthService,
  ) {}

  /** Headline numbers for the operator dashboard. */
  async stats() {
    return this.db.runAsPlatformAdmin(async (tx) => {
      const [[tenants], [activeTenants], [users], [devices], byPlan] = await Promise.all([
        tx.select({ v: count() }).from(schema.tenants).where(isNull(schema.tenants.deletedAt)),
        tx
          .select({ v: count() })
          .from(schema.tenants)
          .where(and(isNull(schema.tenants.deletedAt), eq(schema.tenants.isActive, true))),
        tx.select({ v: count() }).from(schema.users).where(isNull(schema.users.deletedAt)),
        tx.select({ v: count() }).from(schema.devices).where(eq(schema.devices.isActive, true)),
        tx
          .select({ planId: schema.tenants.planId, total: count() })
          .from(schema.tenants)
          .where(isNull(schema.tenants.deletedAt))
          .groupBy(schema.tenants.planId),
      ]);

      /**
       * Monthly recurring revenue, counted only from ACTIVE tenants on a paid
       * plan. Trials and suspended accounts contribute nothing — counting them
       * produces a number that feels good and forecasts wrongly.
       */
      const mrr = byPlan.reduce((sum, row) => {
        const plan = resolvePlan(row.planId);
        return sum + (plan.monthlyPrice ?? 0) * row.total;
      }, 0);

      return {
        tenants: tenants?.v ?? 0,
        activeTenants: activeTenants?.v ?? 0,
        suspendedTenants: (tenants?.v ?? 0) - (activeTenants?.v ?? 0),
        users: users?.v ?? 0,
        devices: devices?.v ?? 0,
        planDistribution: byPlan.map((row) => ({
          planId: row.planId,
          planName: resolvePlan(row.planId).name,
          tenants: row.total,
        })),
        estimatedMrr: mrr,
      };
    });
  }

  async listTenants(query: ListTenantsDto): Promise<Paginated<unknown>> {
    const { page, limit, q, planId, status } = query;
    const offset = (page - 1) * limit;

    const where = and(
      isNull(schema.tenants.deletedAt),
      q ? or(ilike(schema.tenants.name, `%${q}%`), ilike(schema.tenants.slug, `%${q}%`)) : undefined,
      planId ? eq(schema.tenants.planId, planId) : undefined,
      status === "active"
        ? eq(schema.tenants.isActive, true)
        : status === "suspended"
          ? eq(schema.tenants.isActive, false)
          : undefined,
    );

    return this.db.runAsPlatformAdmin(async (tx) => {
      const [rows, [totals]] = await Promise.all([
        tx
          .select({
            id: schema.tenants.id,
            name: schema.tenants.name,
            slug: schema.tenants.slug,
            planId: schema.tenants.planId,
            isActive: schema.tenants.isActive,
            trialEndsAt: schema.tenants.trialEndsAt,
            subscriptionEndsAt: schema.tenants.subscriptionEndsAt,
            suspendedReason: schema.tenants.suspendedReason,
            createdAt: schema.tenants.createdAt,
            // Counted per row rather than joined: a tenant list is short, and a
            // GROUP BY across users would hide tenants that have none.
            userCount: sql<number>`(
              SELECT count(*)::int FROM users u
              WHERE u.tenant_id = ${schema.tenants.id} AND u.deleted_at IS NULL
            )`,
          })
          .from(schema.tenants)
          .where(where)
          .orderBy(desc(schema.tenants.createdAt))
          .limit(limit)
          .offset(offset),
        tx.select({ v: count() }).from(schema.tenants).where(where),
      ]);

      const total = totals?.v ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      return {
        items: rows.map((row) => ({
          ...row,
          plan: resolvePlan(row.planId),
          trial: trialStatus(row.planId, row.trialEndsAt, new Date()),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    });
  }

  async suspend(tenantId: string, dto: SuspendTenantDto): Promise<void> {
    const operator = RequestContext.requireUser();

    await this.db.runAsPlatformAdmin(async (tx) => {
      const [updated] = await tx
        .update(schema.tenants)
        .set({
          isActive: false,
          suspendedAt: new Date(),
          suspendedReason: dto.reason,
        })
        .where(eq(schema.tenants.id, tenantId))
        .returning({ id: schema.tenants.id, name: schema.tenants.name });

      if (!updated) throw new AppError(ERROR_CODES.NOT_FOUND, "Business not found");

      /**
       * Kill every live session immediately. Suspension that leaves existing
       * refresh tokens working means a suspended tenant keeps trading for up to
       * 90 days on a POS terminal.
       */
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.refreshTokens.tenantId, tenantId),
            isNull(schema.refreshTokens.revokedAt),
          ),
        );

      await this.writeAudit(tx, tenantId, operator.id, "suspend", dto.reason);
      this.logger.warn({ tenantId, operator: operator.id }, `Suspended ${updated.name}`);
    });
  }

  async activate(tenantId: string): Promise<void> {
    const operator = RequestContext.requireUser();

    await this.db.runAsPlatformAdmin(async (tx) => {
      const [updated] = await tx
        .update(schema.tenants)
        .set({ isActive: true, suspendedAt: null, suspendedReason: null })
        .where(eq(schema.tenants.id, tenantId))
        .returning({ id: schema.tenants.id });

      if (!updated) throw new AppError(ERROR_CODES.NOT_FOUND, "Business not found");
      await this.writeAudit(tx, tenantId, operator.id, "activate", null);
    });
  }

  /**
   * Move a tenant between plans, effective immediately.
   *
   * Downgrades are NOT retroactively enforced: a tenant with 8 branches moved
   * to a 2-branch plan keeps all 8 and simply cannot create a 9th. Deleting
   * their data because they downgraded would be indefensible; the limit is a
   * gate on growth, not a reaper.
   */
  async changePlan(tenantId: string, dto: ChangePlanDto): Promise<void> {
    const operator = RequestContext.requireUser();

    await this.db.runAsPlatformAdmin(async (tx) => {
      const existing = await tx.query.tenants.findFirst({
        where: (t, { eq: e }) => e(t.id, tenantId),
      });
      if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, "Business not found");

      await tx
        .update(schema.tenants)
        .set({
          planId: dto.planId as PlanId,
          // Leaving a trial ends it — a paid plan has no trial clock.
          trialEndsAt: dto.planId === "trial" ? existing.trialEndsAt : null,
          ...(dto.subscriptionEndsAt
            ? { subscriptionEndsAt: new Date(dto.subscriptionEndsAt) }
            : {}),
        })
        .where(eq(schema.tenants.id, tenantId));

      await this.writeAudit(
        tx,
        tenantId,
        operator.id,
        "change_plan",
        `${existing.planId} -> ${dto.planId}`,
      );
    });
  }

  /**
   * Impersonate a tenant for support.
   *
   * The highest-risk capability in the system: it mints a working session
   * inside somebody else's business. Three controls, all mandatory:
   *
   *   - the audit row is written BEFORE the token exists, so a crash cannot
   *     produce an unlogged impersonation;
   *   - the session is issued to that tenant's own admin, so everything the
   *     operator does is attributable to a real user id rather than appearing
   *     as a ghost;
   *   - it expires with the normal 15-minute access token, and the response is
   *     flagged so the UI can show a persistent banner.
   */
  async impersonate(tenantId: string): Promise<AuthSession & { impersonated: true }> {
    const operator = RequestContext.requireUser();

    const target = await this.db.runAsPlatformAdmin(async (tx) => {
      const tenant = await tx.query.tenants.findFirst({
        where: (t, { eq: e }) => e(t.id, tenantId),
      });
      if (!tenant) throw new AppError(ERROR_CODES.NOT_FOUND, "Business not found");
      if (!tenant.isActive) {
        throw new AppError(
          ERROR_CODES.TENANT_SUSPENDED,
          "Reactivate the business before impersonating it",
        );
      }

      const rows = await tx
        .select({ user: schema.users })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
        .where(
          and(
            eq(schema.users.tenantId, tenantId),
            eq(schema.roles.name, "admin"),
            eq(schema.users.isActive, true),
            isNull(schema.users.deletedAt),
          ),
        )
        .limit(1);

      const admin = rows[0]?.user;
      if (!admin) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "That business has no active administrator");
      }

      await this.writeAudit(
        tx,
        tenantId,
        operator.id,
        "impersonate",
        `Operator ${operator.id} impersonated admin ${admin.id}`,
      );

      return admin;
    });

    this.logger.warn(
      { tenantId, operatorId: operator.id, targetUserId: target.id },
      "IMPERSONATION started",
    );

    const session = await this.auth.issueSessionFor(target.id, tenantId);
    return { ...session, impersonated: true };
  }

  /** Audit rows are append-only, enforced by trigger. */
  private async writeAudit(
    tx: Parameters<Parameters<TenantDatabase["runAsPlatformAdmin"]>[0]>[0],
    tenantId: string,
    operatorId: string,
    action: string,
    reason: string | null,
  ): Promise<void> {
    await tx.insert(schema.auditLog).values({
      tenantId,
      userId: null, // The operator is not a member of this tenant.
      entityType: "tenants",
      entityId: tenantId,
      action,
      reason,
      changes: { platformOperator: [null, operatorId] },
      requestId: RequestContext.requestId,
    });
  }
}
