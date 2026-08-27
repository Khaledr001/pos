import { and, eq, isNull, schema } from "@devsfleet/db";
import {
  hasPermission,
  type AuthSession,
  type Permission,
  type AuthenticatedUser,
  type AuthTokens,
  type JwtPayload,
} from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import type { Env } from "../../config/env.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { LoginDto, ManagerOverrideDto, PinLoginDto, RefreshDto } from "./dto.js";

/** A user row joined to the role that carries their permissions. */
interface PinHolder {
  user: typeof schema.users.$inferSelect;
  role: typeof schema.roles.$inferSelect;
}

/**
 * What a terminal learns from an approved override.
 *
 * A name and an id. Not a token, not a permission list — the terminal is being
 * told the answer to one question, not handed the approver's authority.
 */
export interface ManagerOverrideResult {
  approvedBy: { id: string; name: string };
  permission: Permission;
  /** Signed proof, for the terminal to attach to whatever it was approving. */
  grant: string;
  /** Seconds until `grant` stops being accepted. */
  expiresIn: number;
}

/**
 * How long an approval remains attachable.
 *
 * One shift. The sale it authorises may sit in an offline terminal's outbox
 * for hours, so minutes are useless; days would turn a single approval into a
 * standing permission somebody could keep reusing.
 */
