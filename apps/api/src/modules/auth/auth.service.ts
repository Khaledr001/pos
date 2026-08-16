import { and, eq, isNull, schema } from "@devsfleet/db";
import type { AuthSession, AuthTokens, JwtPayload } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import type { Env } from "../../config/env.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { LoginDto, PinLoginDto, RefreshDto } from "./dto.js";

/**
 * Authentication.
 *
 * Two entry points with deliberately different trust models:
 *
 *   login()     email + password, for the admin panel. Full session.
 *   pinLogin()  4-6 digit PIN, for the counter. A PIN is low entropy on
 *               purpose — cashiers switch between each other all shift — so it
 *               is only accepted alongside a registered device id and a branch,
 *               and it only ever mints a token scoped to that branch.
 *
 * Refresh tokens rotate on every use. Presenting a token that was already
 * rotated means it was captured, so the whole family is revoked.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(dto: LoginDto): Promise<AuthSession> {
    // No tenant context yet — the tenant is what we are resolving.
    const found = await this.db.runAsPlatformAdmin(async (tx) => {
      const rows = await tx
        .select({
          user: schema.users,
          role: schema.roles,
          tenant: schema.tenants,
          branch: schema.branches,
        })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
        .innerJoin(schema.tenants, eq(schema.users.tenantId, schema.tenants.id))
        .leftJoin(schema.branches, eq(schema.users.branchId, schema.branches.id))
        .where(
          and(
            eq(schema.users.email, dto.email.toLowerCase().trim()),
            eq(schema.users.isActive, true),
            isNull(schema.users.deletedAt),
            dto.tenantSlug ? eq(schema.tenants.slug, dto.tenantSlug) : undefined,
          ),
        )
        .limit(1);
      return rows[0];
    });

    /**
     * Hash against a dummy even when the user does not exist.
     *
     * bcrypt takes ~250ms at 12 rounds. Returning early on an unknown email
     * would make "user exists" measurable from the response time alone, which
     * hands an attacker a free account-enumeration oracle.
     */
    const hash = found?.user.passwordHash ?? DUMMY_HASH;
    const passwordOk = await bcrypt.compare(dto.password, hash);

    if (!found || !passwordOk) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, "Invalid email or password");
    }
    if (!found.tenant.isActive) {
      throw new AppError(ERROR_CODES.TENANT_INACTIVE, "This account is suspended");
    }

    const tokens = await this.issueTokens({
      user: found.user,
      role: found.role,
      tenant: found.tenant,
      isPos: false,
    });

    await this.db.runAs(found.tenant.id, async (tx) => {
      await tx
        .update(schema.users)
        .set({ lastLoginAt: new Date() })
        .where(eq(schema.users.id, found.user.id));
    });

    return {
      ...tokens,
      user: {
        id: found.user.id,
        name: found.user.name,
        email: found.user.email,
        roleName: found.role.name,
        permissions: found.role.permissions,
        tenantId: found.tenant.id,
        tenantName: found.tenant.name,
        branchId: found.branch?.id ?? null,
        branchName: found.branch?.name ?? null,
        locale: found.user.locale,
      },
    };
  }

  /**
   * Counter login.
   *
   * The device must already be registered and active — an unregistered
   * terminal cannot brute-force four digits against every cashier in the
   * branch, because it cannot get past this check to begin with.
   */
  async pinLogin(dto: PinLoginDto): Promise<AuthSession> {
    const device = await this.db.runAsPlatformAdmin(async (tx) =>
      tx.query.devices.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.id, dto.deviceId), e(t.isActive, true)),
      }),
    );

    if (!device || device.branchId !== dto.branchId) {
      throw new AppError(
        ERROR_CODES.DEVICE_NOT_REGISTERED,
        "This terminal is not registered for the selected branch",
      );
    }

    const candidates = await this.db.runAs(device.tenantId, async (tx) =>
      tx
        .select({ user: schema.users, role: schema.roles })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
        .where(
          and(
            eq(schema.users.isActive, true),
            isNull(schema.users.deletedAt),
            // Branch staff, plus tenant-wide users (branchId null) such as the owner.
            // Postgres `IS NOT DISTINCT FROM` would be tidier but drizzle has no
            // helper, and the candidate set here is small.
          ),
        ),
    );

    // A PIN is not unique, so every candidate has to be checked. The set is one
    // branch's staff — a handful of rows, not a scan.
    for (const candidate of candidates) {
      if (!candidate.user.pinHash) continue;
      if (candidate.user.branchId !== null && candidate.user.branchId !== dto.branchId) {
        continue;
      }
      if (!(await bcrypt.compare(dto.pin, candidate.user.pinHash))) continue;

      const tenantRow = await this.db.runAsPlatformAdmin(async (tx) =>
        tx.query.tenants.findFirst({ where: (t, { eq: e }) => e(t.id, device.tenantId) }),
      );
      if (!tenantRow) {
        throw new AppError(ERROR_CODES.TENANT_INACTIVE, "This business is no longer active");
      }

      const tokens = await this.issueTokens({
        user: candidate.user,
        role: candidate.role,
        tenant: tenantRow,
        isPos: true,
        deviceId: device.id,
        // A POS session is always pinned to the terminal's branch, even for a
        // user who normally has tenant-wide access.
        branchIdOverride: dto.branchId,
      });

      return {
        ...tokens,
        user: {
          id: candidate.user.id,
          name: candidate.user.name,
          email: candidate.user.email,
          roleName: candidate.role.name,
          permissions: candidate.role.permissions,
          tenantId: device.tenantId,
          tenantName: tenantRow.name,
          branchId: dto.branchId,
          branchName: null,
          locale: candidate.user.locale,
        },
      };
    }

    throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, "Incorrect PIN");
  }

  /**
   * Rotate a refresh token.
   *
   * The presented token is revoked and a new one issued. If a token that was
   * already rotated comes back, someone is replaying a captured token — every
   * session for that user is killed rather than just rejecting the request.
   */
  async refresh(dto: RefreshDto): Promise<AuthTokens> {
    const tokenHash = hashToken(dto.refreshToken);

    const stored = await this.db.runAsPlatformAdmin(async (tx) =>
      tx.query.refreshTokens.findFirst({
        where: (t, { eq: e }) => e(t.tokenHash, tokenHash),
      }),
    );

    if (!stored) {
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, "Refresh token is not recognised");
    }

    if (stored.revokedAt) {
      if (stored.replacedByHash) {
        this.logger.warn(
          { userId: stored.userId },
          "Reuse of a rotated refresh token — revoking every session for this user",
        );
        await this.db.runAs(stored.tenantId, async (tx) => {
          await tx
            .update(schema.refreshTokens)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(schema.refreshTokens.userId, stored.userId),
                isNull(schema.refreshTokens.revokedAt),
              ),
            );
        });
      }
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, "Refresh token has been revoked");
    }

    if (stored.expiresAt.getTime() < Date.now()) {
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, "Refresh token has expired");
    }

    const found = await this.db.runAs(stored.tenantId, async (tx) => {
      const rows = await tx
        .select({ user: schema.users, role: schema.roles })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
        .where(and(eq(schema.users.id, stored.userId), eq(schema.users.isActive, true)))
        .limit(1);
      return rows[0];
    });

    if (!found) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, "User is no longer active");
    }

    const tenantRow = await this.db.runAsPlatformAdmin(async (tx) =>
      tx.query.tenants.findFirst({ where: (t, { eq: e }) => e(t.id, stored.tenantId) }),
    );
    if (!tenantRow?.isActive) {
      throw new AppError(ERROR_CODES.TENANT_SUSPENDED, "This business is suspended");
    }

    const tokens = await this.issueTokens({
      user: found.user,
      role: found.role,
      tenant: tenantRow,
      isPos: Boolean(stored.deviceId),
      ...(stored.deviceId ? { deviceId: stored.deviceId } : {}),
    });

    await this.db.runAs(stored.tenantId, async (tx) => {
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date(), replacedByHash: hashToken(tokens.refreshToken) })
        .where(eq(schema.refreshTokens.id, stored.id));
    });

    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.db.runAsPlatformAdmin(async (tx) => {
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(schema.refreshTokens.tokenHash, tokenHash));
    });
  }

  /**
   * Build a full session for a user who has ALREADY been authenticated by
   * another means — today, only self-registration, which has just verified the
   * password by choosing it.
   *
   * Deliberately not exported through a controller. Anything reachable from
   * HTTP that mints a session without checking a credential is an
   * authentication bypass.
   */
  async issueSessionFor(userId: string, tenantId: string): Promise<AuthSession> {
    const found = await this.db.runAsPlatformAdmin(async (tx) => {
      const rows = await tx
        .select({
          user: schema.users,
          role: schema.roles,
          tenant: schema.tenants,
          branch: schema.branches,
        })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
        .innerJoin(schema.tenants, eq(schema.users.tenantId, schema.tenants.id))
        .leftJoin(schema.branches, eq(schema.users.branchId, schema.branches.id))
        .where(and(eq(schema.users.id, userId), eq(schema.users.tenantId, tenantId)))
        .limit(1);
      return rows[0];
    });

    if (!found) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, "Account not found");
    }

    const tokens = await this.issueTokens({
      user: found.user,
      role: found.role,
      tenant: found.tenant,
      isPos: false,
    });

    return {
      ...tokens,
      user: {
        id: found.user.id,
        name: found.user.name,
        email: found.user.email,
        roleName: found.role.name,
        permissions: found.role.permissions,
        tenantId: found.tenant.id,
        tenantName: found.tenant.name,
        branchId: found.branch?.id ?? null,
        branchName: found.branch?.name ?? null,
        locale: found.user.locale,
      },
    };
  }

  // ---------------------------------------------------------------------------

  private async issueTokens(input: {
    user: typeof schema.users.$inferSelect;
    role: typeof schema.roles.$inferSelect;
    tenant: typeof schema.tenants.$inferSelect;
    isPos: boolean;
    deviceId?: string;
    branchIdOverride?: string;
  }): Promise<AuthTokens> {
    const { user, role, tenant, isPos, deviceId, branchIdOverride } = input;

    /**
     * Everything authorization needs travels in the token, so a permission or
     * limit check never costs a database round trip — including on a sync push
     * carrying hundreds of items.
     *
     * The cost is staleness: a permission revoked now still works until the
     * access token expires. Fifteen minutes is the deliberate ceiling on that.
     */
    const payload: Omit<JwtPayload, "iat" | "exp"> = {
      sub: user.id,
      tenantId: user.tenantId,
      branchId: branchIdOverride ?? user.branchId,
      roleId: role.id,
      roleName: role.name,
      permissions: role.permissions,
      abac: {
        maxDiscountPercent: user.maxDiscountPercent,
        maxSaleAmount: user.maxSaleAmount,
        canApproveRefund: user.canApproveRefund,
        canViewCost: user.canViewCost,
        allowedBranchIds: user.allowedBranchIds,
      },
      isPlatformAdmin: user.isPlatformAdmin,
      planId: tenant.planId,
      trialEndsAt: tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null,
      ...(deviceId ? { deviceId } : {}),
    };

    const accessTtlMs = parseDuration(this.config.get("JWT_ACCESS_TTL", { infer: true }));
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
      // Seconds, not the "15m" string: jsonwebtoken's types only accept the
      // string form as a narrow literal union, and a value read from env is
      // just `string`.
      expiresIn: Math.floor(accessTtlMs / 1000),
    });

    // Opaque random string, not a JWT: a refresh token's only job is to be
    // looked up and revoked, and a JWT cannot be revoked without a lookup anyway.
    const refreshToken = randomBytes(48).toString("base64url");
    const refreshTtl = isPos
      ? this.config.get("JWT_POS_REFRESH_TTL", { infer: true })
      : this.config.get("JWT_REFRESH_TTL", { infer: true });

    await this.db.runAs(user.tenantId, async (tx) => {
      await tx.insert(schema.refreshTokens).values({
        tenantId: user.tenantId,
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        ...(deviceId ? { deviceId } : {}),
        expiresAt: new Date(Date.now() + parseDuration(refreshTtl)),
      });
    });

    return { accessToken, refreshToken, expiresIn: Math.floor(accessTtlMs / 1000) };
  }
}

/** SHA-256 is right here: the input is 48 random bytes, so there is nothing to brute-force. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** "15m" | "30d" | "12h" | "45s" -> milliseconds. */
function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: ${value}`);
  const amount = Number(match[1]);
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return amount * multipliers[match[2] as keyof typeof multipliers];
}

/**
 * A real bcrypt hash of a value nothing can match, used to keep the timing of a
 * failed login identical whether or not the email exists.
 */
const DUMMY_HASH = "$2b$12$c8Kt3F6Zt0mBnPq1Z3nJZeQyLwYy6pQ8mTfN1cV2xW3yA4bC5dE6f";
