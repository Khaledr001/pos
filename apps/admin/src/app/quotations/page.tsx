"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  FileText, Plus, RefreshCw, X, AlertCircle, CheckCircle2, Search, Printer,
  Send, Ban, ShoppingCart, ClipboardList, Trash2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ──────────────────────────────────────────────────────────────────

interface QuotationRow {
  id: string;
  quotationNumber: string;
  status: string;
  customerName: string | null;
  total: string;
  currency?: string;
  validUntil: string | null;
  /** Derived server-side — a stored "expired" would need a job that may not run. */
  expired: boolean;
  createdAt: string;
}

interface QuotationItem {
  id: string;
  productName: string;
  variantName?: string;
  productSku?: string;
  sku?: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  total: string;
}

interface QuotationDetail {
  id: string;
  quotationNumber: string;
  status: string;
  currency: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  total: string;
  validUntil: string | null;
  expired: boolean;
  notes: string | null;
  createdAt: string;
  customer: { id: string; name: string; company: string | null; phone: string | null } | null;
  customerName?: string | null;
  items: QuotationItem[];
}

interface Customer {
  id: string;
  name: string;
  company?: string | null;
}

/** `/products/search` — the same variant search the POS uses. */
interface VariantHit {
  id: string;
  sku: string;
  productName: string;
  variantName: string;
  sellingPrice: string | null;
}

const STATUS_VARIANT: Record<string, "success" | "secondary" | "destructive" | "outline"> = {
  draft: "secondary",
  sent: "outline",
  confirmed: "success",
  converted: "success",
  expired: "destructive",
  cancelled: "destructive",
};

const STATUSES = ["draft", "sent", "confirmed", "converted", "expired", "cancelled"] as const;

export default function QuotationsPage() {
  const { tokens } = useAuth();

  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [selected, setSelected] = useState<QuotationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ items: QuotationRow[]; total: number }>("/quotations", {
        accessToken: tokens?.accessToken,
        query: { page, pageSize: PAGE_SIZE, ...(status ? { status } : {}) },
      });
      setRows(res?.items ?? []);
      setTotal(res?.total ?? 0);
    } catch (err: any) {
      setError(err?.message || "Failed to load quotations.");
    } finally {
      setLoading(false);
    }
  }, [tokens, page, status]);

  useEffect(() => { fetchRows(); }, [fetchRows]);
  useEffect(() => { setPage(1); }, [status]);

  const openQuotation = useCallback(async (id: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const full = await api.get<QuotationDetail>(`/quotations/${id}`, {
        accessToken: tokens?.accessToken,
      });
      setSelected(full);
    } catch (err: any) {
      setError(err?.message || "Failed to load the quotation.");
    } finally {
      setDetailLoading(false);
    }
  }, [tokens]);

  const printQuotation = useCallback(async (row: { id: string; quotationNumber: string }) => {
    setBusy(`pdf:${row.id}`);
    setError(null);
    try {
      const { blob } = await apiDownload(`/quotations/${row.id}/pdf`, {
        accessToken: tokens?.accessToken,
      });
      printBlob(blob, `Quotation ${row.quotationNumber}`);
    } catch (err: any) {
      setError(err?.message || "Failed to load the quotation for printing.");
    } finally {
      setBusy(null);
    }
  }, [tokens]);

  /**
   * One helper for send / cancel / convert, because they differ only by the
   * path and the wording. Each refetches rather than patching state: all
   * three change the status server-side, and a converted quote also creates
   * a document elsewhere — the server is the authority on the result.
   */
  const act = useCallback(
    async (id: string, path: string, label: string, body?: unknown) => {
      setBusy(`${path}:${id}`);
      setError(null);
      try {
        await api.post(`/quotations/${id}/${path}`, body ?? {}, {
          accessToken: tokens?.accessToken,
        });
        setSuccess(label);
        setSelected(null);
        await fetchRows();
      } catch (err: any) {
        setError(err?.message || `Could not ${label.toLowerCase()}.`);
      } finally {
        setBusy(null);
      }
    },
    [tokens, fetchRows],
  );

  const filtered = rows.filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      r.quotationNumber.toLowerCase().includes(q) ||
      (r.customerName ?? "").toLowerCase().includes(q)
    );
  });

  const fmtDate = (iso?: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString("en-AE", { dateStyle: "medium" });
    } catch { return iso; }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Quotations</h1>
            {total > 0 && <Badge variant="outline">{total} total</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Quote a price, hold it until it expires, then turn it into a sale or an order.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button variant="outline" size="sm" onClick={fetchRows} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New Quotation
          </Button>
        </div>
      </div>

      {success && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /><span>{success}</span></div>
          <button onClick={() => setSuccess(null)} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2"><AlertCircle className="h-4 w-4" /><span>{error}</span></div>
          <button onClick={() => setError(null)} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by quote number or customer..."
            className="pl-10 h-10 bg-secondary/30"
          />
        </div>
        <Select value={status || "all"} onValueChange={(val) => setStatus(val === "all" ? "" : val)}>
          <SelectTrigger className="h-10 sm:w-48 text-xs">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading quotations...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <FileText className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">No quotations found</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {search || status
                ? "Nothing matches this filter."
                : "Raise one here, or from a POS terminal with F7."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3.5 font-medium">Quote #</th>
                    <th className="px-4 py-3.5 font-medium">Customer</th>
                    <th className="px-4 py-3.5 font-medium">Raised</th>
                    <th className="px-4 py-3.5 font-medium">Valid until</th>
                    <th className="px-4 py-3.5 text-right font-medium">Total</th>
                    <th className="px-4 py-3.5 text-center font-medium">Status</th>
                    <th className="px-4 py-3.5 text-right font-medium">Print</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => void openQuotation(row.id)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open quotation ${row.quotationNumber}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void openQuotation(row.id);
                        }
                      }}
                      className="cursor-pointer hover:bg-secondary/30 transition-colors focus:bg-secondary/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <td className="px-4 py-3.5 font-mono font-bold text-primary whitespace-nowrap">
                        <span className="underline decoration-dotted underline-offset-2">
                          {row.quotationNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-medium text-foreground max-w-[200px] truncate">
                        {row.customerName ?? "—"}
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap">
                        {fmtDate(row.createdAt)}
                      </td>
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <span className={cn(row.expired && "text-destructive")}>
                          {fmtDate(row.validUntil)}
                        </span>
                        {/* Expiry is what makes a quote a promise with an end;
                            worth flagging even when the status has not caught up. */}
                        {row.expired && row.status !== "converted" && (
                          <Badge variant="destructive" className="ml-2 text-[10px]">expired</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-foreground">
                        {parseFloat(row.total).toFixed(2)}
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <Badge variant={STATUS_VARIANT[row.status] ?? "secondary"}>{row.status}</Badge>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => {
                            // Otherwise the row's own click opens the dialog too.
                            e.stopPropagation();
                            void printQuotation(row);
                          }}
                          disabled={busy === `pdf:${row.id}`}
                          aria-label={`Print quotation ${row.quotationNumber}`}
                          className="gap-1.5"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          {busy === `pdf:${row.id}` ? "…" : "Print"}
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
                  Page {page} · {total} total
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

      <QuotationDetailDialog
        quotation={selected}
        loading={detailLoading}
        busy={busy}
        onClose={() => setSelected(null)}
        onPrint={printQuotation}
        onAct={act}
      />

      <CreateQuotationDialog
        open={creating}
        accessToken={tokens?.accessToken}
        onClose={() => setCreating(false)}
        onCreated={(number) => {
          setCreating(false);
          setSuccess(`Quotation ${number} created.`);
          void fetchRows();
        }}
      />
    </div>
  );
}

