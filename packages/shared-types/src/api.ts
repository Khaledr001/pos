import type { Locale, PermissionGrant } from "./index.js";

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
  refreshToken: string;
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
