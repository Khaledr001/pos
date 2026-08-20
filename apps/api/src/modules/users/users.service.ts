import { and, asc, count, eq, ilike, isNull, or, schema } from "@devsfleet/db";
import type { Paginated } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import bcrypt from "bcryptjs";
import {
  assertMayGrantAbac,
  assertMayGrantPermissions,
} from "../../common/context/authority.js";
import { RequestContext } from "../../common/context/request-context.js";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import type { Env } from "../../config/env.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type {
  CreateUserDto,
  ListUsersDto,
  SetPasswordDto,
  SetPinDto,
  UpdateUserDto,
} from "./dto.js";

/**
 * Staff management.
 *
 * Two rules run through everything here:
 *
 *   - A password hash or PIN hash NEVER leaves this service. Every read
 *     projects an explicit column list rather than selecting the row, so
 *     adding a secret column later cannot accidentally start returning it.
 *   - A tenant must never be able to lock itself out. The last active
 *     administrator cannot be deactivated, demoted, or deleted.
 */
@Injectable()
export class UsersService {
  /** The only columns any read returns. Secrets are absent by construction. */
  private readonly publicColumns = {
    id: schema.users.id,
    name: schema.users.name,
    email: schema.users.email,
    phone: schema.users.phone,
    roleId: schema.users.roleId,
    branchId: schema.users.branchId,
    locale: schema.users.locale,
    isActive: schema.users.isActive,
    lastLoginAt: schema.users.lastLoginAt,
    maxDiscountPercent: schema.users.maxDiscountPercent,
    maxSaleAmount: schema.users.maxSaleAmount,
    canApproveRefund: schema.users.canApproveRefund,
    canViewCost: schema.users.canViewCost,
    allowedBranchIds: schema.users.allowedBranchIds,
    createdAt: schema.users.createdAt,
  };

