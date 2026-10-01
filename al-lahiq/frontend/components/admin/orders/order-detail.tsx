"use client";

import type { AdminOrderView, OrderStatus } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { FileText, Printer } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, ButtonLink, buttonClass } from "@/components/ui/button";
import { FormError, TextAreaField, TextField } from "@/components/ui/field";
import { adminApi, errorMessage } from "@/lib/api-browser";
import {
  DELIVERY_METHOD,
  emirateName,
  formatDateTime,
  formatQty,
  ORDER_STATUS,
  PAYMENT_METHOD,
  uomShort,
} from "@/lib/format";
import { useAdminQuery, useInvalidate, useSetAdminData } from "../data";
import { STATUS_ACTION } from "../helpers";
import { ConfirmModal, Modal } from "../modal";
import { useCan } from "../staff-context";
import { useToast } from "../toast";
import { DataTable, ErrorState, Facts, Loading, Notice, num, OrderStatusBadge, PageHeader, Panel, PaymentStatusBadge } from "../ui";

export function actorLabel(actor: string | null) {
  if (!actor) return "System";
  if (actor.startsWith("staff:")) return "Staff member";
  if (actor === "customer") return "Customer";
  if (actor.startsWith("payment:")) return "Payment provider";
  if (actor.startsWith("pos")) return "POS";
  return actor.charAt(0).toUpperCase() + actor.slice(1);
}

export function addressLines(a: Record<string, string> | null) {
  if (!a) return [];
  return [a.fullName, a.building, a.street, a.area, emirateName(a.emirate), a.landmark && `Landmark: ${a.landmark}`, a.phone].filter(
    Boolean,
  ) as string[];
}

