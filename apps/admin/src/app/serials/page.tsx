"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Barcode,
  Loader2,
  PackageSearch,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  X,
} from "lucide-react";
import { SERIAL_NUMBER_STATUSES, type SerialNumberStatus } from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { cn } from "@/lib/utils";
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";
import {
  SortableTh, Table, TableBody, TableContainer, TableEmpty, TableHead,
  TablePagination, TableSearch, Th,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow, MobileSort, listCard } from "@/components/ui/mobile-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Serial numbers — which unit, not how many.
 *
 * The stock ledger counts twelve drills on the shelf; this page answers which
 * twelve, and for one in a customer's hand: where it came in, which invoice it
 * left on, and whether it is still under warranty. Serials are created by the
 * purchase receipt and claimed by the sale, so the only write here is the one
 * that has no other home — writing a unit off as damaged.
 */

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface SerialRow {
  id: string;
  serial: string;
  status: SerialNumberStatus;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  productId: string;
  productName: string;
  sku: string;
  variantName: string | null;
  expiryDate: string | null;
  createdAt: string;
  saleId: string | null;
  saleNumber: string | null;
}

/** `GET /serials/:serial/lookup` */
interface SerialHistory extends Omit<SerialRow, "saleNumber"> {
  saleNumber: string | null;
  soldAt: string | null;
  saleStatus: string | null;
  customerId: string | null;
  customerName: string | null;
  receivedAt: string;
}

const STATUS_LABEL: Record<SerialNumberStatus, string> = {
  available: "In stock",
  sold: "Sold",
  returned: "Returned",
  damaged: "Damaged",
};

const STATUS_VARIANT: Record<SerialNumberStatus, "success" | "secondary" | "warning" | "destructive"> = {
  available: "success",
  sold: "secondary",
  returned: "warning",
  damaged: "destructive",
};

const LIMIT = 50;

