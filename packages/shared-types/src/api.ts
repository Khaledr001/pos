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
  tenantId: string;
  /** null = the user may act on any branch in the tenant. */
  branchId: string | null;
  roleId: string;
  roleName: string;
  permissions: PermissionGrant[];
  /** Present only on tokens minted for a POS terminal. */
  deviceId?: string;
  iat: number;
  exp: number;
}

/** What `@CurrentUser()` injects into a controller. */
export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  branchId: string | null;
  roleId: string;
  roleName: string;
  permissions: PermissionGrant[];
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