const OVERRIDE_GRANT_TTL_SECONDS = 12 * 60 * 60;

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

  /**
   * A hash of a random value nothing can match, at the SAME cost as a real
   * password, so a failed login takes the same time whether or not the account
   * exists.
   *
   * Computed rather than hardcoded, because a literal pins the cost factor.
   * The one that used to live here was `$2b$12$…` while a deployment running
   * `BCRYPT_ROUNDS=10` hashed real users four times cheaper — so an unknown
   * email was measurably SLOWER than a known one, which is the enumeration
   * oracle the dummy exists to close, just pointing the other way.
   *
   * Warmed at construction so the first failed login does not pay for it.
   */
  private readonly dummyHash: Promise<string>;

  constructor(
    private readonly db: TenantDatabase,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.dummyHash = bcrypt.hash(
      randomBytes(24).toString("hex"),
      this.config.get("BCRYPT_ROUNDS", { infer: true }),
    );
  }

  async login(dto: LoginDto): Promise<AuthSession> {
    // No tenant context yet — the tenant is what we are resolving.
    const candidates = await this.db.runAsPlatformAdmin(async (tx) => {
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
        // Two rows is the interesting case, so the query has to be able to see
        // it. Three is enough to distinguish "one" from "more than one".
        .limit(3);
      return rows;
    });

    /**
     * One address, two businesses.
     *
     * A contractor who keeps the books for two tenants signs up with the same
     * email at both. This used to `.limit(1)` with no ORDER BY and no tie-break,
     * so the same credentials landed them in whichever business the planner
     * happened to emit first — and the password that "worked yesterday" failed
     * today because it belonged to the other account.
     *
     * The password is therefore checked against EVERY candidate before the
     * ambiguity is decided. Two accounts at two businesses almost always have
     * two different passwords, so the usual case resolves to exactly one and
     * nobody is asked anything. Only a genuine collision — same email, same
     * password, two tenants — needs `tenantSlug`, and being told about it
     * requires already knowing a working password, so it is not an enumeration
     * oracle.
     *
     * The cost is one bcrypt round per candidate, so a response time does still
     * hint at how many businesses share an address. That is a far weaker signal
     * than "does this account exist", which is the one worth closing, and the
     * `.limit(3)` above bounds it.
     */
    const verified: typeof candidates = [];
    for (const candidate of candidates) {
      if (await bcrypt.compare(dto.password, candidate.user.passwordHash)) {
        verified.push(candidate);
      }
    }

    /**
     * The dummy compare keeps the timing flat.
     *
     * bcrypt takes ~250ms at 12 rounds. Returning early on an unknown email
     * would make "this account exists" measurable from response time alone,
     * which is a free account-enumeration oracle. The loop above does no work
     * when there are no candidates, so one comparison is done here instead.
     */
    if (candidates.length === 0) await bcrypt.compare(dto.password, await this.dummyHash);

    if (verified.length > 1) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        "That email and password work at more than one business. Name the one you want.",
      );
    }

    const found = verified[0];
    const passwordOk = verified.length === 1;

    /**
     * Lockout is checked AFTER the compare above but reported before the
     * credential result, so "locked" and "wrong password" cost the same time —
     * otherwise the difference tells an attacker their guessing is working.
     *
     * Read from every candidate, not just the matched one: a locked account
     * must stay locked whether or not this particular guess was right.
     */
    const locked = (found ? [found] : candidates)
      .map((c) => lockoutRemaining(c.user.lockedUntil))
      .find(Boolean);

    if (locked) {
      throw new AppError(
        ERROR_CODES.ACCOUNT_LOCKED,
        `Too many failed attempts. Try again in ${locked}.`,
      );
    }

    if (!found || !passwordOk) {
      /**
       * Counted against EVERY candidate the guess was tested against.
       *
       * Attributing it only to a single candidate would mean an email
       * registered at two businesses could never be locked out at all — the
       * guessing would simply never be counted anywhere.
       */
      for (const candidate of candidates) {
        await this.recordFailedAttempt(candidate.tenant.id, candidate.user);
      }
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
        // A successful login clears the failure counter. Leaving it to decay
        // would lock out someone who mistyped twice this morning and twice
        // this afternoon.
        .set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null })
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
        maxDiscountPercent: found.user.maxDiscountPercent,
        isPlatformAdmin: found.user.isPlatformAdmin,
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

    /**
     * A suspended business cannot sell.
     *
     * `login()` has always checked this; this path did not, so a tenant
     * suspended for non-payment kept trading at every till — the one place
     * that actually takes money.
     */
    const tenantRow = await this.db.runAsPlatformAdmin(async (tx) =>
      tx.query.tenants.findFirst({ where: (t, { eq: e }) => e(t.id, device.tenantId) }),
    );
    if (!tenantRow) {
      throw new AppError(
        ERROR_CODES.TENANT_INACTIVE,
        "This business is no longer active",
      );
    }
    if (!tenantRow.isActive) {
      throw new AppError(ERROR_CODES.TENANT_SUSPENDED, "This business is suspended");
    }

    const match = await this.resolvePinHolder(device.tenantId, dto.branchId, dto.pin);
    if (!match) throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, "Incorrect PIN");

    await this.db.runAs(device.tenantId, async (tx) => {
      await tx
        .update(schema.users)
        .set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null })
        .where(eq(schema.users.id, match.user.id));
    });

    const tokens = await this.issueTokens({
      user: match.user,
      role: match.role,
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
        id: match.user.id,
        name: match.user.name,
        email: match.user.email,
        roleName: match.role.name,
        permissions: match.role.permissions,
        tenantId: device.tenantId,
        tenantName: tenantRow.name,
        branchId: dto.branchId,
        branchName: null,
        locale: match.user.locale,
        maxDiscountPercent: match.user.maxDiscountPercent,
      },
    };
  }

  /**
   * A supervisor approving one action at somebody else's till.
   *
   * This exists because the POS used to implement an override by calling
   * pin-login: the manager's PIN minted a full token pair and the terminal
   * stored it, so the cashier's session was silently REPLACED by the manager's.
   * Every sale, drawer movement and audit row for the rest of that shift was
   * then attributed to the manager, and the manager's refresh token — a
   * credential with approval rights — was left on the shop floor.
   *
   * So this mints nothing. It answers one question, "may this PIN authorise
   * <permission> here", and writes the trail. The caller's own session carries
   * on unchanged, which is what an override is supposed to mean.
   *
   * The branch and device come from the caller's token, never the body: the
   * one thing worth protecting here is which branch's staff PINs an attacker
   * gets to test, and a body field would let them choose.
   */
  async verifyOverride(
    dto: ManagerOverrideDto,
    caller: AuthenticatedUser,
  ): Promise<ManagerOverrideResult> {
    if (!caller.tenantId || !caller.branchId) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_PERMISSIONS,
        "Overrides can only be approved from a terminal signed in to a branch",
      );
    }

    const match = await this.resolvePinHolder(caller.tenantId, caller.branchId, dto.pin);
    if (!match) throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, "Incorrect PIN");

    /**
     * The permission is checked HERE, not by the terminal.
     *
     * The old flow returned the approver's full permission list to the renderer
     * and let it decide — which made the decision a client-side one, changeable
     * from devtools by anybody holding any valid PIN.
     */
    if (!hasPermission(match.role.permissions, dto.permission)) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_PERMISSIONS,
        `${match.user.name} is not authorised to approve this`,
      );
    }

    /**
     * Written inside the transaction, not left to AuditInterceptor.
     *
     * For an override the trail IS the deliverable — it is the only record that
     * a below-floor price or a refund was authorised by somebody senior. An
     * after-the-fact row that can go missing is not good enough here.
     */
    const store = RequestContext.get();
    await this.db.run(async (tx) => {
      await tx.insert(schema.auditLog).values({
        tenantId: caller.tenantId!,
        branchId: caller.branchId,
        // Who was ACTING. The approver is the entity, below.
        userId: caller.id,
        entityType: "user",
        entityId: match.user.id,
        action: "override",
        reason: dto.reason
          ? `${dto.permission} approved by ${match.user.name}: ${dto.reason}`
          : `${dto.permission} approved by ${match.user.name}`,
        ...(store?.ipAddress ? { ipAddress: store.ipAddress } : {}),
        requestId: RequestContext.requestId,
      });
    });

    this.logger.log(
      {
        approverId: match.user.id,
        cashierId: caller.id,
        branchId: caller.branchId,
        permission: dto.permission,
      },
      "Manager override approved",
    );

    /**
     * The grant is what makes the approval survive the trip to the server.
     *
     * It is scoped to ONE permission, one tenant and one branch, and it is not
     * a session: it authenticates nothing, cannot be refreshed, and carries no
     * permission list. `typ` separates it from an access token signed with the
     * same secret, and jwt.strategy would reject it anyway for having no role.
     */
    const grant = await this.jwt.signAsync(
      {
        typ: "override",
        sub: match.user.id,
        name: match.user.name,
        tenantId: caller.tenantId,
        branchId: caller.branchId,
        permission: dto.permission,
        abac: {
          maxDiscountPercent: match.user.maxDiscountPercent,
          maxSaleAmount: match.user.maxSaleAmount,
        },
      },
      {
        secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
        expiresIn: OVERRIDE_GRANT_TTL_SECONDS,
      },
    );

    // Deliberately narrow otherwise: a name to print on the receipt and an id
    // for the sale to carry. No permission list, no session, nothing to replay
    // as the approver.
    return {
      approvedBy: { id: match.user.id, name: match.user.name },
      permission: dto.permission,
      grant,
      expiresIn: OVERRIDE_GRANT_TTL_SECONDS,
    };
  }

  /**
   * The one person at this branch whose PIN this is.
   *
   * Shared by pinLogin and verifyOverride so the ambiguity rule below cannot be
   * enforced in one path and forgotten in the other.
   *
   * Returns null when nothing matches. THROWS when the account is locked out,
   * and when more than one person answers to the PIN: nothing stops two
   * cashiers choosing 1234, and returning whichever row the planner happened to
   * emit first would attribute a whole shift — every sale, drawer count and
   * audit entry — to the wrong person, silently and unreproducibly. Refusing is
   * recoverable; a manager changes one of the PINs.
   */
  private async resolvePinHolder(
    tenantId: string,
    branchId: string,
    pin: string,
  ): Promise<PinHolder | null> {
    const candidates = await this.db.runAs(tenantId, async (tx) =>
      tx
        .select({ user: schema.users, role: schema.roles })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
        .where(and(eq(schema.users.isActive, true), isNull(schema.users.deletedAt))),
    );

    // A PIN is not unique, so every candidate has to be checked. The set is one
    // branch's staff plus tenant-wide users such as the owner — a handful of
    // rows, not a scan.
    const matches: PinHolder[] = [];
    for (const candidate of candidates) {
      if (!candidate.user.pinHash) continue;
      if (candidate.user.branchId !== null && candidate.user.branchId !== branchId)
        continue;
      if (!(await bcrypt.compare(pin, candidate.user.pinHash))) continue;
      matches.push(candidate);
    }

    if (matches.length > 1) {
      this.logger.error(
        { branchId, count: matches.length },
        "Two staff share a PIN at this branch — refusing to guess which one signed in",
      );
      throw new AppError(
        ERROR_CODES.INVALID_CREDENTIALS,
        "More than one person at this branch uses that PIN. Ask a manager to change it.",
      );
    }

    const [match] = matches;
    if (!match) return null;

    const locked = lockoutRemaining(match.user.lockedUntil);
    if (locked) {
      throw new AppError(
        ERROR_CODES.ACCOUNT_LOCKED,
        `Too many failed attempts. Try again in ${locked}.`,
      );
    }

    return match;
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

    /**
     * A session bound to a terminal dies with the terminal.
     *
     * Without this, "deactivate device" was decorative: `pinLogin` and the sync
     * routes check `devices.isActive`, but nothing stopped the terminal's
     * existing refresh token — POS tokens live 90 days by default — from
     * minting fresh access tokens and calling every other endpoint. A stolen
     * till stayed usable for three months after being switched off in the admin.
     *
     * Checking here, rather than on every request, matches the revocation model
     * this file already documents: the holder is out within one access-token
     * lifetime (15 minutes) rather than instantly, at no per-request cost.
     */
    if (stored.deviceId) {
      const device = await this.db.runAsPlatformAdmin(async (tx) =>
        tx.query.devices.findFirst({
          where: (t, { eq: e }) => e(t.id, stored.deviceId!),
          columns: { id: true, isActive: true },
        }),
      );

      if (!device?.isActive) {
        // Revoke the whole family rather than just refusing: a terminal that
        // has been switched off should not be one restart away from trying
        // again with the same token.
        await this.revokeTokensForDevice(stored.tenantId, stored.deviceId);
        throw new AppError(
          ERROR_CODES.DEVICE_NOT_REGISTERED,
          "This terminal has been deactivated",
        );
      }
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

    /**
     * Rotation only ever runs on a session that HAS a refresh token, so this
     * cannot fire — but `replacedByHash` is what detects a replayed token and
     * kills the family, so leaving it unset would silently disable reuse
     * detection rather than fail. Refuse instead of asserting the type away.
     */
    if (!tokens.refreshToken) {
      throw new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        "Refresh produced no replacement token",
      );
    }
    const replacement = tokens.refreshToken;

    await this.db.runAs(stored.tenantId, async (tx) => {
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date(), replacedByHash: hashToken(replacement) })
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
   *
   * `impersonatedBy` marks the session as a platform operator acting as this
   * user. It stamps the operator's id into the token and suppresses the
   * refresh token, so the session dies with the access token rather than
   * becoming a standing credential — see `PlatformService.impersonate`.
   */
  async issueSessionFor(
    userId: string,
    tenantId: string,
    options: { impersonatedBy?: string } = {},
  ): Promise<AuthSession> {
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
      ...(options.impersonatedBy
        ? { impersonatedBy: options.impersonatedBy, skipRefreshToken: true }
        : {}),
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
        maxDiscountPercent: found.user.maxDiscountPercent,
        isPlatformAdmin: found.user.isPlatformAdmin,
      },
    };
  }

  /**
   * Kill every session belonging to a terminal.
   *
   * Called when a device is deactivated, so "disable this till" takes effect on
   * the next refresh instead of waiting out a 90-day token.
   */
  async revokeTokensForDevice(tenantId: string, deviceId: string): Promise<void> {
    await this.db.runAs(tenantId, async (tx) => {
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.refreshTokens.deviceId, deviceId),
            isNull(schema.refreshTokens.revokedAt),
          ),
        );
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * Count a failed password attempt, and lock the account once they pile up.
   *
   * Only reachable where the user is IDENTIFIED — i.e. the password path. A
   * failed PIN names nobody, so locking on it would let anyone lock out every
   * cashier in a branch by typing wrong numbers; that path is defended by the
   * per-route rate limit instead.
   */
  private async recordFailedAttempt(
    tenantId: string,
    user: typeof schema.users.$inferSelect,
  ): Promise<void> {
    const attempts = user.failedLoginCount + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;

    await this.db.runAs(tenantId, async (tx) => {
      await tx
        .update(schema.users)
        .set({
          // Reset the counter as the lock is applied, so the next lock needs a
          // fresh run of failures rather than tripping on the very next typo.
          failedLoginCount: lock ? 0 : attempts,
          ...(lock ? { lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : {}),
        })
        .where(eq(schema.users.id, user.id));
    });

    if (lock) {
      this.logger.warn(
        { userId: user.id, tenantId },
        `Account locked after ${MAX_FAILED_ATTEMPTS} failed login attempts`,
      );
    }
  }

  private async issueTokens(input: {
    user: typeof schema.users.$inferSelect;
    role: typeof schema.roles.$inferSelect;
    tenant: typeof schema.tenants.$inferSelect;
    isPos: boolean;
    deviceId?: string;
    branchIdOverride?: string;
    /** Stamps the acting platform operator into the token. */
    impersonatedBy?: string;
    /**
     * Mint an access token only. An impersonation session must not be
     * renewable: a refresh token would let an operator hold a foreign tenant's
     * session open indefinitely, long after the support ticket closed.
     */
    skipRefreshToken?: boolean;
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
      ...(input.impersonatedBy ? { impersonatedBy: input.impersonatedBy } : {}),
    };

    const accessTtlMs = parseDuration(this.config.get("JWT_ACCESS_TTL", { infer: true }));
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get("JWT_ACCESS_SECRET", { infer: true }),
      // Seconds, not the "15m" string: jsonwebtoken's types only accept the
      // string form as a narrow literal union, and a value read from env is
      // just `string`.
      expiresIn: Math.floor(accessTtlMs / 1000),
    });

    // An impersonation session ends when its access token does. Minting no
    // refresh token is what makes that true — there is nothing to rotate, and
    // nothing left behind to revoke.
    if (input.skipRefreshToken) {
      return { accessToken, expiresIn: Math.floor(accessTtlMs / 1000) };
    }

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

/** Failures before a password account locks. */
const MAX_FAILED_ATTEMPTS = 5;

/**
 * Fifteen minutes. Long enough that guessing is hopeless, short enough that a
 * cashier who fat-fingered their password is not sent home — a lockout nobody
 * can wait out becomes a support call, and support calls become a shared
 * password taped to the till.
 */
const LOCKOUT_MS = 15 * 60_000;

/**
 * Human-readable time left on a lock, or null if it is not locked.
 *
 * Returns null for a lock that has expired, so the row heals itself on the next
 * attempt without needing a sweep job.
 */
function lockoutRemaining(lockedUntil: Date | null): string | null {
  if (!lockedUntil) return null;
  const ms = lockedUntil.getTime() - Date.now();
  if (ms <= 0) return null;

  const minutes = Math.ceil(ms / 60_000);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
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
