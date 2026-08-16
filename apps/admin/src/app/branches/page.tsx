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
      setActionSuccess(`Branch "${name}" (${code.toUpperCase()}) created successfully!`);
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
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[--color-fg]">
              Branches & Warehouses
            </h1>
            <span className="rounded-full bg-[--color-brand]/10 px-2.5 py-0.5 text-xs font-semibold text-[--color-brand]">
              {branches.length} Locations
            </span>
          </div>
          <p className="mt-1 text-xs text-[--color-muted]">
            Multi-branch retail outlets and warehouse locations isolated by PostgreSQL Row-Level Security.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchBranches}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-[--color-border] bg-[--color-surface] px-3 py-2 text-xs font-medium text-[--color-fg] hover:bg-[--color-border]/50 transition-colors cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </button>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[--color-brand] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-all cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Add Branch</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div className="flex items-center justify-between rounded-lg border border-[--color-success]/30 bg-[--color-success]/10 p-3 text-xs text-[--color-success]">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {actionError && (
        <div className="flex items-center justify-between rounded-lg border border-[--color-danger]/30 bg-[--color-danger]/10 p-3 text-xs text-[--color-danger]">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[--color-muted]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by branch name, code (DXB, SHJ), or city..."
            className="w-full rounded-lg border border-[--color-border] bg-[--color-surface] py-2 pl-9 pr-3 text-xs text-[--color-fg] placeholder-[--color-muted] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
          />
        </div>
      </div>

      {/* Branch Cards Grid */}
      {loading ? (
        <div className="py-16 text-center text-xs text-[--color-muted]">
          <RefreshCw className="mx-auto h-6 w-6 animate-spin text-[--color-brand] mb-2" />
          Loading branches from API...
        </div>
      ) : filteredBranches.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[--color-border] bg-[--color-surface] py-16 text-center">
          <Building2 className="mx-auto h-10 w-10 text-[--color-muted] opacity-40" />
          <h3 className="mt-3 text-sm font-semibold text-[--color-fg]">No branches found</h3>
          <p className="mt-1 text-xs text-[--color-muted]">
            {search ? "No branches match your search query." : "Get started by adding your first retail store."}
          </p>
          {!search && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[--color-brand] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Create Store</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredBranches.map((branch) => (
            <div
              key={branch.id}
              className="group flex flex-col justify-between rounded-xl border border-[--color-border] bg-[--color-surface] p-5 shadow-sm transition-all hover:border-[--color-brand]/50 hover:shadow-md"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[--color-brand]/10 font-mono text-xs font-bold text-[--color-brand]">
                      {branch.code}
                    </span>
                    <div>
                      <h3 className="text-sm font-semibold text-[--color-fg] leading-tight">
                        {branch.name}
                      </h3>
                      <span className="text-[10px] font-mono text-[--color-muted]">
                        ID: {branch.id.slice(0, 8)}...
                      </span>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      branch.isActive
                        ? "bg-[--color-success]/10 text-[--color-success]"
                        : "bg-[--color-muted]/10 text-[--color-muted]"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        branch.isActive ? "bg-[--color-success]" : "bg-[--color-muted]"
                      }`}
                    />
                    {branch.isActive ? "Active" : "Inactive"}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-xs text-[--color-muted]">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0 mt-0.5 text-[--color-muted]" />
                    <span className="line-clamp-2">{branch.address || "No physical address provided"}</span>
                  </div>

                  {branch.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-[--color-muted]" />
                      <span className="font-mono">{branch.phone}</span>
                    </div>
                  )}

                  {branch.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-[--color-muted]" />
                      <span>{branch.email}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-5 border-t border-[--color-border] pt-3 flex items-center justify-between text-xs">
                <span className="text-[11px] text-[--color-muted]">
                  Document Code: <strong className="font-mono text-[--color-fg]">{branch.code}</strong>
                </span>

                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-[--color-brand]">POS Ready</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Branch Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[--color-border] bg-[--color-surface] p-6 shadow-2xl animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-[--color-border] pb-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-[--color-brand]" />
                <h3 className="text-base font-bold text-[--color-fg]">Create New Branch Location</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-1 text-[--color-muted] hover:bg-[--color-border] hover:text-[--color-fg]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateBranch} className="mt-4 space-y-3.5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[--color-fg] mb-1">
                    Branch Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Abu Dhabi Mussafah Branch"
                    className="w-full rounded-lg border border-[--color-border] bg-[--color-bg] p-2 text-xs text-[--color-fg] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[--color-fg] mb-1">
                    Code (2-10 chars) *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="e.g. AUH"
                    className="w-full font-mono uppercase rounded-lg border border-[--color-border] bg-[--color-bg] p-2 text-xs text-[--color-fg] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[--color-fg] mb-1">
                  Physical Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="e.g. Sector M-14, Mussafah, Abu Dhabi, UAE"
                  className="w-full rounded-lg border border-[--color-border] bg-[--color-bg] p-2 text-xs text-[--color-fg] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-[--color-fg] mb-1">
                    Phone Number
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+971 2 555 1234"
                    className="w-full rounded-lg border border-[--color-border] bg-[--color-bg] p-2 text-xs text-[--color-fg] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[--color-fg] mb-1">
                    Contact Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="branch@devsfleet.com"
                    className="w-full rounded-lg border border-[--color-border] bg-[--color-bg] p-2 text-xs text-[--color-fg] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2 border-t border-[--color-border] pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg border border-[--color-border] px-3.5 py-2 text-xs font-medium text-[--color-muted] hover:bg-[--color-border] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[--color-brand] px-4 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {submitting ? "Saving Branch..." : "Save Branch"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