function StatusBadge({ status }: { status: SerialNumberStatus }) {
  return <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/**
 * "Until 12 Mar 2027 · 141 days left", or "Expired 3 days ago". `expiryDate`
 * is a plain YYYY-MM-DD, compared by calendar day so the last day of a
 * warranty still reads as covered.
 */
function warranty(expiryDate: string | null): { text: string; expired: boolean } | null {
  if (!expiryDate) return null;
  const end = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(end.getTime())) return { text: expiryDate, expired: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((end.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) {
    return { text: `Expired ${formatDate(expiryDate)} · ${-days} ${-days === 1 ? "day" : "days"} ago`, expired: true };
  }
  return {
    text: `Until ${formatDate(expiryDate)} · ${days === 0 ? "last day" : `${days} ${days === 1 ? "day" : "days"} left`}`,
    expired: false,
  };
}

export default function SerialsPage() {
  const { tokens } = useAuth();
  const accessToken = tokens?.accessToken;
  const mayWriteOff = usePermission("inventory:adjust");

  const list = useListQuery({
    sortBy: "createdAt",
    sortOrder: "desc",
    filters: { status: "", branch: "", product: "" },
  });
  const { q, page, sortBy, sortOrder, filters } = list;

  const loadSerials = useCallback(
    async (signal: AbortSignal) =>
      readListResult<SerialRow>(
        await api.get<unknown>("/serials", {
          accessToken,
          signal,
          query: {
            q: q.trim() || undefined,
            status: filters.status || undefined,
            branchId: filters.branch || undefined,
            productId: filters.product || undefined,
            page,
            limit: LIMIT,
            sortBy,
            sortOrder,
          },
        }),
      ),
    [accessToken, q, filters.status, filters.branch, filters.product, page, sortBy, sortOrder],
  );
  const serials = useListData(loadSerials, list.ready);

  const [branches, setBranches] = useState<Branch[]>([]);
  useEffect(() => {
    if (!accessToken) return;
    api
      .get<{ items: Branch[] } | Branch[]>("/branches", { accessToken, query: { limit: 200 } })
      .then((res) => setBranches(Array.isArray(res) ? res : (res?.items ?? [])))
      .catch(() => setBranches([]));
  }, [accessToken]);

  // ── Lookup ────────────────────────────────────────────────────────────────

  const lookupRef = useRef<HTMLInputElement>(null);
  const [lookupInput, setLookupInput] = useState("");
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [history, setHistory] = useState<SerialHistory | null>(null);
  /** The serial the product filter was taken from, so the chip can name the product. */
  const [productLabel, setProductLabel] = useState<string | null>(null);

  const lookUp = useCallback(
    async (serial: string) => {
      const term = serial.trim();
      if (!term) return;
      setLookingUp(true);
      setLookupError(null);
      try {
        const found = await api.get<SerialHistory>(`/serials/${encodeURIComponent(term)}/lookup`, { accessToken });
        setHistory(found);
      } catch (err) {
        setHistory(null);
        setLookupError(err instanceof Error ? err.message : "Lookup failed.");
      } finally {
        setLookingUp(false);
      }
    },
    [accessToken],
  );

  function showProduct(productId: string, productName: string) {
    setProductLabel(productName);
    list.setFilter("product", productId);
  }

  // A product chip restored from the URL has no lookup behind it; the rows,
  // all of that one product, can still name it.
  const productChip =
    filters.product
      ? (productLabel ?? serials.items.find((r) => r.productId === filters.product)?.productName ?? "One product")
      : null;

  // ── Write-off ─────────────────────────────────────────────────────────────

  const [writeOff, setWriteOff] = useState<{ id: string; serial: string; status: SerialNumberStatus } | null>(null);
  const [reason, setReason] = useState("");
  const [writingOff, setWritingOff] = useState(false);
  const [writeOffError, setWriteOffError] = useState<string | null>(null);

  function openWriteOff(target: { id: string; serial: string; status: SerialNumberStatus }) {
    setWriteOff(target);
    setReason("");
    setWriteOffError(null);
  }

  async function confirmWriteOff() {
    if (!writeOff || reason.trim().length < 3) return;
    setWritingOff(true);
    setWriteOffError(null);
    try {
      await api.post(`/serials/${writeOff.id}/damaged`, { reason: reason.trim() }, { accessToken });
      const serial = writeOff.serial;
      setWriteOff(null);
      serials.reload();
      if (history?.serial === serial) void lookUp(serial);
    } catch (err) {
      setWriteOffError(err instanceof Error ? err.message : "Could not record the write-off.");
    } finally {
      setWritingOff(false);
    }
  }

  const canWriteOff = (status: SerialNumberStatus) => mayWriteOff && status !== "damaged";

  const filtered = Boolean(list.q || filters.status || filters.branch || filters.product);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Serial Numbers</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Track individual units — where each one came in, which invoice it left on, and its warranty.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={serials.reload} disabled={serials.loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", serials.loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* ── Lookup ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ScanLine className="h-4 w-4 text-primary" />
            Look up a serial
          </CardTitle>
          <CardDescription className="text-xs">
            Scan or type the serial from the unit or its box, then press Enter.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void lookUp(lookupInput);
            }}
          >
            <div className="relative flex-1">
              <Barcode aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={lookupRef}
                value={lookupInput}
                onChange={(e) => setLookupInput(e.target.value)}
                placeholder="e.g. SN-4F2A-88013"
                aria-label="Serial number to look up"
                autoFocus
                autoComplete="off"
                spellCheck={false}
                className="h-11 pl-9 font-mono"
              />
            </div>
            <Button type="submit" className="h-11" disabled={lookingUp || !lookupInput.trim()}>
              {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageSearch className="h-4 w-4" />}
              Look up
            </Button>
          </form>

          {lookupError && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {lookupError}
            </p>
          )}

          {history && (
            <HistoryCard
              history={history}
              mayWriteOff={canWriteOff(history.status)}
              onWriteOff={() => openWriteOff(history)}
              onShowProduct={() => showProduct(history.productId, history.productName)}
              onClose={() => {
                setHistory(null);
                setLookupInput("");
                lookupRef.current?.focus();
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* ── List ───────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row">
          <TableSearch
            value={list.search}
            onChange={list.setSearch}
            label="Search serial numbers"
            placeholder="Search by serial, SKU or product…"
            className="flex-1"
          />
          <MobileSort
            options={[
              { column: "createdAt", label: "Received", firstOrder: "desc" },
              { column: "serial", label: "Serial" },
              { column: "status", label: "Status" },
              { column: "expiryDate", label: "Warranty" },
            ]}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onChange={list.setSort}
          />
          <div className="grid grid-cols-2 gap-2 lg:flex">
            <Select value={filters.status || "all"} onValueChange={(v) => list.setFilter("status", v === "all" ? "" : v)}>
              <SelectTrigger className="h-10 text-xs lg:w-40" aria-label="Filter by status">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {SERIAL_NUMBER_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filters.branch || "all"} onValueChange={(v) => list.setFilter("branch", v === "all" ? "" : v)}>
              <SelectTrigger className="h-10 text-xs lg:w-48" aria-label="Filter by branch">
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {productChip && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Product:</span>
            <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-1 pl-3 pr-1 font-medium text-primary">
              <span className="truncate">{productChip}</span>
              <button
                type="button"
                onClick={() => {
                  setProductLabel(null);
                  list.setFilter("product", "");
                }}
                aria-label="Clear product filter"
                className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full hover:bg-primary/15"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        )}

        {serials.error && (
          <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {serials.error}
          </p>
        )}

        <MobileList
          loading={serials.initialLoading}
          empty={
            <MobileEmpty
              icon={Barcode}
              title="No serial numbers"
              description={filtered ? "Nothing matches this filter." : "Serials are recorded when a purchase is received."}
            />
          }
        >
          {serials.items.map((row) => {
            const w = warranty(row.expiryDate);
            return (
              <MobileRow
                key={row.id}
                title={<span className="font-mono">{row.serial}</span>}
                subtitle={row.productName}
                badge={<StatusBadge status={row.status} />}
                fields={[
                  { label: "Product", value: `${row.productName}${row.variantName ? ` · ${row.variantName}` : ""}` },
                  { label: "SKU", value: <span className="font-mono">{row.sku}</span> },
                  { label: "Branch", value: row.branchName ?? "—" },
                  { label: "Received", value: formatDate(row.createdAt) },
                  { label: "Warranty", value: w ? <span className={cn(w.expired && "text-destructive")}>{w.text}</span> : "—" },
                  {
                    label: "Sale",
                    value: row.saleNumber ? (
                      <Link className="font-mono text-primary underline-offset-2 hover:underline" href={`/sales?q=${encodeURIComponent(row.saleNumber)}`}>
                        {row.saleNumber}
                      </Link>
                    ) : "—",
                  },
                ]}
                actions={
                  <>
                    <Button variant="outline" size="sm" onClick={() => { setLookupInput(row.serial); void lookUp(row.serial); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                      <PackageSearch className="h-3.5 w-3.5" />
                      History
                    </Button>
                    {canWriteOff(row.status) && (
                      <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => openWriteOff(row)}>
                        <ShieldAlert className="h-3.5 w-3.5" />
                        Damaged
                      </Button>
                    )}
                  </>
                }
              />
            );
          })}
        </MobileList>

        <Card className={listCard}>
          <TableContainer className="hidden md:block">
            <Table>
              <TableHead>
                <tr>
                  <SortableTh column="serial" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Serial</SortableTh>
                  <Th>Product</Th>
                  <Th>Branch</Th>
                  <SortableTh column="status" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Status</SortableTh>
                  <SortableTh column="createdAt" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} firstOrder="desc">Received</SortableTh>
                  <SortableTh column="expiryDate" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Warranty</SortableTh>
                  <Th>Sale</Th>
                  <Th align="right"><span className="sr-only">Actions</span></Th>
                </tr>
              </TableHead>
              <TableBody
                columns={8}
                loading={serials.initialLoading}
                empty={
                  <TableEmpty
                    columns={8}
                    icon={Barcode}
                    title="No serial numbers"
                    description={filtered ? "Nothing matches this filter." : "Serials are recorded when a purchase is received."}
                  />
                }
              >
                {serials.items.map((row) => {
                  const w = warranty(row.expiryDate);
                  return (
                    <tr key={row.id} className={cn("transition-colors hover:bg-secondary/30", serials.loading && "opacity-60")}>
                      <td className="px-4 py-3 font-mono font-semibold text-foreground whitespace-nowrap">
                        <button
                          type="button"
                          className="cursor-pointer text-primary underline decoration-dotted underline-offset-2"
                          onClick={() => { setLookupInput(row.serial); void lookUp(row.serial); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                          aria-label={`Show history of ${row.serial}`}
                        >
                          {row.serial}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          className="block max-w-56 cursor-pointer truncate text-left font-medium text-foreground hover:text-primary"
                          onClick={() => showProduct(row.productId, row.productName)}
                          title={`Show every serial of ${row.productName}`}
                        >
                          {row.productName}
                        </button>
                        <span className="font-mono text-[11px] text-muted-foreground">{row.sku}</span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.branchCode ? <Badge variant="secondary" className="font-mono text-[10px]">{row.branchCode}</Badge> : "—"}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={row.status} /></td>
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums text-muted-foreground">{formatDate(row.createdAt)}</td>
                      <td className={cn("px-4 py-3 whitespace-nowrap text-muted-foreground", w?.expired && "text-destructive")}>
                        {w ? w.text : "—"}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.saleNumber ? (
                          <Link className="font-mono text-primary underline-offset-2 hover:underline" href={`/sales?q=${encodeURIComponent(row.saleNumber)}`}>
                            {row.saleNumber}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canWriteOff(row.status) && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => openWriteOff(row)}
                            aria-label={`Mark ${row.serial} as damaged`}
                          >
                            <ShieldAlert className="h-3.5 w-3.5" />
                            Damaged
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination page={page} pageSize={LIMIT} total={serials.total} onPageChange={list.setPage} noun="serials" />
        </Card>
      </div>

      <Dialog open={writeOff !== null} onOpenChange={(open) => !open && !writingOff && setWriteOff(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark {writeOff?.serial} as damaged?</DialogTitle>
            <DialogDescription>
              {writeOff?.status === "available"
                ? "It is still in stock, so this also takes one unit off the branch's stock. Damaged is final — the serial cannot be sold again."
                : "Damaged is final — the serial cannot be sold or returned to stock afterwards."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="damage-reason" className="text-xs font-medium text-foreground">
              What happened? <span className="text-destructive">*</span>
            </label>
            <textarea
              id="damage-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Dropped in the warehouse, casing cracked"
              aria-describedby="damage-reason-help"
              className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p id="damage-reason-help" className="text-[11px] text-muted-foreground">
              Recorded on the stock adjustment and the audit trail.
            </p>
          </div>
          {writeOffError && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
              {writeOffError}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setWriteOff(null)} disabled={writingOff}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void confirmWriteOff()} disabled={writingOff || reason.trim().length < 3}>
              {writingOff && <Loader2 className="h-4 w-4 animate-spin" />}
              Mark damaged
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryCard({
  history,
  mayWriteOff,
  onWriteOff,
  onShowProduct,
  onClose,
}: {
  history: SerialHistory;
  mayWriteOff: boolean;
  onWriteOff: () => void;
  onShowProduct: () => void;
  onClose: () => void;
}) {
  const w = warranty(history.expiryDate);
  const rows: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: "Product",
      value: (
        <>
          {history.productName}
          {history.variantName && <span className="text-muted-foreground"> · {history.variantName}</span>}
          <span className="block font-mono text-[11px] text-muted-foreground">{history.sku}</span>
        </>
      ),
    },
    { label: history.status === "sold" ? "Sold from" : "Branch", value: history.branchName ?? "—" },
    { label: "Received", value: formatDate(history.receivedAt) },
    {
      label: "Sold",
      value: history.saleNumber ? (
        <>
          <Link className="font-mono text-primary underline-offset-2 hover:underline" href={`/sales?q=${encodeURIComponent(history.saleNumber)}`}>
            {history.saleNumber}
          </Link>
          <span className="text-muted-foreground"> · {formatDate(history.soldAt)}</span>
          {history.customerId ? (
            <Link className="block text-primary underline-offset-2 hover:underline" href={`/customers/${history.customerId}`}>
              {history.customerName}
            </Link>
          ) : (
            <span className="block text-muted-foreground">Walk-in customer</span>
          )}
        </>
      ) : (
        <span className="text-muted-foreground">Not sold</span>
      ),
    },
    {
      label: "Warranty",
      value: w ? (
        <span className={cn("font-medium", w.expired ? "text-destructive" : "text-emerald-600 dark:text-emerald-400")}>{w.text}</span>
      ) : (
        <span className="text-muted-foreground">No expiry recorded</span>
      ),
    },
  ];

  return (
    <section aria-label={`History of serial ${history.serial}`} className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center gap-3 border-b border-border bg-secondary/40 px-4 py-3">
        <Barcode aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate font-mono text-base font-bold">{history.serial}</span>
        <StatusBadge status={history.status} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close history"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <dl className="divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[9rem_1fr] sm:gap-4">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:pt-0.5">{r.label}</dt>
            <dd className="min-w-0 text-foreground [overflow-wrap:anywhere]">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2 border-t border-border p-3">
        <Button variant="outline" size="sm" onClick={onShowProduct}>
          <PackageSearch className="h-3.5 w-3.5" />
          All serials of this product
        </Button>
        {mayWriteOff && (
          <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onWriteOff}>
            <ShieldAlert className="h-3.5 w-3.5" />
            Mark damaged
          </Button>
        )}
      </div>
    </section>
  );
}
