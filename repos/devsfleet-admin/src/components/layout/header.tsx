"use client";

import React, { useEffect, useState } from "react";
import { Search, Bell, Activity, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";

export function Header() {
  const { user } = useAuth();
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkHealth() {
      try {
        await api.get("/health");
        setApiOnline(true);
      } catch {
        setApiOnline(false);
      }
    }
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-[--color-border] bg-[--color-bg]/80 backdrop-blur px-6">
      {/* Search Shortcut */}
      <div className="flex items-center gap-3">
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[--color-muted]" />
          <input
            type="text"
            placeholder="Search products, orders, SKU... (⌘K)"
            className="w-full rounded-lg border border-[--color-border] bg-[--color-surface] py-1.5 pl-9 pr-3 text-xs text-[--color-fg] placeholder-[--color-muted] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
          />
        </div>
      </div>

      {/* Right Controls: Tenant Badge, Live API Status, Notifications */}
      <div className="flex items-center gap-4">
        {/* Backend API status */}
        <div
          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border ${
            apiOnline === true
              ? "bg-[--color-success]/10 text-[--color-success] border-[--color-success]/20"
              : apiOnline === false
                ? "bg-[--color-danger]/10 text-[--color-danger] border-[--color-danger]/20"
                : "bg-[--color-surface] text-[--color-muted] border-[--color-border]"
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full animate-pulse ${
              apiOnline === true ? "bg-[--color-success]" : "bg-[--color-danger]"
            }`}
          />
          <span>{apiOnline === true ? "API Connected" : "API Offline"}</span>
        </div>

        {/* Tenant Scope Badge */}
        <div className="flex items-center gap-1.5 rounded-lg border border-[--color-border] bg-[--color-surface] px-2.5 py-1 text-xs font-medium text-[--color-fg]">
          <ShieldCheck className="h-3.5 w-3.5 text-[--color-brand]" />
          <span>{user?.tenantName || "Tenant #1 (UAE)"}</span>
        </div>

        {/* Notifications Icon */}
        <button
          title="Notifications"
          className="relative rounded-lg p-2 text-[--color-muted] hover:bg-[--color-surface] hover:text-[--color-fg] transition-colors border border-transparent hover:border-[--color-border]"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[--color-brand]" />
        </button>
      </div>
    </header>
  );
}
