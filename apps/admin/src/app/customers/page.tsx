"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, RefreshCw, X, AlertCircle, CheckCircle2, Users, ChevronRight, Eye } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { useTenantSettings } from "@/lib/tenant-settings";
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";
import {
  SortableTh, Table, TableBody, TableContainer, TableEmpty, TableHead,
  TablePagination, TableSearch, Th, numericCell,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow, MobileSort, listCard } from "@/components/ui/mobile-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EinvoiceAddressFields, TrnField } from "@/components/einvoice/customer-fields";
import {
  EMPTY_EINVOICE_FIELDS,
  customerEinvoiceProblems,
  einvoiceFieldsPayload,
  hasEinvoiceFields,
  isValidTrn,
  type EinvoiceCustomerFields,
  type EinvoiceCustomerLike,
} from "@/lib/einvoice";

// ── Types ─────────────────────────────────────────────────────────────────

interface Customer extends EinvoiceCustomerLike {
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

const CUSTOMER_TYPES = ["retail", "wholesale", "vip"] as const;
type CustomerType = typeof CUSTOMER_TYPES[number];

/**
 * A small readiness chip for a business customer (one with a TRN). Nothing for
 * a till customer, and nothing when the list payload carries no address fields
 * at all — a false "Missing details" is worse than no chip.
 */
function EinvoiceChip({ customer }: { customer: Customer }) {
  if (!customer.trn || !hasEinvoiceFields(customer)) return null;
  const problems = customerEinvoiceProblems(customer);
  return problems.length === 0 ? (
    <Badge variant="success" className="text-[10px]">E-invoice ready</Badge>
  ) : (
    <Badge variant="warning" className="text-[10px]" title={problems.join(" · ")}>Missing details</Badge>
  );
}

const TYPE_GRADIENT: Record<string, string> = {
  wholesale: "from-blue-500 to-indigo-600",
  retail: "from-emerald-500 to-teal-600",
  vip: "from-amber-500 to-orange-600",
};

// ── Component ─────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const router = useRouter();
  const { tokens } = useAuth();

  const currency = useTenantSettings().currency.base;

  const PAGE_SIZE = 50;
  const list = useListQuery({ sortBy: "createdAt", sortOrder: "desc", filters: { type: "" } });
  const { q, page, sortBy, sortOrder } = list;
  const typeFilter = list.filters.type as CustomerType | "";

  const loadCustomers = useCallback(
    async (signal: AbortSignal) =>
      readListResult<Customer>(
        await api.get<unknown>("/customers", {
          accessToken: tokens?.accessToken,
          signal,
          query: {
            q: q.trim() || undefined,
            type: typeFilter || undefined,
            page,
            pageSize: PAGE_SIZE,
            includeInactive: false,
            sortBy,
            sortOrder,
          },
        }),
      ),
    [tokens?.accessToken, q, typeFilter, page, sortBy, sortOrder],
  );
  const {
    items: customers, total, loading, initialLoading, error: loadError, reload: fetchCustomers,
  } = useListData(loadCustomers, list.ready);

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
  const [fEinv, setFEinv] = useState<EinvoiceCustomerFields>(EMPTY_EINVOICE_FIELDS);
  const [fType, setFType] = useState<CustomerType>("retail");
  const [fCreditLimit, setFCreditLimit] = useState("0");
  const [fPaymentTerms, setFPaymentTerms] = useState("0");
  const [fWhatsappPhone, setFWhatsappPhone] = useState("");
  const [fNotes, setFNotes] = useState("");

