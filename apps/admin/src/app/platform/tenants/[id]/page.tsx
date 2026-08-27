"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Building2,
  GitBranch,
  Users,
  Package,
  ShoppingCart,
  Tablet,
  ShieldAlert,
  Layers,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Calendar,
  Clock,
  Mail,
  Phone,
  MapPin,
  RefreshCw,
  AlertTriangle,
  ScrollText,
  Sliders,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { PLAN_IDS, type PlanId } from "@devsfleet/shared-types";

interface TenantDetail {
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
    maxDevices: number;
    maxProducts: number;
  };
  trial: {
    isTrial: boolean;
    daysRemaining: number | null;
    isExpired: boolean;
  };
  isActive: boolean;
  trialEndsAt: string | null;
  subscriptionEndsAt: string | null;
  suspendedReason: string | null;
  suspendedAt: string | null;
  settings: {
    currency?: { base: string };
    tax?: { defaultVatPercent: string };
  };
  createdAt: string;
  updatedAt: string;
  branches: Array<{
    id: string;
    name: string;
    code: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    isActive: boolean;
    createdAt: string;
  }>;
  users: Array<{
    id: string;
    name: string;
    email: string | null;
    roleName: string;
    branchName: string | null;
    isActive: boolean;
    isPlatformAdmin: boolean;
    lastLoginAt: string | null;
    createdAt: string;
  }>;
  counts: {
    branches: number;
    users: number;
    devices: number;
    products: number;
    sales: number;
  };
  usage: {
    branches: { current: number; max: number };
    users: { current: number; max: number };
    devices: { current: number; max: number };
    products: { current: number; max: number };
  };
  auditLogs: Array<{
    id: string;
    action: string;
    entityType: string;
    reason: string | null;
    createdAt: string;
    ipAddress: string | null;
  }>;
}

