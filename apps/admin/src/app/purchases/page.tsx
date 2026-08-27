"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Package,
  Plus,
  RefreshCw,
  X,
  AlertCircle,
  CheckCircle2,
  Search,
  Trash2,
  Send,
  Ban,
  PackageCheck,
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

interface Branch { id: string; name: string; code: string; }
interface Supplier { id: string; name: string; company?: string | null; }
interface VariantResult { id: string; sku: string; productName: string; variantName: string | null; }

type POStatus = "draft" | "sent" | "partial" | "received" | "cancelled";

interface PurchaseOrder {
  id: string;
  poNumber: string;
  status: POStatus;
  supplierName: string;
  total: string;
  expectedDate: string | null;
  createdAt: string;
}

interface POLine {
  id: string;
  variantId: string;
  productName: string;
  productSku: string;
  quantity: string;
  receivedQuantity: string;
  unitPrice: string;
}

interface PODetail {
  id: string;
  poNumber: string;
  status: POStatus;
  branchId: string;
  supplierId: string;
  total: string;
  shippingAmount: string;
  items: POLine[];
}

const STATUS_TONE: Record<POStatus, "secondary" | "warning" | "outline" | "success" | "destructive"> = {
  draft: "secondary",
  sent: "warning",
  partial: "outline",
  received: "success",
  cancelled: "destructive",
};

