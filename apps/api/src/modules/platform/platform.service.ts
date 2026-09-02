import {
  alias,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  or,
  schema,
  sql,
} from "@devsfleet/db";
import {
  COMMON_UNITS,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_TENANT_SETTINGS,
  SYSTEM_ROLES,
  PLANS,
  resolvePlan,
  resolveTenantSettings,
  trialStatus,
  type AuthSession,
  type Paginated,
  type PlanId,
} from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, slugify } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import bcrypt from "bcryptjs";
import type { Env } from "../../config/env.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { AuthService } from "../auth/auth.service.js";
import { RESERVED_SLUGS } from "../tenants/dto.js";
import type {
  ChangePlanDto,
  CreateTenantDto,
  ImpersonateDto,
  ListAuditLogsDto,
  ListTenantsDto,
  SuspendTenantDto,
  UpdateTenantDto,
} from "./dto.js";

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
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Headline numbers for the operator dashboard. */
  async stats() {
    return this.db.runAsPlatformAdmin(async (tx) => {
      const [[tenants], [activeTenants], [users], [devices], byPlan, recentTenants] =
        await Promise.all([
          tx
            .select({ v: count() })
            .from(schema.tenants)
            .where(isNull(schema.tenants.deletedAt)),
          tx
            .select({ v: count() })
            .from(schema.tenants)
            .where(
              and(isNull(schema.tenants.deletedAt), eq(schema.tenants.isActive, true)),
            ),
          tx
            .select({ v: count() })
            .from(schema.users)
            .where(isNull(schema.users.deletedAt)),
          tx
            .select({ v: count() })
            .from(schema.devices)
            .where(eq(schema.devices.isActive, true)),
          tx
            .select({ planId: schema.tenants.planId, total: count() })
            .from(schema.tenants)
            // Active only. Without this the MRR below counted suspended paid
            // tenants — a business suspended for non-payment was still being
            // reported as revenue, which is precisely backwards.
            .where(and(isNull(schema.tenants.deletedAt), eq(schema.tenants.isActive, true)))
            .groupBy(schema.tenants.planId),
          tx
            .select({
              id: schema.tenants.id,
              name: schema.tenants.name,
              slug: schema.tenants.slug,
              planId: schema.tenants.planId,
              isActive: schema.tenants.isActive,
              createdAt: schema.tenants.createdAt,
            })
            .from(schema.tenants)
            .where(isNull(schema.tenants.deletedAt))
            .orderBy(desc(schema.tenants.createdAt))
            .limit(5),
        ]);

      /**
       * Monthly recurring revenue, counted only from ACTIVE tenants on a paid
       * plan. Trials and suspended accounts contribute nothing — counting them
       * produces a number that feels good and forecasts wrongly.
       *
       * Enterprise is `monthlyPrice: null` (negotiated per contract), so it is
       * excluded rather than counted as zero. This figure is therefore MRR
       * from list-priced plans, which is what `mrrExcludesEnterprise` says
       * out loud so a dashboard cannot imply otherwise.
       */
      const mrr = byPlan.reduce((sum, row) => {
        const plan = resolvePlan(row.planId);
        return sum + (plan.monthlyPrice ?? 0) * row.total;
      }, 0);

      const enterpriseTenants = byPlan
        .filter((row) => resolvePlan(row.planId).monthlyPrice === null)
        .reduce((sum, row) => sum + row.total, 0);

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
        /** How many active tenants sit outside `estimatedMrr` on custom terms. */
        mrrExcludesEnterprise: enterpriseTenants,
        recentTenants: recentTenants.map((t) => ({
          ...t,
          plan: resolvePlan(t.planId),
        })),
      };
    });
  }

  async listTenants(query: ListTenantsDto): Promise<Paginated<unknown>> {
    const { page, limit, q, planId, status } = query;
    const offset = (page - 1) * limit;

    const where = and(
      isNull(schema.tenants.deletedAt),
      q
        ? or(ilike(schema.tenants.name, `%${q}%`), ilike(schema.tenants.slug, `%${q}%`))
        : undefined,
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
            userCount: sql<number>`(
              SELECT count(*)::int FROM users u
              WHERE u.tenant_id = ${schema.tenants.id} AND u.deleted_at IS NULL
            )`,
            branchCount: sql<number>`(
              SELECT count(*)::int FROM branches b
              WHERE b.tenant_id = ${schema.tenants.id} AND b.deleted_at IS NULL
            )`,
            deviceCount: sql<number>`(
              SELECT count(*)::int FROM devices d
              WHERE d.tenant_id = ${schema.tenants.id} AND d.is_active = true
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

  /** Detailed single-tenant inspection for the operator dashboard. */
  async getTenant(tenantId: string) {
    return this.db.runAsPlatformAdmin(async (tx) => {
      const tenant = await tx.query.tenants.findFirst({
        // `listTenants` filters soft-deleted tenants; this did not, so a
        // deleted business stayed fully readable by id — including its
        // complete staff directory.
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, tenantId), n(t.deletedAt)),
      });

      if (!tenant) throw new AppError(ERROR_CODES.NOT_FOUND, "Business not found");

      const [
        branches,
        usersList,
        [devicesCount],
        [productsCount],
        [salesCount],
        auditEntries,
      ] = await Promise.all([
        tx.query.branches.findMany({
          where: (b, { and: a, eq: e, isNull: n }) =>
            a(e(b.tenantId, tenantId), n(b.deletedAt)),
          orderBy: (b, { desc: d }) => [d(b.createdAt)],
        }),
        tx
          .select({
            id: schema.users.id,
            name: schema.users.name,
            email: schema.users.email,
            roleId: schema.users.roleId,
            roleName: schema.roles.name,
            branchId: schema.users.branchId,
            branchName: schema.branches.name,
            isActive: schema.users.isActive,
            isPlatformAdmin: schema.users.isPlatformAdmin,
            lastLoginAt: schema.users.lastLoginAt,
            createdAt: schema.users.createdAt,
          })
          .from(schema.users)
          .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
          .leftJoin(schema.branches, eq(schema.users.branchId, schema.branches.id))
          .where(and(eq(schema.users.tenantId, tenantId), isNull(schema.users.deletedAt)))
          .orderBy(desc(schema.users.createdAt)),
        tx
          .select({ v: count() })
          .from(schema.devices)
          .where(
            and(eq(schema.devices.tenantId, tenantId), eq(schema.devices.isActive, true)),
          ),
        tx
          .select({ v: count() })
          .from(schema.products)
          .where(
            and(
              eq(schema.products.tenantId, tenantId),
              isNull(schema.products.deletedAt),
            ),
          ),
        tx
          .select({ v: count() })
          .from(schema.sales)
          .where(eq(schema.sales.tenantId, tenantId)),
        tx.query.auditLog.findMany({
          where: (a, { eq: e }) => e(a.tenantId, tenantId),
          orderBy: (a, { desc: d }) => [d(a.createdAt)],
          limit: 20,
        }),
      ]);

      const plan = resolvePlan(tenant.planId);
      const trial = trialStatus(tenant.planId, tenant.trialEndsAt, new Date());

      const activeUsersCount = usersList.filter((u) => u.isActive).length;
      const activeBranchesCount = branches.filter((b) => b.isActive).length;

      /**
       * Enumerated, not spread.
       *
       * `...tenant` shipped `paymentCustomerId` and `paymentSubscriptionId` —
       * external payment-processor references with no business on a detail
       * screen — and any column added to `tenants` later would have joined
       * them silently.
       */
      return {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        planId: tenant.planId,
        isActive: tenant.isActive,
        trialEndsAt: tenant.trialEndsAt,
        subscriptionEndsAt: tenant.subscriptionEndsAt,
        suspendedAt: tenant.suspendedAt,
        suspendedReason: tenant.suspendedReason,
        settings: tenant.settings,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
        plan,
        trial,
        branches,
        users: usersList,
        counts: {
          branches: activeBranchesCount,
          users: activeUsersCount,
          devices: devicesCount?.v ?? 0,
          products: productsCount?.v ?? 0,
          sales: salesCount?.v ?? 0,
        },
        usage: {
          branches: { current: activeBranchesCount, max: plan.maxBranches },
          users: { current: activeUsersCount, max: plan.maxUsers },
          devices: { current: devicesCount?.v ?? 0, max: plan.maxDevices },
          products: { current: productsCount?.v ?? 0, max: plan.maxProducts },
        },
        auditLogs: auditEntries,
      };
    });
  }

  /** Provision a tenant directly as a platform operator. */
  async createTenant(dto: CreateTenantDto) {
    const operator = RequestContext.requireUser();
    const slug = slugify(dto.slug);
    const email = dto.ownerEmail.toLowerCase().trim();
    const rounds = this.config.get("BCRYPT_ROUNDS", { infer: true });

    if (RESERVED_SLUGS.has(slug)) {
      throw new AppError(ERROR_CODES.DUPLICATE_SLUG, `The slug "${slug}" is reserved`);
    }

    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const created = await this.db.runAsPlatformAdmin(async (tx) => {
      const existingTenant = await tx.query.tenants.findFirst({
        where: (t, { eq: e }) => e(t.slug, slug),
      });
      if (existingTenant) {
        throw new AppError(
          ERROR_CODES.DUPLICATE_SLUG,
          `The name "${slug}" is already taken. Try another.`,
        );
      }

      const existingUser = await tx.query.users.findFirst({
        where: (t, { eq: e }) => e(t.email, email),
      });
      if (existingUser) {
        throw new AppError(
          ERROR_CODES.DUPLICATE_EMAIL,
          "That email already has an account.",
        );
      }

      const trialEndsAt =
        dto.planId === "trial" ? new Date(Date.now() + dto.trialDays * 86_400_000) : null;
      const subscriptionEndsAt =
        dto.planId !== "trial" ? new Date(Date.now() + 30 * 86_400_000) : null;

      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          name: dto.businessName,
          slug,
          planId: dto.planId,
          trialEndsAt,
          subscriptionEndsAt,
          settings: DEFAULT_TENANT_SETTINGS,
        })
        .returning();

      if (!tenant)
        throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the business");

      const roleIds = new Map<string, string>();
      for (const roleName of SYSTEM_ROLES) {
        const [role] = await tx
          .insert(schema.roles)
          .values({
            tenantId: tenant.id,
            name: roleName,
            isSystem: true,
            permissions: [...(DEFAULT_ROLE_PERMISSIONS[roleName] ?? [])],
          })
          .returning();
        if (role) roleIds.set(roleName, role.id);
      }

      const [branch] = await tx
        .insert(schema.branches)
        .values({
          tenantId: tenant.id,
          name: dto.branchName,
          code: dto.branchCode.toUpperCase().trim(),
        })
        .returning();

      // A hardware/electrical/sanitary/paint retailer needs Box and Roll on
      // day one, not just Piece — see COMMON_UNITS.
      await tx.insert(schema.units).values(
        COMMON_UNITS.map((u) => ({ tenantId: tenant.id, ...u })),
      );

      await tx.insert(schema.priceLists).values({
        tenantId: tenant.id,
        name: "Retail",
        type: "retail",
        isDefault: true,
        currency: DEFAULT_TENANT_SETTINGS.currency.base,
      });

      const [owner] = await tx
        .insert(schema.users)
        .values({
          tenantId: tenant.id,
          branchId: null,
          roleId: roleIds.get("admin")!,
          name: dto.ownerName,
          email,
          passwordHash,
          maxDiscountPercent: "100",
          maxSaleAmount: null,
          canApproveRefund: true,
          canViewCost: true,
          allowedBranchIds: [],
        })
        .returning();

      if (!owner)
        throw new AppError(
          ERROR_CODES.INTERNAL_ERROR,
          "Could not create the owner account",
        );

      await this.writeAudit(
        tx,
        tenant.id,
        operator.id,
        "create_tenant",
        `Created tenant ${tenant.name} (${tenant.slug}) on plan ${dto.planId}`,
      );

      return { tenant, owner, branch };
    });

    this.logger.log(
      { tenantId: created.tenant.id, operatorId: operator.id },
      `Platform operator provisioned tenant: ${dto.businessName}`,
    );

    return {
      ...created.tenant,
      plan: resolvePlan(created.tenant.planId),
      owner: {
        id: created.owner.id,
        name: created.owner.name,
        email: created.owner.email,
      },
    };
  }

  /** Update tenant configuration from platform console. */
  async updateTenant(tenantId: string, dto: UpdateTenantDto) {
    const operator = RequestContext.requireUser();

    return this.db.runAsPlatformAdmin(async (tx) => {
      const existing = await tx.query.tenants.findFirst({
        where: (t, { eq: e }) => e(t.id, tenantId),
      });
      if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, "Business not found");

      if (dto.slug && dto.slug !== existing.slug) {
        const slug = slugify(dto.slug);
        if (RESERVED_SLUGS.has(slug)) {
          throw new AppError(
            ERROR_CODES.DUPLICATE_SLUG,
            `The slug "${slug}" is reserved`,
          );
        }
        const duplicate = await tx.query.tenants.findFirst({
          where: (t, { eq: e }) => e(t.slug, slug),
        });
        if (duplicate) {
          throw new AppError(
            ERROR_CODES.DUPLICATE_SLUG,
            `Slug "${slug}" is already in use`,
          );
        }
      }

      const updateData: Partial<typeof schema.tenants.$inferInsert> = {};
      if (dto.name !== undefined) updateData.name = dto.name;
      if (dto.slug !== undefined) updateData.slug = slugify(dto.slug);
      if (dto.planId !== undefined) updateData.planId = dto.planId as PlanId;
      if (dto.trialEndsAt !== undefined) {
        updateData.trialEndsAt = dto.trialEndsAt ? new Date(dto.trialEndsAt) : null;
      }
      if (dto.subscriptionEndsAt !== undefined) {
        updateData.subscriptionEndsAt = dto.subscriptionEndsAt
          ? new Date(dto.subscriptionEndsAt)
          : null;
      }
      if (dto.settings !== undefined) {
        /**
         * Merged per section against the RESOLVED settings, exactly as the
         * tenant's own settings route does.
         *
         * The previous one-level `{ ...existing.settings, ...dto.settings }`
         * replaced whole sections: patching one field of `tax` discarded every
         * other field in it. Sections have to be spread individually or a
         * partial patch is a destructive overwrite.
         */
        const current = resolveTenantSettings(existing.settings);
        const patch = dto.settings;
        updateData.settings = {
          ...current,
          ...(patch.legalName !== undefined ? { legalName: patch.legalName } : {}),
          ...(patch.trn !== undefined ? { trn: patch.trn } : {}),
          ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
          ...(patch.email !== undefined ? { email: patch.email } : {}),
          ...(patch.logoUrl !== undefined ? { logoUrl: patch.logoUrl } : {}),
          ...(patch.addressLines !== undefined
            ? { addressLines: patch.addressLines }
            : {}),
          tax: { ...current.tax, ...patch.tax },
          sales: { ...current.sales, ...patch.sales },
          printing: { ...current.printing, ...patch.printing },
        };
      }

      const [updated] = await tx
        .update(schema.tenants)
        .set(updateData)
        .where(eq(schema.tenants.id, tenantId))
        .returning();

      if (!updated) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "Business not found");
      }

      await this.writeAudit(
        tx,
        tenantId,
        operator.id,
        "update_tenant",
        `Updated tenant configuration`,
      );

      return {
        ...updated,
        plan: resolvePlan(updated.planId),
        trial: trialStatus(updated.planId, updated.trialEndsAt, new Date()),
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
          trialEndsAt: dto.planId === "trial" ? existing.trialEndsAt : null,
          ...(dto.subscriptionEndsAt !== undefined
            ? {
                subscriptionEndsAt: dto.subscriptionEndsAt
                  ? new Date(dto.subscriptionEndsAt)
                  : null,
              }
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
   * The session this mints is deliberately constrained: it carries the
   * operator's id as `impersonatedBy` (so every audit row it writes records
   * who was really at the keyboard) and it gets no refresh token (so it dies
   * with its access token instead of becoming a standing cross-tenant
   * credential). `POST /admin/impersonation/end` closes it early and returns
   * the operator to their own session.
   */
  async impersonate(
    tenantId: string,
    dto: ImpersonateDto,
  ): Promise<AuthSession & { impersonated: true }> {
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
        // Deterministic: without an ordering, which administrator you become
        // is whatever Postgres happens to return first, and can change between
        // two calls on identical data. Support work has to be reproducible.
        .orderBy(asc(schema.users.createdAt), asc(schema.users.id))
        .limit(1);

      const admin = rows[0]?.user;
      if (!admin) {
        throw new AppError(
          ERROR_CODES.NOT_FOUND,
          "That business has no active administrator",
        );
      }

      await this.writeAudit(
        tx,
        tenantId,
        operator.id,
        "impersonate",
        `Operator ${operator.id} impersonated admin ${admin.id}: ${dto.reason}`,
      );

      return admin;
    });

    this.logger.warn(
      { tenantId, operatorId: operator.id, targetUserId: target.id, reason: dto.reason },
      "IMPERSONATION started",
    );

    const session = await this.auth.issueSessionFor(target.id, tenantId, {
      impersonatedBy: operator.id,
    });
    return { ...session, impersonated: true };
  }

  /**
   * End an impersonation session and hand the operator their own back.
   *
   * Authenticated by the impersonation token itself: it is signed by this
   * server and carries `impersonatedBy`, which is proof this server created
   * the session for that operator. Nothing client-side is trusted, which
   * matters because the operator's own token is not available here — they are
   * holding the impersonated one.
   *
   * The operator is re-verified before a session is minted. Being an operator
   * when the impersonation started does not entitle them to one now: if they
   * were deactivated or demoted mid-session, they get nothing back and have to
   * sign in again.
   */
  async endImpersonation(): Promise<AuthSession> {
    const acting = RequestContext.requireUser();
    const operatorId = acting.impersonatedBy;

    if (!operatorId) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_PERMISSIONS,
        "This session is not an impersonation",
      );
    }

    const operator = await this.db.runAsPlatformAdmin(async (tx) => {
      const found = await tx.query.users.findFirst({
        where: (u, { and: a, eq: e, isNull: n }) =>
          a(e(u.id, operatorId), e(u.isActive, true), n(u.deletedAt)),
      });

      // Written whether or not the operator can be restored — the point is
      // that the session ended, and how long it lasted.
      if (acting.tenantId) {
        await this.writeAudit(
          tx,
          acting.tenantId,
          operatorId,
          "impersonate_end",
          `Operator ${operatorId} ended impersonation of user ${acting.id}`,
        );
      }

      return found;
    });

    if (!operator?.isPlatformAdmin) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_PERMISSIONS,
        "Your operator account is no longer active. Sign in again.",
      );
    }

    this.logger.warn(
      { operatorId, targetUserId: acting.id, tenantId: acting.tenantId },
      "IMPERSONATION ended",
    );

    return this.auth.issueSessionFor(operator.id, operator.tenantId);
  }

  /** List platform-wide audit log events. */
  async listAuditLogs(query: ListAuditLogsDto): Promise<Paginated<unknown>> {
    const { page, limit, entityType, action, tenantId, from, to } = query;
    const offset = (page - 1) * limit;

    const where = and(
      entityType ? eq(schema.auditLog.entityType, entityType) : undefined,
      action ? eq(schema.auditLog.action, action) : undefined,
      tenantId ? eq(schema.auditLog.tenantId, tenantId) : undefined,
      from ? gte(schema.auditLog.createdAt, new Date(from)) : undefined,
      to ? lte(schema.auditLog.createdAt, new Date(to)) : undefined,
    );

    // `users` is already joined for the row's subject, so the operator needs
    // its own alias to be joined a second time.
    const operatorUser = alias(schema.users, "operator_user");

    return this.db.runAsPlatformAdmin(async (tx) => {
      const [rows, [totals]] = await Promise.all([
        tx
          .select({
            id: schema.auditLog.id,
            tenantId: schema.auditLog.tenantId,
            tenantName: schema.tenants.name,
            tenantSlug: schema.tenants.slug,
            userId: schema.auditLog.userId,
            userName: schema.users.name,
            branchId: schema.auditLog.branchId,
            entityType: schema.auditLog.entityType,
            entityId: schema.auditLog.entityId,
            action: schema.auditLog.action,
            changes: schema.auditLog.changes,
            reason: schema.auditLog.reason,
            ipAddress: schema.auditLog.ipAddress,
            requestId: schema.auditLog.requestId,
            createdAt: schema.auditLog.createdAt,
            // Who was REALLY at the keyboard. Null on anything the customer
            // did themselves, which is almost everything.
            impersonatedBy: schema.auditLog.impersonatedBy,
            impersonatedByName: operatorUser.name,
          })
          .from(schema.auditLog)
          .leftJoin(schema.tenants, eq(schema.auditLog.tenantId, schema.tenants.id))
          .leftJoin(schema.users, eq(schema.auditLog.userId, schema.users.id))
          .leftJoin(operatorUser, eq(schema.auditLog.impersonatedBy, operatorUser.id))
          .where(where)
          .orderBy(desc(schema.auditLog.createdAt))
          .limit(limit)
          .offset(offset),
        tx.select({ v: count() }).from(schema.auditLog).where(where),
      ]);

      const total = totals?.v ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      return {
        items: rows,
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

  /** Real-time system diagnostics and health status. */
  async systemHealth() {
    const start = Date.now();
    let dbOk = false;
    let dbLatencyMs = -1;

    try {
      await this.db.runAsPlatformAdmin(async (tx) => {
        await tx.execute(sql`SELECT 1`);
      });
      dbOk = true;
      dbLatencyMs = Date.now() - start;
    } catch {
      dbOk = false;
    }

    const memory = process.memoryUsage();
    const uptimeSeconds = process.uptime();

    const system = {
      uptimeSeconds: Math.floor(uptimeSeconds),
      uptimeFormatted: formatUptime(uptimeSeconds),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV ?? "development",
      memoryUsage: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
      },
    };

    /**
     * `degraded` used to be unreachable.
     *
     * The only branch that could set `dbOk = false` was a dead database — and
     * the code then went straight on to run three more queries against it,
     * which threw and turned the whole endpoint into a 500. The one condition
     * this endpoint exists to report was the one condition it could not
     * report. Bail out with what we know instead.
     */
    if (!dbOk) {
      return {
        status: "degraded" as const,
        timestamp: new Date().toISOString(),
        database: { connected: false, latencyMs: -1 },
        system,
        counts: { activeTenants: 0, activeUsers: 0, activeDevices: 0 },
      };
    }

    return this.db.runAsPlatformAdmin(async (tx) => {
      const [[tenantsCount], [usersCount], [devicesCount]] = await Promise.all([
        tx
          .select({ v: count() })
          .from(schema.tenants)
          .where(
            and(isNull(schema.tenants.deletedAt), eq(schema.tenants.isActive, true)),
          ),
        tx
          .select({ v: count() })
          .from(schema.users)
          .where(and(isNull(schema.users.deletedAt), eq(schema.users.isActive, true))),
        tx
          .select({ v: count() })
          .from(schema.devices)
          .where(eq(schema.devices.isActive, true)),
      ]);

      return {
        status: "healthy" as const,
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          latencyMs: dbLatencyMs,
        },
        system,
        counts: {
          activeTenants: tenantsCount?.v ?? 0,
          activeUsers: usersCount?.v ?? 0,
          activeDevices: devicesCount?.v ?? 0,
        },
      };
    });
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
      // `main.ts` configures `trust proxy` specifically so this is the caller's
      // real address rather than the load balancer's. These are the most
      // privileged actions in the system; they are exactly the ones worth
      // being able to trace back to a source.
      ...(RequestContext.get()?.ipAddress
        ? { ipAddress: RequestContext.get()!.ipAddress }
        : {}),
      // Also on the dedicated column, so "everything this operator ever did"
      // is one indexed query rather than a JSONB scan.
      impersonatedBy: operatorId,
    });
  }
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}
