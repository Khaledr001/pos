"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Boxes,
  History,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  SlidersHorizontal,
  ArrowRightLeft,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";
import {
  SortableTh, Table, TableBody, TableContainer, TableEmpty, TableHead,
  TablePagination, TableSearch, Th, numericCell,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow, MobileSort, listCard } from "@/components/ui/mobile-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ─────────────────────────────────────────────────────────────────

/** `GET /inventory`. Quantities are numeric strings, as every numeric column is. */
interface StockRow {
  variantId: string;
  sku: string;
  variantName: string;
  productName: string;
  unitAbbr: string;
  branchId: string;
  branchName: string;
  quantity: string;
  available: string;
  minStock: string;
}

/** `GET /inventory/transactions`. */
interface TxRow {
  id: string;
  createdAt: string;
  type: string;
  quantity: string;
  balanceAfter: string;
  sku: string;
  productName: string;
  branchName: string;
  referenceType?: string | null;
  notes?: string | null;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

/**
 * "85.0000" → "85", "2.5000" → "2.5". Trimmed as a string: a quantity column
 * holding four decimals of trailing zeros is unreadable, and going through a
 * float to drop them would be the one place a quantity could pick up an error.
 */
function formatQty(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

const STOCK_PAGE_SIZE = 50;
const TX_PAGE_SIZE = 20;

// ── Component ─────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const { tokens } = useAuth();

  const list = useListQuery({
    sortBy: "productName",
    sortOrder: "asc",
    filters: { branch: "", low: "" },
  });
  const { q, page, sortBy, sortOrder } = list;
  const branchFilter = list.filters.branch;
  const lowOnly = list.filters.low === "1";

  const loadStock = useCallback(
    async (signal: AbortSignal) =>
      readListResult<StockRow>(
        await api.get<unknown>("/inventory", {
          accessToken: tokens?.accessToken,
          signal,
          query: {
            q: q.trim() || undefined,
            page,
            limit: STOCK_PAGE_SIZE,
            sortBy,
            sortOrder,
            branchId: branchFilter || undefined,
            lowStockOnly: lowOnly || undefined,
          },
        }),
      ),
    [tokens?.accessToken, q, page, sortBy, sortOrder, branchFilter, lowOnly],
  );
  const stockList = useListData(loadStock, list.ready && Boolean(tokens?.accessToken));
  const stock = stockList.items;

  // The ledger pages on its own, outside the URL: it is a feed beside the
  // table, and two page numbers in one query string would be ambiguous.
  const [txPage, setTxPage] = useState(1);
  const loadTx = useCallback(
    async (signal: AbortSignal) =>
      readListResult<TxRow>(
        await api.get<unknown>("/inventory/transactions", {
          accessToken: tokens?.accessToken,
          signal,
          query: { limit: TX_PAGE_SIZE, page: txPage },
        }),
      ),
    [tokens?.accessToken, txPage],
  );
  const txList = useListData(loadTx, Boolean(tokens?.accessToken));
  const transactions = txList.items;

  const [branches, setBranches] = useState<Branch[]>([]);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const error = stockList.error ?? txList.error;

  // Dialogs
  const [isAdjustOpen, setIsAdjustOpen] = useState(false);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Adjust Form
  const [adjVariantId, setAdjVariantId] = useState("");
  const [adjBranchId, setAdjBranchId] = useState("");
  const [adjNewQty, setAdjNewQty] = useState("");
  const [adjReason, setAdjReason] = useState("");

  // Transfer Form
  const [trVariantId, setTrVariantId] = useState("");
  const [trFromBranch, setTrFromBranch] = useState("");
  const [trToBranch, setTrToBranch] = useState("");
  const [trQty, setTrQty] = useState("");
  const [trNotes, setTrNotes] = useState("");

  useEffect(() => {
    if (!tokens?.accessToken) return;
    api
      .get<{ items: Branch[] } | Branch[]>("/branches", { accessToken: tokens.accessToken })
      .then((val) => {
        const bs = Array.isArray(val) ? val : (val?.items ?? []);
        setBranches(bs);
        if (bs[0]) {
          setAdjBranchId((cur) => cur || bs[0]!.id);
          setTrFromBranch((cur) => cur || bs[0]!.id);
        }
        if (bs[1]) setTrToBranch((cur) => cur || bs[1]!.id);
      })
      .catch(() => {
        // The table still works without the branch filter; the dialogs say what is missing.
      });
  }, [tokens?.accessToken]);

  const fetchAll = useCallback(() => {
    stockList.reload();
    txList.reload();
  }, [stockList.reload, txList.reload]);

  // The dialogs offer the variants on screen — search the table to bring another into reach.
  const uniqueVariants = React.useMemo(() => {
    const map = new Map<string, { variantId: string; sku: string; productName: string }>();
    for (const s of stock) {
      if (!map.has(s.variantId)) {
        map.set(s.variantId, { variantId: s.variantId, sku: s.sku, productName: s.productName });
      }
    }
    return Array.from(map.values());
  }, [stock]);

  useEffect(() => {
    const first = uniqueVariants[0]?.variantId;
    if (!first) return;
    setAdjVariantId((cur) => cur || first);
    setTrVariantId((cur) => cur || first);
  }, [uniqueVariants]);

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjVariantId || !adjBranchId || adjNewQty === "" || !adjReason.trim()) {
      setActionError("Please fill all required adjustment fields.");
      return;
    }