function money(value: string | null | undefined): string {
  return Number(value ?? "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PurchasesPage() {
  const { tokens } = useAuth();

  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [receivingId, setReceivingId] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setActionError(null);
    try {
      const res = await api.get<{ items: PurchaseOrder[]; total: number }>("/purchases", {
        accessToken: tokens?.accessToken,
        query: { status: statusFilter || undefined, pageSize: 50 },
      });
      setOrders(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (err: any) {
      setActionError(err?.message || "Failed to load purchase orders from the API.");
    } finally {
      setLoading(false);
    }
  }, [tokens, statusFilter]);

  useEffect(() => {
    if (!tokens?.accessToken) return;
    Promise.allSettled([
      api.get<Branch[]>("/branches", { accessToken: tokens.accessToken }),
      api.get<{ items: Supplier[] }>("/suppliers", { accessToken: tokens.accessToken }),
    ]).then(([branchRes, supplierRes]) => {
      if (branchRes.status === "fulfilled") setBranches((branchRes.value as any)?.items ?? branchRes.value ?? []);
      if (supplierRes.status === "fulfilled") setSuppliers((supplierRes.value as any)?.items ?? []);
    });
  }, [tokens]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const runAction = async (order: PurchaseOrder, action: "send" | "cancel") => {
    setBusyId(order.id);
    setActionError(null);
    try {
      await api.post(`/purchases/${order.id}/${action}`, undefined, { accessToken: tokens?.accessToken });
      setActionSuccess(`Order ${order.poNumber} ${action === "send" ? "sent" : "cancelled"}.`);
      fetchOrders();
    } catch (err: any) {
      setActionError(err?.message || `Failed to ${action} the order.`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Purchase Orders</h1>
            {total > 0 && <Badge variant="secondary">{total} orders</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Order from a supplier, receive the delivery, see what it actually cost landed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Select value={statusFilter || "all"} onValueChange={(val) => setStatusFilter(val === "all" ? "" : val)}>
            <SelectTrigger className="w-37.5 h-9 text-xs">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(["draft", "sent", "partial", "received", "cancelled"] as const).map((s) => (
                <SelectItem key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchOrders} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setActionError(null); setCreating(true); }}>
            <Plus className="h-4 w-4" />
            New Order
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
            Loading purchase orders...
          </div>
        ) : orders.length === 0 ? (
          <div className="py-16 text-center">
            <Package className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">No purchase orders found</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">Order stock from a supplier to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3.5 font-medium">PO #</th>
                  <th className="px-4 py-3.5 font-medium">Supplier</th>
                  <th className="px-4 py-3.5 text-right font-medium">Total</th>
                  <th className="px-4 py-3.5 text-center font-medium">Status</th>
                  <th className="px-4 py-3.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3.5 font-mono font-bold text-primary">{o.poNumber}</td>
                    <td className="px-4 py-3.5 text-foreground">{o.supplierName}</td>
                    <td className="px-4 py-3.5 text-right font-mono font-semibold">AED {money(o.total)}</td>
                    <td className="px-4 py-3.5 text-center">
                      <Badge variant={STATUS_TONE[o.status]} className="text-[10px] capitalize">{o.status}</Badge>
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {o.status === "draft" && (
                          <Button size="sm" variant="outline" disabled={busyId === o.id} onClick={() => runAction(o, "send")}>
                            <Send className="h-3 w-3" /> Send
                          </Button>
                        )}
                        {(o.status === "draft" || o.status === "sent" || o.status === "partial") && (
                          <Button size="sm" variant="outline" disabled={busyId === o.id} onClick={() => setReceivingId(o.id)}>
                            <PackageCheck className="h-3 w-3" /> Receive
                          </Button>
                        )}
                        {(o.status === "draft" || o.status === "sent") && (
                          <Button size="sm" variant="ghost" disabled={busyId === o.id} onClick={() => runAction(o, "cancel")} className="text-muted-foreground hover:text-destructive">
                            <Ban className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CreateOrderDialog
        open={creating}
        branches={branches}
        suppliers={suppliers}
        onClose={() => setCreating(false)}
        onCreated={(message) => {
          setCreating(false);
          setActionSuccess(message);
          fetchOrders();
        }}
      />

      <ReceiveDialog
        orderId={receivingId}
        onClose={() => setReceivingId(null)}
        onReceived={(message) => {
          setReceivingId(null);
          setActionSuccess(message);
          fetchOrders();
        }}
      />
    </div>
  );
}

function CreateOrderDialog({
  open,
  branches,
  suppliers,
  onClose,
  onCreated,
}: {
  open: boolean;
  branches: Branch[];
  suppliers: Supplier[];
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const { tokens } = useAuth();
  const [branchId, setBranchId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [shippingAmount, setShippingAmount] = useState("0");
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Array<{ variantId: string; sku: string; productName: string; quantity: string; unitPrice: string }>>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState<VariantResult[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBranchId(branches[0]?.id ?? "");
    setSupplierId(suppliers[0]?.id ?? "");
    setShippingAmount("0");
    setExpectedDate("");
    setNotes("");
    setItems([]);
    setSearchQuery("");
    setResults([]);
    setError(null);
  }, [open, branches, suppliers]);

  useEffect(() => {
    if (!searchQuery.trim() || !tokens?.accessToken) {
      setResults([]);
      return;
    }
    const handle = setTimeout(() => {
      api
        .get<VariantResult[]>("/products/search", { accessToken: tokens.accessToken, query: { q: searchQuery, limit: 8 } })
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [searchQuery, tokens]);

  const addItem = (variant: VariantResult) => {
    if (items.some((i) => i.variantId === variant.id)) return;
    setItems((prev) => [...prev, { variantId: variant.id, sku: variant.sku, productName: variant.productName, quantity: "1", unitPrice: "0" }]);
    setSearchQuery("");
    setResults([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) { setError("Choose a supplier."); return; }
    if (items.length === 0) { setError("Add at least one item."); return; }
    setSubmitting(true);
    setError(null);
    try {
      await api.post(
        "/purchases",
        {
          branchId: branchId || undefined,
          supplierId,
          lines: items.map((i) => ({ variantId: i.variantId, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) })),
          shippingAmount: Number(shippingAmount) || 0,
          expectedDate: expectedDate || undefined,
          notes: notes || undefined,
        },
        { accessToken: tokens?.accessToken },
      );
      onCreated("Purchase order created.");
    } catch (err: any) {
      setError(err?.message || "Failed to create the purchase order.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-indigo-600 text-white">
              <Package className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>New Purchase Order</DialogTitle>
              <DialogDescription>Created as a draft — send it once you&apos;re ready.</DialogDescription>
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
              <label className="block text-xs font-medium text-foreground mb-1.5">Supplier *</label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="— Select Supplier —" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Receiving Branch</label>
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
              <label className="block text-xs font-medium text-foreground mb-1.5">Expected Date</label>
              <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Shipping / Freight</label>
              <Input type="number" min="0" step="0.01" value={shippingAmount} onChange={(e) => setShippingAmount(e.target.value)} className="font-mono" />
            </div>
          </div>

          <div className="relative">
            <label className="block text-xs font-medium text-foreground mb-1.5">Add items</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search by name or SKU..." className="pl-9" />
            </div>
            {results.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg max-h-48 overflow-y-auto">
                {results.map((r) => (
                  <button key={r.id} type="button" onClick={() => addItem(r)} className="flex w-full items-center justify-between px-3 py-2 text-left text-xs hover:bg-secondary/50 cursor-pointer">
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
                <div key={item.variantId} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">{item.productName}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{item.sku}</p>
                  </div>
                  <Input
                    type="number" min="0.0001" step="0.0001" value={item.quantity}
                    onChange={(e) => { const v = e.target.value; setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, quantity: v } : it))); }}
                    className="w-20 font-mono" placeholder="Qty"
                  />
                  <Input
                    type="number" min="0" step="0.01" value={item.unitPrice}
                    onChange={(e) => { const v = e.target.value; setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, unitPrice: v } : it))); }}
                    className="w-24 font-mono" placeholder="Cost"
                  />
                  <button type="button" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-destructive cursor-pointer">
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
            <Button type="submit" disabled={submitting}>{submitting ? "Creating..." : "Create Order"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ReceiptResult {
  grnNumber: string;
  items: Array<{ productName: string; sku: string; quantity: string; landedUnitCost: string }>;
}

function ReceiveDialog({
  orderId,
  onClose,
  onReceived,
}: {
  orderId: string | null;
  onClose: () => void;
  onReceived: (message: string) => void;
}) {
  const { tokens } = useAuth();
  const [order, setOrder] = useState<PODetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [lines, setLines] = useState<Array<{ purchaseOrderItemId: string; variantId: string; productName: string; sku: string; remaining: string; quantity: string; damagedQuantity: string }>>([]);
  const [shippingAmount, setShippingAmount] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptResult | null>(null);

  useEffect(() => {
    if (!orderId) {
      setOrder(null);
      return;
    }
    setLoading(true);
    setError(null);
    setReceipt(null);
    api
      .get<PODetail>(`/purchases/${orderId}`, { accessToken: tokens?.accessToken })
      .then((data) => {
        setOrder(data);
        setLines(
          data.items
            .filter((item) => Number(item.quantity) - Number(item.receivedQuantity) > 0)
            .map((item) => {
              const remaining = String(Number(item.quantity) - Number(item.receivedQuantity));
              return {
                purchaseOrderItemId: item.id,
                variantId: item.variantId,
                productName: item.productName,
                sku: item.productSku,
                remaining,
                quantity: remaining,
                damagedQuantity: "0",
              };
            }),
        );
        setShippingAmount("");
        setInvoiceNumber("");
      })
      .catch((err) => setError(err?.message || "Failed to load the order."))
      .finally(() => setLoading(false));
  }, [orderId, tokens]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.post<ReceiptResult>(
        "/purchases/receive",
        {
          purchaseOrderId: order.id,
          branchId: order.branchId,
          lines: lines
            .filter((l) => Number(l.quantity) > 0)
            .map((l) => ({
              purchaseOrderItemId: l.purchaseOrderItemId,
              variantId: l.variantId,
              quantity: Number(l.quantity),
              damagedQuantity: Number(l.damagedQuantity) || 0,
            })),
          ...(shippingAmount ? { shippingAmount: Number(shippingAmount) } : {}),
          ...(invoiceNumber ? { supplierInvoiceNumber: invoiceNumber } : {}),
        },
        { accessToken: tokens?.accessToken },
      );
      // Shown before closing, not passed straight to onReceived — landed
      // cost per line is the whole reason this receipt exists to be seen.
      setReceipt(result);
    } catch (err: any) {
      setError(err?.message || "Failed to record the delivery.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={orderId !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-emerald-500 to-teal-600 text-white">
              <PackageCheck className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle>Receive Delivery{order ? ` — ${order.poNumber}` : ""}</DialogTitle>
              <DialogDescription>Moves stock and spreads freight across lines by value.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
          </div>
        )}

        {receipt ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /><span>Receipt {receipt.grnNumber} recorded. Stock and cost updated.</span>
            </div>
            <div className="rounded-xl border border-border divide-y divide-border">
              {receipt.items.map((item) => (
                <div key={`${item.sku}-${item.quantity}`} className="flex items-center justify-between px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{item.productName}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{item.sku} · {item.quantity} received</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-muted-foreground">Landed unit cost</p>
                    <p className="font-mono font-semibold text-foreground">AED {money(item.landedUnitCost)}</p>
                  </div>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onReceived(`Delivery received against ${order?.poNumber}.`)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : loading ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Loading...</p>
        ) : lines.length === 0 ? (
          <p className="py-8 text-center text-xs text-muted-foreground">Nothing left to receive on this order.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-xl border border-border divide-y divide-border">
              {lines.map((line, idx) => (
                <div key={line.purchaseOrderItemId} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground truncate">{line.productName}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{line.sku} · {line.remaining} remaining</p>
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground">Receiving</label>
                    <Input
                      type="number" min="0" step="0.0001" value={line.quantity}
                      onChange={(e) => { const v = e.target.value; setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, quantity: v } : l))); }}
                      className="w-20 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted-foreground">Damaged</label>
                    <Input
                      type="number" min="0" step="0.0001" value={line.damagedQuantity}
                      onChange={(e) => { const v = e.target.value; setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, damagedQuantity: v } : l))); }}
                      className="w-20 font-mono"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Freight on this delivery</label>
                <Input type="number" min="0" step="0.01" value={shippingAmount} onChange={(e) => setShippingAmount(e.target.value)} placeholder="Uses order's figure if blank" className="font-mono" />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Supplier Invoice #</label>
                <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Optional" />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? "Recording..." : "Confirm Delivery"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
