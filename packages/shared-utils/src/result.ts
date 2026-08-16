/**
 * Result<T, E> for operations whose failure is an expected business outcome
 * rather than a bug: "credit limit exceeded", "below floor price", "SKU already
 * exists in the import file".
 *
 * Throwing for those is wrong twice over — it costs a stack unwind on a hot
 * path (the importer runs this 5,000 times), and it lets a caller forget the
 * case entirely. A Result forces the branch to be written.
 *
 * Genuine faults — a dropped database connection, a null where the type said
 * otherwise — should still throw. Those are for the exception filter.
 */

export type Result<T, E = AppError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;

/** Throw on failure. Use at a boundary where the caller genuinely cannot recover. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error instanceof Error
    ? result.error
    : new Error(`Unwrapped a failed Result: ${JSON.stringify(result.error)}`);
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> {
  return result.ok ? Ok(fn(result.value)) : result;
}

/**
 * A business failure carrying a stable code.
 *
 * `code` is what clients switch on and what gets logged; it must not change
 * once shipped. `message` is for humans and may be reworded freely.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Canonical error codes. Add here, never inline a string literal at a call
 * site — the admin panel and the POS both map these to localised messages.
 */
export const ERROR_CODES = {
  // saas / tenancy
  DUPLICATE_SLUG: "DUPLICATE_SLUG",
  DUPLICATE_EMAIL: "DUPLICATE_EMAIL",
  PLAN_LIMIT_EXCEEDED: "PLAN_LIMIT_EXCEEDED",
  TRIAL_EXPIRED: "TRIAL_EXPIRED",
  TENANT_SUSPENDED: "TENANT_SUSPENDED",
  ACCOUNT_LOCKED: "ACCOUNT_LOCKED",
  ACCOUNT_DISABLED: "ACCOUNT_DISABLED",

  // auth
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  TENANT_INACTIVE: "TENANT_INACTIVE",
  DEVICE_NOT_REGISTERED: "DEVICE_NOT_REGISTERED",

  // catalog
  PRODUCT_NOT_FOUND: "PRODUCT_NOT_FOUND",
  SKU_ALREADY_EXISTS: "SKU_ALREADY_EXISTS",
  BARCODE_ALREADY_EXISTS: "BARCODE_ALREADY_EXISTS",
  DUPLICATE_IMAGE: "DUPLICATE_IMAGE",

  // pricing
  NO_PRICE_FOR_PRODUCT: "NO_PRICE_FOR_PRODUCT",
  BELOW_FLOOR_PRICE: "BELOW_FLOOR_PRICE",
  DISCOUNT_EXCEEDS_LIMIT: "DISCOUNT_EXCEEDS_LIMIT",

  // inventory
  INSUFFICIENT_STOCK: "INSUFFICIENT_STOCK",
  NEGATIVE_STOCK_BLOCKED: "NEGATIVE_STOCK_BLOCKED",
  TRANSFER_INVALID_STATUS: "TRANSFER_INVALID_STATUS",

  // customers
  CREDIT_LIMIT_EXCEEDED: "CREDIT_LIMIT_EXCEEDED",
  CUSTOMER_NOT_FOUND: "CUSTOMER_NOT_FOUND",

  // sales
  SALE_ALREADY_RETURNED: "SALE_ALREADY_RETURNED",
  CASH_SESSION_NOT_OPEN: "CASH_SESSION_NOT_OPEN",
  CASH_SESSION_ALREADY_OPEN: "CASH_SESSION_ALREADY_OPEN",

  // sync
  SYNC_CHECKPOINT_STALE: "SYNC_CHECKPOINT_STALE",
  SYNC_PAYLOAD_INVALID: "SYNC_PAYLOAD_INVALID",

  // generic
  VALIDATION_FAILED: "VALIDATION_FAILED",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
