"use client";

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Search,
  Bell,
  ShieldCheck,
  Sun,
  Moon,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/branches": "Branches & Warehouses",
  "/products": "Product Catalogue",
  "/inventory": "Inventory Ledger",
  "/sales": "Sales & Tax Invoices",
  "/customers": "Customers & Credit",
  "/whatsapp": "WhatsApp AI",
  "/settings": "Settings",
};

export function Header() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
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

  const currentLabel = ROUTE_LABELS[pathname] || "Page";

  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-border bg-background/70 backdrop-blur-xl px-6">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground font-medium">DevsFleet</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
        <span className="font-semibold text-foreground">{currentLabel}</span>
      </div>

      {/* ── Right Controls ── */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search... ⌘K"
            className="w-64 pl-9 h-9 bg-secondary/50 border-transparent focus-visible:border-input focus-visible:bg-background text-xs"
          />
        </div>

        {/* API Status Badge */}
        <Badge
          variant={
            apiOnline === true
              ? "success"
              : apiOnline === false
                ? "destructive"
                : "secondary"
          }
          className="gap-1.5 text-[11px] font-medium"
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full animate-pulse",
              apiOnline === true
                ? "bg-emerald-500"
                : apiOnline === false
                  ? "bg-red-500"
                  : "bg-muted-foreground",
            )}
          />
          {apiOnline === true
            ? "API Connected"
            : apiOnline === false
              ? "API Offline"
              : "Checking..."}
        </Badge>

        {/* Tenant Badge */}
        <Badge variant="outline" className="gap-1.5 hidden lg:inline-flex">
          <ShieldCheck className="h-3 w-3 text-primary" />
          <span className="text-[11px]">
            {user?.tenantName || "Tenant #1"}
          </span>
        </Badge>

        {/* Theme Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          className="text-muted-foreground hover:text-foreground"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative text-muted-foreground hover:text-foreground"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full gradient-brand ring-2 ring-background" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel>Notifications</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium">
                  Low stock alert: Ducab Cable
                </span>
                <span className="text-[11px] text-muted-foreground">
                  35 units remaining across all branches
                </span>
              </div>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium">
                  New WhatsApp inquiry
                </span>
                <span className="text-[11px] text-muted-foreground">
                  +971 50 123 4567 requested a quotation
                </span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
