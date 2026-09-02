import { eq, schema } from "@devsfleet/db";
import {
  COMMON_UNITS,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_TENANT_SETTINGS,
  SYSTEM_ROLES,
  TRIAL_DAYS,
  type AuthSession,
} from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, slugify } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import bcrypt from "bcryptjs";
import type { Env } from "../../config/env.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { AuthService } from "../auth/auth.service.js";
import { RESERVED_SLUGS, type RegisterTenantDto } from "./dto.js";

/**
 * Self-service signup — the front door of the SaaS.
 *
 * One unauthenticated call turns a form submission into a working business:
 * tenant, owner, roles, a branch, a starter set of units, a default price
 * list, and a signed-in
 * session. No second login, no setup wizard, no empty-state dead end.
 *
 * ALL-OR-NOTHING. Everything happens in one transaction. A half-created tenant
 * — one with no admin user, or no default branch — is worse than a failed
 * signup, because the person cannot get in to fix it and the slug they wanted
 * is now taken.
 */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async register(dto: RegisterTenantDto): Promise<AuthSession> {
    const slug = slugify(dto.slug);
    const email = dto.ownerEmail.toLowerCase().trim();
    const rounds = this.config.get("BCRYPT_ROUNDS", { infer: true });

    // Hash before opening the transaction. bcrypt at 12 rounds takes ~250ms,
    // and holding a write transaction open for that long under signup load is
    // pure lock contention for no reason.
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    const created = await this.db.runAsPlatformAdmin(async (tx) => {
      // Slug uniqueness is also a unique index; checking first only buys a
      // better error message. The index is what actually prevents the race.
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
          "That email already has an account. Sign in instead.",
        );
      }

      const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000);

      const [tenant] = await tx
        .insert(schema.tenants)
        .values({
          name: dto.businessName,
          slug,
          planId: "trial",
          trialEndsAt,
          settings: DEFAULT_TENANT_SETTINGS,
        })
        .returning();
      if (!tenant) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the business");

      // Every role, not just admin. A business that hires its first cashier
      // next week should not need a migration to have somewhere to put them.
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
          name: "Main Branch",
          code: "MAIN",
        })
        .returning();

      // A hardware/electrical/sanitary/paint retailer needs Box and Roll on
      // day one, not just Piece — see COMMON_UNITS.
      await tx.insert(schema.units).values(
        COMMON_UNITS.map((u) => ({ tenantId: tenant.id, ...u })),
      );

      // Without a default price list, the first product created has nowhere to
      // put its price and the pricing resolver has no fallback.
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
          // null = every branch. The owner is not pinned to one.
          branchId: null,
          roleId: roleIds.get("admin")!,
          name: dto.ownerName,
          email,
          passwordHash,
          // The owner gets no ceilings — they are the person who sets everyone
          // else's.
          maxDiscountPercent: "100",
          maxSaleAmount: null,
          canApproveRefund: true,
          canViewCost: true,
          allowedBranchIds: [],
        })
        .returning();
      if (!owner) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the owner account");

      return { tenant, owner, branch };
    });

    this.logger.log(
      { tenantId: created.tenant.id, slug },
      `New business registered: ${dto.businessName}`,
    );

    // Sign them straight in. A signup that ends at a login form loses people
    // who have just proved they know the password.
    return this.auth.issueSessionFor(created.owner.id, created.tenant.id);
  }

  /**
   * Is this slug free? Powers the live check on the signup form.
   *
   * Applies the SAME reserved list the registration schema enforces. Reporting
   * a name as available and then refusing it at submit is the kind of small
   * inconsistency that makes a signup form feel broken.
   */
  async isSlugAvailable(rawSlug: string): Promise<boolean> {
    const slug = slugify(rawSlug);
    if (slug.length < 2) return false;
    if (RESERVED_SLUGS.has(slug)) return false;

    return this.db.runAsPlatformAdmin(async (tx) => {
      const existing = await tx.query.tenants.findFirst({
        where: (t, { eq: e }) => e(t.slug, slug),
        columns: { id: true },
      });
      return !existing;
    });
  }
}
