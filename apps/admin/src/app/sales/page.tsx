"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Search, RefreshCw, CreditCard, Banknote, Receipt, ShoppingCart,
  Printer, AlertCircle, FileText,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api, apiDownload, printBlob } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";

// ── Types ─────────────────────────────────────────────────────────────────

interface SalePayment {
  method: string;
  amount: string;
}

interface SaleItem {
  id: string;
  productName: string;
  variantName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  total: string;
}

/** `GET /sales/:id` — the full document, lines and payments included. */
interface SaleDetail extends Sale {
  items?: SaleItem[];
  discountAmount?: string;
  notes?: string | null;
  voidedAt?: string | null;
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

  // Row click → the full invoice. Fetched fresh rather than reusing the list
  // row, which carries no lines at all.
  const [selected, setSelected] = useState<SaleDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  /** Which invoice is downloading, so only its own button shows a spinner. */
  const [downloading, setDownloading] = useState<string | null>(null);

  const openSale = useCallback(async (sale: Sale) => {
    setDetailLoading(true);
    // Shown immediately from the list row so the dialog is never blank while
    // the lines load.
    setSelected(sale);
    try {
      const full = await api.get<SaleDetail>(`/sales/${sale.id}`, {
        accessToken: tokens?.accessToken,
      });
      setSelected(full);
    } catch (err: any) {
      setError(err?.message || "Failed to load the invoice.");
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  }, [tokens]);

  const [printing, setPrinting] = useState<string | null>(null);

  const printInvoice = useCallback(async (sale: Sale) => {
    setPrinting(sale.id);
    setError(null);
    try {
      const { blob } = await apiDownload(`/sales/${sale.id}/invoice`, {
        accessToken: tokens?.accessToken,
      });
      printBlob(blob, `Invoice ${sale.saleNumber || sale.id}`);
    } catch (err: any) {
      setError(err?.message || "Failed to load the invoice for printing.");
    } finally {
      setPrinting(null);
    }
  }, [tokens]);

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
                    <th className="px-4 py-3.5 text-right font-medium">Print</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((sale) => {
                    const method = primaryPaymentMethod(sale.payments);
                    return (
                      <tr
                        key={sale.id}
                        onClick={() => void openSale(sale)}
                        /**
                         * The whole row opens the invoice. A tabIndex and a
                         * keyboard handler come with that: making a `tr`
                         * clickable and leaving it unreachable by keyboard
                         * just moves the problem.
                         */
                        tabIndex={0}
                        role="button"
                        aria-label={`Open invoice ${sale.saleNumber || sale.invoiceNumber || ""}`}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            void openSale(sale);
                          }
                        }}
                        className="cursor-pointer hover:bg-secondary/30 transition-colors focus:bg-secondary/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <td className="px-4 py-3.5 font-mono font-bold text-primary whitespace-nowrap">
                          <span className="underline decoration-dotted underline-offset-2">
                            {sale.saleNumber || sale.invoiceNumber || "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 font-medium text-foreground max-w-45 truncate">
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
                        <td className="px-4 py-3.5 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            // Stops the row's own click firing underneath, which
                            // would open the dialog on every print.
                            onClick={(e) => {
                              e.stopPropagation();
                              void printInvoice(sale);
                            }}
                            disabled={printing === sale.id}
                            aria-label={`Print invoice ${sale.saleNumber || ""} `}
                          >
                            <Printer className="h-3.5 w-3.5" />
                            {printing === sale.id ? "…" : "Print"}
                          </Button>
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

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-indigo-600 text-white">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="font-mono">
                  {selected?.saleNumber || selected?.invoiceNumber || "Invoice"}
                </DialogTitle>
                <DialogDescription>
                  {formatTime(selected?.occurredAt || selected?.createdAt)}
                  {selected?.branchName ? ` · ${selected.branchName}` : ""}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selected?.voidedAt && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>This sale was voided. The invoice is kept, and downloads stamped as voided.</span>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {selected?.customerName || selected?.customer?.name || "Walk-in Customer"}
              </p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Tender</p>
              <div className="mt-1 space-y-0.5">
                {(selected?.payments ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">—</p>
                ) : (
                  selected?.payments?.map((p, i) => (
                    <p key={i} className="text-sm text-foreground capitalize">
                      {p.method.replace("_", " ")}{" "}
                      <span className="font-mono text-muted-foreground">
                        AED {parseFloat(p.amount).toFixed(2)}
                      </span>
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            {detailLoading && !selected?.items ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">Loading lines…</p>
            ) : (selected?.items ?? []).length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                No line detail available for this invoice.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Item</th>
                      <th className="px-3 py-2 text-right font-medium">Qty</th>
                      <th className="px-3 py-2 text-right font-medium">Unit</th>
                      <th className="px-3 py-2 text-right font-medium">Tax %</th>
                      <th className="px-3 py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {selected?.items?.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-foreground">
                            {item.productName}
                            {item.variantName && item.variantName !== "Default"
                              ? ` — ${item.variantName}`
                              : ""}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">{item.productSku}</div>
                        </td>
                        <td className="px-3 py-2 text-right font-mono">{item.quantity}</td>
                        <td className="px-3 py-2 text-right font-mono">{parseFloat(item.unitPrice).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                          {Number(item.taxPercent)}%
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {parseFloat(item.total).toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="ml-auto w-full max-w-xs space-y-1 text-xs">
            <Row label="Subtotal" value={selected?.subtotal} />
            {Number(selected?.discountAmount ?? "0") > 0 && (
              <Row label="Discount" value={`-${selected?.discountAmount}`} />
            )}
            <Row label="VAT" value={selected?.taxAmount} />
            <div className="flex justify-between border-t border-border pt-1.5 text-sm font-bold text-foreground">
              <span>Total</span>
              <span className="font-mono">
                AED {selected ? parseFloat(selected.total).toFixed(2) : "0.00"}
              </span>
            </div>
            {Number(selected?.dueAmount ?? "0") > 0 && (
              <div className="flex justify-between text-amber-500 font-medium">
                <span>Balance due</span>
                <span className="font-mono">
                  AED {parseFloat(selected!.dueAmount!).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
            <Button
              onClick={() => selected && void printInvoice(selected)}
              disabled={!selected || printing === selected?.id}
              className="gap-2"
            >
              <Printer className="h-4 w-4" />
              {printing === selected?.id ? "Opening print…" : "Print Tax Invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** One right-aligned totals line. Dashes rather than "AED NaN" when absent. */
function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono">
        {value === undefined || value === null ? "—" : `AED ${parseFloat(value).toFixed(2)}`}
      </span>
    </div>
  );
}
