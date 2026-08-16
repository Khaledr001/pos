/**
 * RBAC permission catalogue.
 *
 * `roles.permissions` is a JSONB array of these strings. The API's RolesGuard
 * checks membership; there is no implicit hierarchy — `admin` is powerful
 * because it is seeded with every permission, not because the code special-cases
 * the name.
 *
 * Format: `<resource>:<action>`. Keep it flat. Resist inventing wildcards
 * beyond the single `*` superuser grant, because a wildcard you have to parse
 * is a permission check you can get wrong.
 */

export const PERMISSIONS = [
  // catalog
  "product:read",
  "product:write",
  "product:delete",
  "product:import",
  "price:read",
  "price:write",
  "price:override", // sell below the price list, above the floor
  "price:override_floor", // sell below min_selling_price — manager only

  // inventory
  "inventory:read",
  "inventory:adjust",
  "inventory:count",
  "transfer:read",
  "transfer:request",
  "transfer:approve",
  "transfer:receive",

  // purchasing
  "supplier:read",
  "supplier:write",
  "purchase:read",
  "purchase:write",
  "purchase:receive",

  // selling
  "customer:read",
  "customer:write",
  "customer:credit", // set credit limit / allow credit sale
  "quotation:read",
  "quotation:write",
  "order:read",
  "order:write",
  "sale:read",
  "sale:create",
  "sale:void",
  "sale:return",
  "sale:discount",

  // cash
  "cash:open",
  "cash:close",
  "cash:movement",
  "payment:read",
  "payment:write",

  // whatsapp
  "whatsapp:read",
  "whatsapp:reply",
  "whatsapp:takeover",

  // admin
  "report:read",
  "report:financial", // cost prices, margins, profit
  "branch:read",
  "branch:write",
  "user:read",
  "user:write",
  "role:write",
  "settings:read",
  "settings:write",
  "device:manage",
  "audit:read",

  // financial operations
  "day_close:read",
  "day_close:manage", // open and close a day — never the cashier who sold on it
  "expense:read",
  "expense:write",
  "expense:delete",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Grants everything. Only the tenant owner role should carry this. */
export const SUPERUSER_PERMISSION = "*" as const;

export type PermissionGrant = Permission | typeof SUPERUSER_PERMISSION;

/**
 * Default permission sets applied when a tenant is created. A tenant admin can
 * edit these afterwards; changing this constant does not retroactively update
 * existing tenants.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly PermissionGrant[]> = {
  admin: [SUPERUSER_PERMISSION],

  manager: [
    "product:read",
    "product:write",
    "product:import",
    "price:read",
    "price:write",
    "price:override",
    "price:override_floor",
    "inventory:read",
    "inventory:adjust",
    "inventory:count",
    "transfer:read",
    "transfer:request",
    "transfer:approve",
    "transfer:receive",
    "supplier:read",
    "supplier:write",
    "purchase:read",
    "purchase:write",
    "purchase:receive",
    "customer:read",
    "customer:write",
    "customer:credit",
    "quotation:read",
    "quotation:write",
    "order:read",
    "order:write",
    "sale:read",
    "sale:create",
    "sale:void",
    "sale:return",
    "sale:discount",
    "cash:open",
    "cash:close",
    "cash:movement",
    "payment:read",
    "payment:write",
    "whatsapp:read",
    "whatsapp:reply",
    "whatsapp:takeover",
    "report:read",
    "report:financial",
    "branch:read",
    "user:read",
    "settings:read",
    "day_close:read",
    "day_close:manage",
    "expense:read",
    "expense:write",
    "expense:delete",
  ],

  /**
   * Deliberately cannot see cost price or margin (`report:financial`), cannot
   * void a sale, and cannot sell below the floor price. Those three together
   * are the shrinkage surface at the counter.
   *
   * `day_close:read` without `day_close:manage` is the same principle: a
   * cashier can see what the drawer should hold, but cannot sign off the day
   * they were selling on.
   */
  cashier: [
    "product:read",
    "price:read",
    "inventory:read",
    "customer:read",
    "customer:write",
    "quotation:read",
    "quotation:write",
    "order:read",
    "sale:read",
    "sale:create",
    "sale:return",
    "sale:discount",
    "cash:open",
    "cash:close",
    "cash:movement",
    "payment:read",
    "payment:write",
    "day_close:read",
    "expense:read",
    "expense:write",
  ],

  warehouse: [
    "product:read",
    "inventory:read",
    "inventory:adjust",
    "inventory:count",
    "transfer:read",
    "transfer:request",
    "transfer:receive",
    "purchase:read",
    "purchase:receive",
    "supplier:read",
  ],
};

/** Single place the guard and the admin UI both call. */
export function hasPermission(
  granted: readonly PermissionGrant[] | null | undefined,
  required: Permission,
): boolean {
  if (!granted || granted.length === 0) return false;
  return granted.includes(SUPERUSER_PERMISSION) || granted.includes(required);
}
