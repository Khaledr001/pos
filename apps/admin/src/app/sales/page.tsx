"use client";

import React, { useState, useCallback } from "react";
import {
  RefreshCw, CreditCard, Banknote, Receipt, ShoppingCart,
  Printer, AlertCircle, FileText, Ban, Undo2,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api, apiDownload, printBlob } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { useTenantSettings } from "@/lib/tenant-settings";
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  SortableTh, Table, TableBody, TableContainer, TableEmpty, TableHead,
  TablePagination, TableSearch, Th, numericCell,
} from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { usePermission } from "@/lib/require-auth";
import {
  ReturnSaleDialog,
  VoidSaleDialog,
  saleActionState,
  type ActionableSale,
} from "./sale-actions";

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
  /** How much of this line has already gone back — caps a further return. */
  returnedQuantity?: string;
}

/** `GET /sales/:id` — the full document, lines and payments included. */
interface SaleDetail extends Sale {
  items?: SaleItem[];
  discountAmount?: string;
  notes?: string | null;
  voidedAt?: string | null;
  /** Set when this document is itself a return — it can be neither voided nor returned. */
  returnOfSaleId?: string | null;
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
  branchCode?: string;
  branch?: { code: string; name: string };
  cashierName?: string;
  subtotal?: string;
  taxAmount?: string;
  total: string;
  paidAmount?: string;
  dueAmount?: string;
  status: string;
  payments?: SalePayment[];
  /** Distinct tender types — what the list endpoint sends instead of `payments`. */
  paymentMethods?: string[];
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
  const settings = useTenantSettings();
  const currency = settings.currency.base;

  const LIMIT = 50;
  const list = useListQuery({ sortBy: "occurredAt", sortOrder: "desc" });
  const { q, page, sortBy, sortOrder } = list;

  const loadSales = useCallback(
    async (signal: AbortSignal) =>
      readListResult<Sale>(
        await api.get<unknown>("/sales", {
          accessToken: tokens?.accessToken,
          signal,
          query: { q: q.trim() || undefined, page, limit: LIMIT, sortBy, sortOrder },
        }),
      ),
    [tokens?.accessToken, q, page, sortBy, sortOrder],
  );
  const { items: sales, total, loading, initialLoading, error: loadError, reload: fetchSales } =
    useListData(loadSales, list.ready);
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? loadError;

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

  /**
   * Void and return.
   *
   * Both are gated on a permission AND on the sale's own state — a voided
   * sale cannot be returned, a partly-returned one cannot be voided. The
   * rules live in `saleActionState` next to the dialogs, so the button and
   * the service cannot drift apart.
   */
  const mayVoid = usePermission("sale:void");
  const mayReturn = usePermission("sale:return");
  const [voiding, setVoiding] = useState(false);
  const [returning, setReturning] = useState(false);
  const actions = saleActionState(selected as ActionableSale | null);

  /**
   * After either one lands, the sale AND the list are both stale: its status,
   * its returned quantities and the page's totals all moved. Re-reading the
   * detail keeps the open dialog honest about what is still returnable.
   */
  const refreshAfterAction = useCallback(async () => {
    const id = selected?.id;
    void fetchSales();
    if (!id) return;
    try {
      const full = await api.get<SaleDetail>(`/sales/${id}`, {
        accessToken: tokens?.accessToken,
      });
      setSelected(full);
    } catch {
      // The action itself succeeded; a failed re-read is not worth an alarm.
      setSelected(null);
    }
  }, [selected?.id, tokens]);

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