  constructor(
    private readonly db: TenantDatabase,
    private readonly planLimits: PlanLimitService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async list(query: ListUsersDto): Promise<Paginated<unknown>> {
    const { page, limit, q, roleId, branchId, includeInactive } = query;
    const offset = (page - 1) * limit;

    const where = and(
      isNull(schema.users.deletedAt),
      includeInactive ? undefined : eq(schema.users.isActive, true),
      roleId ? eq(schema.users.roleId, roleId) : undefined,
      branchId ? eq(schema.users.branchId, branchId) : undefined,
      q
        ? or(ilike(schema.users.name, `%${q}%`), ilike(schema.users.email, `%${q}%`))
        : undefined,
    );

    return this.db.run(async (tx) => {
      const [items, [totals]] = await Promise.all([
        tx
          .select({ ...this.publicColumns, roleName: schema.roles.name })
          .from(schema.users)
          .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
          .where(where)
          .orderBy(asc(schema.users.name))
          .limit(limit)
          .offset(offset),
        tx.select({ value: count() }).from(schema.users).where(where),
      ]);

      const total = totals?.value ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      return {
        items,
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

  async findById(id: string): Promise<unknown> {
    const [user] = await this.db.run(async (tx) =>
      tx
        .select({ ...this.publicColumns, roleName: schema.roles.name })
        .from(schema.users)
        .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
        .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
        .limit(1),
    );

    if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, `User ${id} not found`);
    return user;
  }

  async create(dto: CreateUserDto): Promise<unknown> {
    this.planLimits.assertTrialActive();
    await this.planLimits.assertCanCreate("users");

    const tenantId = RequestContext.requireTenantId();
    const rounds = this.config.get("BCRYPT_ROUNDS", { infer: true });

    if (dto.pin) await this.assertPinIsUnambiguous(dto.pin, dto.branchId ?? null);

    // Hashed outside the transaction — bcrypt at 12 rounds is ~250ms of lock
    // time that buys nothing.
    const passwordHash = await bcrypt.hash(dto.password, rounds);
    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, rounds) : null;

    return this.db.run(async (tx) => {
      const role = await tx.query.roles.findFirst({
        where: (t, { eq: e }) => e(t.id, dto.roleId),
      });
      if (!role) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "That role does not exist");

      // Without this, `user:write` was the only permission anybody needed:
      // create an account holding the owner's role, then sign in as it.
      assertMayGrantPermissions(role.permissions, "That role");
      assertMayGrantAbac(dto);

      const [user] = await tx
        .insert(schema.users)
        .values({
          tenantId,
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          roleId: dto.roleId,
          branchId: dto.branchId ?? null,
          locale: dto.locale,
          passwordHash,
          pinHash,
          maxDiscountPercent: String(dto.maxDiscountPercent ?? 0),
          maxSaleAmount:
            dto.maxSaleAmount === null || dto.maxSaleAmount === undefined
              ? null
              : String(dto.maxSaleAmount),
          canApproveRefund: dto.canApproveRefund ?? false,
          canViewCost: dto.canViewCost ?? false,
          allowedBranchIds: dto.allowedBranchIds ?? [],
        })
        .returning(this.publicColumns);

      if (!user) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the user");
      return user;
    });
  }

  async update(id: string, dto: UpdateUserDto): Promise<unknown> {
    if (Object.keys(dto).length === 0) return this.findById(id);

    return this.db.run(async (tx) => {
      // You may not edit somebody who outranks you — otherwise a manager
      // demotes the owner, or promotes themselves by editing their own row.
      await this.assertMayManage(tx, id);

      if (dto.roleId) {
        const role = await tx.query.roles.findFirst({
          where: (t, { eq: e }) => e(t.id, dto.roleId!),
        });
        if (!role) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "That role does not exist");
        assertMayGrantPermissions(role.permissions, "That role");
      }
      assertMayGrantAbac(dto);

      // Losing the last administrator means nobody can create another one, and
      // recovery needs a platform operator. Refuse both routes into it.
      if (dto.isActive === false || dto.roleId) {
        await this.assertNotLastAdmin(tx, id, dto);
      }

      const [user] = await tx
        .update(schema.users)
        .set({
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.roleId !== undefined ? { roleId: dto.roleId } : {}),
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.maxDiscountPercent !== undefined
            ? { maxDiscountPercent: String(dto.maxDiscountPercent) }
            : {}),
          ...(dto.maxSaleAmount !== undefined
            ? {
                maxSaleAmount:
                  dto.maxSaleAmount === null ? null : String(dto.maxSaleAmount),
              }
            : {}),
          ...(dto.canApproveRefund !== undefined
            ? { canApproveRefund: dto.canApproveRefund }
            : {}),
          ...(dto.canViewCost !== undefined ? { canViewCost: dto.canViewCost } : {}),
          ...(dto.allowedBranchIds !== undefined
            ? { allowedBranchIds: dto.allowedBranchIds }
            : {}),
        })
        .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
        .returning(this.publicColumns);

      if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, `User ${id} not found`);
      return user;
    });
  }

  /**
   * Deactivate, not delete.
   *
   * A user is referenced by every sale they rang, every stock adjustment they
   * made and every audit row. Removing the row would orphan years of history,
   * and "who did this?" is the question an audit trail exists to answer.
   */
  async deactivate(id: string): Promise<void> {
    if (id === RequestContext.requireUser().id) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        "You cannot deactivate your own account",
      );
    }

    await this.db.run(async (tx) => {
      await this.assertMayManage(tx, id);
      await this.assertNotLastAdmin(tx, id, { isActive: false });

      const [user] = await tx
        .update(schema.users)
        .set({ isActive: false })
        .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
        .returning({ id: schema.users.id });

      if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, `User ${id} not found`);

      // Kill their live sessions, or a deactivated cashier keeps selling until
      // their refresh token expires — 90 days on a POS terminal.
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(schema.refreshTokens.userId, id), isNull(schema.refreshTokens.revokedAt)),
        );
    });
  }

  async setPassword(id: string, dto: SetPasswordDto): Promise<void> {
    const rounds = this.config.get("BCRYPT_ROUNDS", { infer: true });
    const passwordHash = await bcrypt.hash(dto.password, rounds);

    await this.db.run(async (tx) => {
      /**
       * The shortest escalation path of the lot: with `user:write` and no check
       * here, a branch manager reset the owner's password and signed in as
       * them. No new account, no role change, nothing to notice in a user list.
       */
      await this.assertMayManage(tx, id);

      const [user] = await tx
        .update(schema.users)
        .set({ passwordHash, failedLoginCount: 0, lockedUntil: null })
        .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
        .returning({ id: schema.users.id });

      if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, `User ${id} not found`);

      // Every existing session dies. A password change that leaves old
      // sessions alive does not actually revoke access.
      await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(schema.refreshTokens.userId, id), isNull(schema.refreshTokens.revokedAt)),
        );
    });
  }

  async setPin(id: string, dto: SetPinDto): Promise<void> {
    const rounds = this.config.get("BCRYPT_ROUNDS", { infer: true });

    if (dto.pin) {
      // Against THIS user's branch, not the caller's — a manager may be
      // setting a PIN for staff at a branch they oversee but do not sit at.
      const target = await this.db.run(async (tx) =>
        tx.query.users.findFirst({
          where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)),
          columns: { branchId: true },
        }),
      );
      if (!target) throw new AppError(ERROR_CODES.NOT_FOUND, `User ${id} not found`);

      // `id` is excluded: re-setting somebody's PIN to what they already have
      // is a no-op, not a collision with themselves.
      await this.assertPinIsUnambiguous(dto.pin, target.branchId, id);
    }

    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, rounds) : null;

    await this.db.run(async (tx) => {
      // A PIN is a credential like any other: setting the owner's would let a
      // manager sign in as them at any till.
      await this.assertMayManage(tx, id);

      const [user] = await tx
        .update(schema.users)
        .set({ pinHash })
        .where(and(eq(schema.users.id, id), isNull(schema.users.deletedAt)))
        .returning({ id: schema.users.id });

      if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, `User ${id} not found`);
    });
  }

  /**
   * Refuse a PIN somebody else at the same branch already answers to.
   *
   * `resolvePinHolder` (auth.service.ts) will not guess between two people
   * sharing a PIN — it refuses the sign-in outright, because attributing a
   * shift's sales and drawer counts to the wrong cashier is worse. That
   * refusal is the right call but it surfaces at the till, mid-shift, to a
   * cashier who cannot fix it. Checking here moves the failure to the person
   * actually choosing the PIN, while they are still looking at the form.
   *
   * Branch reachability mirrors `resolvePinHolder` exactly: a user with no
   * branch (an owner, an area manager) is a candidate at EVERY branch, so
   * they collide with everyone; a branch user collides only within their own
   * branch, plus those tenant-wide users.
   *
   * Deliberately not a database constraint: bcrypt salts every hash, so two
   * rows holding the same PIN do not look alike and no unique index can see
   * it. One `compare` per candidate is the only way to know, which is the
   * same cost `resolvePinHolder` already pays on every sign-in.
   *
   * What this CANNOT cover, for the same reason: MOVING a user to a branch
   * where somebody already holds their PIN. Only the hash is stored, so there
   * is no plaintext to re-check them against at that moment.
   * `resolvePinHolder` staying strict is what still catches that one.
   */
  private async assertPinIsUnambiguous(
    pin: string,
    branchId: string | null,
    exceptUserId?: string,
  ): Promise<void> {
    const candidates = await this.db.run(async (tx) =>
      tx
        .select({
          id: schema.users.id,
          name: schema.users.name,
          branchId: schema.users.branchId,
          pinHash: schema.users.pinHash,
        })
        .from(schema.users)
        .where(and(eq(schema.users.isActive, true), isNull(schema.users.deletedAt))),
    );

    for (const candidate of candidates) {
      if (!candidate.pinHash) continue;
      if (candidate.id === exceptUserId) continue;
      // Reachable together at some branch?
      const sharesABranch =
        branchId === null || candidate.branchId === null || candidate.branchId === branchId;
      if (!sharesABranch) continue;

      if (await bcrypt.compare(pin, candidate.pinHash)) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `${candidate.name} already uses that PIN at this branch. Two people sharing a PIN ` +
            "cannot sign in at all — pick a different one.",
        );
      }
    }
  }

  /**
   * Refuse acting on a user who holds more than the caller does.
   *
   * Read inside the caller's transaction so a concurrent role change cannot
   * slip between the check and the write.
   */
  private async assertMayManage(
    tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0],
    userId: string,
  ): Promise<void> {
    const [target] = await tx
      .select({ permissions: schema.roles.permissions })
      .from(schema.users)
      .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);

    // Absent is not a permission problem; the caller's own query reports 404.
    if (!target) return;

    assertMayGrantPermissions(target.permissions, "That user");
  }

  /**
   * Refuse anything that would leave the tenant with no active administrator.
   *
   * Checked inside the caller's transaction, so a concurrent demotion of the
   * other admin cannot slip between the count and the update.
   */
  private async assertNotLastAdmin(
    tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0],
    userId: string,
    change: { isActive?: boolean; roleId?: string },
  ): Promise<void> {
    const [target] = await tx
      .select({ roleName: schema.roles.name })
      .from(schema.users)
      .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (target?.roleName !== "admin") return;

    // Moving to another admin role is fine; only leaving the role matters.
    if (change.roleId) {
      const newRole = await tx.query.roles.findFirst({
        where: (t, { eq: e }) => e(t.id, change.roleId!),
      });
      if (newRole?.name === "admin") return;
    }

    const [remaining] = await tx
      .select({ value: count() })
      .from(schema.users)
      .innerJoin(schema.roles, eq(schema.users.roleId, schema.roles.id))
      .where(
        and(
          eq(schema.roles.name, "admin"),
          eq(schema.users.isActive, true),
          isNull(schema.users.deletedAt),
        ),
      );

    if ((remaining?.value ?? 0) <= 1) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        "This is the last administrator. Promote someone else first, or the " +
          "business would be locked out of its own account.",
      );
    }
  }
}
