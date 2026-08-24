"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Truck,
  Plus,
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle2,
  Search,
  Trash2,
  ArrowRight,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
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

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface TransferItem {
  variantId: string;
  quantity: string;
  productName: string;
  sku: string;
}

interface Transfer {
  id: string;
  transferNumber: string;
  fromBranchId: string;
  toBranchId: string;
  status: "requested" | "approved" | "shipped" | "received" | "cancelled";
  createdAt: string;
  notes: string | null;
  items: TransferItem[];
}

interface VariantResult {
  id: string;
  sku: string;
  productName: string;
  variantName: string | null;
}

const STATUS_TONE: Record<Transfer["status"], "success" | "warning" | "secondary" | "destructive" | "outline"> = {
  requested: "warning",
  approved: "outline",
  shipped: "secondary",
  received: "success",
  cancelled: "destructive",
};

export default function TransfersPage() {
  const { tokens } = useAuth();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);

  const branchLabel = useCallback(
    (id: string) => {
      const b = branches.find((br) => br.id === id);
      return b ? `${b.name} (${b.code})` : id;
    },
    [branches],
  );

  const fetchTransfers = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      // The API's TransformInterceptor hoists a paginated { items, meta }
      // response so `data` IS the items array directly, and discards meta —
      // apiFetch only ever returns `data`. Matches every other paginated
      // list in this admin app.
      const res = await api.get<Transfer[]>("/transfers", {
        accessToken: tokens?.accessToken,
        query: { status: statusFilter || undefined, limit: 50 },
      });
      const list = Array.isArray(res) ? res : [];
      setTransfers(list);
      setTotal(list.length);
    } catch (err: any) {
      setActionError(err?.message || "Failed to load transfers from the API.");
    } finally {
      setLoading(false);
    }
  }, [tokens, statusFilter]);

  useEffect(() => {
    if (!tokens?.accessToken) return;
    api
      .get<Branch[]>("/branches", { accessToken: tokens.accessToken })
      .then((res) => setBranches((res as any)?.items ?? res ?? []))
      .catch(() => undefined);
  }, [tokens]);

  useEffect(() => {
    fetchTransfers();
  }, [fetchTransfers]);

  const runAction = async (transfer: Transfer, action: "approve" | "ship" | "receive") => {
    setBusyId(transfer.id);
    setActionError(null);
    try {
      await api.post(`/transfers/${transfer.id}/${action}`, undefined, { accessToken: tokens?.accessToken });
      setActionSuccess(`Transfer ${transfer.transferNumber} ${action === "approve" ? "approved" : action === "ship" ? "shipped" : "received"}.`);
      fetchTransfers();
    } catch (err: any) {
      setActionError(err?.message || `Failed to ${action} the transfer.`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Stock Transfers</h1>
            {total > 0 && <Badge variant="secondary">{total} transfers</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Request stock from another branch — requested, approved, shipped, received.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Select value={statusFilter || "all"} onValueChange={(val) => setStatusFilter(val === "all" ? "" : val)}>
            <SelectTrigger className="w-[150px] h-9 text-xs">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(["requested", "approved", "shipped", "received", "cancelled"] as const).map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchTransfers} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setActionError(null); setIsModalOpen(true); }}>
            <Plus className="h-4 w-4" />
            Request Transfer
          </Button>
        </div>
      </div>

      {actionSuccess && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /><span>{actionSuccess}</span></div>
          <button onClick={() => setActionSuccess(null)} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {actionError && (
        <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2"><AlertCircle className="h-4 w-4" /><span>{actionError}</span></div>
          <button onClick={() => setActionError(null)} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading transfers...
          </div>
        ) : transfers.length === 0 ? (
          <div className="py-16 text-center">
            <Truck className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">No transfers found</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">Request stock from another branch to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3.5 font-medium">Transfer #</th>
                  <th className="px-4 py-3.5 font-medium">Route</th>
                  <th className="px-4 py-3.5 font-medium">Items</th>
                  <th className="px-4 py-3.5 text-center font-medium">Status</th>
                  <th className="px-4 py-3.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transfers.map((t) => (
                  <tr key={t.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3.5 font-mono font-bold text-primary">{t.transferNumber}</td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-foreground">
                        {branchLabel(t.fromBranchId)}
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        {branchLabel(t.toBranchId)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {t.items.length} line{t.items.length === 1 ? "" : "s"}
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <Badge variant={STATUS_TONE[t.status]} className="text-[10px] capitalize">{t.status}</Badge>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      {t.status === "requested" && (
                        <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={() => runAction(t, "approve")}>
                          Approve
                        </Button>
                      )}
                      {t.status === "approved" && (
                        <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={() => runAction(t, "ship")}>
                          Ship
                        </Button>
                      )}
                      {t.status === "shipped" && (
                        <Button size="sm" variant="outline" disabled={busyId === t.id} onClick={() => runAction(t, "receive")}>
                          Receive
                        </Button>
                      )}
                      {(t.status === "received" || t.status === "cancelled") && (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <RequestTransferDialog
        open={isModalOpen}
        branches={branches}
        onClose={() => setIsModalOpen(false)}
        onCreated={(message) => {
          setIsModalOpen(false);
          setActionSuccess(message);
          fetchTransfers();
        }}
      />
    </div>
  );
}

function RequestTransferDialog({
  open,
  branches,
  onClose,
  onCreated,
}: {
  open: boolean;
  branches: Branch[];
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const { tokens } = useAuth();
  const [fromBranchId, setFromBranchId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [items, setItems] = useState<Array<{ variantId: string; sku: string; productName: string; quantity: string }>>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<VariantResult[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFromBranchId(branches[0]?.id ?? "");
    setToBranchId(branches[1]?.id ?? "");
    setItems([]);
    setSearchQuery("");
    setResults([]);
    setNotes("");
    setError(null);
  }, [open, branches]);

  useEffect(() => {
    if (!searchQuery.trim() || !tokens?.accessToken) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api
        .get<VariantResult[]>("/products/search", {
          accessToken: tokens.accessToken,
          query: { q: searchQuery, limit: 8 },
        })
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [searchQuery, tokens]);

  const addItem = (variant: VariantResult) => {
    if (items.some((i) => i.variantId === variant.id)) return;
    setItems((prev) => [
      ...prev,
      { variantId: variant.id, sku: variant.sku, productName: variant.productName, quantity: "1" },
    ]);
    setSearchQuery("");
    setResults([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromBranchId || !toBranchId) {
      setError("Choose both branches.");
      return;
    }
    if (fromBranchId === toBranchId) {
      setError("Source and destination branches must differ.");
      return;
    }
    if (items.length === 0) {
      setError("Add at least one item.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(
        "/transfers",
        {
          fromBranchId,
          toBranchId,
          items: items.map((i) => ({ variantId: i.variantId, quantity: Number(i.quantity) })),
          notes: notes || undefined,
        },
        { accessToken: tokens?.accessToken },
      );
      onCreated("Transfer requested.");
    } catch (err: any) {
      setError(err?.message || "Failed to request the transfer.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
              <Truck className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>Request Stock Transfer</DialogTitle>
              <DialogDescription>Pulls from another branch — needs approval before it ships.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">From Branch *</label>
              <Select value={fromBranchId} onValueChange={setFromBranchId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="— Select Origin —" />
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
              <Select value={toBranchId} onValueChange={setToBranchId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="— Select Destination —" />
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

          <div className="relative">
            <label className="block text-xs font-medium text-foreground mb-1.5">Add items</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or SKU..."
                className="pl-9"
              />
            </div>
            {results.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg max-h-48 overflow-y-auto">
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => addItem(r)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-secondary/50 cursor-pointer"
                  >
                    <span className="font-medium text-foreground truncate">{r.productName}</span>
                    <span className="font-mono text-muted-foreground ml-2 shrink-0">{r.sku}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 && (
            <div className="rounded-xl border border-border divide-y divide-border">
              {items.map((item, idx) => (
                <div key={item.variantId} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{item.productName}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{item.sku}</p>
                  </div>
                  <Input
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={item.quantity}
                    onChange={(e) => {
                      const value = e.target.value;
                      setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, quantity: value } : it)));
                    }}
                    className="w-24 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-muted-foreground hover:text-destructive cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-foreground mb-1.5">Notes</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Requesting..." : "Request Transfer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
