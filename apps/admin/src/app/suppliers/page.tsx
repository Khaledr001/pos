"use client";

import React, { useState, useCallback } from "react";
import {
  Truck,
  Plus,
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

export default function SuppliersPage() {
  const { tokens } = useAuth();

  const PAGE_SIZE = 50;
  const list = useListQuery({ sortBy: "createdAt", sortOrder: "desc" });
  const { q, page, sortBy, sortOrder } = list;

  const loadSuppliers = useCallback(
    async (signal: AbortSignal) =>
      readListResult<Supplier>(
        await api.get<unknown>("/suppliers", {
          accessToken: tokens?.accessToken,
          signal,
          query: { q: q.trim() || undefined, page, pageSize: PAGE_SIZE, includeInactive: false, sortBy, sortOrder },
        }),
      ),
    [tokens?.accessToken, q, page, sortBy, sortOrder],
  );
  const {
    items: suppliers, total, loading, initialLoading, error: loadError, reload: fetchSuppliers,
  } = useListData(loadSuppliers, list.ready);

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
          label="Search suppliers"
          placeholder="Search by supplier name, company, TRN, or mobile..."
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
            icon={Truck}
            title="No suppliers found"
            description={q ? "No suppliers match your search query." : "Add your primary trade vendors to get started."}
            action={!q ? (
              <Button size="sm" onClick={() => setIsModalOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add Supplier
              </Button>
            ) : undefined}
          />
        }
      >
        {suppliers.map((s) => (
          <MobileRow
            key={s.id}
            title={s.name}
            subtitle={s.company ?? undefined}
            badge={
              <Badge variant={s.isActive ? "success" : "secondary"}>
                {s.isActive ? "Active" : "Inactive"}
              </Badge>
            }
            fields={[
              { label: "Contact", value: s.phone ?? s.email ?? "No direct contact" },
              { label: "Company", value: s.company ?? "Individual Vendor" },
              ...(s.trn ? [{ label: "TRN", value: s.trn }] : []),
              { label: "Location", value: s.address ?? "—" },
              { label: "Terms", value: s.paymentTermDays === 0 ? "COD (Immediate)" : `${s.paymentTermDays} Days Credit` },
            ]}
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDelete(s.id, s.name)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
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
                <SortableTh column="name" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Supplier & Contact</SortableTh>
                <Th>Company & TRN</Th>
                <Th>Location</Th>
                <Th align="right">Payment Terms</Th>
                <Th align="center">Status</Th>
                <Th align="right"><span className="sr-only">Actions</span></Th>
              </tr>
            </TableHead>
            <TableBody
              columns={6}
              loading={initialLoading}
              empty={
                <TableEmpty
                  columns={6}
                  icon={Truck}
                  title="No suppliers found"
                  description={q ? "No suppliers match your search query." : "Add your primary trade vendors to get started."}
                  action={!q ? (
                    <Button size="sm" onClick={() => setIsModalOpen(true)}>
                      <Plus className="h-3.5 w-3.5" /> Add Supplier
                    </Button>
                  ) : undefined}
                />
              }
            >
              {suppliers.map((s) => (
                <tr key={s.id} className={cn("hover:bg-secondary/30 transition-colors", loading && "opacity-60")}>
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
                  <td className="px-4 py-3.5 text-muted-foreground max-w-50 truncate" title={s.address ?? undefined}>
                    {s.address ?? "—"}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums font-medium text-foreground">
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
                      aria-label={`Remove supplier ${s.name}`}
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
        <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun="suppliers" />
      </Card>

      {/* Add Supplier Dialog */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-indigo-600 text-white">
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
