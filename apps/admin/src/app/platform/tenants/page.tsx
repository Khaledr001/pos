"use client";

import React, { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  Building2,
  Search,
  Filter,
  Plus,
  MoreVertical,
  ShieldAlert,
  UserCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  ExternalLink,
  Layers,
  Sparkles,
  Calendar,
  Lock,
  Mail,
  User,
  GitBranch,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PLAN_IDS, type PlanId } from "@devsfleet/shared-types";

interface TenantItem {
  id: string;
  name: string;
  slug: string;
  planId: string;
  plan: {
    id: string;
    name: string;
    monthlyPrice: number;
    maxBranches: number;
    maxUsers: number;
  };
  isActive: boolean;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  suspendedReason: string | null;
  userCount: number;
  branchCount: number;
  deviceCount: number;
  createdAt: string;
}

interface PaginatedTenants {
  items: TenantItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export default function PlatformTenantsPage() {
  const { impersonateTenant } = useAuth();
  const [data, setData] = useState<PaginatedTenants | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [page, setPage] = useState(1);

  // Modals state
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [planModalTenant, setPlanModalTenant] = useState<TenantItem | null>(null);
  const [suspendModalTenant, setSuspendModalTenant] = useState<TenantItem | null>(null);
  const [impersonateTarget, setImpersonateTarget] = useState<TenantItem | null>(null);

  // Form states
  const [provisionForm, setProvisionForm] = useState({
    businessName: "",
    slug: "",
    ownerName: "",
    ownerEmail: "",
    password: "",
    planId: "starter" as PlanId,
    trialDays: 14,
    branchName: "Main Branch",
    branchCode: "MAIN",
  });
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  const [newPlanId, setNewPlanId] = useState<PlanId>("starter");
  const [newSubEndsAt, setNewSubEndsAt] = useState<string>("");
  const [planActionLoading, setPlanActionLoading] = useState(false);

  const [suspendReason, setSuspendReason] = useState("");
  const [suspendLoading, setSuspendLoading] = useState(false);

  const [impersonateLoading, setImpersonateLoading] = useState(false);

  const fetchTenants = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<any>("/admin/tenants", {
        query: {
          page,
          limit: 15,
          q: search.trim() || undefined,
          planId: selectedPlan || undefined,
          status: selectedStatus || undefined,
        },
      });
      const items = Array.isArray(res) ? res : (res?.items ?? []);
      const meta = res?.meta ?? {
        page,
        limit: 15,
        total: items.length,
        totalPages: Math.max(1, Math.ceil(items.length / 15)),
        hasNext: false,
        hasPrev: page > 1,
      };
      setData({ items, meta });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tenants directory");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTenants();
  }, [page, selectedPlan, selectedStatus]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchTenants();
  };

  const handleSlugAutoFill = (name: string) => {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    setProvisionForm((prev) => ({ ...prev, businessName: name, slug }));
  };

  const handleProvisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProvisionLoading(true);
    setProvisionError(null);
    try {
      await api.post("/admin/tenants", provisionForm);
      setProvisionOpen(false);
      setProvisionForm({
        businessName: "",
        slug: "",
        ownerName: "",
        ownerEmail: "",
        password: "",
        planId: "starter",
        trialDays: 14,
        branchName: "Main Branch",
        branchCode: "MAIN",
      });
      fetchTenants();
    } catch (err) {
      setProvisionError(err instanceof Error ? err.message : "Could not provision business");
    } finally {
      setProvisionLoading(false);
    }
  };

  const handleChangePlanSubmit = async () => {
    if (!planModalTenant) return;
    setPlanActionLoading(true);
    try {
      await api.post(`/admin/tenants/${planModalTenant.id}/plan`, {
        planId: newPlanId,
        subscriptionEndsAt: newSubEndsAt ? new Date(newSubEndsAt).toISOString() : undefined,
      });
      setPlanModalTenant(null);
      fetchTenants();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to change subscription plan");
    } finally {
      setPlanActionLoading(false);
    }
  };

  const handleSuspendSubmit = async () => {
    if (!suspendModalTenant || !suspendReason.trim()) return;
    setSuspendLoading(true);
    try {
      await api.post(`/admin/tenants/${suspendModalTenant.id}/suspend`, {
        reason: suspendReason.trim(),
      });
      setSuspendModalTenant(null);
      setSuspendReason("");
      fetchTenants();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to suspend business");
    } finally {
      setSuspendLoading(false);
    }
  };

  const handleActivate = async (tenantId: string) => {
    if (!confirm("Are you sure you want to reactivate this business?")) return;
    try {
      await api.post(`/admin/tenants/${tenantId}/activate`, {});
      fetchTenants();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to activate business");
    }
  };

  const handleImpersonate = async (tenant: TenantItem) => {
    setImpersonateLoading(true);
    try {
      await impersonateTenant(tenant.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Impersonation failed");
      setImpersonateLoading(false);
    }
  };

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Tenants & Organizations
            </h1>
            <Badge variant="outline" className="text-xs">
              {data?.meta?.total || 0} registered
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Browse all SaaS business instances, manage plans, toggle active statuses, and access customer accounts for support.
          </p>
        </div>

        <Button
          onClick={() => setProvisionOpen(true)}
          className="bg-primary text-primary-foreground font-semibold shadow-md text-xs h-9"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          Provision New Business
        </Button>
      </div>

      {/* ── Search & Filter Controls ── */}
      <Card className="border-border/60 shadow-2xs">
        <CardContent className="p-4">
          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-col md:flex-row items-stretch md:items-center gap-3"
          >
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by business name, slug..."
                className="pl-9 h-9 text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedPlan}
                onChange={(e) => {
                  setSelectedPlan(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-xl border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">All Subscription Plans</option>
                {PLAN_IDS.map((p) => (
                  <option key={p} value={p}>
                    {p.charAt(0).toUpperCase() + p.slice(1)} Plan
                  </option>
                ))}
              </select>

              <select
                value={selectedStatus}
                onChange={(e) => {
                  setSelectedStatus(e.target.value);
                  setPage(1);
                }}
                className="h-9 rounded-xl border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                <option value="">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="suspended">Suspended Only</option>
              </select>

              <Button type="submit" size="sm" variant="secondary" className="h-9 text-xs">
                Filter
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Tenants Data Table ── */}
      <Card className="border-border/60 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold">
                <th className="py-3 px-4">Business / Tenant</th>
                <th className="py-3 px-4">Slug / Domain</th>
                <th className="py-3 px-4">Subscription Plan</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Branches & Users</th>
                <th className="py-3 px-4">Created On</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <div className="inline-flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                      <span>Loading organizations…</span>
                    </div>
                  </td>
                </tr>
              ) : data?.items && data.items.length > 0 ? (
                data.items.map((tenant) => (
                  <tr key={tenant.id} className="hover:bg-muted/20 transition-colors group">
                    {/* Business Name */}
                    <td className="py-3.5 px-4 font-medium">
                      <Link
                        href={`/platform/tenants/${tenant.id}`}
                        className="font-bold text-foreground text-sm hover:text-primary transition-colors flex items-center gap-1.5"
                      >
                        <Building2 className="h-4 w-4 text-primary shrink-0" />
                        <span>{tenant.name}</span>
                      </Link>
                    </td>

                    {/* Slug */}
                    <td className="py-3.5 px-4 font-mono text-muted-foreground">
                      <span className="rounded bg-muted/50 px-1.5 py-0.5 border border-border/40">
                        t/{tenant.slug}
                      </span>
                    </td>

                    {/* Plan */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground">
                          {tenant.plan.name}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          ${tenant.plan.monthlyPrice}/mo
                        </span>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4">
                      <Badge
                        variant={tenant.isActive ? "default" : "destructive"}
                        className="text-[10px] font-semibold"
                      >
                        {tenant.isActive ? "Active" : "Suspended"}
                      </Badge>
                      {tenant.suspendedReason && (
                        <div
                          className="text-[10px] text-destructive truncate max-w-[140px] mt-0.5"
                          title={tenant.suspendedReason}
                        >
                          Reason: {tenant.suspendedReason}
                        </div>
                      )}
                    </td>

                    {/* Usage / Counts */}
                    <td className="py-3.5 px-4 text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <span title="Branches">
                          <strong>{tenant.branchCount || 1}</strong> br
                        </span>
                        <span>·</span>
                        <span title="Users">
                          <strong>{tenant.userCount || 1}</strong> users
                        </span>
                      </div>
                    </td>

                    {/* Created At */}
                    <td className="py-3.5 px-4 text-muted-foreground">
                      {new Date(tenant.createdAt).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>

                    {/* Actions Menu */}
                    <td className="py-3.5 px-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52 p-1.5 shadow-xl rounded-xl">
                          <DropdownMenuItem asChild className="cursor-pointer text-xs rounded-md">
                            <Link href={`/platform/tenants/${tenant.id}`}>
                              <Building2 className="mr-2 h-3.5 w-3.5 text-primary" />
                              View Tenant Details
                            </Link>
                          </DropdownMenuItem>

                          <DropdownMenuItem
                            onClick={() => {
                              setPlanModalTenant(tenant);
                              setNewPlanId(tenant.planId as PlanId);
                            }}
                            className="cursor-pointer text-xs rounded-md"
                          >
                            <Layers className="mr-2 h-3.5 w-3.5 text-violet-500" />
                            Change Plan
                          </DropdownMenuItem>

                          <DropdownMenuSeparator className="my-1" />

                          {/* Impersonate */}
                          <DropdownMenuItem
                            onClick={() => setImpersonateTarget(tenant)}
                            disabled={!tenant.isActive}
                            className="cursor-pointer text-xs rounded-md font-medium text-amber-600 dark:text-amber-400 focus:bg-amber-500/10"
                          >
                            <ShieldAlert className="mr-2 h-3.5 w-3.5" />
                            Impersonate Admin
                          </DropdownMenuItem>

                          <DropdownMenuSeparator className="my-1" />

                          {/* Suspend or Activate */}
                          {tenant.isActive ? (
                            <DropdownMenuItem
                              onClick={() => {
                                setSuspendModalTenant(tenant);
                                setSuspendReason("");
                              }}
                              className="cursor-pointer text-xs rounded-md text-destructive focus:bg-destructive/10"
                            >
                              <XCircle className="mr-2 h-3.5 w-3.5" />
                              Suspend Business
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => handleActivate(tenant.id)}
                              className="cursor-pointer text-xs rounded-md text-emerald-600 focus:bg-emerald-500/10"
                            >
                              <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                              Reactivate Business
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    No tenants match your search query.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {data && data?.meta?.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20 text-xs">
            <div className="text-muted-foreground">
              Showing page <strong>{data?.meta?.page}</strong> of{" "}
              <strong>{data?.meta?.totalPages}</strong> ({data?.meta?.total} total)
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!data?.meta?.hasPrev}
                className="h-8 text-xs"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!data?.meta?.hasNext}
                className="h-8 text-xs"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Provision Tenant Dialog ── */}
      <Dialog open={provisionOpen} onOpenChange={setProvisionOpen}>
        <DialogContent className="max-w-xl p-6 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              Provision Business Tenant
            </DialogTitle>
            <DialogDescription className="text-xs">
              Instantly create a new business instance, administrator account, and root branch.
            </DialogDescription>
          </DialogHeader>

          {provisionError && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{provisionError}</span>
            </div>
          )}

          <form onSubmit={handleProvisionSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Business Name *
                </label>
                <Input
                  required
                  value={provisionForm.businessName}
                  onChange={(e) => handleSlugAutoFill(e.target.value)}
                  placeholder="e.g. Al Lahiq Electricals"
                  className="h-9 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Tenant URL Slug *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-xs">
                    t/
                  </span>
                  <Input
                    required
                    value={provisionForm.slug}
                    onChange={(e) =>
                      setProvisionForm((prev) => ({ ...prev, slug: e.target.value }))
                    }
                    placeholder="al-lahiq"
                    className="pl-8 h-9 text-xs font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Owner Full Name *
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    required
                    value={provisionForm.ownerName}
                    onChange={(e) =>
                      setProvisionForm((prev) => ({ ...prev, ownerName: e.target.value }))
                    }
                    placeholder="Ahmed Al Mansoori"
                    className="pl-9 h-9 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Owner Email Address *
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="email"
                    required
                    value={provisionForm.ownerEmail}
                    onChange={(e) =>
                      setProvisionForm((prev) => ({ ...prev, ownerEmail: e.target.value }))
                    }
                    placeholder="owner@allahiq.com"
                    className="pl-9 h-9 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Initial Password *
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="password"
                    required
                    minLength={8}
                    value={provisionForm.password}
                    onChange={(e) =>
                      setProvisionForm((prev) => ({ ...prev, password: e.target.value }))
                    }
                    placeholder="Min 8 characters"
                    className="pl-9 h-9 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Commercial Plan Tier
                </label>
                <select
                  value={provisionForm.planId}
                  onChange={(e) =>
                    setProvisionForm((prev) => ({
                      ...prev,
                      planId: e.target.value as PlanId,
                    }))
                  }
                  className="w-full h-9 rounded-xl border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {PLAN_IDS.map((p) => (
                    <option key={p} value={p}>
                      {p.toUpperCase()} Plan
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Default Branch Name
                </label>
                <Input
                  value={provisionForm.branchName}
                  onChange={(e) =>
                    setProvisionForm((prev) => ({ ...prev, branchName: e.target.value }))
                  }
                  placeholder="Main Branch"
                  className="h-9 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Branch Short Code
                </label>
                <Input
                  value={provisionForm.branchCode}
                  onChange={(e) =>
                    setProvisionForm((prev) => ({ ...prev, branchCode: e.target.value }))
                  }
                  placeholder="MAIN"
                  className="h-9 text-xs font-mono uppercase"
                />
              </div>
            </div>

            <DialogFooter className="pt-3 gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setProvisionOpen(false)}
                className="text-xs h-9"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={provisionLoading}
                className="bg-primary text-primary-foreground font-semibold text-xs h-9"
              >
                {provisionLoading ? "Provisioning…" : "Provision Business"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Change Plan Dialog ── */}
      <Dialog open={Boolean(planModalTenant)} onOpenChange={() => setPlanModalTenant(null)}>
        <DialogContent className="max-w-md p-6 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              Modify Subscription Plan
            </DialogTitle>
            <DialogDescription className="text-xs">
              Change the commercial tier for <strong>{planModalTenant?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Target Plan
              </label>
              <select
                value={newPlanId}
                onChange={(e) => setNewPlanId(e.target.value as PlanId)}
                className="w-full h-10 rounded-xl border border-input bg-background px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              >
                {PLAN_IDS.map((p) => (
                  <option key={p} value={p}>
                    {p.toUpperCase()} Tier
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-foreground mb-1.5">
                Subscription End Date (Optional)
              </label>
              <Input
                type="date"
                value={newSubEndsAt}
                onChange={(e) => setNewSubEndsAt(e.target.value)}
                className="h-10 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setPlanModalTenant(null)}
              className="text-xs h-9"
            >
              Cancel
            </Button>
            <Button
              onClick={handleChangePlanSubmit}
              disabled={planActionLoading}
              className="bg-primary text-primary-foreground font-semibold text-xs h-9"
            >
              {planActionLoading ? "Updating Plan…" : "Apply Plan Change"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Suspend Tenant Dialog ── */}
      <Dialog open={Boolean(suspendModalTenant)} onOpenChange={() => setSuspendModalTenant(null)}>
        <DialogContent className="max-w-md p-6 rounded-2xl">
          <DialogHeader>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive mb-2">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <DialogTitle className="text-lg font-bold text-center text-foreground">
              Suspend Business Instance
            </DialogTitle>
            <DialogDescription className="text-xs text-center">
              Suspending <strong>{suspendModalTenant?.name}</strong> will immediately revoke all
              active counter till sessions and block login across all branches.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="block text-xs font-semibold text-foreground mb-1">
                Reason for Suspension *
              </label>
              <textarea
                required
                rows={3}
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="e.g. Overdue payment for enterprise plan renewal (Invoice #9482)"
                className="w-full rounded-xl border border-input bg-background p-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                This reason is logged in audit history and shown to store users at sign-in.
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setSuspendModalTenant(null)}
              className="text-xs h-9"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!suspendReason.trim() || suspendLoading}
              onClick={handleSuspendSubmit}
              className="font-semibold text-xs h-9"
            >
              {suspendLoading ? "Suspending…" : "Confirm Suspension"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Impersonate Confirmation Dialog ── */}
      <Dialog open={Boolean(impersonateTarget)} onOpenChange={() => setImpersonateTarget(null)}>
        <DialogContent className="max-w-md p-6 rounded-2xl">
          <DialogHeader>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 mb-2">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <DialogTitle className="text-lg font-bold text-center text-foreground">
              Support Impersonation Mode
            </DialogTitle>
            <DialogDescription className="text-xs text-center">
              You are about to sign into <strong>{impersonateTarget?.name}</strong> as their tenant
              administrator for support troubleshooting.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground space-y-1.5">
            <p>
              • An immutable audit row will be recorded with your operator ID.
            </p>
            <p>
              • Your Super Admin session is backed up, and you can return to the platform console anytime via the top banner.
            </p>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setImpersonateTarget(null)}
              className="text-xs h-9"
            >
              Cancel
            </Button>
            <Button
              onClick={() => impersonateTarget && handleImpersonate(impersonateTarget)}
              disabled={impersonateLoading}
              className="bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs h-9"
            >
              {impersonateLoading ? "Authenticating…" : "Begin Impersonation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