export function OrderDetail({ id }: { id: string }) {
  const path = `/admin/orders/${id}`;
  const { data: order, error, isPending, refetch } = useAdminQuery<AdminOrderView>(path);

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isPending) return <Loading label="Loading order" />;

  const pickup = order.deliveryMethod === "PICKUP";
  return (
    <>
      <PageHeader
        back={{ href: "/admin/orders", label: "All orders" }}
        title={`Order ${order.orderNumber}`}
        meta={
          <>
            <OrderStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
            <span>Placed {formatDateTime(order.placedAt ?? order.createdAt)}</span>
          </>
        }
        actions={
          <>
            {order.invoice && (
              <a
                href={`/api/v1/admin/orders/${order.id}/invoice.pdf`}
                target="_blank"
                rel="noopener"
                className={buttonClass("secondary", "sm")}
              >
                <FileText className="size-4" aria-hidden />
                Tax invoice (PDF)
              </a>
            )}
            <ButtonLink href={`/admin/orders/${order.id}/packing-slip`} variant="secondary" size="sm">
              <Printer className="size-4" aria-hidden />
              Print packing slip
            </ButtonLink>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel title="Items" flush>
            <ul className="divide-y divide-galv sm:hidden">
              {order.lines.map((l) => (
                <li key={l.id} className="px-4 py-3">
                  <p className="font-medium">{l.name}</p>
                  <p className="text-[13px] text-steel">
                    SKU <span className="font-mono text-ink">{l.sku}</span>
                    {l.priceListCode && (
                      <>
                        , price list <span className="font-mono text-ink">{l.priceListCode}</span>
                      </>
                    )}
                  </p>
                  <p className="mt-1 flex items-baseline justify-between gap-3 text-sm">
                    <span>
                      {formatQty(l.quantity)} {uomShort(l.uom)} at {l.unitPrice.formatted}
                    </span>
                    <span className="font-cond text-[16px] font-semibold">{l.lineTotal.formatted}</span>
                  </p>
                </li>
              ))}
              <li className="px-4 py-3">
                <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
                  <dt className="text-steel">Subtotal (excl. VAT)</dt>
                  <dd className="text-right font-cond font-semibold">{order.totals.subtotalNet.formatted}</dd>
                  {order.totals.discountNet.fils > 0 && (
                    <>
                      <dt className="text-steel">Discount{order.couponCode ? ` (${order.couponCode})` : ""}</dt>
                      <dd className="text-right font-cond font-semibold">− {order.totals.discountNet.formatted}</dd>
                    </>
                  )}
                  <dt className="text-steel">Delivery (excl. VAT)</dt>
                  <dd className="text-right font-cond font-semibold">{order.totals.shippingNet.formatted}</dd>
                  <dt className="text-steel">VAT 5%</dt>
                  <dd className="text-right font-cond font-semibold">{order.totals.vat.formatted}</dd>
                  <dt className="font-semibold">Total</dt>
                  <dd className="text-right font-cond text-xl font-bold">{order.totals.total.formatted}</dd>
                </dl>
              </li>
            </ul>
            <div className="hidden sm:block">
            <DataTable minWidth={680}>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col" className="!text-right">
                    Qty
                  </th>
                  <th scope="col" className="!text-right">
                    Unit price
                  </th>
                  <th scope="col" className="!text-right">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.productSlug ? (
                        <Link href={`/product/${l.productSlug}`} target="_blank" className="font-medium hover:underline">
                          {l.name}
                        </Link>
                      ) : (
                        <p className="font-medium">{l.name}</p>
                      )}
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-steel">
                        <span>
                          SKU <span className="font-mono text-ink">{l.sku}</span>
                        </span>
                        {l.priceListCode && (
                          <span>
                            Price list <span className="font-mono text-ink">{l.priceListCode}</span>
                          </span>
                        )}
                      </p>
                    </td>
                    <td className={num}>
                      {formatQty(l.quantity)} <span className="font-sans text-[13px] font-normal text-steel">{uomShort(l.uom)}</span>
                    </td>
                    <td className={num}>
                      {l.unitPrice.formatted}
                      <p className="font-sans text-[12px] font-normal text-steel">{l.unitNet.formatted} excl. VAT</p>
                    </td>
                    <td className={num}>{l.lineTotal.formatted}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-galv text-sm">
                <TotalRow label="Subtotal (excl. VAT)" value={order.totals.subtotalNet.formatted} />
                {order.totals.discountNet.fils > 0 && (
                  <TotalRow
                    label={`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`}
                    value={`− ${order.totals.discountNet.formatted}`}
                  />
                )}
                <TotalRow label={pickup ? "Delivery (pickup)" : "Delivery (excl. VAT)"} value={order.totals.shippingNet.formatted} />
                <TotalRow label="VAT 5%" value={order.totals.vat.formatted} />
                <TotalRow label="Total" value={order.totals.total.formatted} strong />
              </tfoot>
            </DataTable>
            </div>
          </Panel>

          <Panel title="History" flush>
            <ol className="divide-y divide-galv">
              {[...order.timeline].reverse().map((t, i) => (
                <li key={i} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5">
                  <div className="w-40 shrink-0">
                    <OrderStatusBadge status={t.status} />
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p>
                      {actorLabel(t.actor)}
                      <span className="text-steel">, {formatDateTime(t.at)}</span>
                    </p>
                    {t.note && <p className="mt-0.5 text-steel">{t.note}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>

          {order.shipments.length > 0 && (
            <Panel title="Shipments" flush>
              <DataTable minWidth={520}>
                <thead>
                  <tr>
                    <th scope="col">Courier</th>
                    <th scope="col">Tracking number</th>
                    <th scope="col">Status</th>
                    <th scope="col">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {order.shipments.map((s, i) => (
                    <tr key={i}>
                      <td>{s.courier === "manual" ? "Not specified" : s.courier}</td>
                      <td>
                        {s.trackingUrl ? (
                          <a href={s.trackingUrl} target="_blank" rel="noopener" className="font-mono text-pipe hover:underline">
                            {s.trackingNumber ?? "Track"}
                          </a>
                        ) : (
                          <span className="font-mono">{s.trackingNumber ?? "None"}</span>
                        )}
                      </td>
                      <td>{s.status.charAt(0) + s.status.slice(1).toLowerCase().replace(/_/g, " ")}</td>
                      <td>{formatDateTime(s.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </Panel>
          )}
        </div>

        <div className="order-first flex flex-col gap-4 lg:order-none">
          <StatusActions order={order} path={path} />

          <Panel title="Customer">
            <Facts
              items={[
                ["Name", order.contact.fullName],
                [
                  "Phone",
                  <a key="p" href={`tel:${order.contact.phone}`} className="text-pipe hover:underline">
                    {order.contact.phone}
                  </a>,
                ],
                [
                  "Email",
                  <a key="e" href={`mailto:${order.contact.email}`} className="break-all text-pipe hover:underline">
                    {order.contact.email}
                  </a>,
                ],
                ...(order.companyName ? ([["Company", order.companyName]] as [string, string][]) : []),
                ...(order.trn ? ([["TRN", <span key="t" className="font-mono">{order.trn}</span>]] as [string, ReactNode][]) : []),
              ]}
            />
          </Panel>

          <Panel title={DELIVERY_METHOD[order.deliveryMethod]}>
            {pickup && order.pickup ? (
              <div className="text-sm">
                <p className="font-semibold">{order.pickup.branch.name}</p>
                <p className="text-steel">{order.pickup.branch.address}</p>
                {order.pickup.slotStart && (
                  <p className="mt-2">
                    Pickup slot:{" "}
                    <span className="font-semibold">
                      {formatDateTime(order.pickup.slotStart)}
                      {order.pickup.slotEnd && ` to ${formatDateTime(order.pickup.slotEnd).split(", ").pop()}`}
                    </span>
                  </p>
                )}
              </div>
            ) : (
              <address className="text-sm not-italic">
                {addressLines(order.shippingAddress).map((l, i) => (
                  <p key={i} className={i === 0 ? "font-semibold" : undefined}>
                    {l}
                  </p>
                ))}
              </address>
            )}
            {order.notes && (
              <div className="mt-3 rounded-[var(--radius-tag)] bg-brass-tint px-3 py-2 text-sm">
                <p className="font-semibold">Customer note</p>
                <p className="whitespace-pre-line">{order.notes}</p>
              </div>
            )}
          </Panel>

          <Panel title="Payment">
            <Facts
              items={[
                ["Method", PAYMENT_METHOD[order.paymentMethod]],
                ["Status", <PaymentStatusBadge key="s" status={order.paymentStatus} />],
                ["Total", <span key="t" className="font-cond text-lg font-semibold">{order.totals.total.formatted}</span>],
                ...(order.invoice
                  ? ([["Tax invoice", `${order.invoice.number}, ${formatDateTime(order.invoice.issuedAt)}`]] as [string, string][])
                  : []),
              ]}
            />
            {order.paymentMethod === "COD" && order.paymentStatus !== "PAID" && (
              <p className="mt-3 text-sm text-steel">Collect {order.totals.total.formatted} in cash on delivery.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <tr>
      <th scope="row" colSpan={3} className={strong ? "text-right text-base font-semibold" : "text-right font-normal text-steel"}>
        {label}
      </th>
      <td className={strong ? `${num} text-xl` : num}>{value}</td>
    </tr>
  );
}

type StatusInput = { status: OrderStatus; note?: string; trackingNumber?: string; trackingUrl?: string; courier?: string };

function StatusActions({ order, path }: { order: AdminOrderView; path: string }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const setData = useSetAdminData();
  const canRefund = useCan("refund");
  const [note, setNote] = useState("");
  const [shipOpen, setShipOpen] = useState(false);
  const [confirm, setConfirm] = useState<"cancel" | "refund" | null>(null);

  const onDone = (o: AdminOrderView, msg: string) => {
    setData(path, o);
    void invalidate("/admin/orders", "/admin/reports/dashboard");
    setNote("");
    toast(msg);
  };

  const change = useMutation({
    mutationFn: (input: StatusInput) => adminApi.post<AdminOrderView>(`${path}/status`, input),
    onSuccess: (o, input) => {
      setShipOpen(false);
      setConfirm(null);
      onDone(o, `Order ${o.orderNumber} is now “${ORDER_STATUS[input.status]}”`);
    },
  });
  const refund = useMutation({
    mutationFn: () => adminApi.post<AdminOrderView>(`${path}/refund`),
    onSuccess: (o) => {
      setConfirm(null);
      onDone(o, `Refund sent for order ${o.orderNumber}`);
    },
  });

  const refundable =
    order.paymentStatus === "PAID" && ["CANCELLED", "DELIVERED", "COLLECTED"].includes(order.status);
  const steps = order.nextStatuses.filter((s) => s !== "CANCELLED");
  const cancellable = order.nextStatuses.includes("CANCELLED");
  const run = (status: OrderStatus) => {
    if (status === "SHIPPED") return setShipOpen(true);
    change.mutate({ status, note: note.trim() || undefined });
  };

  if (!order.nextStatuses.length && !(refundable && canRefund)) {
    return (
      <Panel title="Next step">
        <p className="text-sm text-steel">
          {order.status === "PENDING_PAYMENT"
            ? "Waiting for the customer to finish paying. Nothing to do yet."
            : "This order is complete. There's nothing left to do."}
        </p>
        {refundable && !canRefund && <p className="mt-2 text-sm text-steel">A manager can refund this order.</p>}
      </Panel>
    );
  }

  return (
    <Panel title="Next step" className="border-pipe/40">
      <div className="flex flex-col gap-3">
        {!shipOpen && !confirm && <FormError message={change.error ? errorMessage(change.error) : null} />}
        {order.nextStatuses.length > 0 && (
          <TextAreaField
            label="Note for the order history (optional)"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            hint="Staff only. The customer doesn't see it."
          />
        )}
        {steps.map((s, i) => (
          <Button
            key={s}
            variant={i === 0 ? "primary" : "secondary"}
            onClick={() => run(s)}
            loading={change.isPending && change.variables?.status === s}
            disabled={change.isPending}
          >
            {STATUS_ACTION[s] ?? ORDER_STATUS[s]}
          </Button>
        ))}
        {steps.length > 1 && (
          <p className="text-[13px] text-steel">You can skip steps: for example, mark an order as packed without confirming it first.</p>
        )}
        {cancellable && (
          <Button variant="ghost" className="text-signal hover:bg-signal-tint" onClick={() => setConfirm("cancel")} disabled={change.isPending}>
            Cancel order
          </Button>
        )}
        {refundable && canRefund && (
          <>
            <Notice tone="warning" title="This order was paid online">
              {order.status === "CANCELLED" ? "It's cancelled, so the customer should get their money back." : "Refund it if the customer returned the goods."}
            </Notice>
            <Button variant="danger" onClick={() => setConfirm("refund")}>
              Send refund
            </Button>
          </>
        )}
      </div>

      <ShipModal
        open={shipOpen}
        onClose={() => setShipOpen(false)}
        loading={change.isPending}
        error={shipOpen && change.error ? errorMessage(change.error) : null}
        defaultNote={note}
        onSubmit={(input) => change.mutate({ status: "SHIPPED", ...input })}
      />
      <ConfirmModal
        open={confirm === "cancel"}
        onClose={() => {
          setConfirm(null);
          change.reset();
        }}
        onConfirm={() => change.mutate({ status: "CANCELLED", note: note.trim() || undefined })}
        title={`Cancel order ${order.orderNumber}?`}
        confirmLabel="Cancel order"
        loading={change.isPending}
        error={confirm === "cancel" && change.error ? errorMessage(change.error) : null}
      >
        The customer is told their order is cancelled and reserved stock is released. This can&apos;t be undone.
        {order.paymentStatus === "PAID" && " The payment isn't refunded automatically: send the refund afterwards."}
      </ConfirmModal>
      <ConfirmModal
        open={confirm === "refund"}
        onClose={() => {
          setConfirm(null);
          refund.reset();
        }}
        onConfirm={() => refund.mutate()}
        title={`Refund ${order.totals.total.formatted}?`}
        confirmLabel="Send refund"
        loading={refund.isPending}
        error={refund.error ? errorMessage(refund.error) : null}
      >
        The full amount goes back to the customer&apos;s {PAYMENT_METHOD[order.paymentMethod].toLowerCase()} and the order is marked
        as refunded. This can&apos;t be undone.
      </ConfirmModal>
    </Panel>
  );
}

function ShipModal({
  open,
  onClose,
  onSubmit,
  loading,
  error,
  defaultNote,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: Omit<StatusInput, "status">) => void;
  loading: boolean;
  error: string | null;
  defaultNote: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Mark as shipped" description="The customer gets an email with the tracking details." size="sm">
      <ShipForm onSubmit={onSubmit} loading={loading} error={error} onCancel={onClose} defaultNote={defaultNote} />
    </Modal>
  );
}

function ShipForm({
  onSubmit,
  loading,
  error,
  onCancel,
  defaultNote,
}: {
  onSubmit: (input: Omit<StatusInput, "status">) => void;
  loading: boolean;
  error: string | null;
  onCancel: () => void;
  defaultNote: string;
}) {
  const [trackingNumber, setTrackingNumber] = useState("");
  const [courier, setCourier] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [note, setNote] = useState(defaultNote);
  const [urlError, setUrlError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const url = trackingUrl.trim();
    if (url && !/^https?:\/\/\S+\.\S+/.test(url)) {
      setUrlError("Enter the full tracking link, starting with https://");
      return;
    }
    setUrlError(null);
    onSubmit({
      trackingNumber: trackingNumber.trim(),
      courier: courier.trim() || undefined,
      trackingUrl: url || undefined,
      note: note.trim() || undefined,
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <FormError message={error} />
      <TextField
        label="Tracking number"
        required
        maxLength={100}
        value={trackingNumber}
        onChange={(e) => setTrackingNumber(e.target.value)}
        autoFocus
      />
      <TextField label="Courier (optional)" placeholder="e.g. Aramex" maxLength={60} value={courier} onChange={(e) => setCourier(e.target.value)} />
      <TextField
        label="Tracking link (optional)"
        type="url"
        placeholder="https://"
        value={trackingUrl}
        onChange={(e) => setTrackingUrl(e.target.value)}
        error={urlError}
      />
      <TextAreaField label="Note for the order history (optional)" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Go back
        </Button>
        <Button type="submit" loading={loading} disabled={!trackingNumber.trim()}>
          Mark as shipped
        </Button>
      </div>
    </form>
  );
}
