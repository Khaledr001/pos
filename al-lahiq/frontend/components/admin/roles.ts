import type { StaffRole } from "@al-lahiq/api-client";

/**
 * What each role may use. Mirrors the API's @Roles guards (OWNER always
 * passes); the API still enforces it, this only hides what would fail.
 */
export type Area =
  | "orders"
  | "customers"
  | "catalog"
  | "content"
  | "reports"
  | "promotions"
  | "settings"
  | "sync"
  | "staff"
  | "trade"
  | "refund";

const ACCESS: Record<Area, StaffRole[]> = {
  orders: ["MANAGER", "ORDER_STAFF"],
  customers: ["MANAGER", "ORDER_STAFF"],
  catalog: ["MANAGER", "CONTENT_EDITOR"],
  content: ["MANAGER", "CONTENT_EDITOR"],
  reports: ["MANAGER"],
  promotions: ["MANAGER"],
  settings: ["MANAGER"],
  sync: ["MANAGER"],
  staff: [],
  trade: ["MANAGER"],
  refund: ["MANAGER"],
};

export function can(role: StaffRole, area: Area) {
  return role === "OWNER" || ACCESS[area].includes(role);
}

export const ROLE_LABEL: Record<StaffRole, string> = {
  OWNER: "Owner",
  MANAGER: "Manager",
  ORDER_STAFF: "Order desk",
  CONTENT_EDITOR: "Content editor",
};

export const ROLE_HINT: Record<StaffRole, string> = {
  OWNER: "Everything, including staff accounts",
  MANAGER: "Everything except staff accounts",
  ORDER_STAFF: "Orders and customers (no refunds or trade approvals)",
  CONTENT_EDITOR: "Products, categories, brands and website content",
};

/** Which area a panel URL belongs to (null = open to every staff member). */
export function areaForPath(pathname: string): Area | null {
  const seg = pathname.replace(/^\/admin\/?/, "").split("/")[0];
  switch (seg) {
    case "orders":
      return "orders";
    case "customers":
      return "customers";
    case "products":
    case "categories":
    case "brands":
    case "attributes":
      return "catalog";
    case "content":
      return "content";
    case "promotions":
      return "promotions";
    case "settings":
      return "settings";
    case "sync":
      return "sync";
    case "staff":
      return "staff";
    default:
      return null;
  }
}
