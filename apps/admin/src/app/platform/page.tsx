"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Users,
  Layers,
  TrendingUp,
  Activity,
  AlertTriangle,
  Tablet,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  ShieldCheck,
  RefreshCw,
  Plus,
  Crown,
  Server,
  Sparkles,
  Search,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface PlatformStats {
  tenants: number;
  activeTenants: number;
  suspendedTenants: number;
  users: number;
  devices: number;
  planDistribution: Array<{
    planId: string;
    planName: string;
    tenants: number;
  }>;
  estimatedMrr: number;
  recentTenants: Array<{
    id: string;
    name: string;
    slug: string;
    planId: string;
    plan: { name: string; monthlyPrice: number };
    isActive: boolean;
    createdAt: string;
  }>;
}

interface SystemHealth {
  status: "healthy" | "degraded";
  timestamp: string;
  database: {
    connected: boolean;
    latencyMs: number;
  };
  system: {
    uptimeSeconds: number;
    uptimeFormatted: string;
    nodeVersion: string;
    environment: string;
    memoryUsage: {
      rssMb: number;
      heapUsedMb: number;
      heapTotalMb: number;
    };
  };
  counts: {
    activeTenants: number;
    activeUsers: number;
    activeDevices: number;
  };
}

export default function PlatformDashboardPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setError(null);
      const [statsData, healthData] = await Promise.all([
        api.get<PlatformStats>("/admin/stats"),
        api.get<SystemHealth>("/admin/system-health"),
      ]);
      setStats(statsData);
      setHealth(healthData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load platform analytics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchData();
  };

  if (loading) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-center animate-fade-in">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm font-medium text-muted-foreground">Loading SaaS Platform Telemetry…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* ── Top Hero / Header ── */}
      <div className="relative overflow-hidden rounded-2xl bg-linear-to-br from-violet-950 via-slate-900 to-indigo-950 p-6 sm:p-8 text-white shadow-xl border border-violet-800/20">
        <div className="absolute right-0 top-0 -mt-8 -mr-8 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />
        <div className="absolute left-1/3 bottom-0 h-48 w-48 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 rounded-full bg-violet-500/20 border border-violet-400/30 px-3 py-1 text-xs font-semibold text-violet-200">
              <Crown className="h-3.5 w-3.5 text-amber-400" />
              <span>Platform Operator Suite</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              SaaS Super Admin Console
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 max-w-xl">
              Cross-tenant control center. Monitor subscriptions, manage tenant organizations,
              inspect global health, and execute support operations.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20 backdrop-blur-xs text-xs h-9"
            >
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Sync Telemetry
            </Button>
            <Button
              asChild
              size="sm"
              className="bg-linear-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs h-9 shadow-md shadow-violet-900/40 border-0"
            >
              <Link href="/platform/tenants">
                <Plus className="mr-1.5 h-4 w-4" />
                Provision Business
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Primary KPI Cards ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Estimated MRR */}
        <Card className="relative overflow-hidden border-border/60 shadow-xs hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Estimated MRR
            </CardTitle>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              ${stats?.estimatedMrr.toLocaleString() || 0}
              <span className="text-xs font-normal text-muted-foreground ml-1">/mo</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Recurring revenue from paid active tenants
            </p>
          </CardContent>
        </Card>

        {/* Total Businesses */}
        <Card className="relative overflow-hidden border-border/60 shadow-xs hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Businesses
            </CardTitle>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              {stats?.tenants || 0}
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="h-3 w-3" />
                {stats?.activeTenants || 0} Active
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                <XCircle className="h-3 w-3" />
                {stats?.suspendedTenants || 0} Suspended
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Total Platform Users */}
        <Card className="relative overflow-hidden border-border/60 shadow-xs hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Platform Users
            </CardTitle>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Users className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              {stats?.users.toLocaleString() || 0}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Across owners, managers & counter cashiers
            </p>
          </CardContent>
        </Card>

        {/* Active POS Terminals */}
        <Card className="relative overflow-hidden border-border/60 shadow-xs hover:shadow-md transition-shadow">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active POS Tills
            </CardTitle>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Tablet className="h-5 w-5" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight">
              {stats?.devices || 0}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Hardware terminals bound & online
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Middle Section: Plan Distribution & System Health ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Subscription Plan Distribution */}
        <Card className="lg:col-span-2 border-border/60 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-foreground">
                Subscription Plan Breakdown
              </CardTitle>
              <CardDescription className="text-xs">
                Active tenant distribution across commercial plan tiers
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild className="text-xs text-primary">
              <Link href="/platform/plans">
                <span>View Plans Matrix</span>
                <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
              {stats?.planDistribution.map((item) => (
                <div
                  key={item.planId}
                  className="flex flex-col justify-between rounded-xl border border-border/50 bg-muted/20 p-3.5 hover:bg-muted/40 transition-colors"
                >
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {item.planName}
                    </span>
                    <div className="text-xl font-bold text-foreground">
                      {item.tenants}
                      <span className="text-xs font-normal text-muted-foreground ml-1">tenants</span>
                    </div>
                  </div>
                  <div className="mt-2.5 pt-2 border-t border-border/40 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>Share</span>
                    <span className="font-semibold text-foreground">
                      {stats.tenants > 0
                        ? `${Math.round((item.tenants / stats.tenants) * 100)}%`
                        : "0%"}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Quick action bar */}
            <div className="rounded-xl bg-primary/5 border border-primary/20 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary shrink-0" />
                <span className="font-medium text-foreground">
                  Ready to manage commercial terms or override plan quotas for key enterprise accounts?
                </span>
              </div>
              <Button size="sm" variant="outline" asChild className="shrink-0 h-8 text-xs">
                <Link href="/platform/tenants">Inspect Directory</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Real-time Infrastructure & Diagnostics */}
        <Card className="border-border/60 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base font-bold text-foreground">
                System Diagnostics
              </CardTitle>
              <CardDescription className="text-xs">
                Live backend & database health
              </CardDescription>
            </div>
            <Badge
              variant={health?.status === "healthy" ? "default" : "destructive"}
              className="capitalize text-[11px]"
            >
              {health?.status || "Unknown"}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {/* Database Ping */}
            <div className="flex items-center justify-between rounded-xl bg-muted/30 p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-foreground">PostgreSQL DB</span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    health?.database.connected ? "bg-emerald-500" : "bg-destructive"
                  }`}
                />
                <span className="font-mono text-muted-foreground">
                  {health?.database.latencyMs} ms
                </span>
              </div>
            </div>

            {/* System Memory */}
            <div className="flex items-center justify-between rounded-xl bg-muted/30 p-2.5 text-xs">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-foreground">Memory Heap</span>
              </div>
              <span className="font-mono text-muted-foreground">
                {health?.system.memoryUsage.heapUsedMb} MB / {health?.system.memoryUsage.heapTotalMb} MB
              </span>
            </div>

            {/* Uptime */}
            <div className="flex items-center justify-between rounded-xl bg-muted/30 p-2.5 text-xs">
              <span className="font-medium text-foreground">Service Uptime</span>
              <span className="font-mono text-muted-foreground">
                {health?.system.uptimeFormatted || "0s"}
              </span>
            </div>

            {/* Node Environment */}
            <div className="flex items-center justify-between rounded-xl bg-muted/30 p-2.5 text-xs">
              <span className="font-medium text-foreground">Runtime / Mode</span>
              <span className="font-mono text-muted-foreground">
                Node {health?.system.nodeVersion} ({health?.system.environment})
              </span>
            </div>

            <Button
              variant="outline"
              size="sm"
              asChild
              className="w-full text-xs h-8 mt-2"
            >
              <Link href="/platform/health">Full Diagnostics Console</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Bottom Section: Recent Onboardings & Quick Shortcuts ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Tenant Signups */}
        <Card className="lg:col-span-2 border-border/60 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-foreground">
                Recent Tenant Onboardings
              </CardTitle>
              <CardDescription className="text-xs">
                Latest business accounts registered or provisioned
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" asChild className="text-xs text-primary">
              <Link href="/platform/tenants">
                <span>View All</span>
                <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent>
            {stats?.recentTenants && stats.recentTenants.length > 0 ? (
              <div className="divide-y divide-border/50">
                {stats.recentTenants.map((t) => (
                  <div
                    key={t.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between py-3 gap-2 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/50 border border-border/60 text-primary font-bold text-sm">
                        {t.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/platform/tenants/${t.id}`}
                            className="text-sm font-semibold text-foreground hover:text-primary transition-colors"
                          >
                            {t.name}
                          </Link>
                          <Badge
                            variant={t.isActive ? "default" : "destructive"}
                            className="text-[10px] h-4 px-1.5"
                          >
                            {t.isActive ? "Active" : "Suspended"}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-mono">t/{t.slug}</span>
                          <span>·</span>
                          <span>Plan: {t.plan.name}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <Button variant="ghost" size="sm" asChild className="h-8 text-xs">
                        <Link href={`/platform/tenants/${t.id}`}>Manage</Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-6 text-xs text-muted-foreground">
                No tenants onboarded yet.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Super Admin Quick Navigation Suite */}
        <Card className="border-border/60 shadow-xs">
          <CardHeader>
            <CardTitle className="text-base font-bold text-foreground">
              Operator Quick Actions
            </CardTitle>
            <CardDescription className="text-xs">
              Fast navigation to platform management tools
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <Link
              href="/platform/tenants"
              className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 p-3 hover:bg-muted/40 hover:border-primary/30 transition-all text-xs font-medium group"
            >
              <div className="flex items-center gap-2.5">
                <Building2 className="h-4 w-4 text-primary" />
                <div>
                  <div className="font-semibold text-foreground">Tenant Directory</div>
                  <div className="text-[11px] text-muted-foreground">
                    Search, suspend, activate, and impersonate
                  </div>
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </Link>

            <Link
              href="/platform/plans"
              className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 p-3 hover:bg-muted/40 hover:border-primary/30 transition-all text-xs font-medium group"
            >
              <div className="flex items-center gap-2.5">
                <Layers className="h-4 w-4 text-violet-500" />
                <div>
                  <div className="font-semibold text-foreground">Plans & Quotas</div>
                  <div className="text-[11px] text-muted-foreground">
                    Configure limits, pricing, and features
                  </div>
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-violet-500 transition-colors" />
            </Link>

            <Link
              href="/platform/audit-logs"
              className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 p-3 hover:bg-muted/40 hover:border-primary/30 transition-all text-xs font-medium group"
            >
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-4 w-4 text-indigo-500" />
                <div>
                  <div className="font-semibold text-foreground">Platform Audit Trail</div>
                  <div className="text-[11px] text-muted-foreground">
                    Inspect all operator & cross-tenant events
                  </div>
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-indigo-500 transition-colors" />
            </Link>

            <Link
              href="/platform/health"
              className="flex items-center justify-between rounded-xl border border-border/50 bg-muted/20 p-3 hover:bg-muted/40 hover:border-primary/30 transition-all text-xs font-medium group"
            >
              <div className="flex items-center gap-2.5">
                <Activity className="h-4 w-4 text-emerald-500" />
                <div>
                  <div className="font-semibold text-foreground">Infrastructure Health</div>
                  <div className="text-[11px] text-muted-foreground">
                    Real-time ping, uptime & telemetry
                  </div>
                </div>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-500 transition-colors" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
