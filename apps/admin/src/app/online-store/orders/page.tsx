"use client";

import React, { useCallback, useState } from "react";
import { Globe, RefreshCw, Truck, Store, Undo2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  SortableTh, Table, TableBody, TableContainer, TableEmpty, TableHead,
  TablePagination, TableSearch, Th, numericCell,
} from "@/components/ui/data-table";
import { formatMoney } from "@/lib/format";
import { useTenantSettings } from "@/lib/tenant-settings";
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";
import { Field, Notice, PageHeader, StatusBadge, errorText, humanize, selectClass } from "../shared";

interface WebOrderRow {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  deliveryMethod: string;
  contactName: string;
  contactPhone: string;
  total: string;
  branchName: string;
  placedAt: string | null;
  createdAt: string;
}

interface Money { amount: string; formatted: string }

interface WebOrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  deliveryMethod: string;
  posStatus: string | null;
  contact: { fullName: string; email: string; phone: string };
  companyName: string | null;
  trn: string | null;
  shippingAddress: Record<string, string> | null;
  pickup: { branch: { name: string }; slotStart: string | null; slotEnd: string | null } | null;
  lines: { id: string; sku: string; name: string; uom: string; quantity: number; unitPrice: Money; lineTotal: Money }[];
  totals: { subtotalNet: Money; discountNet: Money; shippingNet: Money; vat: Money; total: Money };
  couponCode: string | null;
  notes: string | null;
  shipments: { courier: string; trackingNumber: string | null; trackingUrl: string | null; createdAt: string }[];
  timeline: { status: string; note: string | null; at: string }[];
  invoice: { number: string; issuedAt: string } | null;
  payments: { provider: string; method: string; amount: string; status: string }[];
  nextStatuses: string[];
  canRefund: boolean;
}

const FILTERS = ["", "PENDING_PAYMENT", "PLACED", "CONFIRMED", "PACKED", "SHIPPED", "READY_FOR_PICKUP", "DELIVERED", "COLLECTED", "CANCELLED"];
const HANDOVER = ["DELIVERED", "COLLECTED"];

