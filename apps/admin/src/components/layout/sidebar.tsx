"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  GitBranch,
  Package,
  Boxes,
  ShoppingCart,
  Users,
  MessageSquare,
  Settings,
  LogOut,
  Store,
  PanelLeftClose,
  PanelRightOpen,
  Truck,
  BarChart3,
  UserCheck,
  Tablet,
  ShieldCheck,
  ScrollText,
  Wallet,
  FolderTree,
  Tag,
  Ruler,
  Calculator,
  Download,
  FileText,
  ChevronDown,
  X,
  Crown,
  Building2,
  Layers,
  Activity,
  UserRound,
  ChevronsUpDown,
  Globe,
  TicketPercent,
  Briefcase,
} from "lucide-react";
import { hasPermission, type Permission } from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// ─── Information Architecture ──────────────────────────────────────────────────
//
// Structured by clear operational domains:
// 1. Overview (Dashboard, Branches)
// 2. Sales & POS (Sales, Quotations, Day Close, Customers)
// 3. Inventory & Catalog (Products, Categories, Brands, Inventory)
// 4. Procurement & Logistics (Purchase Orders, Transfers, Suppliers)
// 5. Intelligence & AI (Reports, WhatsApp AI)
// 6. Settings & System (Users, Roles, Devices, Audit, Settings)

type SubItem = {
  label: string;
  href: string;
  icon?: typeof LayoutDashboard;
  permission?: Permission;
};

type NavItem = {
  label: string;
  href: string;
  /**
   * What the collapsed rail prints under the icon.
   *
   * The full label is written for a 264px panel — "Products & Catalog",
   * "Day Close Registers" — and simply cannot be read in an 88px rail. Rather
   * than truncate it to "Produc…", each item carries a one-word form. Falls
   * back to `label` when the label is already short enough.
   */
  short?: string;
  icon: typeof LayoutDashboard;
  permission?: Permission;
  children?: SubItem[];
};

