"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  Search,
  Sun,
  Moon,
  Building2,
  Menu,
  Crown,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { Button } from "@/components/ui/button";
import { CommandSearchDialog } from "./command-search";
import { NotificationPanel } from "./notification-panel";
import { cn } from "@/lib/utils";

export function Header({
  onOpenMobileMenu,
}: {
  onOpenMobileMenu?: () => void;
}) {
  const { user, isImpersonating } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(typeof navigator !== "undefined" && navigator.userAgent.includes("Mac"));

    // Global Command/Ctrl + K shortcut
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <header
        className={cn(
          "sticky z-30 flex h-16 w-full items-center justify-between border-b border-border bg-background/80 backdrop-blur-xl px-3 sm:px-4 md:px-6 gap-2 sm:gap-4",
          isImpersonating ? "top-10.5" : "top-0",
        )}
      >
        {/* ── Left: Mobile Hamburger & Search Bar ── */}
        <div className="flex items-center gap-2 flex-1 max-w-md lg:max-w-lg min-w-0">
          {onOpenMobileMenu && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onOpenMobileMenu}
              className="lg:hidden h-9 w-9 shrink-0 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60"
              aria-label="Open mobile menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}

          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="group relative flex items-center w-full h-10 rounded-xl bg-muted/40 hover:bg-muted/60 border border-border/60 hover:border-primary/40 px-3 text-xs text-muted-foreground transition-all cursor-pointer shadow-xs focus:outline-none focus:ring-2 focus:ring-primary/20 min-w-0"
            aria-label="Search or open command palette"
          >
            <Search className="h-4 w-4 mr-2 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
            <span className="flex-1 text-left truncate text-muted-foreground/80 group-hover:text-foreground">
              Search products, orders…
            </span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 pointer-events-none select-none rounded-md border border-border/70 bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground shadow-2xs group-hover:border-primary/30 ml-1 shrink-0">
              <span>{isMac ? "⌘" : "Ctrl"}</span>
              <span>K</span>
            </kbd>
          </button>
        </div>

        {/* ── Right Controls ── */}
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          {/* Platform Super Admin Quick Switcher */}
          {user?.isPlatformAdmin && (
            <Link
              href="/platform"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-linear-to-r from-violet-600/15 via-purple-600/15 to-indigo-600/15 border border-purple-500/30 px-3 py-1.5 text-xs font-semibold text-purple-600 dark:text-purple-300 hover:bg-purple-500/20 transition-all shadow-xs"
            >
              <Crown className="h-3.5 w-3.5 text-amber-500" />
              <span>Super Admin</span>
            </Link>
          )}

          {/* Active Business / Tenant Pill */}
          <div className="hidden sm:flex items-center gap-2 rounded-xl bg-muted/40 border border-border/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/60 transition-colors">
            <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="font-semibold text-foreground truncate max-w-32.5 md:max-w-45">
              {user?.tenantName || "DevsFleet Retail"}
            </span>
            {user?.branchName && (
              <span className="hidden md:inline text-[11px] text-muted-foreground/70 border-l border-border/70 pl-2 truncate max-w-30">
                {user.branchName}
              </span>
            )}
          </div>

          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-9 w-9 rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
            aria-label="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4 text-amber-400" />
            ) : (
              <Moon className="h-4 w-4 text-slate-700" />
            )}
          </Button>

          <NotificationPanel />
        </div>
      </header>

      {/* ── Global Command & Search Modal ── */}
      <CommandSearchDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        initialQuery={searchQuery}
      />
    </>
  );
}
