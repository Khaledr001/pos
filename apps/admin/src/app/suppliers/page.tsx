"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Truck,
  Plus,
  Search,
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle2,
  Phone,
  Mail,
  MapPin,
  Building2,
  Trash2,
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

interface Supplier {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  trn?: string;
  address?: string;
  paymentTermDays?: number;
  contactPerson?: string;
  notes?: string;
  isActive: boolean;
  createdAt: string;
}

interface SuppliersResponse {
  items: Supplier[];
  total: number;
}

export default function SuppliersPage() {
  const { tokens } = useAuth();

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
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
  const [fCompany, setFCompany] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fTrn, setFTrn] = useState("");
  const [fAddress, setFAddress] = useState("");
  const [fContactPerson, setFContactPerson] = useState("");
  const [fPaymentTerms, setFPaymentTerms] = useState("30");
  const [fNotes, setFNotes] = useState("");

  const fetchSuppliers = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const res = await api.get<any>("/suppliers", {
        accessToken: tokens?.accessToken,
        query: {
          q: search || undefined,
          page,
          pageSize: PAGE_SIZE,
          includeInactive: false,
        },
      });
      const list = Array.isArray(res) ? res : (res?.items ?? []);
      const totalCount = res?.meta?.total ?? res?.total ?? list.length;
      setSuppliers(list);
      setTotal(totalCount);
    } catch (err: any) {
      console.error("Failed to load suppliers:", err);
      setActionError(err?.message || "Failed to load suppliers.");
    } finally {
      setLoading(false);
    }
  }, [tokens, search, page]);

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(null);

    try {
      await api.post(
        "/suppliers",
        {
          name: fName.trim(),
          company: fCompany.trim() || undefined,
          phone: fPhone.trim() || undefined,
          email: fEmail.trim() || undefined,
          trn: fTrn.trim() || undefined,
          address: fAddress.trim() || undefined,
          contactPerson: fContactPerson.trim() || undefined,
          paymentTermDays: parseInt(fPaymentTerms) || 0,
          notes: fNotes.trim() || undefined,
        },
        { accessToken: tokens?.accessToken }
      );

      setActionSuccess(`Supplier "${fName}" created successfully.`);
      setIsModalOpen(false);
      setFName("");
      setFCompany("");
      setFPhone("");
      setFEmail("");
      setFTrn("");
      setFAddress("");
      setFContactPerson("");
      setFPaymentTerms("30");
      setFNotes("");
      fetchSuppliers();
    } catch (err: any) {
      setActionError(err?.message || "Failed to create supplier.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove supplier "${name}"?`)) return;
    try {
      await api.delete(`/suppliers/${id}`, { accessToken: tokens?.accessToken });
      setActionSuccess(`Supplier "${name}" removed.`);
      fetchSuppliers();
    } catch (err: any) {
      setActionError(err?.message || "Failed to remove supplier.");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Suppliers & Vendors</h1>
            {total > 0 && <Badge variant="secondary">{total} Active</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Distributors, manufacturers, and trade suppliers with UAE TRN registration and purchase credit terms.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button variant="outline" size="sm" onClick={fetchSuppliers} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setActionError(null); setIsModalOpen(true); }}>
            <Plus className="h-4 w-4" />
            Add Supplier
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
          placeholder="Search by supplier name, company, TRN, or mobile..."
          className="pl-10 h-10 bg-secondary/30"
        />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading suppliers from API...
          </div>
        ) : suppliers.length === 0 ? (
          <div className="py-16 text-center">
            <Truck className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">No suppliers found</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {search ? "No suppliers match your search query." : "Add your primary trade vendors to get started."}
            </p>
            {!search && (
              <Button size="sm" onClick={() => setIsModalOpen(true)} className="mt-4">
                <Plus className="h-3.5 w-3.5" /> Add Supplier
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3.5 font-medium">Supplier & Contact</th>
                    <th className="px-4 py-3.5 font-medium">Company & TRN</th>
                    <th className="px-4 py-3.5 font-medium">Location</th>
                    <th className="px-4 py-3.5 text-right font-medium">Payment Terms</th>
                    <th className="px-4 py-3.5 text-center font-medium">Status</th>
                    <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {suppliers.map((s) => (
                    <tr key={s.id} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">{s.name}</span>
                          <span className="text-[11px] text-muted-foreground font-mono">
                            {s.phone ?? s.email ?? "No direct contact"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">{s.company ?? "Individual Vendor"}</span>
                          {s.trn && <span className="text-[10px] text-muted-foreground font-mono">TRN: {s.trn}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground max-w-[200px] truncate">
                        {s.address ?? "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-medium text-foreground">
                        {s.paymentTermDays === 0 ? "COD (Immediate)" : `${s.paymentTermDays} Days Credit`}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <Badge variant={s.isActive ? "success" : "secondary"}>
                          {s.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(s.id, s.name)}
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

            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Add Supplier Dialog */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                <Truck className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle>Add Trade Supplier</DialogTitle>
                <DialogDescription>Register a vendor for goods receiving and purchase invoices</DialogDescription>
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
                <label className="block text-xs font-medium text-foreground mb-1.5">Supplier Name *</label>
                <Input required value={fName} onChange={(e) => setFName(e.target.value)} placeholder="e.g. Ducab Cables Middle East" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Company Legal Name</label>
                <Input value={fCompany} onChange={(e) => setFCompany(e.target.value)} placeholder="e.g. Dubai Cable Company (Pvt) Ltd" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Phone Number</label>
                <Input type="tel" value={fPhone} onChange={(e) => setFPhone(e.target.value)} placeholder="+971 4 815 8888" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Email Address</label>
                <Input type="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} placeholder="sales@ducab.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">UAE TRN (Tax Registration Number)</label>
                <Input value={fTrn} onChange={(e) => setFTrn(e.target.value)} placeholder="100123456700003" className="font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Payment Terms (Days)</label>
                <Input type="number" min="0" max="365" value={fPaymentTerms} onChange={(e) => setFPaymentTerms(e.target.value)} placeholder="30" className="font-mono" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-foreground mb-1.5">Physical Address / City</label>
                <Input value={fAddress} onChange={(e) => setFAddress(e.target.value)} placeholder="e.g. Jebel Ali Free Zone, Dubai, UAE" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-foreground mb-1.5">Contact Person & Notes</label>
                <Input value={fNotes} onChange={(e) => setFNotes(e.target.value)} placeholder="e.g. Key Account Manager: Mr. Tariq" />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Save Supplier"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
