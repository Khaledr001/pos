"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Search, RefreshCw, CreditCard, Banknote, Receipt, ShoppingCart } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ── Types ─────────────────────────────────────────────────────────────────

interface SalePayment {
  method: string;
  amount: string;
}

interface Sale {
  id: string;
  saleNumber?: string;
  invoiceNumber?: string;
  occurredAt?: string;
  createdAt?: string;
  customerName?: string | null;
  customer?: { name: string } | null;
  branchName?: string;
  branch?: { code: string; name: string };
  cashierName?: string;
  subtotal?: string;
  taxAmount?: string;
  total: string;
  paidAmount?: string;
  dueAmount?: string;
  status: string;
  payments?: SalePayment[];
}

interface SalesPage {
  items: Sale[];
  meta?: { total: number };
  total?: number;
  page?: number;
}

const PAYMENT_ICONS: Record<string, React.ReactNode> = {
  cash: <Banknote className="h-3.5 w-3.5 text-emerald-500" />,
  card: <CreditCard className="h-3.5 w-3.5 text-primary" />,
  credit: <Receipt className="h-3.5 w-3.5 text-amber-500" />,
  split: <CreditCard className="h-3.5 w-3.5 text-violet-500" />,
};

// ── Component ─────────────────────────────────────────────────────────────

export default function SalesPage() {
  const { tokens } = useAuth();

  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const LIMIT = 50;
  const [error, setError] = useState<string | null>(null);

  const fetchSales = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<any>("/sales", {
        accessToken: tokens?.accessToken,
        query: { page, limit: LIMIT },
      });
      const list = Array.isArray(res) ? res : (res?.items ?? []);
      const totalCount = res?.meta?.total ?? res?.total ?? list.length;
      setSales(list);
      setTotal(totalCount);
    } catch (err: any) {
      console.error("Failed to load sales:", err);
      setError(err?.message || "Failed to load sales.");
    } finally {
      setLoading(false);
    }
  }, [tokens, page]);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  const formatTime = (iso?: string) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("en-AE", { dateStyle: "short", timeStyle: "short" });
    } catch { return iso; }
  };

  const primaryPaymentMethod = (payments?: SalePayment[]): string => {
    if (!payments?.length) return "cash";
    const methods = [...new Set(payments.map(p => p.method.toLowerCase()))];
    return methods.length > 1 ? "split" : (methods[0] ?? "cash");
  };

  // Client-side search filter (invoice number / customer name)
  const filtered = sales.filter(s => {
    const num = s.saleNumber || s.invoiceNumber || "";
    const cust = s.customerName || s.customer?.name || "";
    const br = s.branchName || s.branch?.name || s.branch?.code || "";
    return (
      !search ||
      num.toLowerCase().includes(search.toLowerCase()) ||
      cust.toLowerCase().includes(search.toLowerCase()) ||
      br.toLowerCase().includes(search.toLowerCase())
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Sales & Tax Invoices</h1>
            <Badge variant="secondary">UAE FTA Compliant</Badge>
            {total > 0 && <Badge variant="outline">{total} Total</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Finalized sales from POS terminals with snapshot pricing, VAT calculation, and payment splits.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchSales} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by invoice number, customer, or branch code..."
          className="pl-10 h-10 bg-secondary/30"
        />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading invoices from API...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <ShoppingCart className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">No sales found</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {search ? "No invoices match your search." : "Sales are created from the POS terminal."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3.5 font-medium">Invoice #</th>
                    <th className="px-4 py-3.5 font-medium">Customer</th>
                    <th className="px-4 py-3.5 font-medium">Branch</th>
                    <th className="px-4 py-3.5 font-medium">Date & Time</th>
                    <th className="px-4 py-3.5 font-medium">Payment</th>
                    <th className="px-4 py-3.5 text-right font-medium">Subtotal</th>
                    <th className="px-4 py-3.5 text-right font-medium">VAT (5%)</th>
                    <th className="px-4 py-3.5 text-right font-medium">Total (AED)</th>
                    <th className="px-4 py-3.5 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((sale) => {
                    const method = primaryPaymentMethod(sale.payments);
                    return (
                      <tr key={sale.id} className="hover:bg-secondary/30 transition-colors">
                        <td className="px-4 py-3.5 font-mono font-bold text-primary whitespace-nowrap">
                          {sale.saleNumber || sale.invoiceNumber || "—"}
                        </td>
                        <td className="px-4 py-3.5 font-medium text-foreground max-w-[180px] truncate">
                          {sale.customerName || sale.customer?.name || "Walk-in Customer"}
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge variant="secondary" className="font-mono text-[10px] font-bold">
                            {sale.branchName || sale.branch?.code || "HQ"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                          {formatTime(sale.occurredAt || sale.createdAt)}
                        </td>
                        <td className="px-4 py-3.5">
                          <span className="inline-flex items-center gap-1.5 font-medium text-foreground capitalize">
                            {PAYMENT_ICONS[method] ?? <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />}
                            {method}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-muted-foreground">
                          {sale.subtotal ? `AED ${parseFloat(sale.subtotal).toFixed(2)}` : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono text-muted-foreground">
                          {sale.taxAmount ? `AED ${parseFloat(sale.taxAmount).toFixed(2)}` : "—"}
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono font-bold text-foreground">
                          AED {parseFloat(sale.total).toFixed(2)}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <Badge variant={sale.status === "completed" ? "success" : sale.status === "void" ? "destructive" : "secondary"}>
                            {sale.status}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > LIMIT && (
              <div className="flex items-center justify-between border-t border-border px-4 py-3">
                <span className="text-xs text-muted-foreground">
                  Page {page} · {total} total invoices
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page * LIMIT >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
