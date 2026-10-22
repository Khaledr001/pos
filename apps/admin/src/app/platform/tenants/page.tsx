"use client";

import React, { useCallback, useState, useTransition } from "react";
import Link from "next/link";
import {
  Building2,
  Filter,
  Plus,
  MoreVertical,
  ShieldAlert,
  UserCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
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
import { cn } from "@/lib/utils";
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";
import {
  SortableTh, Table, TableBody, TableContainer, TableEmpty, TableHead,
  TablePagination, TableSearch, Th,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow, MobileSort, listCard } from "@/components/ui/mobile-list";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
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
    /** null on Enterprise — custom pricing, not free. */
    monthlyPrice: number | null;
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

export default function PlatformTenantsPage() {
  const { impersonateTenant } = useAuth();
  const PAGE_SIZE = 15;
  const list = useListQuery({
    sortBy: "createdAt",
    sortOrder: "desc",
    filters: { plan: "", status: "" },
  });
  const { q, page, sortBy, sortOrder } = list;
  const selectedPlan = list.filters.plan;
  const selectedStatus = list.filters.status;

  const loadTenants = useCallback(
    async (signal: AbortSignal) =>
      readListResult<TenantItem>(
        await api.get<unknown>("/admin/tenants", {
          signal,
          query: {
            page,
            limit: PAGE_SIZE,
            q: q.trim() || undefined,
            planId: selectedPlan || undefined,
            status: selectedStatus || undefined,
            sortBy,
            sortOrder,
          },
        }),
      ),
    [q, page, selectedPlan, selectedStatus, sortBy, sortOrder],
  );
  const {
    items: tenants, total, loading, initialLoading, error, reload: fetchTenants,
  } = useListData(loadTenants, list.ready);

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
  const [impersonateReason, setImpersonateReason] = useState("");

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
      await impersonateTenant(tenant.id, impersonateReason.trim());
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
              {total} registered
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
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
            <TableSearch
              value={list.search}
              onChange={list.setSearch}
              label="Search businesses"
              placeholder="Search by business name, slug..."
              className="flex-1"
            />
            <MobileSort
              options={[
                { column: "createdAt", label: "Created", firstOrder: "desc" },
                { column: "name", label: "Name" },
              ]}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onChange={list.setSort}
            />

            <div className="flex flex-wrap items-center gap-2">
              <SelectField
                value={selectedPlan}
                onValueChange={(v) => list.setFilter("plan", v)}
                label="Filter by plan"
                className="min-w-0 flex-1 rounded-xl bg-background md:w-52 md:flex-none"
                options={[
                  { value: "", label: "All Subscription Plans" },
                  ...PLAN_IDS.map((p) => ({ value: p, label: `${p.charAt(0).toUpperCase() + p.slice(1)} Plan` })),
                ]}
              />

              <SelectField
                value={selectedStatus}
                onValueChange={(v) => list.setFilter("status", v)}
                label="Filter by status"
                className="min-w-0 flex-1 rounded-xl bg-background md:w-44 md:flex-none"
                options={[
                  { value: "", label: "All Statuses" },
                  { value: "active", label: "Active Only" },
                  { value: "suspended", label: "Suspended Only" },
                ]}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <MobileList
        loading={initialLoading}
        empty={
          <MobileEmpty
            icon={Building2}
            title="No businesses found"
            description={q || selectedPlan || selectedStatus ? "No tenants match your search or filters." : "Provision the first business to get started."}
          />
        }
      >
        {tenants.map((tenant) => (
          <MobileRow
            key={tenant.id}
            title={tenant.name}
            subtitle={tenant.plan.name}
            badge={
              <Badge variant={tenant.isActive ? "default" : "destructive"} className="text-[10px] font-semibold">
                {tenant.isActive ? "Active" : "Suspended"}
              </Badge>
            }
            fields={[
              { label: "Slug", value: <span className="font-mono">t/{tenant.slug}</span> },
              {
                label: "Plan",
                value: `${tenant.plan.name} · ${tenant.plan.monthlyPrice === null ? "Custom" : `$${tenant.plan.monthlyPrice}/mo`}`,
              },
              ...(tenant.suspendedReason ? [{ label: "Reason", value: tenant.suspendedReason }] : []),
              { label: "Branches", value: String(tenant.branchCount ?? 0), numeric: true },
              { label: "Users", value: String(tenant.userCount ?? 0), numeric: true },
              {
                label: "Created",
                value: new Date(tenant.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
              },
            ]}
            actions={
              <>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/platform/tenants/${tenant.id}`}>
                    <Building2 className="h-3.5 w-3.5" /> Details
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPlanModalTenant(tenant);
                    setNewPlanId(tenant.planId as PlanId);
                  }}
                >
                  <Layers className="h-3.5 w-3.5" /> Change plan
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setImpersonateTarget(tenant)}
                  disabled={!tenant.isActive}
                  className="text-amber-600 dark:text-amber-400"
                >
                  <ShieldAlert className="h-3.5 w-3.5" /> Impersonate
                </Button>
                {tenant.isActive ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSuspendModalTenant(tenant);
                      setSuspendReason("");
                    }}
                    className="text-destructive hover:text-destructive"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Suspend
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleActivate(tenant.id)}
                    className="text-emerald-600"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Reactivate
                  </Button>
                )}
              </>
            }
          />
        ))}
      </MobileList>

      {/* ── Tenants Data Table ── */}
      <Card className={cn("border-border/60 shadow-xs", listCard)}>
        <TableContainer className="hidden md:block">
          <Table>
            <TableHead>
              <tr>
                <SortableTh column="name" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Business / Tenant</SortableTh>
                <Th>Slug / Domain</Th>
                <Th>Subscription Plan</Th>
                <Th>Status</Th>
                <Th>Branches & Users</Th>
                <SortableTh column="createdAt" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} firstOrder="desc">Created On</SortableTh>
                <Th align="right"><span className="sr-only">Actions</span></Th>
              </tr>
            </TableHead>
            <TableBody
              columns={7}
              loading={initialLoading}
              empty={
                <TableEmpty
                  columns={7}
                  icon={Building2}
                  title="No businesses found"
                  description={q || selectedPlan || selectedStatus ? "No tenants match your search or filters." : "Provision the first business to get started."}
                />
              }
            >
                {tenants.map((tenant) => (
                  <tr key={tenant.id} className={cn("hover:bg-muted/20 transition-colors group", loading && "opacity-60")}>
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
                          {tenant.plan.monthlyPrice === null
                            ? "Custom"
                            : `$${tenant.plan.monthlyPrice}/mo`}
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
                          className="text-[10px] text-destructive truncate max-w-35 mt-0.5"
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
                          <strong>{tenant.branchCount ?? 0}</strong> br
                        </span>
                        <span>·</span>
                        <span title="Users">
                          <strong>{tenant.userCount ?? 0}</strong> users
                        </span>
                      </div>
                    </td>

                    {/* Created At */}
                    <td className="py-3.5 px-4 text-muted-foreground whitespace-nowrap tabular-nums">
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
                          <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" aria-label={`Actions for ${tenant.name}`}>
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
                ))}
            </TableBody>
          </Table>
        </TableContainer>

        <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun="businesses" />
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
                    minLength={6}
                    // Mirrors CreateTenantSchema. Kept in step deliberately:
                    // a client rule looser than the server's turns a fixable
                    // typo into an opaque 400 after the form is submitted.
                    pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{6,}"
                    title="At least 6 characters, with a lowercase letter, an uppercase letter, and a digit"
                    value={provisionForm.password}
                    onChange={(e) =>
                      setProvisionForm((prev) => ({ ...prev, password: e.target.value }))
                    }
                    placeholder="Min 6 chars, mixed case + digit"
                    className="pl-9 h-9 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Commercial Plan Tier
                </label>
                <SelectField
                  size="sm"
                  value={provisionForm.planId}
                  onValueChange={(v) =>
                    setProvisionForm((prev) => ({
                      ...prev,
                      planId: v as PlanId,
                    }))
                  }
                  label="Commercial plan tier"
                  className="rounded-xl bg-background"
                  options={PLAN_IDS.map((p) => ({ value: p, label: `${p.toUpperCase()} Plan` }))}
                />
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
              <SelectField
                value={newPlanId}
                onValueChange={(v) => setNewPlanId(v as PlanId)}
                label="Target plan"
                className="rounded-xl bg-background text-xs font-medium"
                options={PLAN_IDS.map((p) => ({ value: p, label: `${p.toUpperCase()} Tier` }))}
              />
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

          <div className="space-y-1.5">
            <label
              htmlFor="impersonate-reason"
              className="text-xs font-semibold text-foreground"
            >
              Reason <span className="text-destructive">*</span>
            </label>
            <textarea
              id="impersonate-reason"
              value={impersonateReason}
              onChange={(e) => setImpersonateReason(e.target.value)}
              rows={2}
              minLength={3}
              maxLength={500}
              placeholder="e.g. Ticket #4821 — customer reports missing stock after import"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500/30"
            />
          </div>

          <div className="rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground space-y-1.5">
            <p>• Everything you do is audit-logged against your operator ID, not theirs.</p>
            <p>
              • The session expires on its own and cannot be renewed. Exit via the top
              banner to return to the platform console.
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
              disabled={impersonateLoading || impersonateReason.trim().length < 3}
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