// ── Detail ──────────────────────────────────────────────────────────────────

function QuotationDetailDialog({
  quotation,
  loading,
  busy,
  onClose,
  onPrint,
  onAct,
}: {
  quotation: QuotationDetail | null;
  loading: boolean;
  busy: string | null;
  onClose: () => void;
  onPrint: (row: { id: string; quotationNumber: string }) => void;
  onAct: (id: string, path: string, label: string, body?: unknown) => void;
}) {
  const q = quotation;
  /**
   * What can still be done to it. A converted quote is finished — offering
   * "convert" again would either double-bill the customer or fail, and
   * neither is a button worth showing.
   */
  const open = q ? !["converted", "cancelled"].includes(q.status) : false;

  return (
    <Dialog open={q !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="font-mono">{q?.quotationNumber}</DialogTitle>
              <DialogDescription>
                {q?.customer?.name || q?.customerName || "No customer"}
                {q?.validUntil ? ` · valid until ${q.validUntil}` : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {q?.expired && q.status !== "converted" && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>This quote has passed its validity date. Converting it charges today at the quoted prices.</span>
          </div>
        )}

        <div className="rounded-xl border border-border overflow-hidden">
          {loading ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">Loading…</p>
          ) : (q?.items ?? []).length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">No lines on this quotation.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Unit</th>
                    <th className="px-3 py-2 text-right font-medium">Disc %</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {q?.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">
                          {item.productName}
                          {item.variantName && item.variantName !== "Default" ? ` — ${item.variantName}` : ""}
                        </div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {item.productSku || item.sku}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{item.quantity}</td>
                      <td className="px-3 py-2 text-right font-mono">{parseFloat(item.unitPrice).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                        {Number(item.discountPercent)}%
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
          <TotalsRow label="Subtotal" value={q?.subtotal} currency={q?.currency} />
          {Number(q?.discountAmount ?? "0") > 0 && (
            <TotalsRow label="Discount" value={`-${q?.discountAmount}`} currency={q?.currency} />
          )}
          <TotalsRow label="VAT" value={q?.taxAmount} currency={q?.currency} />
          <div className="flex justify-between border-t border-border pt-1.5 text-sm font-bold text-foreground">
            <span>Total</span>
            <span className="font-mono">
              {q?.currency} {q ? parseFloat(q.total).toFixed(2) : "0.00"}
            </span>
          </div>
        </div>

        {q?.notes && (
          <p className="rounded-lg bg-secondary/40 p-3 text-xs text-muted-foreground">{q.notes}</p>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>

          <Button
            variant="outline"
            onClick={() => q && onPrint(q)}
            disabled={!q || busy === `pdf:${q?.id}`}
            className="gap-2"
          >
            <Printer className="h-4 w-4" />
            {busy === `pdf:${q?.id}` ? "Opening print…" : "Print Quotation"}
          </Button>

          {open && q?.status === "draft" && (
            <Button
              variant="outline"
              onClick={() => onAct(q.id, "send", `Quotation ${q.quotationNumber} marked as sent.`)}
              disabled={busy === `send:${q.id}`}
            >
              <Send className="h-4 w-4" />
              Mark sent
            </Button>
          )}

          {open && (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  onAct(q!.id, "cancel", `Quotation ${q!.quotationNumber} cancelled.`)
                }
                disabled={busy === `cancel:${q!.id}`}
              >
                <Ban className="h-4 w-4" />
                Cancel
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  onAct(q!.id, "convert-to-order", `Order raised from ${q!.quotationNumber}.`)
                }
                disabled={busy === `convert-to-order:${q!.id}`}
              >
                <ClipboardList className="h-4 w-4" />
                To order
              </Button>
              <Button
                onClick={() =>
                  onAct(q!.id, "convert", `Sale raised from ${q!.quotationNumber}.`, { payments: [] })
                }
                disabled={busy === `convert:${q!.id}`}
              >
                <ShoppingCart className="h-4 w-4" />
                Convert to sale
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TotalsRow({ label, value, currency }: { label: string; value?: string; currency?: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono">
        {value === undefined || value === null
          ? "—"
          : `${currency ?? ""} ${parseFloat(value).toFixed(2)}`}
      </span>
    </div>
  );
}

// ── Create ──────────────────────────────────────────────────────────────────

/**
 * Lines are built from the same `/products/search` the POS sells from, so a
 * quote cannot name a variant that is not sellable. Unit price is left blank
 * by default: omitting it quotes the RESOLVED price (customer tier, quantity
 * break and all), which is almost always what is wanted — typing one is how
 * you record a negotiated figure, deliberately.
 */
function CreateQuotationDialog({
  open,
  accessToken,
  onClose,
  onCreated,
}: {
  open: boolean;
  accessToken?: string;
  onClose: () => void;
  onCreated: (quotationNumber: string) => void;
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState("");
  /**
   * Required, not optional. An admin account is tenant-wide — it has no
   * pinned branch — so the server answers "this action needs a branch, name
   * it explicitly". A quotation also belongs somewhere: it is quoted at a
   * branch's prices and converts into that branch's sale.
   */
  const [branches, setBranches] = useState<Array<{ id: string; name: string; code: string }>>([]);
  const [branchId, setBranchId] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [docDiscount, setDocDiscount] = useState("");

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VariantHit[]>([]);
  const [lines, setLines] = useState<
    Array<{ variantId: string; label: string; sku: string; quantity: string; unitPrice: string; discountPercent: string }>
  >([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !accessToken) return;
    setError(null);

    api
      .get<{ items: Customer[] } | Customer[]>("/customers", { accessToken, query: { pageSize: 200 } })
      .then((res) => setCustomers(Array.isArray(res) ? res : (res?.items ?? [])))
      .catch((e: any) => setError(e?.message || "Could not load customers."));

    api
      .get<{ items: Array<{ id: string; name: string; code: string }> }>("/branches", { accessToken })
      .then((res) => {
        const list = res?.items ?? [];
        setBranches(list);
        // Preselected when there is only one, which is the common case — the
        // form should not make a single-branch tenant choose every time.
        if (list.length === 1 && list[0]) setBranchId(list[0].id);
      })
      .catch((e: any) => setError(e?.message || "Could not load branches."));
  }, [open, accessToken]);

  useEffect(() => {
    if (!query.trim() || !accessToken) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      api
        .get<VariantHit[]>("/products/search", { accessToken, query: { q: query, limit: 10 } })
        .then((res) => setHits(res ?? []))
        .catch(() => setHits([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, accessToken]);

  function reset() {
    setCustomerId("");
    setBranchId("");
    setValidUntil("");
    setNotes("");
    setDocDiscount("");
    setQuery("");
    setHits([]);
    setLines([]);
    setError(null);
  }

  function addLine(hit: VariantHit) {
    if (lines.some((l) => l.variantId === hit.id)) return;
    setLines((prev) => [
      ...prev,
      {
        variantId: hit.id,
        label: `${hit.productName}${hit.variantName && hit.variantName !== "Default" ? ` — ${hit.variantName}` : ""}`,
        sku: hit.sku,
        quantity: "1",
        unitPrice: "",
        discountPercent: "",
      },
    ]);
    setQuery("");
    setHits([]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (lines.length === 0) {
      setError("Add at least one line.");
      return;
    }
    if (!branchId) {
      setError("Choose which branch is quoting this.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.post<{ quotationNumber: string }>(
        "/quotations",
        {
          branchId,
          ...(customerId ? { customerId } : {}),
          ...(validUntil ? { validUntil } : {}),
          ...(notes ? { notes } : {}),
          ...(docDiscount ? { documentDiscountPercent: Number(docDiscount) } : {}),
          lines: lines.map((l) => ({
            variantId: l.variantId,
            quantity: Number(l.quantity),
            // Sent only when typed — an empty string would quote zero.
            ...(l.unitPrice ? { unitPrice: l.unitPrice } : {}),
            ...(l.discountPercent ? { discountPercent: Number(l.discountPercent) } : {}),
          })),
        },
        { accessToken },
      );
      reset();
      onCreated(created.quotationNumber);
    } catch (err: any) {
      setError(err?.message || "Failed to create the quotation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-white">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>New Quotation</DialogTitle>
              <DialogDescription>
                Prices are resolved at the customer&apos;s tier unless you type one.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Branch *</label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="— Select Branch —" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Customer</label>
              <Select value={customerId || "walk-in"} onValueChange={(val) => setCustomerId(val === "walk-in" ? "" : val)}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="— Walk-in (no customer) —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="walk-in">— Walk-in (no customer) —</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{c.company ? ` (${c.company})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Valid until</label>
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>

          <div className="rounded-xl border border-border p-4 space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lines</p>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products by name, SKU or barcode..."
                className="pl-10"
              />
              {hits.length > 0 && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg">
                  {hits.map((hit) => (
                    <button
                      key={hit.id}
                      type="button"
                      onClick={() => addLine(hit)}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-secondary/60"
                    >
                      <span className="font-medium text-foreground">
                        {hit.productName}
                        {hit.variantName && hit.variantName !== "Default" ? ` — ${hit.variantName}` : ""}
                      </span>
                      <span className="ml-3 font-mono text-[10px] text-muted-foreground">{hit.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {lines.length === 0 ? (
              <p className="text-xs text-muted-foreground">No lines yet — search above to add one.</p>
            ) : (
              <div className="space-y-2">
                {lines.map((line, i) => (
                  <div key={line.variantId} className="grid grid-cols-[1fr_5rem_6rem_5rem_2rem] items-end gap-2">
                    <div>
                      <p className="truncate text-xs font-medium text-foreground">{line.label}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{line.sku}</p>
                    </div>
                    <div>
                      {i === 0 && <label className="block text-[10px] text-muted-foreground">Qty</label>}
                      <Input
                        type="number" min="0.0001" step="0.0001" className="h-8 font-mono"
                        value={line.quantity}
                        onChange={(e) =>
                          setLines((prev) => prev.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))
                        }
                      />
                    </div>
                    <div>
                      {i === 0 && <label className="block text-[10px] text-muted-foreground">Price</label>}
                      <Input
                        type="number" min="0" step="0.01" className="h-8 font-mono"
                        placeholder="auto"
                        value={line.unitPrice}
                        onChange={(e) =>
                          setLines((prev) => prev.map((l, j) => (j === i ? { ...l, unitPrice: e.target.value } : l)))
                        }
                      />
                    </div>
                    <div>
                      {i === 0 && <label className="block text-[10px] text-muted-foreground">Disc %</label>}
                      <Input
                        type="number" min="0" max="100" step="0.01" className="h-8 font-mono"
                        placeholder="0"
                        value={line.discountPercent}
                        onChange={(e) =>
                          setLines((prev) => prev.map((l, j) => (j === i ? { ...l, discountPercent: e.target.value } : l)))
                        }
                      />
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${line.label}`}
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                      className="mb-1 cursor-pointer text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Document discount %</label>
              <Input
                type="number" min="0" max="100" step="0.01" className="font-mono"
                placeholder="0"
                value={docDiscount}
                onChange={(e) => setDocDiscount(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-foreground mb-1.5">Notes (printed on the quote)</label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Delivery within 3 working days." />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
            <Button type="submit" disabled={submitting || lines.length === 0 || !branchId}>
              {submitting ? "Creating..." : "Create Quotation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
