"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  GitBranch,
  Package,
  TrendingUp,
  Boxes,
  Users,
  MessageSquare,
  ArrowUpRight,
  Plus,
  ShieldCheck,
  CheckCircle2,
  Cpu,
  Sparkles,
} from "lucide-react";
import { Money, calculateDocument } from "@devsfleet/shared-utils";
import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface BranchItem {
  id: string;
  name: string;
  code: string;
  phone?: string;
  address?: string;
  isActive: boolean;
}

// KPI cards are built dynamically in the component from API data
const KPI_GRADIENT = [
  "from-blue-500 to-indigo-600",
  "from-emerald-500 to-teal-600",
  "from-amber-500 to-orange-600",
  "from-violet-500 to-purple-600",
];

// placeholder for the shape of a dynamic KPI card
const KPI_DEFS = [
  {
    label: "Active Branches",
    valueKey: "branches" as const,
    change: "Online",
    changeType: "positive" as const,
    icon: GitBranch,
    gradient: "from-emerald-500 to-teal-600",
    bgGlow: "bg-emerald-500/10",
  },
  {
    label: "Catalog Products",
    valueKey: "products" as const,
    change: "SKUs",
    changeType: "neutral" as const,
    icon: Package,
    gradient: "from-amber-500 to-orange-600",
  },
  {
    label: "Total Customers",
    valueKey: "customers" as const,
    change: "Accounts",
    changeType: "positive" as const,
    icon: Users,
    gradient: "from-violet-500 to-purple-600",
  },
];

const QUICK_LINKS = [
  {
    label: "Products Catalogue",
    desc: "5,000+ SKUs, multi-unit conversions, barcode tagging",
    href: "/products",
    icon: Package,
    gradient: "from-blue-500 to-indigo-600",
  },
  {
    label: "Inventory Ledger",
    desc: "Append-only stock balances and inter-branch transfers",
    href: "/inventory",
    icon: Boxes,
    gradient: "from-emerald-500 to-teal-600",
  },
  {
    label: "WhatsApp AI Agent",
    desc: "Meta Cloud API, multi-language price quotes",
    href: "/whatsapp",
    icon: MessageSquare,
    gradient: "from-violet-500 to-purple-600",
  },
];

interface KpiCounts {
  branches: number;
  products: number;
  customers: number;
}

