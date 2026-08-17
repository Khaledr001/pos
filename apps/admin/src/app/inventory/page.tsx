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
  Plus,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

// ── Types ─────────────────────────────────────────────────────────────────

interface StockRow {
  variantId: string;
  variantSku: string;
  variantName: string;
  productName: string;
  branchId: string;
  branchCode: string;
  quantity: number;
  minStock: number;
}

interface StockPage {
  items: StockRow[];
  total: number;
}

interface TxRow {
  id: string;
  createdAt: string;
  type: string;
  quantity: number;
  balanceAfter: number;
  variantSku: string;
  branchCode: string;
  reference?: string;
  notes?: string;
}

interface TxPage {
  items: TxRow[];
  total: number;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

// ── Component ─────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const { tokens } = useAuth();

  const [stock, setStock] = useState<StockRow[]>([]);
  const [transactions, setTransactions] = useState<TxRow[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loadingStock, setLoadingStock] = useState(true);
  const [loadingTx, setLoadingTx] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const fetchAll = useCallback(async () => {
    if (!tokens?.accessToken) return;
    setLoadingStock(true);
    setLoadingTx(true);
    setError(null);

    try {
      const [stockRes, txRes, branchRes] = await Promise.allSettled([
        api.get<StockPage>("/inventory", {
          accessToken: tokens.accessToken,
          query: { limit: 50, page: 1 },
        }),
        api.get<TxPage>("/inventory/transactions", {
          accessToken: tokens.accessToken,
          query: { limit: 20, page: 1 },
        }),
        api.get<{ items: Branch[] }>("/branches", {
          accessToken: tokens.accessToken,
        }),
      ]);

      if (stockRes.status === "fulfilled") {
        const val = stockRes.value as any;
        const list = Array.isArray(val) ? val : (val?.items ?? []);
        setStock(list);
        if (list[0]) {
          setAdjVariantId(list[0].variantId);
          setTrVariantId(list[0].variantId);
        }
      }
      if (txRes.status === "fulfilled") {
        const val = txRes.value as any;
        const list = Array.isArray(val) ? val : (val?.items ?? []);
        setTransactions(list);
      }
      if (branchRes.status === "fulfilled") {
        const val = branchRes.value as any;
        const bs = Array.isArray(val) ? val : (val?.items ?? []);
        setBranches(bs);
        if (bs[0]) {
          setAdjBranchId(bs[0].id);
          setTrFromBranch(bs[0].id);
        }
        if (bs[1]) {
          setTrToBranch(bs[1].id);
        }
      }
      if (stockRes.status === "rejected" && txRes.status === "rejected") {
        setError("Failed to load inventory data from API.");
      }
    } finally {
      setLoadingStock(false);
      setLoadingTx(false);
    }
  }, [tokens]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Unique list of variants from stock
  const uniqueVariants = React.useMemo(() => {
    const map = new Map<string, { variantId: string; variantSku: string; productName: string }>();
    for (const s of stock) {
      if (!map.has(s.variantId)) {
        map.set(s.variantId, { variantId: s.variantId, variantSku: s.variantSku, productName: s.productName });
      }
    }
    return Array.from(map.values());
  }, [stock]);

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
          <Button variant="outline" size="sm" onClick={fetchAll} disabled={loadingStock || loadingTx}>
            <RefreshCw className={cn("h-3.5 w-3.5", (loadingStock || loadingTx) && "animate-spin")} />
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
          <button onClick={() => setActionSuccess(null)} className="cursor-pointer">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {actionError && !isAdjustOpen && !isTransferOpen && (
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

      {/* Stock Table */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-0 border-b border-border bg-secondary/30">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
              <Boxes className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm">Branch Stock Balances</CardTitle>
              <CardDescription className="text-[11px]">Live quantities per variant per branch</CardDescription>
            </div>
          </div>
        </CardHeader>

        {loadingStock ? (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading stock from API...
          </CardContent>
        ) : stock.length === 0 ? (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No stock data found. Add products and record opening stock to get started.
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 text-right font-medium">Qty</th>
                  <th className="px-4 py-3 font-medium">Branch</th>
                  <th className="px-4 py-3 text-right font-medium">Min Stock</th>
                  <th className="px-4 py-3 text-center font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stock.slice(0, 50).map((row) => {
                  const isLow = row.quantity <= row.minStock && row.minStock > 0;
                  const pct = row.minStock > 0 ? Math.min((row.quantity / (row.minStock * 5)) * 100, 100) : 100;
                  return (
                    <tr key={`${row.variantId}-${row.branchId}`} className="hover:bg-secondary/30 transition-colors">
                      <td className="px-4 py-3.5 font-mono font-bold text-primary">{row.variantSku}</td>
                      <td className="px-4 py-3.5 font-medium text-foreground max-w-xs truncate">{row.productName}</td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden hidden sm:block">
                            <div
                              className={cn("h-full rounded-full", isLow ? "bg-amber-500" : "bg-emerald-500")}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={cn("font-mono font-bold", isLow ? "text-amber-500" : "text-emerald-500")}>
                            {row.quantity}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <Badge variant="secondary" className="font-mono text-[10px] font-bold">{row.branchCode}</Badge>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-muted-foreground">{row.minStock}</td>
                      <td className="px-4 py-3.5 text-center">
                        {isLow ? (
                          <Badge variant="warning" className="gap-1">
                            <AlertTriangle className="h-3 w-3" />Low Stock
                          </Badge>
                        ) : (
                          <Badge variant="success">In Stock</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Ledger */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-0 border-b border-border bg-secondary/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                <History className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Stock Movement Ledger</CardTitle>
                <CardDescription className="text-[11px]">Last 20 inventory transactions (immutable)</CardDescription>
              </div>
            </div>
            <Badge variant="outline" className="text-[10px] font-mono hidden md:inline-flex">inventory_transactions</Badge>
          </div>
        </CardHeader>

        {loadingTx ? (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading transactions...
          </CardContent>
        ) : transactions.length === 0 ? (
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No transactions found. Transactions are created automatically when sales, adjustments, or transfers occur.
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Branch</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 text-right font-medium">Movement</th>
                  <th className="px-4 py-3 text-right font-medium">Balance After</th>
                  <th className="px-4 py-3 font-medium">Reference / Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transactions.map((tx) => (
                  <tr key={tx.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3.5 text-muted-foreground">{formatTime(tx.createdAt)}</td>
                    <td className="px-4 py-3.5">
                      <Badge variant="secondary" className="text-[10px] font-bold">{tx.branchCode}</Badge>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground">
                        {tx.quantity < 0
                          ? <ArrowDown className="h-3 w-3 text-red-500" />
                          : <ArrowUp className="h-3 w-3 text-emerald-500" />}
                        <span className="text-[11px]">{tx.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">{tx.variantSku}</td>
                    <td className={cn("px-4 py-3.5 text-right font-bold", tx.quantity < 0 ? "text-red-500" : "text-emerald-500")}>
                      {tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}
                    </td>
                    <td className="px-4 py-3.5 text-right text-foreground">{tx.balanceAfter}</td>
                    <td className="px-4 py-3.5 text-muted-foreground truncate max-w-[200px]">
                      {tx.reference ?? tx.notes ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Adjust Stock Dialog ── */}
      <Dialog open={isAdjustOpen} onOpenChange={setIsAdjustOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white">
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
              <select
                required
                value={adjVariantId}
                onChange={(e) => setAdjVariantId(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">— Select variant —</option>
                {uniqueVariants.map((v) => (
                  <option key={v.variantId} value={v.variantId}>
                    {v.variantSku} · {v.productName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Branch Location *</label>
              <select
                required
                value={adjBranchId}
                onChange={(e) => setAdjBranchId(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">— Select branch —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
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
                {submitting ? "Applying..." : "Post Adjustment"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Inter-Branch Transfer Dialog ── */}
      <Dialog open={isTransferOpen} onOpenChange={setIsTransferOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                <ArrowRightLeft className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle>Inter-Branch Stock Transfer</DialogTitle>
                <DialogDescription>Move available units between stores and warehouses</DialogDescription>
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
              <select
                required
                value={trVariantId}
                onChange={(e) => setTrVariantId(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">— Select variant —</option>
                {uniqueVariants.map((v) => (
                  <option key={v.variantId} value={v.variantId}>
                    {v.variantSku} · {v.productName}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">From Branch *</label>
                <select
                  required
                  value={trFromBranch}
                  onChange={(e) => setTrFromBranch(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— Source —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} ({b.name.slice(0, 15)}...)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">To Branch *</label>
                <select
                  required
                  value={trToBranch}
                  onChange={(e) => setTrToBranch(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">— Destination —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.code} ({b.name.slice(0, 15)}...)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Quantity to Transfer *</label>
              <Input
                required
                type="number"
                min="1"
                step="1"
                value={trQty}
                onChange={(e) => setTrQty(e.target.value)}
                placeholder="e.g. 10"
                className="font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Transfer Notes (optional)</label>
              <Input
                value={trNotes}
                onChange={(e) => setTrNotes(e.target.value)}
                placeholder="e.g. Delivery via Store Van 3"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsTransferOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Transferring..." : "Complete Transfer"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
