"use client";

import type { Permission } from "@devsfleet/shared-types";
import React, { useState } from "react";
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
 *
 * The API is the boundary. This is what stops the panel offering somebody a
 * screen it will then refuse to fill.
 */
const ROUTE_PERMISSIONS: Array<[string, Permission]> = [
  ["/users", "user:read"],
  ["/settings", "settings:read"],
  ["/branches", "branch:read"],
  ["/products", "product:read"],
  ["/inventory", "inventory:read"],
  ["/customers", "customer:read"],
  ["/suppliers", "supplier:read"],
  ["/sales", "sale:read"],
  ["/reports", "report:read"],
  ["/whatsapp", "whatsapp:read"],
  ["/devices", "branch:read"],
];

function permissionFor(pathname: string): Permission | undefined {
  return ROUTE_PERMISSIONS.find(([prefix]) => pathname.startsWith(prefix))?.[1];
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // If we are on /login, render without shell
  if (pathname === "/login") {
    return <>{children}</>;
  }

  const permission = permissionFor(pathname);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <div
        className={cn(
          "flex flex-1 flex-col transition-all duration-300 ease-in-out",
          collapsed ? "pl-[72px]" : "pl-[264px]",
        )}
      >
        <Header />
        <main className="flex-1 p-6 md:p-8">
          <RequireAuth {...(permission ? { permission } : {})}>{children}</RequireAuth>
        </main>
      </div>
    </div>
  );
}