export default function DashboardPage() {
  const { user, tokens } = useAuth();
  const [branches, setBranches] = useState<BranchItem[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [kpiCounts, setKpiCounts] = useState<KpiCounts>({ branches: 0, products: 0, customers: 0 });

  const loadDashboard = useCallback(async () => {
    if (!tokens?.accessToken) return;
    try {
      const [branchRes, productRes, customerRes] = await Promise.allSettled([
        api.get<{ items: BranchItem[]; total: number }>("/branches", { accessToken: tokens.accessToken }),
        api.get<{ items: unknown[]; total: number }>("/products", { accessToken: tokens.accessToken, query: { limit: 1, page: 1 } }),
        api.get<{ items: unknown[]; total: number }>("/customers", { accessToken: tokens.accessToken, query: { pageSize: 1, page: 1 } }),
      ]);

      if (branchRes.status === "fulfilled") {
        const val = branchRes.value as any;
        const list = Array.isArray(val) ? val : (val?.items ?? []);
        setBranches(list);
        setKpiCounts(prev => ({ ...prev, branches: val?.meta?.total ?? val?.total ?? list.length }));
      }
      if (productRes.status === "fulfilled") {
        const val = productRes.value as any;
        const list = Array.isArray(val) ? val : (val?.items ?? []);
        setKpiCounts(prev => ({ ...prev, products: val?.meta?.total ?? val?.total ?? list.length }));
      }
      if (customerRes.status === "fulfilled") {
        const val = customerRes.value as any;
        const list = Array.isArray(val) ? val : (val?.items ?? []);
        setKpiCounts(prev => ({ ...prev, customers: val?.meta?.total ?? val?.total ?? list.length }));
      }
    } catch {
      // silently fall back
    } finally {
      setLoadingBranches(false);
    }
  }, [tokens]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);

  const calcDemo = calculateDocument({
    taxMode: DEFAULT_TENANT_SETTINGS.tax.mode,
    lines: [
      { quantity: 50, unitPrice: "2.20", taxPercent: 5 },
      { quantity: 10, unitPrice: "45.00", taxPercent: 5 },
      { quantity: 4, unitPrice: "120.00", taxPercent: 5 },
    ],
  });

  return (
    <div className="space-y-8">
      {/* ═══ Welcome Banner ═══ */}
      <div className="relative overflow-hidden rounded-2xl gradient-brand p-8 text-white shadow-xl shadow-primary/20">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/10 -translate-y-1/2 translate-x-1/3 blur-2xl" />
        <div className="absolute bottom-0 left-1/3 w-48 h-48 rounded-full bg-white/5 translate-y-1/2 blur-xl" />

        <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-5 w-5 text-white/80" />
              <span className="text-xs font-medium text-white/70 uppercase tracking-wider">
                Business Overview
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Welcome back, {user?.name || "Store Owner"}
            </h1>
            <p className="mt-1 text-sm text-white/70 max-w-lg">
              Here's what's happening across your branches in the UAE today.
              Everything is running smoothly.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              size="sm"
              asChild
              className="bg-white/15 text-white border-white/20 hover:bg-white/25 backdrop-blur-sm"
            >
              <Link href="/branches">
                <GitBranch className="h-4 w-4" />
                Manage Branches
              </Link>
            </Button>
            <Button
              size="sm"
              asChild
              className="bg-white text-primary hover:bg-white/90 shadow-lg"
            >
              <Link href="/products">
                <Plus className="h-4 w-4" />
                New Product
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* ═══ KPI Cards ═══ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {KPI_DEFS.map((kpi, i) => {
          const Icon = kpi.icon;
          const value = kpiCounts[kpi.valueKey];
          const isLoading = loadingBranches && value === 0;
          return (
            <Card
              key={kpi.label}
              className={cn(
                "group hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 animate-fade-in-up border-border/50",
                `stagger-${i + 1}`,
              )}
            >
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {kpi.label}
                  </span>
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br text-white shadow-sm transition-transform duration-300 group-hover:scale-110",
                      kpi.gradient,
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  {isLoading ? (
                    <div className="h-8 w-16 rounded-lg bg-muted animate-pulse" />
                  ) : (
                    <span className="tabular text-2xl font-bold text-foreground">
                      {value.toLocaleString()}
                    </span>
                  )}
                  <Badge
                    variant={kpi.changeType === "positive" ? "success" : "secondary"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {kpi.change}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>


      {/* ═══ Main Grid ═══ */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left 2 Cols */}
        <div className="space-y-6 lg:col-span-2">
          {/* Branches Table */}
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">
                    Active Branch Locations
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">
                    Live status synced from PostgreSQL
                  </CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link
                    href="/branches"
                    className="text-xs text-primary gap-1"
                  >
                    View All
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-border">
                {loadingBranches ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    <div className="h-5 w-5 mx-auto mb-2 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    Loading branches from API...
                  </div>
                ) : branches.length === 0 ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No branches found. Create your first branch.
                  </div>
                ) : (
                  branches.map((b) => (
                    <div
                      key={b.id}
                      className="flex items-center justify-between py-4 first:pt-0 last:pb-0 group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 font-mono text-xs font-bold text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                          {b.code}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {b.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {b.address || "Main retail location"}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <Badge variant="success" className="gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Active
                        </Badge>
                        <span className="text-xs font-mono text-muted-foreground hidden sm:inline">
                          {b.phone || "No phone"}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Access Cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            {QUICK_LINKS.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <Card className="group h-full hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-pointer hover:border-primary/30">
                    <CardContent className="p-5">
                      <div
                        className={cn(
                          "flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br text-white shadow-sm transition-transform duration-300 group-hover:scale-110",
                          item.gradient,
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="mt-4 text-sm font-semibold text-foreground">
                        {item.label}
                      </h3>
                      <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                        {item.desc}
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Calculation Engine */}
          <Card className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-indigo-600 text-white">
                  <Cpu className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm">
                    Exact Money & VAT Engine
                  </CardTitle>
                  <CardDescription className="text-[11px]">
                    Zero float precision errors
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                <dl className="tabular space-y-2.5 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">
                      Sample Subtotal (3 Lines)
                    </dt>
                    <dd className="font-mono font-semibold text-foreground">
                      AED {calcDemo.subtotal}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">UAE VAT (5%)</dt>
                    <dd className="font-mono font-semibold text-foreground">
                      AED {calcDemo.taxAmount}
                    </dd>
                  </div>
                  <Separator />
                  <div className="flex justify-between pt-1">
                    <dt className="font-semibold text-foreground">
                      Total Document
                    </dt>
                    <dd className="font-mono font-bold gradient-text text-base">
                      AED {calcDemo.total}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>
                  calculateDocument() validated
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Enterprise Guardrails */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-emerald-500 to-teal-600 text-white">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <CardTitle className="text-sm">
                  Enterprise Guardrails
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3 text-xs text-muted-foreground">
                {[
                  {
                    title: "PostgreSQL RLS",
                    desc: "Every table scoped to tenant ID automatically.",
                  },
                  {
                    title: "Offline-Ready POS",
                    desc: "Terminal uses SQLite with local checkout queues.",
                  },
                  {
                    title: "Separate Repos",
                    desc: "Frontend and Backend deployable to separate servers.",
                  },
                ].map((item) => (
                  <li key={item.title} className="flex items-start gap-3">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full gradient-brand" />
                    <span>
                      <strong className="text-foreground font-medium">
                        {item.title}:
                      </strong>{" "}
                      {item.desc}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