type NavSection = {
  label: string;
  platformOnly?: boolean;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Platform Admin",
    platformOnly: true,
    items: [
      { label: "Platform Overview", short: "Platform", href: "/platform", icon: Crown },
      { label: "Tenants Directory", short: "Tenants", href: "/platform/tenants", icon: Building2 },
      { label: "Subscription Plans", short: "Plans", href: "/platform/plans", icon: Layers },
      { label: "Platform Audit Log", short: "Audit", href: "/platform/audit-logs", icon: ScrollText },
      { label: "System Diagnostics", short: "Health", href: "/platform/health", icon: Activity },
    ],
  },
  {
    label: "Main",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Branches", href: "/branches", icon: GitBranch, permission: "branch:read" },
    ],
  },
  {
    label: "Analytics & Comms",
    items: [
      { label: "Reports & KPIs", short: "Reports", href: "/reports", icon: BarChart3, permission: "report:read" },
      { label: "WhatsApp AI", short: "WhatsApp", href: "/whatsapp", icon: MessageSquare, permission: "whatsapp:read" },
    ],
  },
  {
    label: "Sales & POS",
    items: [
      { label: "Sales Terminal", short: "Terminal", href: "/sell", icon: Calculator, permission: "sale:create" },
      {
        label: "Sales & Orders",
        short: "Sales",
        href: "/sales",
        icon: ShoppingCart,
        permission: "sale:read",
        children: [
          { label: "All Sales & Orders", href: "/sales", icon: ShoppingCart, permission: "sale:read" },
          { label: "Quotations", href: "/quotations", icon: FileText, permission: "quotation:read" },
          { label: "Day Close Registers", href: "/day-close", icon: Wallet, permission: "day_close:read" },
        ],
      },
      { label: "Customers", href: "/customers", icon: Users, permission: "customer:read" },
    ],
  },
  {
    label: "Online Store",
    items: [
      {
        label: "Online Store",
        short: "Web",
        href: "/online-store",
        icon: Globe,
        permission: "storefront:read",
        children: [
          { label: "Online Orders", href: "/online-store/orders", icon: ShoppingCart, permission: "order:read" },
          { label: "Website Listings", href: "/online-store/listings", icon: Package, permission: "storefront:read" },
          { label: "Pages & Banners", href: "/online-store/content", icon: FileText, permission: "storefront:read" },
          { label: "Promo Codes", href: "/online-store/coupons", icon: TicketPercent, permission: "storefront:read" },
          { label: "Trade Applications", href: "/online-store/trade", icon: Briefcase, permission: "customer:read" },
          { label: "Store Settings", href: "/online-store", icon: Settings, permission: "storefront:read" },
        ],
      },
    ],
  },
  {
    label: "Catalog & Stock",
    items: [
      {
        label: "Products & Catalog",
        short: "Products",
        href: "/products",
        icon: Package,
        permission: "product:read",
        children: [
          { label: "Products List", href: "/products", icon: Package, permission: "product:read" },
          { label: "Categories", href: "/categories", icon: FolderTree, permission: "product:read" },
          { label: "Brands", href: "/brands", icon: Tag, permission: "product:read" },
          { label: "Units of Measure", href: "/units", icon: Ruler, permission: "product:read" },
        ],
      },
      { label: "Inventory Stock", short: "Inventory", href: "/inventory", icon: Boxes, permission: "inventory:read" },
    ],
  },
  {
    label: "Supply & Logistics",
    items: [
      {
        label: "Purchasing",
        href: "/purchases",
        icon: Truck,
        permission: "purchase:read",
        children: [
          { label: "Purchase Orders", href: "/purchases", icon: FileText, permission: "purchase:read" },
          { label: "Stock Transfers", href: "/transfers", icon: Truck, permission: "transfer:read" },
          { label: "Suppliers", href: "/suppliers", icon: Users, permission: "supplier:read" },
        ],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      { label: "Staff & Users", short: "Staff", href: "/users", icon: UserCheck, permission: "user:read" },
      { label: "Roles & Permissions", short: "Roles", href: "/roles", icon: ShieldCheck, permission: "role:write" },
      { label: "Terminals & POS", short: "Devices", href: "/devices", icon: Tablet, permission: "branch:read" },
      { label: "Releases", href: "/releases", icon: Download, permission: "device:manage" },
      { label: "Audit Trail", short: "Audit", href: "/audit-log", icon: ScrollText, permission: "audit:read" },
      { label: "Settings", href: "/settings", icon: Settings, permission: "settings:read" },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isRouteActive(currentPath: string, targetHref: string): boolean {
  if (targetHref === "/") return currentPath === "/";
  return currentPath === targetHref || currentPath.startsWith(`${targetHref}/`);
}

function itemContainsRoute(item: NavItem, currentPath: string): boolean {
  if (isRouteActive(currentPath, item.href)) return true;
  if (item.children) {
    return item.children.some((child) => isRouteActive(currentPath, child.href));
  }
  return false;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({
  collapsed,
  onToggle,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, isImpersonating } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Initialize open state for expandable parents that match the current route
  const [openParents, setOpenParents] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const section of NAV_SECTIONS) {
      for (const item of section.items) {
        if (item.children && item.children.length > 0) {
          init[item.label] = itemContainsRoute(item, pathname);
        }
      }
    }
    return init;
  });

  const toggleParent = (label: string) => {
    setOpenParents((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  /** Desktop icon-rail. The mobile drawer is always the full panel. */
  const isRail = collapsed && !mobileOpen;

  const permissions = (user?.permissions ?? []) as Permission[];

  // Filter items by user permissions and platform operator status
  const visibleSections = NAV_SECTIONS.filter(
    (section) => !section.platformOnly || user?.isPlatformAdmin,
  )
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) => {
          // If parent has specific permission and user lacks it, hide
          if (item.permission && !hasPermission(permissions, item.permission)) {
            return null;
          }

          // If item has children, filter children by permission
          if (item.children) {
            const visibleChildren = item.children.filter(
              (c) => !c.permission || hasPermission(permissions, c.permission),
            );
            if (visibleChildren.length === 0) return null;
            return { ...item, children: visibleChildren };
          }

          return item;
        })
        .filter(Boolean) as NavItem[],
    }))
    .filter((s) => s.items.length > 0);

  /**
   * One shared shape for every row in the rail, so an item that gains or
   * loses children does not change height, indent or hit area.
   */
  const ROW =
    "group relative flex w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
  /** 40px — comfortably past the 24×24 CSS px pointer-target minimum. */
  const ROW_H = "h-10";

  /**
   * A rail tile — icon over a VISIBLE label.
   *
   * The rail used to be icons alone, with every destination named only by a
   * hover tooltip. That fails two groups outright: touch users, who have no
   * hover at all (this panel runs on counter tablets), and anyone who simply
   * does not know that a bare glyph is hoverable. Printing a short label under
   * each icon is the Material navigation-rail pattern and costs 16px of width.
   *
   * 48px tall — double the 24x24 CSS px pointer-target minimum, and short
   * enough that the whole nav still fits a laptop viewport without
   * scrolling, which 56px did not.
   */
  const RAIL_TILE =
    "group relative flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg " +
    "px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-ring focus-visible:ring-inset";

  const railLabel = (item: NavItem) => item.short ?? item.label;

  /**
   * Active is signalled three ways — accent bar, tinted ground, and weight —
   * because colour alone is not a signal for everyone. `aria-current` carries
   * it to assistive tech, which none of the three visual cues do.
   */
  const rowTone = (active: boolean) =>
    active
      ? "bg-primary/10 font-semibold text-primary"
      : "font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

  const ActiveBar = () => (
    <span
      aria-hidden="true"
      className="absolute left-0 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-r-full gradient-brand"
    />
  );

  // ── An item with children ──────────────────────────────────────────────────
  const renderExpandableItem = (item: NavItem) => {
    const Icon = item.icon;
    const isOpen = openParents[item.label] ?? itemContainsRoute(item, pathname);
    const isParentActive = itemContainsRoute(item, pathname);
    const panelId = `nav-panel-${item.label.replace(/\W+/g, "-").toLowerCase()}`;

    /**
     * Collapsed: a DropdownMenu, not a Tooltip.
     *
     * The children used to live inside TooltipContent. A Radix tooltip is
     * `role="tooltip"` and closes on pointer-leave and blur — it is not a
     * container you can move into and click, and nothing in it is reachable
     * by keyboard at all. Sub-navigation was therefore unreachable in the
     * collapsed rail for anyone not using a mouse, and flaky for those who
     * were. A menu is built for exactly this: arrow keys, Escape, focus
     * return, and it stays open while you aim at it.
     */
    if (isRail) {
      return (
        <DropdownMenu key={item.label}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              /* The visible short label is an abbreviation, so the accessible
                 name stays the full one. */
              aria-label={item.label}
              className={cn(
                RAIL_TILE,
                rowTone(isParentActive),
                "data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
              )}
            >
              {isParentActive && <ActiveBar />}
              <Icon className="size-4.5 shrink-0" aria-hidden="true" />
              <span aria-hidden="true" className="w-full truncate text-center text-[10px] leading-none">
                {railLabel(item)}
              </span>
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="right" align="start" sideOffset={10} className="w-56">
            <DropdownMenuLabel>{item.label}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {item.children?.map((child) => {
              const isChildActive = isRouteActive(pathname, child.href);
              return (
                <DropdownMenuItem key={child.href} asChild>
                  <Link
                    href={child.href}
                    aria-current={isChildActive ? "page" : undefined}
                    className={cn("cursor-pointer", isChildActive && "font-semibold text-primary")}
                  >
                    {child.label}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return (
      <div key={item.label}>
        {/*
          A real <button> with aria-expanded, not a div with onClick.
          Previously this row was an unfocusable div, so the whole group could
          not be opened from the keyboard and screen readers announced neither
          that it was a disclosure nor whether it was open. The chevron's own
          nested button — which called the same toggle — is gone with it.
        */}
        <button
          type="button"
          onClick={() => toggleParent(item.label)}
          aria-expanded={isOpen}
          aria-controls={panelId}
          className={cn(ROW, ROW_H, "text-left", rowTone(isParentActive))}
        >
          {isParentActive && <ActiveBar />}
          <Icon className="size-4.5 shrink-0" aria-hidden="true" />
          <span className="flex-1 truncate">{item.label}</span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground/70 transition-transform duration-200 motion-reduce:transition-none",
              isOpen && "rotate-180",
            )}
          />
        </button>

        {/*
          grid-rows 0fr→1fr animates to the content's real height without
          measuring it, and without animating `height` — which would force a
          layout pass on every frame of the open.
        */}
        <div
          id={panelId}
          className={cn(
            "grid overflow-hidden transition-all duration-200 ease-in-out motion-reduce:transition-none",
            isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
          )}
        >
          <div className="min-h-0">
            <ul className="ml-[1.4rem] space-y-0.5 border-l border-sidebar-border py-1 pl-2">
              {item.children?.map((child) => {
                const isChildActive = isRouteActive(pathname, child.href);
                return (
                  <li key={child.href}>
                    <Link
                      href={child.href}
                      onClick={() => onMobileClose?.()}
                      aria-current={isChildActive ? "page" : undefined}
                      tabIndex={isOpen ? undefined : -1}
                      className={cn(
                        "flex h-8 items-center rounded-md px-2.5 text-xs transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        isChildActive
                          ? "bg-primary/10 font-semibold text-primary"
                          : "font-medium text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <span className="truncate">{child.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    );
  };

  // ── An item with no children ───────────────────────────────────────────────
  const renderFlatItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = isRouteActive(pathname, item.href);
    const showLabel = !collapsed || mobileOpen;

    const link = (
      <Link
        href={item.href}
        onClick={() => onMobileClose?.()}
        aria-current={isActive ? "page" : undefined}
        aria-label={showLabel ? undefined : item.label}
        className={cn(
          showLabel ? cn(ROW, ROW_H) : RAIL_TILE,
          rowTone(isActive),
        )}
      >
        {isActive && <ActiveBar />}
        <Icon className="size-4.5 shrink-0" aria-hidden="true" />
        {showLabel ? (
          <span className="truncate">{item.label}</span>
        ) : (
          <span aria-hidden="true" className="w-full truncate text-center text-[10px] leading-none">
            {railLabel(item)}
          </span>
        )}
      </Link>
    );

    /*
     * The tooltip now SUPPLEMENTS a visible label rather than replacing it —
     * it restores the full wording for an abbreviated or truncated one. Only
     * worth mounting when the two actually differ.
     */
    if (!showLabel && railLabel(item) !== item.label) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <React.Fragment key={item.href}>{link}</React.Fragment>;
  };

  return (
    <>
      {/* ── Mobile Backdrop Overlay ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs lg:hidden animate-fade-in transition-opacity"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "fixed bottom-0 left-0 z-50 lg:z-40 flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out",
          isImpersonating ? "top-10.5" : "top-0",
          // Mobile: slide-out drawer
          mobileOpen
            ? "translate-x-0 w-70 max-w-[85vw] shadow-2xl"
            : "-translate-x-full lg:translate-x-0",
          // Desktop: collapsed vs expanded
          collapsed ? "lg:w-22" : "lg:w-66",
        )}
      >
        {/*
          ── Brand header ──

          Collapsed, this is a mark over an explicit "Expand" button.

          It used to be one button whose icon swapped from the logo to a
          panel glyph ON HOVER — so the only clue that the rail could be
          reopened appeared once you were already pointing at it, and never
          at all on a touch screen. The control is now permanently visible
          and permanently labelled.
        */}
        <div
          className={cn(
            "flex shrink-0 flex-col border-b border-sidebar-border",
            isRail ? "gap-1.5 px-2 py-2.5" : "h-16 justify-center px-3",
          )}
        >
          <div className="flex min-w-0 items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div
                aria-hidden="true"
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-xl gradient-brand text-white shadow-md shadow-primary/25",
                  isRail && "mx-auto",
                )}
              >
                <Store className="size-5" />
              </div>

              {(!collapsed || mobileOpen) && (
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  <span className="text-sm font-bold tracking-tight text-sidebar-foreground">
                    DevsFleet
                  </span>
                  <span className="truncate text-[11px] font-medium text-muted-foreground">
                    Retail &amp; Enterprise POS
                  </span>
                </div>
              )}
            </div>

          {/* Desktop Collapse Button */}
          {!collapsed && (
            <button
              onClick={onToggle}
              className="hidden lg:flex rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all duration-200 cursor-pointer shrink-0"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-5 w-5" />
            </button>
          )}

          {/* Mobile Close Button */}
          {onMobileClose && (
            <button
              onClick={onMobileClose}
              className="lg:hidden rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all duration-200 cursor-pointer shrink-0"
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
          )}
          </div>

          {/* Always visible in the rail, never hover-revealed. */}
          {isRail && (
            <button
              type="button"
              onClick={onToggle}
              aria-label="Expand sidebar"
              aria-expanded={false}
              className={cn(
                "hidden w-full cursor-pointer items-center justify-center gap-1 rounded-lg py-1.5",
                "text-[10px] font-medium text-muted-foreground transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                "lg:flex",
              )}
            >
              <PanelRightOpen className="size-3.5" aria-hidden="true" />
              Expand
            </button>
          )}

        </div>

        {/*
          ── Navigation ──

          A labelled landmark: a screen-reader user listing the page's regions
          gets "Main navigation" rather than an anonymous second <nav>, since
          the header carries one too.

          Each section is its own group with an accessible name. Collapsed,
          the visible heading is replaced by a rule — so the name moves onto
          the group via aria-label, and the grouping survives the rail rather
          than flattening into one long run of icons.
        */}
        <nav
          aria-label="Main navigation"
          className={cn(
            "flex flex-1 flex-col overflow-y-auto px-2.5 scrollbar-thin",
            /*
             * `gap`, not `space-y`.
             *
             * The rail's group spacing used to be three margins stacked on
             * top of each other — space-y-5 on the nav, mb-2 on the rule, then
             * space-y-1 from the group — about 33px between groups against 4px
             * between tiles. Gaps do not compound, so the number written here
             * is the number you get.
             *
             * The rail is deliberately tighter than the panel: with a label
             * under every icon, the tiles already read as separate blocks, so
             * the generous rhythm that stops a 264px panel feeling cramped
             * just pushes the lower half of the nav off-screen at 88px.
             */
            isRail ? "gap-1 py-2" : "gap-5 py-4",
          )}
        >
          {visibleSections.map((section, index) => (
            <div
              key={section.label}
              role="group"
              aria-label={section.label}
              className="flex flex-col gap-1"
            >
              {isRail ? (
                /* Short and centred: a full-bleed rule across an 88px rail
                   reads as heavier than the items it is separating. */
                index > 0 && (
                  <Separator className="mx-auto my-0.5 w-8 opacity-60" aria-hidden="true" />
                )
              ) : (
                <h2 className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  {section.label}
                </h2>
              )}

              {section.items.map((item) =>
                item.children && item.children.length > 0
                  ? renderExpandableItem(item)
                  : renderFlatItem(item),
              )}
            </div>
          ))}
        </nav>

        {/*
          ── User menu ──

          A DropdownMenu, not a Popover: this is a list of ACTIONS, and Radix's
          menu gives arrow-key traversal, type-ahead, Escape-to-close and
          focus return to the trigger for free — all of which a Popover full of
          buttons would have to reimplement by hand.

          Sign out sits below a separator rather than inline, because a
          destructive action adjacent to navigation is one mis-click away from
          ending someone's shift. It still opens the confirmation dialog.
        */}
        <div className="border-t border-sidebar-border px-2 py-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Account menu for ${user?.name ?? "current user"}`}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-3 rounded-xl bg-sidebar-accent/40 p-2.5 text-left transition-colors",
                  "hover:bg-sidebar-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "data-[state=open]:bg-sidebar-accent/70",
                  collapsed && "justify-center p-2",
                )}
              >
                <Avatar className="h-8 w-8 shrink-0 border-2 border-primary/20">
                  <AvatarFallback className="bg-primary/10 text-[11px] font-bold text-primary">
                    {user?.name ? user.name.slice(0, 2).toUpperCase() : "AD"}
                  </AvatarFallback>
                </Avatar>

                {!collapsed && (
                  <>
                    <div className="min-w-0 flex-1 animate-slide-in-right">
                      <p className="truncate text-xs font-semibold text-sidebar-foreground">
                        {user?.name || "Admin User"}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {user?.roleName || "Owner / Admin"}
                      </p>
                    </div>
                    <ChevronsUpDown
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </>
                )}
              </button>
            </DropdownMenuTrigger>

            {/* Opens upward and to the right — the trigger sits at the very
                bottom of a full-height rail, so a downward menu would open
                off-screen. */}
            <DropdownMenuContent
              side="top"
              align="start"
              sideOffset={8}
              className="w-60"
            >
              <DropdownMenuLabel className="font-normal">
                <p className="truncate text-sm font-semibold text-foreground">
                  {user?.name || "Admin User"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {user?.email || user?.roleName}
                </p>
              </DropdownMenuLabel>

              <DropdownMenuSeparator />

              <DropdownMenuGroup>
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="cursor-pointer">
                    <UserRound className="h-4 w-4" aria-hidden="true" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings" className="cursor-pointer">
                    <Settings className="h-4 w-4" aria-hidden="true" />
                    Settings
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuGroup>

              <DropdownMenuSeparator />

              <DropdownMenuItem
                onSelect={() => setConfirmOpen(true)}
                className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* ── Logout Confirmation Dialog ── */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <LogOut className="h-5 w-5 text-destructive" />
            </div>
            <DialogTitle className="text-center">Sign out?</DialogTitle>
            <DialogDescription className="text-center">
              You will be returned to the login screen. Any unsaved changes will
              be lost.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col-reverse sm:flex-row gap-2 mt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmOpen(false)}
            >
              Stay signed in
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => {
                setConfirmOpen(false);
                logout();
              }}
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
