"use client";

import type { Permission } from "@devsfleet/shared-types";
import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { RequireAuth } from "@/lib/require-auth";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { ImpersonationBanner } from "./impersonation-banner";
import { cn } from "@/lib/utils";

/**
 * What each area of the admin panel needs, in one place.
 *
 * Deliberately a map rather than a wrapper on each page: this is the whole
 * authorisation surface of the panel, reviewable at a glance, and a page added
 * without an entry is still guarded — it just requires nothing beyond being
 * signed in, which is the safe default here because the API refuses the data
 * regardless. The map matches by prefix, so nested routes inherit.
 */
const ROUTE_PERMISSIONS: Array<[string, Permission]> = [
  ["/users", "user:read"],
  ["/settings", "settings:read"],
  ["/branches", "branch:read"],
  ["/products", "product:read"],
  ["/categories", "product:read"],
  ["/brands", "product:read"],
  ["/inventory", "inventory:read"],
  ["/customers", "customer:read"],
  ["/suppliers", "supplier:read"],
  ["/sales", "sale:read"],
  ["/sell", "sale:create"],
  ["/quotations", "quotation:read"],
  ["/reports", "report:read"],
  ["/whatsapp", "whatsapp:read"],
  ["/devices", "branch:read"],
  ["/roles", "role:write"],
  ["/audit-log", "audit:read"],
  ["/day-close", "day_close:read"],
  ["/transfers", "transfer:read"],
  ["/purchases", "purchase:read"],
  // Order matters: the first matching prefix wins, so the online store's
  // specific screens come before its overview.
  ["/online-store/orders", "order:read"],
  ["/online-store/quotes", "order:read"],
  ["/online-store/stock-alerts", "product:read"],
  ["/online-store/trade", "customer:read"],
  ["/online-store", "storefront:read"],
];

function permissionFor(pathname: string): Permission | undefined {
  return ROUTE_PERMISSIONS.find(([prefix]) => pathname.startsWith(prefix))?.[1];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile sidebar automatically on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // If we are on /login, render without shell
  if (pathname === "/login") {
    return <>{children}</>;
  }

  const permission = permissionFor(pathname);
  const isPlatformRoute = pathname.startsWith("/platform");

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      {/* Impersonation Banner spanning 100% full viewport width across sidebar and content */}
      <ImpersonationBanner />

      <div className="flex flex-1 w-full">
        {/* Responsive Sidebar */}
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          mobileOpen={mobileOpen}
          onMobileClose={() => setMobileOpen(false)}
        />

        {/* Main Content Area */}
        <div
          className={cn(
            "flex flex-1 flex-col min-w-0 w-full transition-all duration-300 ease-in-out",
            collapsed ? "lg:pl-22" : "lg:pl-66",
            "pl-0",
          )}
        >
          <Header onOpenMobileMenu={() => setMobileOpen(true)} />

          <main className="flex-1 p-3 sm:p-4 md:p-6 min-w-0 max-w-full">
            <RequireAuth
              platformOnly={isPlatformRoute}
              {...(permission ? { permission } : {})}
            >
              {children}
            </RequireAuth>
          </main>
        </div>
      </div>
    </div>
  );
}
