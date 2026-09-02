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
  Download,
  FileText,
  ChevronDown,
  CircleDot,
  X,
  Crown,
  Building2,
  Layers,
  Activity,
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
      { label: "Platform Overview", href: "/platform", icon: Crown },
      { label: "Tenants Directory", href: "/platform/tenants", icon: Building2 },
      { label: "Subscription Plans", href: "/platform/plans", icon: Layers },
      { label: "Platform Audit Log", href: "/platform/audit-logs", icon: ScrollText },
      { label: "System Diagnostics", href: "/platform/health", icon: Activity },
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
      { label: "Reports & KPIs", href: "/reports", icon: BarChart3, permission: "report:read" },
      { label: "WhatsApp AI", href: "/whatsapp", icon: MessageSquare, permission: "whatsapp:read" },
    ],
  },
  {
    label: "Sales & POS",
    items: [
      {
        label: "Sales & Orders",
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
    label: "Catalog & Stock",
    items: [
      {
        label: "Products & Catalog",
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
      { label: "Inventory Stock", href: "/inventory", icon: Boxes, permission: "inventory:read" },
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
      { label: "Staff & Users", href: "/users", icon: UserCheck, permission: "user:read" },
      { label: "Roles & Permissions", href: "/roles", icon: ShieldCheck, permission: "role:write" },
      { label: "Terminals & POS", href: "/devices", icon: Tablet, permission: "branch:read" },
      { label: "Releases", href: "/releases", icon: Download, permission: "device:manage" },
      { label: "Audit Trail", href: "/audit-log", icon: ScrollText, permission: "audit:read" },
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
  const [brandHovered, setBrandHovered] = useState(false);

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

  // ── Render an expandable item with children ────────────────────────────────
  const renderExpandableItem = (item: NavItem) => {
    const Icon = item.icon;
    const hasChildren = item.children && item.children.length > 0;
    const isOpen = openParents[item.label] ?? itemContainsRoute(item, pathname);
    const isParentActive = itemContainsRoute(item, pathname);

    if (collapsed) {
      // In collapsed mode: Tooltip shows the parent and clickable children
      return (
        <Tooltip key={item.label}>
          <TooltipTrigger asChild>
            <Link
              href={item.href}
              className={cn(
                "group relative flex h-10 w-full items-center justify-center rounded-xl transition-all duration-200",
                isParentActive
                  ? "bg-primary/10 text-primary font-semibold shadow-sm"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              {isParentActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.75 rounded-r-full gradient-brand" />
              )}
              <Icon className="h-5 w-5 shrink-0 transition-colors" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={10} className="p-2 space-y-1 bg-popover border shadow-lg">
            <p className="font-semibold text-xs text-foreground px-2 py-1 border-b border-border/50">
              {item.label}
            </p>
            <div className="space-y-0.5 pt-1">
              {item.children?.map((child) => {
                const isChildActive = isRouteActive(pathname, child.href);
                return (
                  <Link
                    key={child.href}
                    href={child.href}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
                      isChildActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                  >
                    <CircleDot className={cn("h-2.5 w-2.5", isChildActive ? "text-primary" : "text-muted-foreground/40")} />
                    <span>{child.label}</span>
                  </Link>
                );
              })}
            </div>
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <div key={item.label} className="space-y-1">
        {/* Parent Row */}
        <div
          className={cn(
            "group relative flex items-center justify-between rounded-xl px-3 py-2 text-sm font-medium transition-all duration-200 cursor-pointer select-none",
            isParentActive
              ? "bg-primary/10 text-primary font-semibold shadow-sm"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
          )}
          onClick={() => {
            toggleParent(item.label);
          }}
        >
          {isParentActive && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.75 rounded-r-full gradient-brand" />
          )}

          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Icon
              className={cn(
                "h-4.5 w-4.5 shrink-0 transition-colors",
                isParentActive
                  ? "text-primary"
                  : "text-muted-foreground group-hover:text-sidebar-accent-foreground",
              )}
            />
            <span className="truncate">{item.label}</span>
          </div>

          {hasChildren && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleParent(item.label);
              }}
              className="p-1 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-sidebar-accent transition-transform duration-200"
              aria-label={`Toggle ${item.label}`}
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200",
                  isOpen ? "rotate-180 text-primary" : "rotate-0",
                )}
              />
            </button>
          )}
        </div>

        {/* Child Sub-items Accordion */}
        {hasChildren && (
          <div
            className={cn(
              "grid transition-all duration-200 ease-in-out overflow-hidden",
              isOpen ? "grid-rows-[1fr] opacity-100 mt-1" : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div className="min-h-0">
              <div className="ml-5 pl-3 border-l-2 border-sidebar-border/70 space-y-0.5 py-0.5">
                {item.children?.map((child) => {
                  const isChildActive = isRouteActive(pathname, child.href);

                  return (
                    <Link
                      key={child.href}
                      href={child.href}
                      onClick={() => onMobileClose?.()}
                      className={cn(
                        "group flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150",
                        isChildActive
                          ? "bg-primary/10 text-primary font-semibold shadow-xs"
                          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <span className="truncate">{child.label}</span>
                      {isChildActive && (
                        <CircleDot className="h-2 w-2 text-primary shrink-0 animate-pulse" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Render a direct flat item (No children) ─────────────────────────────────
  const renderFlatItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = isRouteActive(pathname, item.href);

    const linkContent = (
      <Link
        href={item.href}
        onClick={() => onMobileClose?.()}
        className={cn(
          "group relative flex items-center gap-3 rounded-xl text-sm font-medium transition-all duration-200",
          collapsed ? "h-10 w-full justify-center px-0 lg:justify-center" : "px-3 py-2",
          isActive
            ? "bg-primary/10 text-primary font-semibold shadow-sm"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.75 rounded-r-full gradient-brand" />
        )}
        <Icon
          className={cn(
            "h-4.5 w-4.5 shrink-0 transition-colors",
            isActive
              ? "text-primary"
              : "text-muted-foreground group-hover:text-sidebar-accent-foreground",
          )}
        />
        {(!collapsed || mobileOpen) && <span className="truncate">{item.label}</span>}
      </Link>
    );

    if (collapsed && !mobileOpen) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={10}>
            {item.label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return <React.Fragment key={item.href}>{linkContent}</React.Fragment>;
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
          collapsed ? "lg:w-18" : "lg:w-66",
        )}
      >
        {/* ── Brand Header ── */}
        <div
          className="relative flex h-16 shrink-0 items-center justify-between gap-3 border-b border-sidebar-border px-3 overflow-hidden"
          onMouseEnter={() => setBrandHovered(true)}
          onMouseLeave={() => setBrandHovered(false)}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Store icon */}
            <button
              onClick={collapsed ? onToggle : undefined}
              className={cn(
                "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all duration-300",
                collapsed
                  ? "cursor-pointer hover:scale-105 gradient-brand text-white shadow-md shadow-primary/25"
                  : "gradient-brand text-white shadow-md shadow-primary/25 cursor-default pointer-events-none",
              )}
              tabIndex={collapsed ? 0 : -1}
              aria-label={collapsed ? "Expand sidebar" : undefined}
            >
              <Store
                className={cn(
                  "absolute h-5 w-5 transition-all duration-300",
                  collapsed && brandHovered ? "opacity-0 scale-75" : "opacity-100 scale-100",
                )}
              />
              <PanelRightOpen
                className={cn(
                  "absolute h-5 w-5 transition-all duration-300",
                  collapsed && brandHovered ? "opacity-100 scale-100" : "opacity-0 scale-75",
                )}
              />
            </button>

            {/* Brand Name & Tagline */}
            {(!collapsed || mobileOpen) && (
              <div className="flex min-w-0 flex-1 flex-col animate-slide-in-right overflow-hidden">
                <span className="text-sm font-bold tracking-tight text-sidebar-foreground">
                  DevsFleet
                </span>
                <span className="text-[11px] font-medium text-muted-foreground truncate">
                  Retail & Enterprise POS
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

        {/* ── Navigation Items ── */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-4 space-y-4 scrollbar-thin">
          {visibleSections.map((section) => (
            <div key={section.label} className="space-y-1">
              {!collapsed && (
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                  {section.label}
                </p>
              )}
              {collapsed && <Separator className="my-1.5 opacity-60" />}

              <div className="space-y-1">
                {section.items.map((item) =>
                  item.children && item.children.length > 0
                    ? renderExpandableItem(item)
                    : renderFlatItem(item),
                )}
              </div>
            </div>
          ))}
        </nav>

        {/* ── User Profile Footer ── */}
        <div className="border-t border-sidebar-border px-2 py-1">
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl bg-sidebar-accent/40 hover:bg-sidebar-accent/70 p-2.5 transition-all",
              collapsed && "justify-center p-2",
            )}
          >
            <Avatar className="h-8 w-8 shrink-0 border-2 border-primary/20">
              <AvatarFallback className="bg-primary/10 text-primary text-[11px] font-bold">
                {user?.name ? user.name.slice(0, 2).toUpperCase() : "AD"}
              </AvatarFallback>
            </Avatar>

            {!collapsed && (
              <div className="min-w-0 flex-1 animate-slide-in-right">
                <p className="truncate text-xs font-semibold text-sidebar-foreground">
                  {user?.name || "Admin User"}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {user?.roleName || "Owner / Admin"}
                </p>
              </div>
            )}

            {!collapsed && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setConfirmOpen(true)}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
                    aria-label="Log out"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Log Out</TooltipContent>
              </Tooltip>
            )}
          </div>
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
