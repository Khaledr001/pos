"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  UserCheck,
  Plus,
  Search,
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle2,
  Shield,
  KeyRound,
  Trash2,
  Lock,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface StaffUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  roleId: string;
  branchId?: string;
  isActive: boolean;
  maxDiscountPercent?: number;
  canApproveRefund?: boolean;
  canViewCost?: boolean;
  createdAt: string;
}

interface UsersResponse {
  items: StaffUser[];
  total: number;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

export default function UsersPage() {
  const { tokens, user: currentUser } = useAuth();

  const [users, setUsers] = useState<StaffUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // Dialog & actions
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Form fields
  const [fName, setFName] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fBranchId, setFBranchId] = useState("");
  /**
   * Blank, not a default.
   *
   * Every staff member this screen created got `ChangeMe123!` and PIN `1234`
   * unless the administrator noticed and changed them — and both were the
   * seeded values, so they are the first two guesses anybody would make. A
   * defaulted credential is a credential everyone in the building knows.
   */
  const [fPassword, setFPassword] = useState("");
  const [fPin, setFPin] = useState("");
  const [fMaxDiscount, setFMaxDiscount] = useState("10");
  const [fCanApproveRefund, setFCanApproveRefund] = useState(false);
  const [fCanViewCost, setFCanViewCost] = useState(true);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, branchRes] = await Promise.allSettled([
        api.get<UsersResponse>("/users", {
          accessToken: tokens?.accessToken,
          query: {
            q: search || undefined,
            page,
            limit: PAGE_SIZE,
            includeInactive: false,
          },
        }),
        api.get<{ items: Branch[] }>("/branches", {
          accessToken: tokens?.accessToken,
        }),
      ]);

      if (usersRes.status === "fulfilled") {
        const val = usersRes.value as any;
        const list = Array.isArray(val) ? val : (val?.items ?? []);
        setUsers(list);
        setTotal(val?.meta?.total ?? val?.total ?? list.length);
      }
      if (branchRes.status === "fulfilled") {
        const val = branchRes.value as any;
        const list = Array.isArray(val) ? val : (val?.items ?? []);
        setBranches(list);
      }
    } catch (err: any) {
      console.error("Failed to load staff list:", err);
      setActionError(err?.message || "Failed to load staff list.");
    } finally {
      setLoading(false);
    }
  }, [tokens, search, page]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(null);

    // Use roleId from existing staff list or default
    const roleId = users[0]?.roleId || "00000000-0000-0000-0000-000000000001";

    try {
      await api.post(
        "/users",
        {
          name: fName.trim(),
          email: fEmail.trim().toLowerCase(),
          phone: fPhone.trim() || undefined,
          roleId,
          branchId: fBranchId || undefined,
          password: fPassword,
          pin: fPin || undefined,
          maxDiscountPercent: parseFloat(fMaxDiscount) || 0,
          canApproveRefund: fCanApproveRefund,
          canViewCost: fCanViewCost,
        },
        { accessToken: tokens?.accessToken }
      );

      setActionSuccess(`Staff member "${fName}" added successfully.`);
      setIsModalOpen(false);
      setFName("");
      setFEmail("");
      setFPhone("");
      setFBranchId("");
      setFPassword("");
      setFPin("");
      fetchUsers();
    } catch (err: any) {
      setActionError(err?.message || "Failed to add staff member. Verify password complexity (uppercase, lowercase, number).");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to deactivate staff account for "${name}"?`)) return;
    try {
      await api.delete(`/users/${id}`, { accessToken: tokens?.accessToken });
      setActionSuccess(`Staff account for "${name}" deactivated.`);
      fetchUsers();
    } catch (err: any) {
      setActionError(err?.message || "Failed to deactivate user.");
    }
  };

  const getBranchName = (branchId?: string) => {
    if (!branchId) return "All Branches (Tenant Wide)";
    const b = branches.find((item) => item.id === branchId);
    return b ? `${b.name} (${b.code})` : "Assigned Branch";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Staff & User Management</h1>
            {total > 0 && <Badge variant="secondary">{total} Accounts</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Cashiers, store managers, and back-office operators with granular discount limits and branch scoping.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchUsers} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setActionError(null); setIsModalOpen(true); }}>
            <Plus className="h-4 w-4" />
            Add Staff Member
          </Button>
        </div>
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400 animate-fade-in-up">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {actionError && !isModalOpen && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search staff by name or email address..."
          className="pl-10 h-10 bg-secondary/30"
        />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading staff accounts...
          </div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center">
            <UserCheck className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">No staff members found</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {search ? "No staff match your search query." : "Add store cashiers or managers."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3.5 font-medium">User Profile</th>
                  <th className="px-4 py-3.5 font-medium">Branch Assignment</th>
                  <th className="px-4 py-3.5 font-medium">Discount Limit</th>
                  <th className="px-4 py-3.5 font-medium">Refund / Cost Access</th>
                  <th className="px-4 py-3.5 text-center font-medium">Status</th>
                  <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-bold">
                            {u.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-semibold text-foreground">{u.name}</p>
                          <p className="text-[11px] text-muted-foreground font-mono">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {getBranchName(u.branchId)}
                    </td>
                    <td className="px-4 py-3.5 font-mono font-medium text-foreground">
                      Max {u.maxDiscountPercent ?? 0}%
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2 text-[10px]">
                        {u.canApproveRefund && <Badge variant="secondary">Refunds</Badge>}
                        {u.canViewCost && <Badge variant="outline">Cost Visible</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <Badge variant={u.isActive ? "success" : "secondary"}>
                        {u.isActive ? "Active" : "Disabled"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeactivate(u.id, u.name)}
                        className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add Staff Member Dialog */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                <UserCheck className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle>Add Staff Member</DialogTitle>
                <DialogDescription>Create a till operator or back-office user</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {actionError && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /><span>{actionError}</span>
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Full Name *</label>
                <Input required value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Salim Khan" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Work Email Address *</label>
                <Input required type="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} placeholder="salim@devsfleet.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Mobile Phone</label>
                <Input type="tel" value={fPhone} onChange={(e) => setFPhone(e.target.value)} placeholder="+971 50 123 4567" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Assigned Branch</label>
                <select
                  value={fBranchId}
                  onChange={(e) => setFBranchId(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">All Branches (Tenant Wide)</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Password *</label>
                <Input required type="password" value={fPassword} onChange={(e) => setFPassword(e.target.value)} placeholder="Min 10 chars with Aa1" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">POS Quick PIN (4-6 digits)</label>
                <Input value={fPin} onChange={(e) => setFPin(e.target.value)} placeholder="4-6 digits" maxLength={6} className="font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Max Discount Ceiling (%)</label>
                <Input type="number" min="0" max="100" value={fMaxDiscount} onChange={(e) => setFMaxDiscount(e.target.value)} placeholder="10" className="font-mono" />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Creating..." : "Save Staff Account"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
