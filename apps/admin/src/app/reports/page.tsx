"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  TrendingUp,
  Coins,
  Boxes,
  RefreshCw,
  ShieldCheck,
  Layers,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface FinancialSummary {
  range: { from: string; to: string };
  revenue: string;
  cost: string;
  grossProfit: string;
  grossMarginPercent: string;
  expenses: string;
  netProfit: string;
  unitsSold: string;
  taxCollected: string;
}

interface TopProduct {
  variantId: string;
  sku: string;
  productName: string;
  quantity: string;
  revenue: string;
}

interface InventorySummary {
  totals: {
    variants: number;
    units: string;
    value: string;
    outOfStock: number;
  };
  lowStock: unknown[];
}

const RANGES = { "7d": 6, "30d": 29, "90d": 89 } as const;
type RangeKey = keyof typeof RANGES;

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function money(value: string | undefined): string {
  return Number(value ?? "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ReportsPage() {
  const { tokens } = useAuth();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [financial, setFinancial] = useState<FinancialSummary | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [invSummary, setInvSummary] = useState<InventorySummary | null>(null);
  const [dateRange, setDateRange] = useState<RangeKey>("30d");

  const fetchReports = useCallback(async () => {
    if (!tokens?.accessToken) return;
    setLoading(true);
    setError(null);

    const to = isoDaysAgo(0);
    const from = isoDaysAgo(RANGES[dateRange]);

    try {
      const [finRes, topRes, invRes] = await Promise.allSettled([
        api.get<FinancialSummary>("/reports/financial", {
          accessToken: tokens.accessToken,
          query: { from, to },
        }),
        api.get<{ items: TopProduct[] }>("/reports/top-products", {
          accessToken: tokens.accessToken,
          query: { from, to, limit: 5 },
        }),
        api.get<InventorySummary>("/reports/inventory", { accessToken: tokens.accessToken }),
      ]);

      if (finRes.status === "fulfilled") setFinancial(finRes.value);
      else setError((prev) => prev ?? finRes.reason?.message ?? "Failed to load financial figures.");

      if (topRes.status === "fulfilled") setTopProducts(topRes.value?.items ?? []);
      if (invRes.status === "fulfilled") setInvSummary(invRes.value);
    } finally {
      setLoading(false);
    }
  }, [tokens, dateRange]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Analytics & Financial Reports</h1>
            <Badge variant="secondary">FTA Compliant Audits</Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Revenue tracking, margin calculations, weighted-average stock valuation, and tax summaries.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-secondary/50 p-1 rounded-lg border border-border">
            {(Object.keys(RANGES) as RangeKey[]).map((r) => (
              <button
                key={r}
                onClick={() => setDateRange(r)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer",
                  dateRange === r ? "bg-background shadow-xs text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {r === "7d" ? "Last 7 Days" : r === "30d" ? "Last 30 Days" : "Last 90 Days"}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={fetchReports} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {financial && (
        <p className="text-xs text-muted-foreground">
          Showing {financial.range.from} to {financial.range.to}
        </p>
      )}

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="hover:shadow-md transition-all">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Gross Revenue</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                <TrendingUp className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3">
              <span className="tabular text-2xl font-bold text-foreground">
                {loading ? "—" : `AED ${money(financial?.revenue)}`}
              </span>
              <p className="text-[11px] text-muted-foreground mt-1">
                {financial ? `${financial.unitsSold} units sold` : "No data for this range"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-all">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Stock Valuation (Cost)</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Boxes className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3">
              <span className="tabular text-2xl font-bold text-foreground">
                {loading ? "—" : `AED ${money(invSummary?.totals.value)}`}
              </span>
              <p className="text-[11px] text-muted-foreground mt-1">
                Weighted average unit cost
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-all">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Est. Gross Margin</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <Coins className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3">
              <span className="tabular text-2xl font-bold text-foreground">
                {loading ? "—" : financial ? `${financial.grossMarginPercent}%` : "—"}
              </span>
              <p className="text-[11px] text-muted-foreground mt-1">
                {financial ? `AED ${money(financial.grossProfit)} margin` : "No data for this range"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="hover:shadow-md transition-all">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">VAT Output</span>
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400">
                <ShieldCheck className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3">
              <span className="tabular text-2xl font-bold text-foreground">
                {loading ? "—" : `AED ${money(financial?.taxCollected)}`}
              </span>
              <p className="text-[11px] text-muted-foreground mt-1">
                FTA tax return audit ready
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Selling Products */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Top Performing Products</CardTitle>
                <CardDescription className="text-xs mt-1">Highest revenue in the selected range</CardDescription>
              </div>
              <Badge variant="secondary" className="text-[10px]">Ranked by Revenue</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="py-6 text-center text-xs text-muted-foreground">Loading...</p>
            ) : topProducts.length === 0 ? (
              <div className="py-8 text-center">
                <Layers className="mx-auto h-8 w-8 text-muted-foreground/30" />
                <p className="mt-2 text-xs text-muted-foreground">No sales in this range yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {topProducts.map((p, idx) => (
                  <div key={p.variantId} className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary text-xs font-bold font-mono text-muted-foreground">
                        #{idx + 1}
                      </span>
                      <div>
                        <p className="text-xs font-semibold text-foreground">{p.productName}</p>
                        <p className="text-[10px] font-mono text-muted-foreground">SKU: {p.sku}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-mono font-bold text-foreground">AED {money(p.revenue)}</p>
                      <p className="text-[10px] text-muted-foreground">{p.quantity} units sold</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Financial & Stock Health Breakdown */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Inventory Health & Cost Analysis</CardTitle>
                <CardDescription className="text-xs mt-1">Real-time valuation vs stock risk metrics</CardDescription>
              </div>
              <Badge variant="outline" className="text-[10px]">Real-time DB</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-border p-4 space-y-3 bg-secondary/20">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">Active Catalog Items</span>
                <span className="font-semibold text-foreground">
                  {loading ? "—" : `${invSummary?.totals.variants ?? 0} SKUs`}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">Low Stock Warnings</span>
                <Badge variant="warning" className="text-[10px]">
                  {loading ? "—" : `${invSummary?.lowStock.length ?? 0} Products below reorder level`}
                </Badge>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">Out of Stock</span>
                <span className="font-semibold text-muted-foreground">
                  {loading ? "—" : `${invSummary?.totals.outOfStock ?? 0} SKUs`}
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-border p-4 space-y-2.5">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                Accounting & Compliance Verification
              </p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                All receipts and credit notes maintain append-only ledgers. Profit margins are calculated using strict decimal fixed-point arithmetic to prevent floating-point drift.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
