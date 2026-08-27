import type { Locale, Permission, PermissionGrant } from "./index.js";

/**
 * Wire contracts shared by apps/api, apps/admin and apps/pos.
 *
 * Every successful response from the API is wrapped by TransformInterceptor;
 * every failure is shaped by AllExceptionsFilter. Clients can therefore assume
 * exactly two response shapes and never have to guess.
 */

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiError {
  success: false;
  error: {
    /** Stable machine-readable code, e.g. "PRODUCT_NOT_FOUND". Safe to switch on. */
    code: string;
    /** Human-readable, already localised where possible. Safe to display. */
    message: string;
    /** Field-level validation failures, keyed by dotted path. */
    details?: Record<string, string[]>;
  };
  /** Correlates a client-side report with a server log line. */
  requestId: string;
  timestamp: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// -----------------------------------------------------------------------------
// Pagination
// -----------------------------------------------------------------------------

/**
 * Offset pagination. Fine for admin tables.
 * For the 5,000+ product catalogue on the POS, use cursor pagination instead —
 * offset degrades badly past a few thousand rows.
 */
export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface PaginatedMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginatedMeta;
}

/** Cursor pagination — used by sync pulls and large catalogue scans. */
export interface CursorQuery {
  cursor?: string;
  limit?: number;
}

export interface CursorPaginated<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

// -----------------------------------------------------------------------------
// Auth
// -----------------------------------------------------------------------------

/** Decoded access-token body. Mirrored by JwtStrategy in apps/api. */
export interface JwtPayload {
  /** users.id */
  sub: string;
  /** null for a platform operator. */
  tenantId: string | null;
  /** null = the user may act on any branch in the tenant. */
  branchId: string | null;
  roleId: string;
  roleName: string;
  permissions: PermissionGrant[];
  abac: AbacAttributes;
  isPlatformAdmin: boolean;
  planId: string;
  /** ISO instant, or null when the tenant is not on trial. */
  trialEndsAt: string | null;
  /** Present only on tokens minted for a POS terminal. */
  deviceId?: string;
  /**
   * The platform operator acting as this user, on a session minted by
   * `POST /admin/tenants/:id/impersonate`. Absent on every ordinary login.
   *
   * Without this an impersonated session is byte-for-byte indistinguishable
   * from the tenant admin's own, so every audit row written during support
   * work is attributed to the customer. It is signed into the token
   * deliberately: the client cannot set it, and the end-impersonation route
   * trusts nothing else.
   */
  impersonatedBy?: string;
  iat: number;
  exp: number;
}

/**
 * Per-user ceilings, carried in the token so no check costs a query.
 *
 * Always re-validated server-side in the command handler. The client uses them
 * only to disable controls the user would be refused anyway.
 */
export interface AbacAttributes {
  /** 0-100. Highest discount this user may apply, per line and in aggregate. */
  maxDiscountPercent: string;
  /** Decimal string, or null for no ceiling. */
  maxSaleAmount: string | null;
  canApproveRefund: boolean;
  /** Gates purchase price, cost and margin everywhere. */
  canViewCost: boolean;
  /** Branches this user may operate in. Empty = all branches in the tenant. */
  allowedBranchIds: string[];
}

/** What `@CurrentUser()` injects into a controller. */
export interface AuthenticatedUser {
  id: string;
  /** null only for a platform operator, who belongs to no tenant. */
  tenantId: string | null;
  branchId: string | null;
  roleId: string;
  roleName: string;
  permissions: PermissionGrant[];
  abac: AbacAttributes;
  /** Bypasses the tenant filter and every plan limit. */
  isPlatformAdmin: boolean;
  /** The tenant's plan, so limit checks need no lookup. */
  planId: string;
  trialEndsAt: string | null;
  deviceId?: string;
  /** Set when a platform operator is acting as this user. See JwtPayload. */
  impersonatedBy?: string;
}

/**
 * A supervisor's approval, in a form the server will believe later.
 *
 * An override happens at the till, minutes or hours before the sale reaches the
 * server — a terminal can be offline in between. Without something carried on
 * the sale itself, the approval simply evaporates: the push arrives on the
 * CASHIER's token, the cashier still lacks the permission, and the sale is
 * refused with the manager standing right there having approved it.
 *
 * So `POST /auth/verify-override` returns a short-lived JWT signed with the
 * access secret, and the sale carries it. The server re-derives the approver's
 * authority from the grant rather than trusting a user id in the body, which
 * would otherwise be a self-service escalation field.
 */
export interface OverrideGrantPayload {
  /** Distinguishes a grant from an access token signed with the same secret. */
  typ: "override";
  /** users.id of the approver. */
  sub: string;
  name: string;
  tenantId: string;
  branchId: string;
  /** The single permission this grant confers. */
  permission: Permission;
  /** The approver's own ceilings, so an override can lift a discount cap too. */
  abac: Pick<AbacAttributes, "maxDiscountPercent" | "maxSaleAmount">;
  iat: number;
  exp: number;
}

export interface LoginRequest {
  email: string;
  password: string;
  tenantSlug?: string;
}

/** Fast counter login. Scoped to one device, requires a registered deviceId. */
export interface PinLoginRequest {
  pin: string;
  deviceId: string;
  branchId: string;
}

export interface AuthTokens {
  accessToken: string;
  /**
   * Absent on an impersonation session, which is deliberately not renewable —
   * it expires with its access token instead of becoming a standing
   * cross-tenant credential. Every other session has one.
   */
  refreshToken?: string;
  /** Seconds until accessToken expires. */
  expiresIn: number;
}

export interface AuthSession extends AuthTokens {
  user: {
    id: string;
    name: string;
    email: string | null;
    roleName: string;
    permissions: PermissionGrant[];
    tenantId: string;
    tenantName: string;
    branchId: string | null;
    branchName: string | null;
    locale: Locale;
    /**
     * The user's own discount ceiling, so a client can gate the control rather
     * than let somebody type a figure the server will refuse.
     *
     * The other ABAC attributes stay out of the session on purpose: this is
     * the only one a till needs before it can decide what to show. The ceiling
     * is re-checked server-side regardless — see rule 9 in CLAUDE.md.
     */
    maxDiscountPercent: string;
    isPlatformAdmin?: boolean;
  };
}

export interface RefreshRequest {
  refreshToken: string;
}

// -----------------------------------------------------------------------------
// Common query filters
// -----------------------------------------------------------------------------

export interface DateRangeQuery {
  /** ISO date, inclusive. */
  from?: string;
  /** ISO date, inclusive. */
  to?: string;
}

export interface SearchQuery {
  q?: string;
}

/**
 * Branch scoping on a request.
 * Omitted = the caller's own branch. Explicit = requires cross-branch rights.
 */
export interface BranchScopedQuery {
  branchId?: string;
}