export default function TenantDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { impersonateTenant } = useAuth();
  const tenantId = params.id as string;

  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "branches" | "users" | "audit">("overview");

  // Plan modal
  const [planOpen, setPlanOpen] = useState(false);
  const [newPlanId, setNewPlanId] = useState<PlanId>("starter");
  const [planLoading, setPlanLoading] = useState(false);

  // Suspend modal
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendLoading, setSuspendLoading] = useState(false);

  // Impersonate modal
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const [impersonateLoading, setImpersonateLoading] = useState(false);

  const fetchTenant = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<TenantDetail>(`/admin/tenants/${tenantId}`);
      setTenant(data);
      setNewPlanId(data.planId as PlanId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tenant details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (tenantId) fetchTenant();
  }, [tenantId]);

  const handleChangePlan = async () => {
    setPlanLoading(true);
    try {
      await api.post(`/admin/tenants/${tenantId}/plan`, { planId: newPlanId });
      setPlanOpen(false);
      fetchTenant();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update plan");
    } finally {
      setPlanLoading(false);
    }
  };

  const handleSuspend = async () => {
    if (!suspendReason.trim()) return;
    setSuspendLoading(true);
    try {
      await api.post(`/admin/tenants/${tenantId}/suspend`, { reason: suspendReason.trim() });
      setSuspendOpen(false);
      fetchTenant();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to suspend");
    } finally {
      setSuspendLoading(false);
    }
  };

  const handleActivate = async () => {
    if (!confirm("Reactivate this business and allow live sign-in?")) return;
    try {
      await api.post(`/admin/tenants/${tenantId}/activate`, {});
      fetchTenant();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to activate");
    }
  };

  const handleImpersonate = async () => {
    setImpersonateLoading(true);
    try {
      await impersonateTenant(tenantId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Impersonation failed");
      setImpersonateLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading business profile…</p>
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="space-y-4 py-8">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/platform/tenants">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to Directory
          </Link>
        </Button>
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-center text-destructive">
          <AlertTriangle className="mx-auto h-8 w-8 mb-2" />
          <h2 className="text-base font-bold">Tenant Not Found</h2>
          <p className="text-xs text-muted-foreground mt-1">{error || "Invalid business ID."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* ── Breadcrumb & Back ── */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/platform/tenants" className="hover:text-foreground transition-colors">
          Tenants Directory
        </Link>
        <span>/</span>
        <span className="font-semibold text-foreground">{tenant.name}</span>
      </div>

      {/* ── Tenant Hero Banner ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border border-border/60 bg-muted/20 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 text-primary font-black text-2xl">
            {tenant.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-black tracking-tight text-foreground">
                {tenant.name}
              </h1>
              <Badge variant={tenant.isActive ? "default" : "destructive"}>
                {tenant.isActive ? "Active Business" : "Suspended"}
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px]">
                t/{tenant.slug}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                Plan: <strong className="text-foreground">{tenant.plan.name}</strong> (${tenant.plan.monthlyPrice}/mo)
              </span>
              <span>•</span>
              <span>
                Created: {new Date(tenant.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Top Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => setPlanOpen(true)}
            variant="outline"
            className="text-xs h-9"
          >
            <Layers className="mr-1.5 h-3.5 w-3.5" />
            Change Plan
          </Button>

          {tenant.isActive ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSuspendOpen(true)}
              className="text-xs h-9 text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              <XCircle className="mr-1.5 h-3.5 w-3.5" />
              Suspend
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={handleActivate}
              className="text-xs h-9 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10"
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Activate
            </Button>
          )}

          <Button
            size="sm"
            onClick={() => setImpersonateOpen(true)}
            disabled={!tenant.isActive}
            className="bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs h-9 shadow-xs"
          >
            <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
            Impersonate
          </Button>
        </div>
      </div>

      {/* ── Key Metrics Grid ── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Card className="border-border/60 shadow-2xs">
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-muted-foreground">Branches</div>
            <div className="text-2xl font-black text-foreground mt-1">
              {tenant.counts.branches}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Limit: {tenant.plan.maxBranches}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-2xs">
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-muted-foreground">Users / Staff</div>
            <div className="text-2xl font-black text-foreground mt-1">
              {tenant.counts.users}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Limit: {tenant.plan.maxUsers}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-2xs">
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-muted-foreground">POS Tills</div>
            <div className="text-2xl font-black text-foreground mt-1">
              {tenant.counts.devices}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Limit: {tenant.plan.maxDevices}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-2xs">
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-muted-foreground">Catalog SKUs</div>
            <div className="text-2xl font-black text-foreground mt-1">
              {tenant.counts.products}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Limit: {tenant.plan.maxProducts.toLocaleString()}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-2xs">
          <CardContent className="p-4">
            <div className="text-xs font-semibold text-muted-foreground">Total Invoices</div>
            <div className="text-2xl font-black text-foreground mt-1">
              {tenant.counts.sales}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Processed
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Navigation Tabs ── */}
      <div className="flex border-b border-border text-xs font-semibold gap-2">
        <button
          onClick={() => setActiveTab("overview")}
          className={`pb-3 px-3 border-b-2 transition-colors ${
            activeTab === "overview"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Plan Quotas & Specs
        </button>
        <button
          onClick={() => setActiveTab("branches")}
          className={`pb-3 px-3 border-b-2 transition-colors ${
            activeTab === "branches"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Branches ({tenant.branches.length})
        </button>
        <button
          onClick={() => setActiveTab("users")}
          className={`pb-3 px-3 border-b-2 transition-colors ${
            activeTab === "users"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Staff & Roles ({tenant.users.length})
        </button>
        <button
          onClick={() => setActiveTab("audit")}
          className={`pb-3 px-3 border-b-2 transition-colors ${
            activeTab === "audit"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Audit History
        </button>
      </div>

      {/* ── Tab Contents ── */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Plan Limits Progress */}
          <Card className="border-border/60 shadow-xs">
            <CardHeader>
              <CardTitle className="text-sm font-bold text-foreground">
                Plan Limit Allowances
              </CardTitle>
              <CardDescription className="text-xs">
                Real-time resource utilization against commercial quotas
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              {/* Branches meter */}
              <div>
                <div className="flex justify-between mb-1">
                  <span className="font-medium text-foreground">Physical Branches</span>
                  <span className="text-muted-foreground font-mono">
                    {tenant.usage.branches.current} / {tenant.usage.branches.max}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        (tenant.usage.branches.current / tenant.usage.branches.max) * 100,
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Users meter */}
              <div>
                <div className="flex justify-between mb-1">
                  <span className="font-medium text-foreground">Authorized Staff Users</span>
                  <span className="text-muted-foreground font-mono">
                    {tenant.usage.users.current} / {tenant.usage.users.max}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        (tenant.usage.users.current / tenant.usage.users.max) * 100,
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Devices meter */}
              <div>
                <div className="flex justify-between mb-1">
                  <span className="font-medium text-foreground">Active POS Hardware Devices</span>
                  <span className="text-muted-foreground font-mono">
                    {tenant.usage.devices.current} / {tenant.usage.devices.max}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-violet-500 rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        (tenant.usage.devices.current / tenant.usage.devices.max) * 100,
                      )}%`,
                    }}
                  />
                </div>
              </div>

              {/* Products meter */}
              <div>
                <div className="flex justify-between mb-1">
                  <span className="font-medium text-foreground">Catalogue SKUs</span>
                  <span className="text-muted-foreground font-mono">
                    {tenant.usage.products.current} / {tenant.usage.products.max.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-emerald-500 rounded-full transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        (tenant.usage.products.current / tenant.usage.products.max) * 100,
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Business Configuration Details */}
          <Card className="border-border/60 shadow-xs">
            <CardHeader>
              <CardTitle className="text-sm font-bold text-foreground">
                Configuration & Metadata
              </CardTitle>
              <CardDescription className="text-xs">
                Tenant parameters and multi-tenant isolation IDs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <span className="text-muted-foreground">Unique Tenant UUID</span>
                <span className="font-mono text-[11px] text-foreground">{tenant.id}</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <span className="text-muted-foreground">Store Currency</span>
                <span className="font-bold text-foreground">
                  {tenant.settings?.currency?.base || "AED"}
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <span className="text-muted-foreground">Default VAT / Tax Rate</span>
                <span className="font-bold text-foreground">
                  {tenant.settings?.tax?.defaultVatPercent || "5"}%
                </span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                <span className="text-muted-foreground">Subscription Term Status</span>
                <span className="font-medium text-foreground">
                  {tenant.subscriptionEndsAt
                    ? `Paid until ${new Date(tenant.subscriptionEndsAt).toLocaleDateString()}`
                    : "No fixed period set"}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === "branches" && (
        <Card className="border-border/60 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold">
                  <th className="py-3 px-4">Branch Name</th>
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Contact</th>
                  <th className="py-3 px-4">Address</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {tenant.branches.map((b) => (
                  <tr key={b.id} className="hover:bg-muted/20">
                    <td className="py-3.5 px-4 font-bold text-foreground flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-primary" />
                      {b.name}
                    </td>
                    <td className="py-3.5 px-4 font-mono">{b.code}</td>
                    <td className="py-3.5 px-4 text-muted-foreground">
                      {b.phone || b.email || "—"}
                    </td>
                    <td className="py-3.5 px-4 text-muted-foreground">
                      {b.address || "—"}
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge variant={b.isActive ? "default" : "secondary"}>
                        {b.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === "users" && (
        <Card className="border-border/60 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold">
                  <th className="py-3 px-4">Staff Member</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Assigned Branch</th>
                  <th className="py-3 px-4">Last Login</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {tenant.users.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/20">
                    <td className="py-3.5 px-4 font-bold text-foreground flex items-center gap-2">
                      <Users className="h-4 w-4 text-indigo-500" />
                      {u.name}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-muted-foreground">{u.email || "—"}</td>
                    <td className="py-3.5 px-4">
                      <Badge variant="outline" className="capitalize">
                        {u.roleName}
                      </Badge>
                    </td>
                    <td className="py-3.5 px-4 text-muted-foreground">
                      {u.branchName || "All Branches"}
                    </td>
                    <td className="py-3.5 px-4 text-muted-foreground">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "Never"}
                    </td>
                    <td className="py-3.5 px-4">
                      <Badge variant={u.isActive ? "default" : "destructive"}>
                        {u.isActive ? "Active" : "Locked"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === "audit" && (
        <Card className="border-border/60 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold">
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity</th>
                  <th className="py-3 px-4">Reason / Notes</th>
                  <th className="py-3 px-4">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {tenant.auditLogs.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/20">
                    <td className="py-3 px-4 font-semibold capitalize text-foreground">
                      {a.action}
                    </td>
                    <td className="py-3 px-4 font-mono text-muted-foreground">
                      {a.entityType}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {a.reason || "—"}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ── Dialogs ── */}
      {/* Change Plan Dialog */}
      <Dialog open={planOpen} onOpenChange={setPlanOpen}>
        <DialogContent className="max-w-md p-6 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground">
              Modify Subscription Tier
            </DialogTitle>
            <DialogDescription className="text-xs">
              Change the commercial tier for {tenant.name}.
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
                    {p.toUpperCase()} Plan
                  </option>
                ))}
              </select>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPlanOpen(false)} className="text-xs h-9">
              Cancel
            </Button>
            <Button
              onClick={handleChangePlan}
              disabled={planLoading}
              className="bg-primary text-primary-foreground font-semibold text-xs h-9"
            >
              {planLoading ? "Updating…" : "Apply Plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend Dialog */}
      <Dialog open={suspendOpen} onOpenChange={setSuspendOpen}>
        <DialogContent className="max-w-md p-6 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-destructive">
              Suspend Business Instance
            </DialogTitle>
            <DialogDescription className="text-xs">
              This will revoke all active counter sessions for {tenant.name}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <textarea
              required
              rows={3}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Reason for suspension (shown to store users)..."
              className="w-full rounded-xl border border-input bg-background p-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSuspendOpen(false)} className="text-xs h-9">
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!suspendReason.trim() || suspendLoading}
              onClick={handleSuspend}
              className="font-semibold text-xs h-9"
            >
              {suspendLoading ? "Suspending…" : "Confirm Suspension"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Impersonate Dialog */}
      <Dialog open={impersonateOpen} onOpenChange={setImpersonateOpen}>
        <DialogContent className="max-w-md p-6 rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-amber-600">
              Impersonate Administrator
            </DialogTitle>
            <DialogDescription className="text-xs">
              Log into {tenant.name} to view store records as their tenant admin.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setImpersonateOpen(false)}
              className="text-xs h-9"
            >
              Cancel
            </Button>
            <Button
              onClick={handleImpersonate}
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
