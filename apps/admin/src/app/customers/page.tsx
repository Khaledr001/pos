"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Search, Plus, RefreshCw, X, AlertCircle, CheckCircle2, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

// ── Types ─────────────────────────────────────────────────────────────────

interface Customer {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  trn?: string;
  type: string;
  creditLimit: string;
  creditBalance?: string;
  isActive: boolean;
  whatsappPhone?: string;
}

interface CustomersPage {
  items: Customer[];
  total: number;
  page: number;
  pageSize: number;
}

const CUSTOMER_TYPES = ["retail", "wholesale", "vip"] as const;
type CustomerType = typeof CUSTOMER_TYPES[number];

const TYPE_GRADIENT: Record<string, string> = {
  wholesale: "from-blue-500 to-indigo-600",
  retail: "from-emerald-500 to-teal-600",
  vip: "from-amber-500 to-orange-600",
};

// ── Component ─────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const { tokens } = useAuth();

  // List state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<CustomerType | "">("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  // Dialog
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Form
  const [fName, setFName] = useState("");
  const [fCompany, setFCompany] = useState("");
  const [fPhone, setFPhone] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fTrn, setFTrn] = useState("");
  const [fType, setFType] = useState<CustomerType>("retail");
  const [fCreditLimit, setFCreditLimit] = useState("0");
  const [fPaymentTerms, setFPaymentTerms] = useState("0");
  const [fWhatsappPhone, setFWhatsappPhone] = useState("");
  const [fNotes, setFNotes] = useState("");

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const res = await api.get<any>("/customers", {
        accessToken: tokens?.accessToken,
        query: {
          q: search || undefined,
          type: typeFilter || undefined,
          page,
          pageSize: PAGE_SIZE,
          includeInactive: false,
        },
      });
      const list = Array.isArray(res) ? res : (res?.items ?? []);
      const totalCount = res?.meta?.total ?? res?.total ?? list.length;
      setCustomers(list);
      setTotal(totalCount);
    } catch (err: any) {
      console.error("Failed to load customers:", err);
      setActionError(err?.message || "Failed to load customers.");
    } finally {
      setLoading(false);
    }
  }, [tokens, search, typeFilter, page]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);
  useEffect(() => { setPage(1); }, [search, typeFilter]);

  // ── Create ────────────────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setActionError(null);

    try {
      await api.post(
        "/customers",
        {
          name: fName,
          company: fCompany || undefined,
          phone: fPhone || undefined,
          email: fEmail || undefined,
          trn: fTrn || undefined,
          type: fType,
          creditLimit: parseFloat(fCreditLimit) || 0,
          paymentTermDays: parseInt(fPaymentTerms) || 0,
          whatsappPhone: fWhatsappPhone || undefined,
          notes: fNotes || undefined,
        },
        { accessToken: tokens?.accessToken },
      );

      setActionSuccess(`Customer "${fName}" created successfully.`);
      setIsModalOpen(false);
      setFName(""); setFCompany(""); setFPhone(""); setFEmail(""); setFTrn("");
      setFType("retail"); setFCreditLimit("0"); setFPaymentTerms("0");
      setFWhatsappPhone(""); setFNotes("");
      fetchCustomers();
    } catch (err: any) {
      setActionError(err?.message || "Failed to create customer.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Customers & Credit Accounts</h1>
            {total > 0 && <Badge variant="secondary">{total} Customers</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Wholesale, retail, and VIP customer profiles with credit limits, TRN registration, and WhatsApp integration.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchCustomers} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setActionError(null); setIsModalOpen(true); }}>
            <Plus className="h-4 w-4" />
            Add Customer
          </Button>
        </div>
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /><span>{actionSuccess}</span></div>
          <button onClick={() => setActionSuccess(null)} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {actionError && !isModalOpen && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2"><AlertCircle className="h-4 w-4" /><span>{actionError}</span></div>
          <button onClick={() => setActionError(null)} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-1.5">
          {(["", ...CUSTOMER_TYPES] as const).map((t) => (
            <Button
              key={t}
              variant={typeFilter === t ? "default" : "outline"}
              size="sm"
              onClick={() => setTypeFilter(t as CustomerType | "")}
              className={cn("text-xs capitalize", typeFilter === t && "gradient-brand border-0")}
            >
              {t === "" ? "All" : t}
            </Button>
          ))}
        </div>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, company, phone..."
            className="pl-10 h-10 bg-secondary/30"
          />
        </div>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading customers from API...
          </div>
        ) : customers.length === 0 ? (
          <div className="py-16 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">No customers found</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {search || typeFilter ? "No customers match your filters." : "Add your first customer to get started."}
            </p>
            {!search && !typeFilter && (
              <Button size="sm" onClick={() => setIsModalOpen(true)} className="mt-4">
                <Plus className="h-3.5 w-3.5" /> Add Customer
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3.5 font-medium">Customer & Contact</th>
                    <th className="px-4 py-3.5 font-medium">Company & TRN</th>
                    <th className="px-4 py-3.5 font-medium">Tier</th>
                    <th className="px-4 py-3.5 text-right font-medium">Credit Limit (AED)</th>
                    <th className="px-4 py-3.5 text-right font-medium">Outstanding (AED)</th>
                    <th className="px-4 py-3.5 text-center font-medium">Usage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {customers.map((c) => {
                    const limit = parseFloat(c.creditLimit ?? "0") || 0;
                    const balance = parseFloat(c.creditBalance ?? "0") || 0;
                    const usagePct = limit > 0 ? Math.min((balance / limit) * 100, 100) : 0;

                    return (
                      <tr key={c.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className={cn("bg-gradient-to-br text-white text-[10px] font-bold", TYPE_GRADIENT[c.type] ?? "from-slate-400 to-slate-600")}>
                                {c.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <p className="font-semibold text-foreground">{c.name}</p>
                              <p className="text-[11px] text-muted-foreground font-mono">{c.phone ?? c.email ?? "—"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex flex-col">
                            <span className="font-medium text-foreground">{c.company ?? "—"}</span>
                            {c.trn && <span className="text-[10px] text-muted-foreground font-mono">TRN: {c.trn}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge
                            variant={c.type === "wholesale" ? "default" : c.type === "vip" ? "warning" : "secondary"}
                            className="text-[10px] capitalize"
                          >
                            {c.type}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-medium text-foreground">
                          {limit.toFixed(2)}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold gradient-text">
                          {balance.toFixed(2)}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {limit > 0 ? (
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-20 h-2 rounded-full bg-border overflow-hidden">
                                <div
                                  className={cn("h-full rounded-full transition-all", usagePct > 80 ? "bg-red-500" : usagePct > 50 ? "bg-amber-500" : "bg-emerald-500")}
                                  style={{ width: `${usagePct}%` }}
                                />
                              </div>
                              <span className="text-[10px] font-mono text-muted-foreground w-8">{Math.round(usagePct)}%</span>
                            </div>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">No credit</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page * PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Add Customer Dialog */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle>Add New Customer</DialogTitle>
                <DialogDescription>Create a retail, wholesale, or VIP customer profile</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {actionError && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /><span>{actionError}</span>
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-4">
            {/* Contact Info */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Contact Information</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Full Name *</label>
                  <Input required value={fName} onChange={e => setFName(e.target.value)} placeholder="e.g. Eng. Tariq Al-Nuaimi" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Company</label>
                  <Input value={fCompany} onChange={e => setFCompany(e.target.value)} placeholder="e.g. Al Falaj Building Contracting LLC" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Phone</label>
                  <Input type="tel" value={fPhone} onChange={e => setFPhone(e.target.value)} placeholder="+971 50 123 4567" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">WhatsApp Number</label>
                  <Input type="tel" value={fWhatsappPhone} onChange={e => setFWhatsappPhone(e.target.value)} placeholder="+971 50 123 4567" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Email</label>
                  <Input type="email" value={fEmail} onChange={e => setFEmail(e.target.value)} placeholder="contact@example.com" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">TRN (Tax Registration Number)</label>
                  <Input value={fTrn} onChange={e => setFTrn(e.target.value)} placeholder="100234567800003" className="font-mono" />
                </div>
              </div>
            </div>

            {/* Business Terms */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Business Terms</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Customer Type</label>
                  <select
                    value={fType}
                    onChange={e => setFType(e.target.value as CustomerType)}
                    className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="retail">Retail</option>
                    <option value="wholesale">Wholesale</option>
                    <option value="vip">VIP</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Credit Limit (AED)</label>
                  <Input type="number" min="0" step="100" value={fCreditLimit} onChange={e => setFCreditLimit(e.target.value)} placeholder="0.00" className="font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Payment Terms (days)</label>
                  <Input type="number" min="0" max="365" value={fPaymentTerms} onChange={e => setFPaymentTerms(e.target.value)} placeholder="30" className="font-mono" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Internal Notes</label>
                <Input value={fNotes} onChange={e => setFNotes(e.target.value)} placeholder="Any special instructions or notes..." />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving..." : "Create Customer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
