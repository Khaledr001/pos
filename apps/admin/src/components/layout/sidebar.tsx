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
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Branches", href: "/branches", icon: GitBranch },
  { label: "Products", href: "/products", icon: Package },
  { label: "Inventory", href: "/inventory", icon: Boxes },
  { label: "Sales & Orders", href: "/sales", icon: ShoppingCart },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "WhatsApp AI", href: "/whatsapp", icon: MessageSquare },
  { label: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-[--color-border] bg-[--color-surface] transition-all">
      {/* Brand Header */}
      <div className="flex h-16 items-center gap-3 border-b border-[--color-border] px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[--color-brand] text-white shadow-sm">
          <Store className="h-5 w-5" />
        </div>
        <div className="flex flex-col">
          <span className="text-base font-bold tracking-tight text-[--color-fg]">
            DevsFleet
          </span>
          <span className="text-[11px] font-medium text-[--color-muted]">
            Retail Platform · Admin
          </span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                isActive
                  ? "bg-[--color-brand] text-white shadow-sm"
                  : "text-[--color-muted] hover:bg-[--color-border]/50 hover:text-[--color-fg]"
              }`}
            >
              <Icon
                className={`h-4 w-4 transition-colors ${
                  isActive ? "text-white" : "text-[--color-muted] group-hover:text-[--color-fg]"
                }`}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User Profile & Logout Footer */}
      <div className="border-t border-[--color-border] p-3">
        <div className="flex items-center justify-between rounded-lg bg-[--color-bg] p-2.5 border border-[--color-border]">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[--color-brand]/10 text-xs font-semibold text-[--color-brand]">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : "AD"}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-[--color-fg]">
                {user?.name || "Admin User"}
              </p>
              <p className="truncate text-[10px] text-[--color-muted]">
                {user?.roleName || "Owner / Admin"}
              </p>
            </div>
          </div>
          <button
            onClick={logout}
            title="Log Out"
            className="rounded-md p-1.5 text-[--color-muted] hover:bg-[--color-danger]/10 hover:text-[--color-danger] transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
