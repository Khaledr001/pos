"use client";

import type { Permission } from "@devsfleet/shared-types";
import React, { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { RequireAuth } from "@/lib/require-auth";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
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
  ["/quotations", "quotation:read"],
  ["/reports", "report:read"],
  ["/whatsapp", "whatsapp:read"],
  ["/devices", "branch:read"],
  ["/roles", "role:write"],
  ["/audit-log", "audit:read"],
  ["/day-close", "day_close:read"],
  ["/transfers", "transfer:read"],
  ["/purchases", "purchase:read"],
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

  return (
    <div className="flex min-h-screen w-full bg-background overflow-x-hidden">
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
          collapsed ? "lg:pl-[72px]" : "lg:pl-[264px]",
          "pl-0",
        )}
      >
        <Header onOpenMobileMenu={() => setMobileOpen(true)} />
        <main className="flex-1 p-3 sm:p-4 md:p-6 min-w-0 max-w-full overflow-x-auto">
          <RequireAuth {...(permission ? { permission } : {})}>{children}</RequireAuth>
        </main>
      </div>
    </div>
  );
}
