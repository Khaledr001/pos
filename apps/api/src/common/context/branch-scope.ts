import { eq, inArray, type SQL } from "@devsfleet/db";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { RequestContext } from "./request-context.js";

/**
 * Refuse a branch the caller is not scoped to.
 *
 * An empty `allowedBranchIds` means EVERY branch. That is how an owner is
 * represented, and reading empty as "none" would lock them out of their own
 * business — the failure would look like a permissions bug and be debugged as
 * one.
 *
 * This is authorisation, not isolation: RLS already guarantees the row belongs
 * to the tenant. This decides which of that tenant's branches this user may
 * act on.
 */
export function assertBranchInScope(branchId?: string | null): void {
  if (!branchId) return;

  const user = RequestContext.get()?.user;
  if (!user || user.isPlatformAdmin) return;

  const allowed = user.abac.allowedBranchIds;
  if (allowed.length === 0) return;

  if (!allowed.includes(branchId)) {
    throw new AppError(
      ERROR_CODES.INSUFFICIENT_PERMISSIONS,
      "You do not have access to that branch",
    );
  }
}

/**
 * The branches this request may see, or null when that is all of them.
 *
 * `assertBranchInScope` guards a branch the caller NAMED. It does nothing
 * about the far more common case: a list endpoint called with no branch filter
 * at all, which is the default the UI sends. Several of them were returning
 * the whole estate to a manager scoped to one shop — every sale, every drawer
 * count, every terminal.
 *
 * Use it as a filter, not a check:
 *
 *   const scope = branchScope();
 *   const where = and(..., scope ? inArray(table.branchId, scope) : undefined);
 */
export function branchScope(): string[] | null {
  const user = RequestContext.get()?.user;
  if (!user || user.isPlatformAdmin) return null;

  const allowed = user.abac.allowedBranchIds;
  return allowed.length === 0 ? null : [...allowed];
}

/**
 * The branch a request acts on when it does not name one.
 *
 * A POS token is pinned to its terminal's branch, so the common case needs no
 * parameter at all. Falling back to "the first branch" would be worse than
 * failing: it silently books a sale against the wrong shop.
 */
export function requireBranchId(explicit?: string | null): string {
  const branchId = explicit ?? RequestContext.get()?.user?.branchId ?? null;
  if (!branchId) {
    throw new AppError(
      ERROR_CODES.VALIDATION_FAILED,
      "This action needs a branch. Your session is not pinned to one, so name it explicitly.",
    );
  }

  assertBranchInScope(branchId);
  return branchId;
}

/**
 * The branch condition for a LIST query, in one call.
 *
 * Every list used to write `branchId ? eq(col, branchId) : undefined`, which
 * is right when the caller names a branch and wrong when they do not: no
 * branch named — the UI's default — meant no branch condition at all, and a
 * manager scoped to one shop saw quotations, stock, purchase orders and the
 * audit trail of every shop in the business. This applies the named branch
 * (after checking it) or, failing that, the caller's own scope.
 *
 * Rows with a NULL branch (tenant-wide audit events, say) drop out for a
 * scoped caller. That is deliberate: a branch manager has no business reading
 * the owner's settings changes.
 */
export function branchFilter(
  column: Parameters<typeof eq>[0],
  named?: string | null,
): SQL | undefined {
  if (named) {
    assertBranchInScope(named);
    return eq(column, named);
  }
  const scope = branchScope();
  return scope ? inArray(column, scope) : undefined;
}