  const formatTime = (iso?: string) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("en-AE", { dateStyle: "short", timeStyle: "short" });
    } catch { return iso; }
  };

  // A sale with no payment rows is a credit sale, not a cash one.
  const primaryPaymentMethod = (sale: Sale): string => {
    const methods = [
      ...new Set((sale.paymentMethods ?? sale.payments?.map((p) => p.method) ?? []).map((m) => m.toLowerCase())),
    ];
    if (methods.length === 0) return "credit";
    return methods.length > 1 ? "split" : methods[0]!;
  };

  const taxHeader = settings.tax.label;

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
        <Button variant="outline" size="sm" onClick={() => { setError(null); fetchSales(); }} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>
      )}

      <TableSearch
        value={list.search}
        onChange={list.setSearch}
        label="Search sales"
        placeholder="Search by invoice number, customer, or branch..."
      />

      <Card className="overflow-hidden">
        <TableContainer>
          <Table>
            <TableHead>
              <tr>
                <SortableTh column="saleNumber" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Invoice #</SortableTh>
                <Th>Customer</Th>
                <Th>Branch</Th>
                <SortableTh column="occurredAt" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} firstOrder="desc">Date & Time</SortableTh>
                <Th>Payment</Th>
                <Th align="right">Subtotal</Th>
                <Th align="right">{taxHeader}</Th>
                <SortableTh column="total" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} firstOrder="desc" align="right">Total ({currency})</SortableTh>
                <Th align="center">Status</Th>
                <Th align="right"><span className="sr-only">Actions</span></Th>
              </tr>
            </TableHead>
            <TableBody
              columns={10}
              loading={initialLoading}
              empty={
                <TableEmpty
                  columns={10}
                  icon={ShoppingCart}
                  title="No sales found"
                  description={list.q ? `No invoices match "${list.q}".` : "Sales are created from the POS terminal."}
                />
              }
            >
              {sales.map((sale) => {
                const method = primaryPaymentMethod(sale);
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
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void openSale(sale);
                      }
                    }}
                    className={cn(
                      "cursor-pointer hover:bg-secondary/30 transition-colors focus:bg-secondary/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                      loading && "opacity-60",
                    )}
                  >
                    <td className="px-4 py-3.5 font-mono font-bold text-primary whitespace-nowrap">
                      <span className="underline decoration-dotted underline-offset-2">
                        {sale.saleNumber || sale.invoiceNumber || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-medium text-foreground max-w-45 truncate" title={sale.customerName || sale.customer?.name || undefined}>
                      {sale.customerName || sale.customer?.name || "Walk-in Customer"}
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant="secondary" className="font-mono text-[10px] font-bold">
                        {sale.branchCode || sale.branch?.code || sale.branchName || "HQ"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap tabular-nums">
                      {formatTime(sale.occurredAt || sale.createdAt)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1.5 font-medium text-foreground capitalize">
                        {PAYMENT_ICONS[method] ?? <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />}
                        {method}
                      </span>
                    </td>
                    <td className={cn("px-4 py-3.5 text-muted-foreground", numericCell)}>
                      {formatMoney(sale.subtotal)}
                    </td>
                    <td className={cn("px-4 py-3.5 text-muted-foreground", numericCell)}>
                      {formatMoney(sale.taxAmount)}
                    </td>
                    <td className={cn("px-4 py-3.5 font-bold text-foreground", numericCell)}>
                      {formatMoney(sale.total)}
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
                        aria-label={`Print invoice ${sale.saleNumber || ""}`}
                      >
                        <Printer className="h-3.5 w-3.5" />
                        {printing === sale.id ? "…" : "Print"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination page={page} pageSize={LIMIT} total={total} onPageChange={list.setPage} noun="invoices" />
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
                        {formatMoney(p.amount, { currency })}
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
                        <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(item.unitPrice)}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                          {Number(item.taxPercent)}%
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold">
                          {formatMoney(item.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="ml-auto w-full max-w-xs space-y-1 text-xs">
            <Row label="Subtotal" value={selected?.subtotal} currency={currency} />
            {Number(selected?.discountAmount ?? "0") > 0 && (
              <Row label="Discount" value={`-${selected?.discountAmount}`} currency={currency} />
            )}
            <Row label={settings.tax.label} value={selected?.taxAmount} currency={currency} />
            <div className="flex justify-between border-t border-border pt-1.5 text-sm font-bold text-foreground">
              <span>Total</span>
              <span className="font-mono">
                {formatMoney(selected?.total ?? "0", { currency })}
              </span>
            </div>
            {Number(selected?.dueAmount ?? "0") > 0 && (
              <div className="flex justify-between text-amber-500 font-medium">
                <span>Balance due</span>
                <span className="font-mono">
                  {formatMoney(selected!.dueAmount!, { currency })}
                </span>
              </div>
            )}
          </div>

          {/* Why an action is unavailable, rather than a button that 403s.
              Only shown when the operator holds the permission — someone who
              cannot void has no use for the reason this particular sale
              could not be voided. */}
          {((mayVoid && actions.voidBlockedReason) ||
            (mayReturn && actions.returnBlockedReason)) && (
            <p className="flex items-start gap-1.5 rounded-lg border border-border bg-secondary/40 p-2 text-[11px] text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {(mayVoid && actions.voidBlockedReason) ||
                  (mayReturn && actions.returnBlockedReason)}
              </span>
            </p>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {mayReturn && actions.canReturn && (
                <Button variant="outline" onClick={() => setReturning(true)}>
                  <Undo2 className="h-4 w-4" />
                  Return items
                </Button>
              )}
              {mayVoid && actions.canVoid && (
                <Button
                  variant="outline"
                  onClick={() => setVoiding(true)}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  <Ban className="h-4 w-4" />
                  Void sale
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setSelected(null)}>Close</Button>
              <Button
                onClick={() => selected && void printInvoice(selected)}
                disabled={!selected || printing === selected?.id}
                className="gap-2"
              >
                <Printer className="h-4 w-4" />
                {printing === selected?.id ? "Opening print…" : "Print Tax Invoice"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VoidSaleDialog
        sale={selected as ActionableSale | null}
        open={voiding}
        onClose={() => setVoiding(false)}
        onDone={() => void refreshAfterAction()}
        accessToken={tokens?.accessToken}
      />

      <ReturnSaleDialog
        sale={selected as ActionableSale | null}
        open={returning}
        onClose={() => setReturning(false)}
        onDone={() => void refreshAfterAction()}
        accessToken={tokens?.accessToken}
      />
    </div>
  );
}

/** One right-aligned totals line. A dash rather than "NaN" when absent. */
function Row({ label, value, currency }: { label: string; value?: string; currency: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono tabular-nums">
        {formatMoney(value, { currency })}
      </span>
    </div>
  );
}
