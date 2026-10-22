"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  UserCheck,
  Plus,
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
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";
import {
  SortableTh, Table, TableBody, TableContainer, TableEmpty, TableHead,
  TablePagination, TableSearch, Th,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow, MobileSort, listCard } from "@/components/ui/mobile-list";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface Role {
  id: string;
  name: string;
  description?: string | null;
}

export default function UsersPage() {
  const { tokens, user: currentUser } = useAuth();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const PAGE_SIZE = 50;
  const list = useListQuery({ sortBy: "name", sortOrder: "asc" });
  const { q, page, sortBy, sortOrder } = list;

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
  const [fRoleId, setFRoleId] = useState("");

  const roleName = useCallback(
    (roleId: string) => roles.find((r) => r.id === roleId)?.name ?? "—",
    [roles],
  );

  const loadUsers = useCallback(
    async (signal: AbortSignal) =>
      readListResult<StaffUser>(
        await api.get<unknown>("/users", {
          accessToken: tokens?.accessToken,
          signal,
          query: { q: q.trim() || undefined, page, limit: PAGE_SIZE, includeInactive: false, sortBy, sortOrder },
        }),
      ),
    [tokens?.accessToken, q, page, sortBy, sortOrder],
  );
  const {
    items: users, total, loading, initialLoading, error: loadError, reload: fetchUsers,
  } = useListData(loadUsers, list.ready);

  // Lookups for the role/branch columns and the create form. Loaded once —
  // they used to be refetched on every keystroke of the search box.
  useEffect(() => {
    void Promise.allSettled([
      api.get<{ items: Branch[] } | Branch[]>("/branches", { accessToken: tokens?.accessToken }),
      api.get<Role[]>("/roles", { accessToken: tokens?.accessToken }),
    ]).then(([branchRes, rolesRes]) => {
      if (branchRes.status === "fulfilled") {
        const val = branchRes.value;
        setBranches(Array.isArray(val) ? val : (val?.items ?? []));
      }
      if (rolesRes.status === "fulfilled") {
        const roleList = rolesRes.value ?? [];
        setRoles(roleList);
        if (roleList.length > 0) {
          setFRoleId((current) => current || roleList.find((r) => r.name === "cashier")?.id || roleList[0]!.id);
        }
      }
    });
  }, [tokens?.accessToken]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fRoleId) {
      setActionError("Choose a role.");
      return;
    }
    setSubmitting(true);
    setActionError(null);

    try {
      await api.post(
        "/users",
        {
          name: fName.trim(),
          email: fEmail.trim().toLowerCase(),
          phone: fPhone.trim() || undefined,
          roleId: fRoleId,
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
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
          <button onClick={() => setActionSuccess(null)} className="cursor-pointer" aria-label="Dismiss">
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
          <button onClick={() => setActionError(null)} className="cursor-pointer" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{loadError}</span>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <TableSearch
          value={list.search}
          onChange={list.setSearch}
          label="Search staff"
          placeholder="Search staff by name or email address..."
          className="flex-1"
        />
        <MobileSort
          options={[{ column: "name", label: "Name" }]}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onChange={list.setSort}
        />
      </div>

      <MobileList
        loading={initialLoading}
        empty={
          <MobileEmpty
            icon={UserCheck}
            title="No staff members found"
            description={q ? "No staff match your search query." : "Add store cashiers or managers."}
          />
        }
      >
        {users.map((u) => (
          <MobileRow
            key={u.id}
            title={u.name}
            subtitle={roleName(u.roleId)}
            badge={
              <Badge variant={u.isActive ? "success" : "secondary"}>
                {u.isActive ? "Active" : "Disabled"}
              </Badge>
            }
            fields={[
              { label: "Email", value: u.email },
              { label: "Role", value: <span className="capitalize">{roleName(u.roleId)}</span> },
              { label: "Branch", value: getBranchName(u.branchId) },
              { label: "Discount limit", value: `Max ${u.maxDiscountPercent ?? 0}%`, numeric: true },
              {
                label: "Access",
                value:
                  u.canApproveRefund || u.canViewCost
                    ? [u.canApproveRefund && "Refunds", u.canViewCost && "Cost visible"].filter(Boolean).join(", ")
                    : "—",
              },
            ]}
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDeactivate(u.id, u.name)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Deactivate
              </Button>
            }
          />
        ))}
      </MobileList>

      {/* Table */}
      <Card className={listCard}>
        <TableContainer className="hidden md:block">
          <Table>
            <TableHead>
              <tr>
                <SortableTh column="name" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>User Profile</SortableTh>
                <Th>Role</Th>
                <Th>Branch Assignment</Th>
                <Th>Discount Limit</Th>
                <Th>Refund / Cost Access</Th>
                <Th align="center">Status</Th>
                <Th align="right"><span className="sr-only">Actions</span></Th>
              </tr>
            </TableHead>
            <TableBody
              columns={7}
              loading={initialLoading}
              empty={
                <TableEmpty
                  columns={7}
                  icon={UserCheck}
                  title="No staff members found"
                  description={q ? "No staff match your search query." : "Add store cashiers or managers."}
                />
              }
            >
              {users.map((u) => (
                <tr key={u.id} className={cn("hover:bg-secondary/30 transition-colors", loading && "opacity-60")}>
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
                  <td className="px-4 py-3.5">
                    <Badge variant="outline" className="text-[10px] capitalize">{roleName(u.roleId)}</Badge>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">
                    {getBranchName(u.branchId)}
                  </td>
                  <td className="px-4 py-3.5 font-mono tabular-nums font-medium text-foreground">
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
                      aria-label={`Deactivate ${u.name}`}
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun="accounts" />
      </Card>

      {/* Add Staff Member Dialog */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-violet-500 to-purple-600 text-white">
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
                <label className="block text-xs font-medium text-foreground mb-1.5">Role *</label>
                <Select value={fRoleId} onValueChange={setFRoleId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="— Select Role —" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Assigned Branch</label>
                <Select value={fBranchId || "all"} onValueChange={(val) => setFBranchId(val === "all" ? "" : val)}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="All Branches (Tenant Wide)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branches (Tenant Wide)</SelectItem>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Password *</label>
                <Input required type="password" value={fPassword} onChange={(e) => setFPassword(e.target.value)} placeholder="Min 6 chars with Aa1" />
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
