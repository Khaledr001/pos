"use client";

import React from "react";
import { ShieldAlert, LogOut, Building2, Sparkles, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

export function ImpersonationBanner() {
  const { isImpersonating, user, exitImpersonation } = useAuth();

  if (!isImpersonating) return null;

  return (
    <aside
      aria-label="Support impersonation mode active"
      className="sticky top-0 z-50 w-full min-h-[42px] bg-slate-950/95 border-b border-amber-500/30 px-3 sm:px-6 py-1.5 text-white shadow-md shadow-amber-950/30 backdrop-blur-md animate-fade-in-down"
    >
      <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 w-full">
        {/* Subtle Ambient Glow Effect */}
        <div className="absolute -left-10 -top-10 h-24 w-24 rounded-full bg-amber-500/15 blur-2xl pointer-events-none" />
        <div className="absolute -right-10 -bottom-10 h-24 w-24 rounded-full bg-orange-500/15 blur-2xl pointer-events-none" />

        {/* Left: Mode Badge & Tenant Info */}
        <div className="relative z-10 flex items-center gap-2.5 min-w-0">
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 font-bold shadow-xs">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-300 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400 border border-slate-950"></span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <div className="inline-flex items-center gap-1 rounded-md bg-amber-500/20 border border-amber-400/30 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-amber-300">
              <Sparkles className="h-2.5 w-2.5" />
              <span>Support Session</span>
            </div>

            <div className="text-slate-200 text-xs">
              Impersonating <strong className="text-white font-semibold">{user?.name || "Admin"}</strong> at{" "}
              <span className="inline-flex items-center gap-1 font-bold text-amber-300 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded-md">
                <Building2 className="h-3 w-3 inline text-amber-400" />
                {user?.tenantName || "Business"}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Exit Action */}
        <div className="relative z-10 flex items-center justify-end gap-2 shrink-0">
          <Button
            size="sm"
            onClick={exitImpersonation}
            className="h-7 rounded-lg bg-gradient-to-r from-amber-400 via-amber-300 to-yellow-400 hover:from-amber-300 hover:to-yellow-300 text-slate-950 font-bold text-xs px-3 shadow-xs transition-all active:scale-95 border-0"
          >
            <LogOut className="mr-1.5 h-3 w-3 text-slate-950" />
            <span>Exit & Return to Super Admin</span>
            <ArrowRight className="ml-1.5 h-3 w-3 opacity-70" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
