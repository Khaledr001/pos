"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
  ChevronLeft,
  ChevronRight,
  Truck,
  BarChart3,
  UserCheck,
  Tablet,
  ShieldCheck,
  ScrollText,
  Wallet,
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

/**
 * `permission` mirrors the route map in AppShell.
 *
 * The nav used to list every screen to everybody, so a warehouse account was
 * invited into Staff & Users and Settings and met a permission error on
 * arrival — which reads as a broken app rather than as a boundary.
 */
const NAV_SECTIONS: Array<{
  label: string;
  items: Array<{
    label: string;
    href: string;
    icon: typeof LayoutDashboard;
    permission?: Permission;
  }>;
}> = [
  {
    label: "Main",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
      { label: "Branches", href: "/branches", icon: GitBranch, permission: "branch:read" },
    ],
  },
  {
    label: "Commerce",
    items: [
      { label: "Products", href: "/products", icon: Package, permission: "product:read" },
      { label: "Inventory", href: "/inventory", icon: Boxes, permission: "inventory:read" },
      { label: "Transfers", href: "/transfers", icon: Truck, permission: "transfer:read" },
      { label: "Purchase Orders", href: "/purchases", icon: Package, permission: "purchase:read" },
      { label: "Suppliers", href: "/suppliers", icon: Truck, permission: "supplier:read" },
      { label: "Sales & Orders", href: "/sales", icon: ShoppingCart, permission: "sale:read" },
      { label: "Day Close", href: "/day-close", icon: Wallet, permission: "day_close:read" },
      { label: "Customers", href: "/customers", icon: Users, permission: "customer:read" },
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
    label: "System",
    items: [
      { label: "Staff & Users", href: "/users", icon: UserCheck, permission: "user:read" },
      { label: "Roles & Permissions", href: "/roles", icon: ShieldCheck, permission: "role:write" },
      { label: "Terminals", href: "/devices", icon: Tablet, permission: "branch:read" },
      { label: "Audit Trail", href: "/audit-log", icon: ScrollText, permission: "audit:read" },
      { label: "Settings", href: "/settings", icon: Settings, permission: "settings:read" },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const permissions = (user?.permissions ?? []) as Permission[];
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(
      (item) => !item.permission || hasPermission(permissions, item.permission),
    ),
  })).filter((section) => section.items.length > 0);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-300 ease-in-out",
        collapsed ? "w-[72px]" : "w-[264px]",
      )}
    >
      {/* ── Brand Header ── */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl gradient-brand text-white shadow-md shadow-primary/25">
          <Store className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="flex flex-col animate-slide-in-right overflow-hidden">
            <span className="text-sm font-bold tracking-tight text-sidebar-foreground">
              DevsFleet
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">
              Retail Platform
            </span>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {sections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                {section.label}
              </p>
            )}
            {collapsed && <Separator className="mb-2" />}
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/" && pathname.startsWith(item.href));

                const linkContent = (
                  <Link
                    href={item.href}
                    className={cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                      isActive
                        ? "bg-primary/10 text-primary shadow-sm"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    {/* Active indicator bar */}
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r-full gradient-brand" />
                    )}
                    <Icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0 transition-colors",
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-sidebar-accent-foreground",
                      )}
                    />
                    {!collapsed && (
                      <span className="animate-slide-in-right">
                        {item.label}
                      </span>
                    )}
                  </Link>
                );

                if (collapsed) {
                  return (
                    <Tooltip key={item.href}>
                      <TooltipTrigger asChild>{linkContent}</TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8}>
                        {item.label}
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return (
                  <React.Fragment key={item.href}>
                    {linkContent}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Collapse Toggle ── */}
      <div className="px-3 pb-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className="w-full justify-center text-muted-foreground hover:text-foreground"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4" />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </Button>
      </div>

      {/* ── User Profile Footer ── */}
      <div className="border-t border-sidebar-border p-3">
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl bg-sidebar-accent/50 p-2.5 transition-all",
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
                  onClick={logout}
                  className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
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
  );
}