    setSubmitting(true);
    setActionError(null);
    try {
      await api.post(
        "/inventory/adjust",
        {
          variantId: adjVariantId,
          branchId: adjBranchId,
          newQuantity: parseFloat(adjNewQty),
          reason: adjReason.trim(),
        },
        { accessToken: tokens?.accessToken }
      );
      setActionSuccess("Stock quantity adjusted successfully.");
      setIsAdjustOpen(false);
      setAdjNewQty("");
      setAdjReason("");
      fetchAll();
    } catch (err: any) {
      setActionError(err?.message || "Failed to adjust stock.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trVariantId || !trFromBranch || !trToBranch || !trQty || parseFloat(trQty) <= 0) {
      setActionError("Please provide valid transfer parameters.");
      return;
    }
    if (trFromBranch === trToBranch) {
      setActionError("Source and destination branch cannot be the same.");
      return;
    }

    setSubmitting(true);
    setActionError(null);
    try {
      await api.post(
        "/inventory/transfer",
        {
          variantId: trVariantId,
          fromBranchId: trFromBranch,
          toBranchId: trToBranch,
          quantity: parseFloat(trQty),
          notes: trNotes.trim() || undefined,
        },
        { accessToken: tokens?.accessToken }
      );
      setActionSuccess("Stock transferred successfully between branches.");
      setIsTransferOpen(false);
      setTrQty("");
      setTrNotes("");
      fetchAll();
    } catch (err: any) {
      setActionError(err?.message || "Failed to transfer stock.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-AE", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return iso;
    }
  };

  const refreshing = stockList.loading || txList.loading;

  // Below md the card frame comes off (listCard); its header goes with it, so
  // the search and filters line up with the phone cards under them.
  const listCardHeader = "pb-4 border-b border-border bg-secondary/30 max-md:border-0 max-md:bg-transparent max-md:px-0 max-md:pt-0";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Multi-Branch Inventory</h1>
            <Badge variant="secondary">Append-Only Ledger</Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Real-time stock balances across all branches. Updates are audited through immutable database transactions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={refreshing}>
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setActionError(null); setIsTransferOpen(true); }}>
            <ArrowRightLeft className="h-3.5 w-3.5" />
            Transfer Stock
          </Button>
          <Button size="sm" onClick={() => { setActionError(null); setIsAdjustOpen(true); }}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Adjust Stock
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
      {((actionError && !isAdjustOpen && !isTransferOpen) || error) && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{actionError ?? error}</span>
          </div>
          {actionError && (
            <button onClick={() => setActionError(null)} className="cursor-pointer" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Stock Table */}
      <Card className={listCard}>
        <CardHeader className={listCardHeader}>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-emerald-500 to-teal-600 text-white">
              <Boxes className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm">Branch Stock Balances</CardTitle>
              <CardDescription className="text-[11px]">Live quantities per variant per branch</CardDescription>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <TableSearch
              value={list.search}
              onChange={list.setSearch}
              label="Search stock"
              placeholder="Search by product name, SKU, or barcode..."
              className="flex-1 sm:min-w-56"
            />
            <MobileSort
              options={[
                { column: "productName", label: "Product" },
                { column: "sku", label: "SKU" },
                { column: "available", label: "Available" },
                { column: "branchName", label: "Branch" },
              ]}
              sortBy={sortBy}
              sortOrder={sortOrder}
              onChange={list.setSort}
            />
            <Select
              value={branchFilter || "all"}
              onValueChange={(v) => list.setFilter("branch", v === "all" ? "" : v)}
            >
              <SelectTrigger className="h-10 text-xs sm:w-56" aria-label="Filter by branch">
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant={lowOnly ? "default" : "outline"}
              size="sm"
              className="h-10"
              aria-pressed={lowOnly}
              onClick={() => list.setFilter("low", lowOnly ? "" : "1")}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Low stock only
            </Button>
          </div>
        </CardHeader>

        <MobileList
          loading={stockList.initialLoading}
          empty={
            <MobileEmpty
              icon={Boxes}
              title="No stock found"
              description={
                list.q || branchFilter || lowOnly
                  ? "Nothing matches this filter."
                  : "Add products and record opening stock to get started."
              }
            />
          }
        >
          {stock.map((row) => {
            const isLow = Number(row.minStock) > 0 && Number(row.available) <= Number(row.minStock);
            return (
              <MobileRow
                key={`${row.variantId}-${row.branchId}`}
                title={row.sku}
                subtitle={row.productName}
                badge={
                  isLow ? (
                    <Badge variant="warning" className="gap-1">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />Low
                    </Badge>
                  ) : (
                    <Badge variant="success">In Stock</Badge>
                  )
                }
                fields={[
                  {
                    label: "Product",
                    value:
                      row.variantName && row.variantName !== "Default"
                        ? `${row.productName} · ${row.variantName}`
                        : row.productName,
                  },
                  {
                    label: "Available",
                    value: (
                      <span className={cn("font-bold", isLow ? "text-amber-500" : "text-emerald-500")}>
                        {formatQty(row.available)} {row.unitAbbr}
                      </span>
                    ),
                    numeric: true,
                  },
                  { label: "Min stock", value: formatQty(row.minStock), numeric: true },
                  { label: "Branch", value: row.branchName },
                ]}
              />
            );
          })}
        </MobileList>

        <TableContainer className="hidden md:block">
          <Table>
            <TableHead>
              <tr>
                <SortableTh column="sku" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>SKU</SortableTh>
                <SortableTh column="productName" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Product</SortableTh>
                <SortableTh column="available" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} align="right">Available</SortableTh>
                <SortableTh column="branchName" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Branch</SortableTh>
                <Th align="right">Min Stock</Th>
                <Th align="center">Status</Th>
              </tr>
            </TableHead>
            <TableBody
              columns={6}
              loading={stockList.initialLoading}
              empty={
                <TableEmpty
                  columns={6}
                  icon={Boxes}
                  title="No stock found"
                  description={
                    list.q || branchFilter || lowOnly
                      ? "Nothing matches this filter."
                      : "Add products and record opening stock to get started."
                  }
                />
              }
            >
              {stock.map((row) => {
                const available = Number(row.available);
                const min = Number(row.minStock);
                const isLow = min > 0 && available <= min;
                const pct = min > 0 ? Math.min((available / (min * 5)) * 100, 100) : 100;
                return (
                  <tr
                    key={`${row.variantId}-${row.branchId}`}
                    className={cn("hover:bg-secondary/30 transition-colors", stockList.loading && "opacity-60")}
                  >
                    <td className="px-4 py-3.5 font-mono font-bold text-primary whitespace-nowrap">{row.sku}</td>
                    <td className="px-4 py-3.5 font-medium text-foreground max-w-xs">
                      <div className="truncate" title={row.productName}>{row.productName}</div>
                      {row.variantName && row.variantName !== "Default" && (
                        <div className="text-[11px] font-normal text-muted-foreground">{row.variantName}</div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden hidden sm:block" aria-hidden="true">
                          <div
                            className={cn("h-full rounded-full", isLow ? "bg-amber-500" : "bg-emerald-500")}
                            style={{ width: `${Math.max(pct, 0)}%` }}
                          />
                        </div>
                        <span className={cn("font-mono font-bold tabular-nums", isLow ? "text-amber-500" : "text-emerald-500")}>
                          {formatQty(row.available)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{row.unitAbbr}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant="secondary" className="text-[10px] font-semibold max-w-48 truncate" title={row.branchName}>
                        {row.branchName}
                      </Badge>
                    </td>
                    <td className={cn("px-4 py-3.5 text-muted-foreground", numericCell)}>{formatQty(row.minStock)}</td>
                    <td className="px-4 py-3.5 text-center">
                      {isLow ? (
                        <Badge variant="warning" className="gap-1">
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />Low Stock
                        </Badge>
                      ) : (
                        <Badge variant="success">In Stock</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          page={page}
          pageSize={STOCK_PAGE_SIZE}
          total={stockList.total}
          onPageChange={list.setPage}
          noun="stock lines"
        />
      </Card>

      {/* Ledger */}
      <Card className={listCard}>
        <CardHeader className={listCardHeader}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-violet-500 to-purple-600 text-white">
                <History className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Stock Movement Ledger</CardTitle>
                <CardDescription className="text-[11px]">Every inventory transaction, newest first (immutable)</CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono hidden md:inline-flex">inventory_transactions</Badge>
          </div>
        </CardHeader>

        <MobileList
          loading={txList.initialLoading}
          empty={
            <MobileEmpty
              icon={History}
              title="No transactions yet"
              description="Transactions are created automatically when sales, adjustments, or transfers occur."
            />
          }
        >
          {transactions.map((tx) => {
            const outgoing = tx.quantity.trim().startsWith("-");
            return (
              <MobileRow
                key={tx.id}
                title={<span className="font-mono">{tx.sku}</span>}
                subtitle={tx.type}
                badge={
                  <Badge variant={outgoing ? "destructive" : "success"} className="font-mono tabular-nums">
                    {outgoing ? formatQty(tx.quantity) : `+${formatQty(tx.quantity)}`}
                  </Badge>
                }
                fields={[
                  { label: "Time", value: formatTime(tx.createdAt) },
                  { label: "Product", value: tx.productName },
                  { label: "Branch", value: tx.branchName },
                  { label: "Balance after", value: formatQty(tx.balanceAfter), numeric: true },
                  { label: "Reference", value: tx.notes ?? tx.referenceType ?? "—" },
                ]}
              />
            );
          })}
        </MobileList>

        <TableContainer className="hidden md:block">
          <Table className="font-mono">
            <TableHead>
              <tr>
                <Th>Time</Th>
                <Th>Branch</Th>
                <Th>Type</Th>
                <Th>SKU</Th>
                <Th align="right">Movement</Th>
                <Th align="right">Balance After</Th>
                <Th>Reference / Notes</Th>
              </tr>
            </TableHead>
            <TableBody
              columns={7}
              loading={txList.initialLoading}
              empty={
                <TableEmpty
                  columns={7}
                  icon={History}
                  title="No transactions yet"
                  description="Transactions are created automatically when sales, adjustments, or transfers occur."
                />
              }
            >
              {transactions.map((tx) => {
                const outgoing = tx.quantity.trim().startsWith("-");
                return (
                  <tr key={tx.id} className={cn("hover:bg-secondary/30 transition-colors", txList.loading && "opacity-60")}>
                    <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap tabular-nums">{formatTime(tx.createdAt)}</td>
                    <td className="px-4 py-3.5">
                      <Badge variant="secondary" className="text-[10px] font-bold max-w-40 truncate" title={tx.branchName}>
                        {tx.branchName}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground">
                        {outgoing
                          ? <ArrowDown className="h-3 w-3 text-red-500" aria-hidden="true" />
                          : <ArrowUp className="h-3 w-3 text-emerald-500" aria-hidden="true" />}
                        <span className="text-[11px]">{tx.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground whitespace-nowrap" title={tx.productName}>{tx.sku}</td>
                    <td className={cn("px-4 py-3.5 font-bold", numericCell, outgoing ? "text-red-500" : "text-emerald-500")}>
                      {outgoing ? formatQty(tx.quantity) : `+${formatQty(tx.quantity)}`}
                    </td>
                    <td className={cn("px-4 py-3.5 text-foreground", numericCell)}>{formatQty(tx.balanceAfter)}</td>
                    <td className="px-4 py-3.5 text-muted-foreground truncate max-w-50" title={tx.notes ?? undefined}>
                      {tx.notes ?? tx.referenceType ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          page={txPage}
          pageSize={TX_PAGE_SIZE}
          total={txList.total}
          onPageChange={setTxPage}
          noun="movements"
        />
      </Card>

      {/* ── Adjust Stock Dialog ── */}
      <Dialog open={isAdjustOpen} onOpenChange={setIsAdjustOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-amber-500 to-orange-600 text-white">
                <SlidersHorizontal className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle>Stock Count Adjustment</DialogTitle>
                <DialogDescription>Set absolute shelf quantity with an audited reason</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {actionError && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /><span>{actionError}</span>
            </div>
          )}

          <form onSubmit={handleAdjust} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Product / Variant *</label>
              <Select value={adjVariantId} onValueChange={setAdjVariantId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="— Select Variant —" />
                </SelectTrigger>
                <SelectContent>
                  {uniqueVariants.map((v) => (
                    <SelectItem key={v.variantId} value={v.variantId}>
                      {v.sku} · {v.productName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Branch Location *</label>
              <Select value={adjBranchId} onValueChange={setAdjBranchId}>
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
              <label className="block text-xs font-medium text-foreground mb-1.5">New Absolute Quantity on Shelf *</label>
              <Input
                required
                type="number"
                step="1"
                value={adjNewQty}
                onChange={(e) => setAdjNewQty(e.target.value)}
                placeholder="e.g. 45"
                className="font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Reason for Adjustment *</label>
              <Input
                required
                value={adjReason}
                onChange={(e) => setAdjReason(e.target.value)}
                placeholder="e.g. Physical inventory count variance / Damaged items"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAdjustOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Applying…" : "Post Adjustment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Inter-Branch Transfer Modal ────────────────────────────────────── */}
      <Dialog open={isTransferOpen} onOpenChange={setIsTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ArrowRightLeft className="size-5" />
              </div>
              <div>
                <DialogTitle>Transfer Stock Between Branches</DialogTitle>
                <DialogDescription>Move physical stock from one branch to another immediately.</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {actionError && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" /><span>{actionError}</span>
            </div>
          )}

          <form onSubmit={handleTransfer} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Product SKU *</label>
              <Select value={trVariantId} onValueChange={setTrVariantId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="— Select Variant —" />
                </SelectTrigger>
                <SelectContent>
                  {uniqueVariants.map((v) => (
                    <SelectItem key={v.variantId} value={v.variantId}>
                      {v.sku} · {v.productName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">From Branch *</label>
                <Select value={trFromBranch} onValueChange={setTrFromBranch}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="— Source —" />
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
                <label className="block text-xs font-medium text-foreground mb-1.5">To Branch *</label>
                <Select value={trToBranch} onValueChange={setTrToBranch}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="— Destination —" />
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
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Transfer Quantity *</label>
              <Input
                required
                type="number"
                min="0.001"
                step="any"
                value={trQty}
                onChange={(e) => setTrQty(e.target.value)}
                placeholder="e.g. 25"
                className="font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Transfer Notes (Optional)</label>
              <Input
                value={trNotes}
                onChange={(e) => setTrNotes(e.target.value)}
                placeholder="Reference # or driver info"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsTransferOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Transferring…" : "Execute Transfer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
