"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Layers,
  Check,
  Building2,
  Users,
  Tablet,
  Package,
  Sparkles,
  ArrowRight,
  TrendingUp,
  X,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PLANS, type Plan, type PlanId } from "@devsfleet/shared-types";

interface PlatformStats {
  tenants: number;
  planDistribution: Array<{
    planId: string;
    planName: string;
    tenants: number;
  }>;
  estimatedMrr: number;
}

const FEATURE_LABELS: Record<string, string> = {
  whatsappAi: "WhatsApp AI Bot & Quotations",
  multiCurrency: "Multi-Currency Transactions",
  automatedBackups: "Automated Off-Box Backups",
  apiAccess: "Platform REST API & Webhooks",
  financialReports: "Cost, Margin & Profit Reporting",
};

export default function PlatformPlansPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await api.get<PlatformStats>("/admin/stats");
        setStats(data);
      } catch (err) {
        console.error("Failed to load plan stats:", err);
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  const allPlans = Object.values(PLANS);

  const getTenantCount = (planId: string) => {
    return stats?.planDistribution.find((p) => p.planId === planId)?.tenants || 0;
  };

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Commercial Subscription Plans
            </h1>
            <Badge variant="outline" className="text-xs">
              {allPlans.length} Active Tiers
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Subscription tiers, resource quotas, and commercial pricing models enforced across all tenant instances.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm" className="text-xs h-9">
            <Link href="/platform/tenants">
              <Building2 className="mr-1.5 h-4 w-4" />
              Manage Tenant Tiers
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Metric Highlights ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border/60 shadow-2xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-muted-foreground">Estimated MRR</div>
              <div className="text-2xl font-black text-foreground mt-1">
                ${stats?.estimatedMrr.toLocaleString() || 0}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-2xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-muted-foreground">Total Subscribed Businesses</div>
              <div className="text-2xl font-black text-foreground mt-1">
                {stats?.tenants || 0}
              </div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-2xs">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-muted-foreground">Highest Tier Plan</div>
              <div className="text-2xl font-black text-foreground mt-1">Enterprise</div>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400">
              <Sparkles className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Plans Cards Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {allPlans.map((plan) => {
          const tenantCount = getTenantCount(plan.id);
          const isFeatured = plan.id === "pro" || plan.id === "enterprise";

          return (
            <Card
              key={plan.id}
              className={`relative overflow-hidden flex flex-col justify-between transition-all duration-200 border ${
                isFeatured
                  ? "border-primary/50 shadow-md ring-1 ring-primary/20 bg-gradient-to-b from-primary/5 via-background to-background"
                  : "border-border/60 shadow-xs hover:border-border"
              }`}
            >
              {isFeatured && (
                <div className="absolute top-0 right-0 rounded-bl-xl bg-primary px-2.5 py-0.5 text-[10px] font-bold text-primary-foreground">
                  POPULAR
                </div>
              )}

              <div>
                <CardHeader className="pb-3">
                  <div className="space-y-1">
                    <CardTitle className="text-lg font-bold text-foreground capitalize">
                      {plan.name}
                    </CardTitle>
                    <div className="flex items-baseline gap-1 mt-2">
                      <span className="text-3xl font-black text-foreground">
                        {plan.monthlyPrice !== null ? `$${plan.monthlyPrice}` : "Custom"}
                      </span>
                      {plan.monthlyPrice !== null && (
                        <span className="text-xs text-muted-foreground">/month</span>
                      )}
                    </div>
                  </div>
                  <div className="pt-2">
                    <Badge variant="secondary" className="text-[11px] font-medium">
                      {tenantCount} active {tenantCount === 1 ? "tenant" : "tenants"}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-2 text-xs">
                  <div className="space-y-2 border-t border-border/50 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Building2 className="h-3.5 w-3.5 text-primary" />
                        Max Branches
                      </span>
                      <span className="font-bold text-foreground font-mono">
                        {plan.maxBranches === -1 ? "Unlimited" : plan.maxBranches}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Users className="h-3.5 w-3.5 text-indigo-500" />
                        Max Staff
                      </span>
                      <span className="font-bold text-foreground font-mono">
                        {plan.maxUsers === -1 ? "Unlimited" : plan.maxUsers}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Tablet className="h-3.5 w-3.5 text-violet-500" />
                        Max POS Tills
                      </span>
                      <span className="font-bold text-foreground font-mono">
                        {plan.maxDevices === -1 ? "Unlimited" : plan.maxDevices}
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Package className="h-3.5 w-3.5 text-emerald-500" />
                        Max SKUs
                      </span>
                      <span className="font-bold text-foreground font-mono">
                        {plan.maxProducts === -1
                          ? "Unlimited"
                          : plan.maxProducts.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Feature Perks */}
                  <div className="border-t border-border/50 pt-3 space-y-2">
                    <div className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
                      Included Capabilities
                    </div>
                    {Object.entries(plan.features).map(([key, enabled]) => (
                      <div
                        key={key}
                        className={`flex items-center gap-1.5 ${
                          enabled ? "text-foreground font-medium" : "text-muted-foreground/40 line-through"
                        }`}
                      >
                        {enabled ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : (
                          <X className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                        )}
                        <span>{FEATURE_LABELS[key] || key}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </div>

              <div className="p-4 pt-0">
                <Button
                  asChild
                  variant={isFeatured ? "default" : "outline"}
                  size="sm"
                  className="w-full text-xs h-8"
                >
                  <Link href={`/platform/tenants?planId=${plan.id}`}>
                    <span>Filter {plan.name} Tenants</span>
                    <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