export default function OnlineOrdersPage() {
  const { tokens } = useAuth();
  const mayWrite = usePermission("order:write");
  const mayRefund = usePermission("payment:write");

  const settings = useTenantSettings();
  const currency = settings.currency.base;
  const taxLabel = settings.tax.label;
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [selected, setSelected] = useState<WebOrderDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [handover, setHandover] = useState<string | null>(null);
  const [payMethod, setPayMethod] = useState("cash");
  const [cashSessionId, setCashSessionId] = useState("");
  const [payRef, setPayRef] = useState("");
  const [shipment, setShipment] = useState({ courier: "", trackingNumber: "", trackingUrl: "" });

  const PAGE_SIZE = 25;
  const auth = { accessToken: tokens?.accessToken };

  const list = useListQuery({ sortBy: "createdAt", sortOrder: "desc", filters: { status: "" } });
  const { q, page, sortBy, sortOrder } = list;
  const status = list.filters.status;

  const loadOrders = useCallback(
    async (signal: AbortSignal) => {
      const res = await api.get<{ items: WebOrderRow[]; total: number; countsByStatus: Record<string, number> }>(
        "/storefront-admin/orders",
        {
          accessToken: tokens?.accessToken,
          signal,
          query: { page, pageSize: PAGE_SIZE, status: status || undefined, q: q.trim() || undefined, sortBy, sortOrder },
        },
      );
      setCounts(res.countsByStatus ?? {});
      return readListResult<WebOrderRow>(res);
    },
    [tokens?.accessToken, page, status, q, sortBy, sortOrder],
  );
  const { items: rows, total, loading, initialLoading, error: loadError, reload: load } = useListData(loadOrders, list.ready);

  async function open(id: string) {
    setError(null);
    setHandover(null);
    try {
      setSelected(await api.get<WebOrderDetail>(`/storefront-admin/orders/${id}`, auth));
    } catch (err) {
      setError(errorText(err, "Failed to load the order."));
    }
  }

  async function move(to: string) {
    if (!selected) return;
    // Handing over a cash-on-delivery order needs to know how it was paid; ask first.
    if (HANDOVER.includes(to) && selected.paymentStatus !== "PAID" && handover !== to) {
      setHandover(to);
      return;
    }
    if (to === "CANCELLED" && !window.confirm(`Cancel ${selected.orderNumber}? Its stock is released straight away.`)) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { status: to };
      if (HANDOVER.includes(to) && selected.paymentStatus !== "PAID") {
        body.payment = {
          method: payMethod,
          ...(payMethod === "cash" && cashSessionId.trim() ? { cashSessionId: cashSessionId.trim() } : {}),
          ...(payRef.trim() ? { reference: payRef.trim() } : {}),
        };
      }
      const next = await api.post<WebOrderDetail>(`/storefront-admin/orders/${selected.id}/status`, body, auth);
      setSelected(next);
      setHandover(null);
      setSuccess(`${next.orderNumber} is now ${humanize(next.status).toLowerCase()}.${next.invoice && HANDOVER.includes(to) ? ` Invoice ${next.invoice.number} issued.` : ""}`);
      void load();
    } catch (err) {
      setError(errorText(err, "That change was refused."));
    } finally {
      setBusy(false);
    }
  }

  async function addShipment() {
    if (!selected || !shipment.courier.trim()) return;
    setBusy(true);
    try {
      const next = await api.post<WebOrderDetail>(
        `/storefront-admin/orders/${selected.id}/shipments`,
        {
          courier: shipment.courier.trim(),
          ...(shipment.trackingNumber.trim() ? { trackingNumber: shipment.trackingNumber.trim() } : {}),
          ...(shipment.trackingUrl.trim() ? { trackingUrl: shipment.trackingUrl.trim() } : {}),
        },
        auth,
      );
      setSelected(next);
      setShipment({ courier: "", trackingNumber: "", trackingUrl: "" });
    } catch (err) {
      setError(errorText(err, "Could not add the shipment."));
    } finally {
      setBusy(false);
    }
  }

  async function refund() {
    if (!selected || !window.confirm(`Refund ${selected.totals.total.formatted} to the shopper's card?`)) return;
    setBusy(true);
    try {
      const next = await api.post<WebOrderDetail>(`/storefront-admin/orders/${selected.id}/refund`, {}, auth);
      setSelected(next);
      setSuccess(`${next.orderNumber} refunded.`);
      void load();
    } catch (err) {
      setError(errorText(err, "The refund failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Online Orders" description="Orders placed on your website. They hold stock like any other order and become a sale when handed over.">
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </PageHeader>

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && !selected && <Notice kind="error" message={error} onClose={() => setError(null)} />}
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <span>{loadError}</span>
          <Button variant="outline" size="sm" onClick={load}>Retry</Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f || "all"}
            type="button"
            aria-pressed={status === f}
            onClick={() => list.setFilter("status", f)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs cursor-pointer transition-colors",
              status === f ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f ? humanize(f) : "All"}
            {f && counts[f] ? <span className="ml-1.5 opacity-70">{counts[f]}</span> : null}
          </button>
        ))}
      </div>

      <TableSearch
        className="max-w-sm"
        value={list.search}
        onChange={list.setSearch}
        label="Search online orders"
        placeholder="Order number, name, email or phone"
      />

      <Card className="overflow-hidden">
        <TableContainer>
          <Table>
            <TableHead>
              <tr>
                <SortableTh column="orderNumber" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Order</SortableTh>
                <Th>Customer</Th>
                <Th>Delivery</Th>
                <Th>Payment</Th>
                <Th>Status</Th>
                <SortableTh column="total" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} firstOrder="desc" align="right">Total ({currency})</SortableTh>
              </tr>
            </TableHead>
            <TableBody
              columns={6}
              loading={initialLoading}
              empty={
                <TableEmpty
                  columns={6}
                  icon={Globe}
                  title={q ? "No matching online orders" : `No online orders ${status ? `that are ${humanize(status).toLowerCase()}` : "yet"}`}
                  description={q ? `Nothing matches "${q}".` : undefined}
                />
              }
            >
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => void open(r.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open order ${r.orderNumber}`}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void open(r.id);
                    }
                  }}
                  className={cn(
                    "cursor-pointer hover:bg-secondary/30 transition-colors focus:bg-secondary/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    loading && "opacity-60",
                  )}
                >
                  <td className="px-4 py-3.5">
                    <div className="font-mono font-medium text-foreground">{r.orderNumber}</div>
                    <div className="text-muted-foreground tabular-nums">{new Date(r.placedAt ?? r.createdAt).toLocaleString("en-AE")}</div>
                  </td>
                  <td className="px-4 py-3.5"><div className="text-foreground">{r.contactName}</div><div className="text-muted-foreground">{r.contactPhone}</div></td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-1.5">
                      {r.deliveryMethod === "PICKUP" ? <Store aria-hidden="true" className="h-3.5 w-3.5" /> : <Truck aria-hidden="true" className="h-3.5 w-3.5" />}
                      {r.deliveryMethod === "PICKUP" ? `Pickup · ${r.branchName}` : "Courier"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5"><div>{humanize(r.paymentMethod)}</div><StatusBadge status={r.paymentStatus} /></td>
                  <td className="px-4 py-3.5"><StatusBadge status={r.status} /></td>
                  <td className={cn("px-4 py-3.5 font-medium text-foreground", numericCell)}>{formatMoney(r.total)}</td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun="orders" />
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selected.orderNumber} <StatusBadge status={selected.status} />
                </DialogTitle>
                <DialogDescription>
                  {humanize(selected.deliveryMethod)} · {humanize(selected.paymentMethod)} ({humanize(selected.paymentStatus).toLowerCase()})
                  {selected.posStatus ? ` · POS order ${selected.posStatus}` : ""}
                </DialogDescription>
              </DialogHeader>

              {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}

              <div className="grid gap-4 md:grid-cols-2 text-xs">
                <div className="space-y-1">
                  <div className="font-semibold text-foreground">Customer</div>
                  <div>{selected.contact.fullName}</div>
                  <div className="text-muted-foreground">{selected.contact.email} · {selected.contact.phone}</div>
                  {selected.companyName && <div className="text-muted-foreground">{selected.companyName}{selected.trn ? ` · TRN ${selected.trn}` : ""}</div>}
                </div>
                <div className="space-y-1">
                  <div className="font-semibold text-foreground">{selected.pickup ? "Pickup" : "Deliver to"}</div>
                  {selected.pickup ? (
                    <div>{selected.pickup.branch.name}{selected.pickup.slotStart ? ` · ${new Date(selected.pickup.slotStart).toLocaleString("en-AE")}` : ""}</div>
                  ) : selected.shippingAddress ? (
                    <div className="text-muted-foreground">
                      {[selected.shippingAddress.building, selected.shippingAddress.street, selected.shippingAddress.area, humanize(selected.shippingAddress.emirate ?? "")].filter(Boolean).join(", ")}
                      {selected.shippingAddress.landmark ? ` (${selected.shippingAddress.landmark})` : ""}
                    </div>
                  ) : null}
                </div>
              </div>

              <table className="w-full text-left text-xs">
                <thead className="border-b border-border text-muted-foreground">
                  <tr><th className="py-2 font-medium">Item</th><th className="py-2 font-medium text-right">Qty</th><th className="py-2 font-medium text-right">Unit</th><th className="py-2 font-medium text-right">Total</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {selected.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2"><div className="text-foreground">{l.name}</div><div className="font-mono text-muted-foreground">{l.sku}</div></td>
                      <td className="py-2 text-right">{l.quantity} {l.uom}</td>
                      <td className="py-2 text-right">{l.unitPrice.formatted}</td>
                      <td className="py-2 text-right">{l.lineTotal.formatted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ml-auto w-64 space-y-1 text-xs">
                <Row label="Subtotal (net)" value={selected.totals.subtotalNet.formatted} />
                {selected.totals.discountNet.amount !== "0.00" && <Row label={`Discount${selected.couponCode ? ` (${selected.couponCode})` : ""}`} value={`− ${selected.totals.discountNet.formatted}`} />}
                {selected.totals.shippingNet.amount !== "0.00" && <Row label="Delivery (net)" value={selected.totals.shippingNet.formatted} />}
                <Row label={taxLabel} value={selected.totals.vat.formatted} />
                <Row label="Total" value={selected.totals.total.formatted} strong />
                {selected.invoice && <Row label="Tax invoice" value={selected.invoice.number} />}
              </div>

              {selected.notes && <p className="rounded-lg bg-secondary/50 p-3 text-xs">{selected.notes}</p>}

              {selected.deliveryMethod === "COURIER" && (
                <div className="space-y-2 text-xs">
                  <div className="font-semibold text-foreground">Shipments</div>
                  {selected.shipments.length === 0 && <div className="text-muted-foreground">None yet.</div>}
                  {selected.shipments.map((s, i) => (
                    <div key={i}>{s.courier}{s.trackingNumber ? ` · ${s.trackingNumber}` : ""}{s.trackingUrl ? <> · <a className="text-primary underline" href={s.trackingUrl} target="_blank" rel="noreferrer">track</a></> : null}</div>
                  ))}
                  {mayWrite && !["CANCELLED", "REFUNDED", "DELIVERED"].includes(selected.status) && (
                    <div className="grid gap-2 sm:grid-cols-4">
                      <Input placeholder="Courier" value={shipment.courier} onChange={(e) => setShipment((s) => ({ ...s, courier: e.target.value }))} />
                      <Input placeholder="Tracking number" value={shipment.trackingNumber} onChange={(e) => setShipment((s) => ({ ...s, trackingNumber: e.target.value }))} />
                      <Input placeholder="Tracking link" value={shipment.trackingUrl} onChange={(e) => setShipment((s) => ({ ...s, trackingUrl: e.target.value }))} />
                      <Button size="sm" variant="outline" disabled={busy || !shipment.courier.trim()} onClick={() => void addShipment()}>Add shipment</Button>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1 text-xs">
                <div className="font-semibold text-foreground">Timeline</div>
                {selected.timeline.map((t, i) => (
                  <div key={i} className="flex gap-2"><span className="w-36 shrink-0 text-muted-foreground">{new Date(t.at).toLocaleString("en-AE")}</span><span>{humanize(t.status)}{t.note ? ` — ${t.note}` : ""}</span></div>
                ))}
              </div>

              {handover && (
                <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                  <div className="text-xs font-semibold text-foreground">How was this {formatMoney(selected.totals.total.amount, { currency })} cash-on-delivery order paid?</div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Method">
                      <select className={selectClass} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                        <option value="cash">Cash (into a till)</option>
                        <option value="card">Card at the counter</option>
                        <option value="bank_transfer">Bank transfer (courier remittance)</option>
                      </select>
                    </Field>
                    {payMethod === "cash" && (
                      <Field label="Cash session" hint="The open drawer the cash goes into.">
                        <Input value={cashSessionId} onChange={(e) => setCashSessionId(e.target.value)} placeholder="Session id" />
                      </Field>
                    )}
                    <Field label="Reference"><Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Optional" /></Field>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy} onClick={() => void move(handover)}>Confirm {humanize(handover).toLowerCase()} and invoice</Button>
                    <Button size="sm" variant="outline" onClick={() => setHandover(null)}>Back</Button>
                  </div>
                </div>
              )}

              <DialogFooter className="flex-wrap gap-2">
                {mayWrite && !handover && selected.nextStatuses.map((s) => (
                  <Button key={s} size="sm" variant={s === "CANCELLED" ? "destructive" : HANDOVER.includes(s) ? "default" : "outline"} disabled={busy} onClick={() => void move(s)}>
                    {s === "CANCELLED" ? "Cancel order" : `Mark ${humanize(s).toLowerCase()}`}
                  </Button>
                ))}
                {mayWrite && mayRefund && selected.canRefund && (
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => void refund()}>
                    <Undo2 className="h-3.5 w-3.5" /> Refund payment
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "border-t border-border pt-1 font-semibold text-foreground")}>
      <span className="text-muted-foreground">{label}</span><span>{value}</span>
    </div>
  );
}