  // ── Create ────────────────────────────────────────────────────────────────

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fEinv.trn.trim() && !isValidTrn(fEinv.trn)) {
      setActionError("The TRN must be 15 digits starting with 100.");
      return;
    }
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
          trn: fEinv.trn.trim() || undefined,
          ...einvoiceFieldsPayload(fEinv),
          type: fType,
          creditLimit: fCreditLimit.trim() || "0",
          paymentTermDays: parseInt(fPaymentTerms) || 0,
          whatsappPhone: fWhatsappPhone || undefined,
          notes: fNotes || undefined,
        },
        { accessToken: tokens?.accessToken },
      );

      setActionSuccess(`Customer "${fName}" created successfully.`);
      setIsModalOpen(false);
      setFName(""); setFCompany(""); setFPhone(""); setFEmail(""); setFEinv(EMPTY_EINVOICE_FIELDS);
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
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
          <button onClick={() => setActionSuccess(null)} className="cursor-pointer" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {actionError && !isModalOpen && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2"><AlertCircle className="h-4 w-4" /><span>{actionError}</span></div>
          <button onClick={() => setActionError(null)} className="cursor-pointer" aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4" /><span>{loadError}</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Customer type">
          {(["", ...CUSTOMER_TYPES] as const).map((t) => (
            <Button
              key={t}
              variant={typeFilter === t ? "default" : "outline"}
              size="sm"
              aria-pressed={typeFilter === t}
              onClick={() => list.setFilter("type", t)}
              className={cn("text-xs capitalize", typeFilter === t && "gradient-brand border-0")}
            >
              {t === "" ? "All" : t}
            </Button>
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-2 sm:flex-row">
          <TableSearch
            value={list.search}
            onChange={list.setSearch}
            label="Search customers"
            placeholder="Search by name, company, phone..."
            className="flex-1"
          />
          <MobileSort
            options={[
              { column: "name", label: "Name" },
              { column: "creditLimit", label: "Credit limit", firstOrder: "desc" },
              { column: "creditBalance", label: "Outstanding", firstOrder: "desc" },
            ]}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onChange={list.setSort}
          />
        </div>
      </div>

      <MobileList
        loading={initialLoading}
        empty={
          <MobileEmpty
            icon={Users}
            title="No customers found"
            description={q || typeFilter ? "No customers match your filters." : "Add your first customer to get started."}
            action={!q && !typeFilter ? (
              <Button size="sm" onClick={() => setIsModalOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add Customer
              </Button>
            ) : undefined}
          />
        }
      >
        {customers.map((c) => {
          const limit = Number(c.creditLimit ?? "0") || 0;
          const balance = Number(c.creditBalance ?? "0") || 0;
          return (
            <MobileRow
              key={c.id}
              title={c.name}
              subtitle={c.company ?? c.phone ?? undefined}
              badge={
                <Badge
                  variant={c.type === "wholesale" ? "default" : c.type === "vip" ? "warning" : "secondary"}
                  className="text-[10px] capitalize"
                >
                  {c.type}
                </Badge>
              }
              fields={[
                { label: "Phone", value: c.phone ?? c.email ?? "—" },
                { label: "Company", value: c.company ?? "—" },
                ...(c.trn ? [{ label: "TRN", value: <span className="inline-flex flex-wrap items-center gap-1.5"><span className="font-mono">{c.trn}</span><EinvoiceChip customer={c} /></span> }] : []),
                { label: "Credit limit", value: formatMoney(c.creditLimit ?? "0", { currency }), numeric: true },
                { label: "Outstanding", value: formatMoney(c.creditBalance ?? "0", { currency }), numeric: true },
                {
                  label: "Usage",
                  value: limit > 0 ? `${Math.round(Math.min((balance / limit) * 100, 100))}%` : "No credit",
                  numeric: limit > 0,
                },
              ]}
              actions={
                <Button variant="outline" size="sm" onClick={() => router.push(`/customers/${c.id}`)}>
                  <Eye className="h-3.5 w-3.5" />
                  Details
                </Button>
              }
            />
          );
        })}
      </MobileList>

      {/* Table */}
      <Card className={listCard}>
        <TableContainer className="hidden md:block">
          <Table>
            <TableHead>
              <tr>
                <SortableTh column="name" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Customer & Contact</SortableTh>
                <Th>Company & TRN</Th>
                <Th>Tier</Th>
                <SortableTh column="creditLimit" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} firstOrder="desc" align="right">Credit Limit ({currency})</SortableTh>
                <SortableTh column="creditBalance" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} firstOrder="desc" align="right">Outstanding ({currency})</SortableTh>
                <Th align="center">Usage</Th>
                <Th align="right"><span className="sr-only">Actions</span></Th>
              </tr>
            </TableHead>
            <TableBody
              columns={7}
              loading={initialLoading}
              empty={
                <TableEmpty
                  columns={7}
                  icon={Users}
                  title="No customers found"
                  description={q || typeFilter ? "No customers match your filters." : "Add your first customer to get started."}
                  action={!q && !typeFilter ? (
                    <Button size="sm" onClick={() => setIsModalOpen(true)}>
                      <Plus className="h-3.5 w-3.5" /> Add Customer
                    </Button>
                  ) : undefined}
                />
              }
            >
              {customers.map((c) => {
                // A ratio for the bar's width only — the amounts themselves are
                // shown through formatMoney, never from these floats.
                const limit = Number(c.creditLimit ?? "0") || 0;
                const balance = Number(c.creditBalance ?? "0") || 0;
                const usagePct = limit > 0 ? Math.min((balance / limit) * 100, 100) : 0;
                const open = () => router.push(`/customers/${c.id}`);

                return (
                  <tr
                    key={c.id}
                    onClick={open}
                    tabIndex={0}
                    role="link"
                    aria-label={`Open customer ${c.name}`}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter") {
                        e.preventDefault();
                        open();
                      }
                    }}
                    className={cn(
                      "hover:bg-secondary/30 transition-colors cursor-pointer group focus:bg-secondary/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      loading && "opacity-60",
                    )}
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className={cn("bg-linear-to-br text-white text-[10px] font-bold", TYPE_GRADIENT[c.type] ?? "from-slate-400 to-slate-600")}>
                            {c.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-semibold text-foreground group-hover:text-primary transition-colors flex items-center gap-1">
                            <span>{c.name}</span>
                          </p>
                          <p className="text-[11px] text-muted-foreground font-mono">{c.phone ?? c.email ?? "—"}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">{c.company ?? "—"}</span>
                        {c.trn && (
                          <span className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span className="font-mono">TRN: {c.trn}</span>
                            <EinvoiceChip customer={c} />
                          </span>
                        )}
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
                    <td className={cn("px-4 py-3.5 font-medium text-foreground", numericCell)}>
                      {formatMoney(c.creditLimit ?? "0")}
                    </td>
                    <td className={cn("px-4 py-3.5 font-bold gradient-text", numericCell)}>
                      {formatMoney(c.creditBalance ?? "0")}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {limit > 0 ? (
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-20 h-2 rounded-full bg-border overflow-hidden" aria-hidden="true">
                            <div
                              className={cn("h-full rounded-full transition-all", usagePct > 80 ? "bg-red-500" : usagePct > 50 ? "bg-amber-500" : "bg-emerald-500")}
                              style={{ width: `${usagePct}%` }}
                            />
                          </div>
                          <span className="text-[10px] font-mono tabular-nums text-muted-foreground w-8">{Math.round(usagePct)}%</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">No credit</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="sm"
                        tabIndex={-1}
                        onClick={open}
                        className="h-8 text-xs text-muted-foreground hover:text-primary hover:bg-primary/10 gap-1"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        <span>Details</span>
                        <ChevronRight className="h-3.5 w-3.5 opacity-60" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun="customers" />
      </Card>

      {/* Add Customer Dialog */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-emerald-500 to-teal-600 text-white">
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
                <TrnField id="new-customer-trn" value={fEinv.trn} onChange={(trn) => setFEinv((f) => ({ ...f, trn }))} />
              </div>
            </div>

            {/* E-invoicing */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">E-invoicing details (businesses with a TRN)</p>
              <EinvoiceAddressFields idPrefix="new-customer" value={fEinv} onChange={(patch) => setFEinv((f) => ({ ...f, ...patch }))} />
            </div>

            {/* Business Terms */}
            <div className="rounded-xl border border-border p-4 space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Business Terms</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Customer Type</label>
                  <Select value={fType} onValueChange={(val) => setFType(val as CustomerType)}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Customer Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retail">Retail</SelectItem>
                      <SelectItem value="wholesale">Wholesale</SelectItem>
                      <SelectItem value="vip">VIP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Credit Limit ({currency})</label>
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
