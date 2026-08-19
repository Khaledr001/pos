import { SUPERUSER_PERMISSION, type PermissionGrant } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { RequestContext } from "./request-context.js";

/**
 * Nobody hands out authority they do not hold themselves.
 *
 * `user:write` is a single permission, and without this it was a complete one:
 * a branch manager who could add staff could give the new account the owner's
 * role, or simply set their own `roleId` to it, and sign in with `*`. The same
 * permission also reset passwords, so the shortest path did not even need a
 * new account — reset the owner's password and log in as them.
 *
 * Two rules, both enforced here:
 *
 *   GRANT   the role being assigned may not carry a permission the caller
 *           lacks. `*` is therefore only assignable by somebody who holds `*`.
 *   MANAGE  the user being edited may not currently hold more than the caller,
 *           which is what stops a manager touching the owner's credentials.
 *
 * A platform operator and a `*` holder are exempt: the first is provisioning
 * tenants, and the second already has everything there is to escalate to.
 */
export function assertMayGrantPermissions(
  target: readonly PermissionGrant[],
  subject: string,
): void {
  const user = RequestContext.get()?.user;
  if (!user || user.isPlatformAdmin) return;
  if (user.permissions.includes(SUPERUSER_PERMISSION)) return;

  const held = new Set<string>(user.permissions);
  const excess = target.filter((p) => !held.has(p));
  if (excess.length === 0) return;

  throw new AppError(
    ERROR_CODES.INSUFFICIENT_PERMISSIONS,
    `${subject} carries access you do not have yourself: ${excess.slice(0, 5).join(", ")}` +
      (excess.length > 5 ? `, and ${excess.length - 5} more` : ""),
  );
}

/** The per-user ceilings a grant may set. A subset of AbacAttributes. */
interface AbacGrant {
  maxDiscountPercent?: number | string;
  maxSaleAmount?: number | string | null;
  canApproveRefund?: boolean;
  canViewCost?: boolean;
  allowedBranchIds?: string[];
}

/**
 * The same rule applied to the ABAC ceilings, which are not permissions but
 * are exactly as escalatable: a cashier capped at 5% discount who can raise
 * their own cap to 100% has no cap.
 *
 * `maxSaleAmount: null` and `allowedBranchIds: []` both mean "no limit", so
 * they are the values a limited caller must not be able to write.
 */
export function assertMayGrantAbac(next: AbacGrant): void {
  const user = RequestContext.get()?.user;
  if (!user || user.isPlatformAdmin) return;
  if (user.permissions.includes(SUPERUSER_PERMISSION)) return;

  const mine = user.abac;
  const refuse = (what: string): never => {
    throw new AppError(
      ERROR_CODES.INSUFFICIENT_PERMISSIONS,
      `You cannot grant a ${what} above your own`,
    );
  };

  if (
    next.maxDiscountPercent !== undefined &&
    Number(next.maxDiscountPercent) > Number(mine.maxDiscountPercent)
  ) {
    refuse("discount limit");
  }

  if (next.maxSaleAmount !== undefined && mine.maxSaleAmount !== null) {
    if (next.maxSaleAmount === null) refuse("sale limit");
    if (Number(next.maxSaleAmount) > Number(mine.maxSaleAmount)) refuse("sale limit");
  }

  if (next.canApproveRefund && !mine.canApproveRefund) refuse("refund approval right");
  if (next.canViewCost && !mine.canViewCost) refuse("cost visibility right");

  // An empty list on the caller means every branch, so there is nothing they
  // could grant that exceeds it.
  if (next.allowedBranchIds !== undefined && mine.allowedBranchIds.length > 0) {
    if (next.allowedBranchIds.length === 0) refuse("branch scope");
    const outside = next.allowedBranchIds.filter((b) => !mine.allowedBranchIds.includes(b));
    if (outside.length > 0) refuse("branch scope");
  }
}
