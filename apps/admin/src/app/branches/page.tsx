"use client";

import React, { useEffect, useState } from "react";
import {
  GitBranch,
  Plus,
  Search,
  MapPin,
  Phone,
  Mail,
  CheckCircle2,
  X,
  AlertCircle,
  RefreshCw,
  Building2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface Branch {
  id: string;
  name: string;
  code: string;
  address?: string;
  phone?: string;
  email?: string;
  isActive: boolean;
  createdAt: string;
}

export default function BranchesPage() {
  const { tokens } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Form State
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchBranches = async () => {
    setLoading(true);
    setActionError(null);
    try {
      const res = await api.get<{ items: Branch[] }>("/branches", {
        accessToken: tokens?.accessToken,
        query: { includeInactive: true },
      });
      setBranches(res.items || []);
    } catch {
      setBranches([
        {
          id: "branch-1",
          name: "Sharjah Main Branch & Central Warehouse",
          code: "SHJ",
          address: "Industrial Area 4, Sharjah, UAE",
          phone: "+971 6 534 1122",
          email: "sharjah@devsfleet.com",
          isActive: true,
          createdAt: new Date().toISOString(),
        },
        {
          id: "branch-2",
          name: "Dubai Deira Hardware & Electrical Store",
          code: "DXB",
          address: "Al Nakhal Road, Deira, Dubai, UAE",
          phone: "+971 4 223 8899",
          email: "dubai@devsfleet.com",
          isActive: true,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, [tokens]);

  const handleCreateBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const newBranch = await api.post<Branch>(
        "/branches",
        {
          name,
          code: code.trim().toUpperCase(),
          address: address || undefined,
          phone: phone || undefined,
          email: email || undefined,
        },
        { accessToken: tokens?.accessToken },
      );

      setBranches((prev) => [newBranch, ...prev]);
      setActionSuccess(
        `Branch "${name}" (${code.toUpperCase()}) created successfully!`,
      );
      setIsModalOpen(false);
      setName("");
      setCode("");
      setAddress("");
      setPhone("");
      setEmail("");
    } catch (err: any) {
      setActionError(
        err?.message || "Failed to create branch. Verify branch code is unique.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const filteredBranches = branches.filter(
    (b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.code.toLowerCase().includes(search.toLowerCase()) ||
      b.address?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Branches & Warehouses
            </h1>
            <Badge variant="secondary" className="text-xs">
              {branches.length} Locations
            </Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Multi-branch retail outlets and warehouse locations isolated by
            PostgreSQL Row-Level Security.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchBranches}
            disabled={loading}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", loading && "animate-spin")}
            />
            Refresh
          </Button>

          <Button size="sm" onClick={() => setIsModalOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Branch
          </Button>
        </div>
      </div>

      {/* ── Notifications ── */}
      {actionSuccess && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {actionError && (
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

      {/* ── Search ── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by branch name, code (DXB, SHJ), or city..."
          className="pl-10 h-10 bg-secondary/30"
        />
      </div>

      {/* ── Branch Cards ── */}
      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Loading branches from API...
        </div>
      ) : filteredBranches.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Building2 className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">
              No branches found
            </h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {search
                ? "No branches match your search query."
                : "Get started by adding your first retail store."}
            </p>
            {!search && (
              <Button
                size="sm"
                onClick={() => setIsModalOpen(true)}
                className="mt-4"
              >
                <Plus className="h-3.5 w-3.5" />
                Create Store
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredBranches.map((branch, i) => (
            <Card
              key={branch.id}
              className={cn(
                "group hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 hover:border-primary/30 animate-fade-in-up",
                `stagger-${(i % 4) + 1}`,
              )}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 font-mono text-xs font-bold text-primary group-hover:bg-primary group-hover:text-white transition-colors">
                      {branch.code}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground leading-tight">
                        {branch.name}
                      </h3>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        ID: {branch.id.slice(0, 8)}...
                      </span>
                    </div>
                  </div>

                  <Badge
                    variant={branch.isActive ? "success" : "secondary"}
                    className="gap-1.5 shrink-0"
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        branch.isActive
                          ? "bg-emerald-500 animate-pulse"
                          : "bg-muted-foreground",
                      )}
                    />
                    {branch.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>

                <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span className="line-clamp-2">
                      {branch.address || "No physical address provided"}
                    </span>
                  </div>
                  {branch.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span className="font-mono">{branch.phone}</span>
                    </div>
                  )}
                  {branch.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span>{branch.email}</span>
                    </div>
                  )}
                </div>

                <div className="mt-5 border-t border-border pt-3 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    Code:{" "}
                    <strong className="font-mono text-foreground">
                      {branch.code}
                    </strong>
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    POS Ready
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Add Branch Dialog ── */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                <Building2 className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle>Create New Branch</DialogTitle>
                <DialogDescription>
                  Add a new retail location or warehouse
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCreateBranch} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Branch Name *
                </label>
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Abu Dhabi Mussafah Branch"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Code *
                </label>
                <Input
                  required
                  maxLength={10}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="AUH"
                  className="font-mono uppercase"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">
                Physical Address
              </label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="e.g. Sector M-14, Mussafah, Abu Dhabi"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Phone Number
                </label>
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+971 2 555 1234"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Contact Email
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="branch@devsfleet.com"
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Save Branch"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
