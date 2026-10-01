import type { OrderStatus, OrderView, StoreInfo } from "@devsfleet/storefront-client";
import { AlertTriangle, Check, Download, ExternalLink, Store, Truck } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { ProductImage } from "@/components/ui/product-image";
import { cn } from "@/lib/cn";
import {
  addressLine,
  DELIVERY_METHOD,
  formatDate,
  formatDateTime,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  uomCount,
  uomShort,
  whatsappLink,
} from "@/lib/format";
import { OrderStatusBadge } from "./order-status";

/** Mirrors the backend lifecycle: forward steps may be skipped (placed → packed). */
const RANK: Partial<Record<OrderStatus, number>> = {
  PENDING_PAYMENT: 0,
  PLACED: 1,
  CONFIRMED: 2,
  PACKED: 3,
  SHIPPED: 4,
  READY_FOR_PICKUP: 4,
  DELIVERED: 5,
  COLLECTED: 5,
};

const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", hour: "2-digit", minute: "2-digit" });

function lastAt(order: OrderView, status: OrderStatus) {
  return order.timeline.filter((t) => t.status === status).at(-1)?.at ?? null;
}

function courierName(c: string) {
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function statusMessage(order: OrderView): { text: string; tone: "info" | "good" | "bad" } {
  const pickup = order.deliveryMethod === "PICKUP";
  const when = formatDate(lastAt(order, order.status));
  switch (order.status) {
    case "PENDING_PAYMENT":
      return { text: "We're waiting for your payment to be confirmed. This usually takes a few minutes.", tone: "info" };
    case "PLACED":
      return { text: "We've received your order and will confirm it shortly.", tone: "info" };
    case "CONFIRMED":
      return { text: "Your order is confirmed and we're preparing it.", tone: "info" };
    case "PACKED":
      return {
        text: pickup
          ? "Your order is packed. We'll message you as soon as it's ready to collect."
          : "Your order is packed and waiting for the courier.",
        tone: "info",
      };
    case "SHIPPED": {
      const s = order.shipments.at(-1);
      return { text: `Your order is on its way${s ? ` with ${courierName(s.courier)}` : ""}.`, tone: "info" };
    }
    case "READY_FOR_PICKUP":
      return {
        text: `Your order is ready to collect${order.pickup ? ` from ${order.pickup.branch.name}` : ""}. Show your order number at the counter.`,
        tone: "good",
      };
    case "DELIVERED":
      return { text: `Delivered${when ? ` on ${when}` : ""}.`, tone: "good" };
    case "COLLECTED":
      return { text: `Collected${when ? ` on ${when}` : ""}.`, tone: "good" };
    case "CANCELLED":
      return { text: `This order was cancelled${when ? ` on ${when}` : ""}. Nothing more will be sent.`, tone: "bad" };
    case "REFUNDED":
      return { text: `This order was refunded${when ? ` on ${when}` : ""}.`, tone: "bad" };
  }
}

function Progress({ order }: { order: OrderView }) {
  const pickup = order.deliveryMethod === "PICKUP";
  const ended = order.status === "CANCELLED" || order.status === "REFUNDED";
  const reachedRanks = order.timeline.map((t) => RANK[t.status]).filter((r): r is number => r !== undefined);
  const reached = RANK[order.status] ?? Math.max(0, ...reachedRanks);
  const steps = [
    { rank: 1, label: "Order placed" },
    { rank: 2, label: "Confirmed" },
    { rank: 3, label: "Packed" },
    { rank: 4, label: pickup ? "Ready for pickup" : "On its way" },
    { rank: 5, label: pickup ? "Collected" : "Delivered" },
  ].map((s) => {
    const entries = order.timeline.filter((t) => RANK[t.status] === s.rank);
    const at = entries.at(-1)?.at ?? (s.rank === 1 ? order.placedAt : null);
    return { ...s, at, notes: entries.map((e) => e.note).filter(Boolean) as string[], done: reached >= s.rank };
  });

  return (
    <ol className="grid gap-0 sm:grid-cols-5 sm:gap-2">
      {steps.map((s, i) => {
        const current = !ended && reached === s.rank;
        return (
          <li key={s.rank} aria-current={current ? "step" : undefined} className="relative flex gap-3 pb-5 last:pb-0 sm:flex-col sm:gap-2 sm:pb-0">
            {/* connector */}
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-[13px] top-7 bottom-0 w-0.5 sm:left-7 sm:right-[-0.5rem] sm:top-[13px] sm:bottom-auto sm:h-0.5 sm:w-auto",
                  steps[i + 1].done && !ended ? "bg-pipe" : "bg-galv",
                )}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-10 inline-flex size-7 shrink-0 items-center justify-center rounded-full border-2 font-cond text-sm font-bold",
                s.done ? (ended ? "border-steel-light bg-steel-light text-white" : "border-pipe bg-pipe text-white") : "border-galv bg-paper text-steel-light",
                current && "ring-4 ring-pipe/20",
              )}
            >
              {s.done ? <Check className="size-4" strokeWidth={3} /> : s.rank}
            </span>
            <span className="min-w-0">
              <span className={cn("block font-medium", !s.done && "text-steel")}>
                {s.label}
                <span className="sr-only">{s.done ? " (done)" : " (not yet)"}</span>
              </span>
              {s.done && s.at && <span className="block text-sm text-steel">{formatDateTime(s.at)}</span>}
              {s.notes.map((n) => (
                <span key={n} className="mt-0.5 block text-sm text-steel">
                  {n}
                </span>
              ))}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
      <h2 className="mb-3 flex items-center gap-2 text-xl">
        {icon}
        {title}
      </h2>
      <div className="space-y-1 text-[15px]">{children}</div>
    </section>
  );
}

/**
 * The full order: progress, items, totals, delivery, payment and invoice.
 * Shared by the account order page and the guest tracking page.
 */
export function OrderDetail({
  order,
  invoiceHref,
  store,
  actions,
  back,
}: {
  order: OrderView;
  invoiceHref: string | null;
  store: StoreInfo;
  actions?: ReactNode;
  back?: ReactNode;
}) {
  const pickup = order.deliveryMethod === "PICKUP";
  const message = statusMessage(order);
  const addr = order.shippingAddress;
  const cod = order.paymentMethod === "COD" && order.paymentStatus === "PENDING";
  const endTime = order.pickup?.slotEnd ? timeFmt.format(new Date(order.pickup.slotEnd)) : null;
  const { totals } = order;

  return (
    <div>
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl">
            Order <span className="font-cond">{order.orderNumber}</span>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-steel">
            <span>Placed {formatDate(order.placedAt ?? order.createdAt)}</span>
            <OrderStatusBadge status={order.status} />
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          {invoiceHref && order.invoice && (
            <a href={invoiceHref} className={buttonClass("secondary")}>
              <Download className="size-4" aria-hidden /> Download tax invoice
            </a>
          )}
          {actions}
        </div>
      </div>

      <section aria-labelledby="progress" className="mt-6 rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
        <h2 id="progress" className="sr-only">
          Order progress
        </h2>
        <p
          className={cn(
            "mb-5 flex items-start gap-2 rounded-[var(--radius-tag)] px-3 py-2 text-[15px]",
            message.tone === "good" && "bg-pipe-tint text-pipe-dark",
            message.tone === "bad" && "bg-signal-tint text-signal",
            message.tone === "info" && "bg-sheet",
          )}
        >
          {message.tone === "bad" && <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
          {message.text}
        </p>
        {order.status !== "PENDING_PAYMENT" && <Progress order={order} />}
        {order.shipments.length > 0 && (
          <ul className="mt-5 space-y-2 border-t border-galv pt-4">
            {order.shipments.map((s) => (
              <li key={`${s.courier}-${s.trackingNumber ?? s.createdAt}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px]">
                <span>
                  <span className="font-medium">{courierName(s.courier)}</span>
                  {s.trackingNumber && <span className="text-steel"> tracking number {s.trackingNumber}</span>}
                </span>
                {s.trackingUrl && (
                  <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-pipe hover:underline">
                    Track with {courierName(s.courier)} <ExternalLink className="size-3.5" aria-hidden />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section aria-labelledby="items" className="h-fit rounded-[var(--radius-panel)] border border-galv bg-paper px-5 pt-5">
          <h2 id="items" className="text-xl">
            {order.lines.length === 1 ? "1 item" : `${order.lines.length} items`}
          </h2>
          <ul className="divide-y divide-galv">
            {order.lines.map((l) => {
              const image = (
                <ProductImage image={l.imageUrl ? { url: l.imageUrl, alt: l.name } : null} name={l.name} brand="" sizes="64px" />
              );
              return (
                <li key={l.id} className="grid grid-cols-[56px_1fr] gap-3 py-4 sm:grid-cols-[64px_1fr_auto] sm:gap-4">
                  {l.productSlug ? (
                    <Link href={`/product/${l.productSlug}`} tabIndex={-1} aria-hidden className="block self-start overflow-hidden rounded-[var(--radius-tag)] border border-galv">
                      {image}
                    </Link>
                  ) : (
                    <div className="self-start overflow-hidden rounded-[var(--radius-tag)] border border-galv">{image}</div>
                  )}
                  <div className="min-w-0">
                    {l.productSlug ? (
                      <Link href={`/product/${l.productSlug}`} className="font-medium hover:underline">
                        {l.name}
                      </Link>
                    ) : (
                      <p className="font-medium">{l.name}</p>
                    )}
                    <p className="text-sm text-steel">SKU {l.sku}</p>
                    <p className="text-sm text-steel">
                      {uomCount(l.quantity, l.uom)} at {l.unitPrice.formatted} / {uomShort(l.uom)}
                    </p>
                  </div>
                  <p className="tag-price col-start-2 text-xl sm:col-start-3 sm:text-right">{l.lineTotal.formatted}</p>
                </li>
              );
            })}
          </ul>
          <dl className="space-y-2 border-t border-galv py-4 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-steel">Items (excl. VAT)</dt>
              <dd>{totals.subtotalNet.formatted}</dd>
            </div>
            {totals.discountNet.fils > 0 && (
              <div className="flex justify-between text-pipe">
                <dt>Discount{order.couponCode ? ` (${order.couponCode})` : ""}</dt>
                <dd>−{totals.discountNet.formatted}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-steel">{pickup ? "Store pickup" : "Delivery (excl. VAT)"}</dt>
              <dd>{totals.shippingNet.fils === 0 ? "Free" : totals.shippingNet.formatted}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-steel">VAT 5%</dt>
              <dd>{totals.vat.formatted}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-galv pt-3">
              <dt className="font-semibold">Total</dt>
              <dd className="tag-price text-3xl">{totals.total.formatted}</dd>
            </div>
          </dl>
        </section>

        <div className="space-y-4">
          {pickup && order.pickup ? (
            <Panel title="Store pickup" icon={<Store className="size-5 text-steel" aria-hidden />}>
              <p className="font-medium">{order.pickup.branch.name}</p>
              <p className="text-steel">{order.pickup.branch.address}</p>
              {order.pickup.branch.phone && (
                <p>
                  <a href={`tel:${order.pickup.branch.phone.replace(/\s/g, "")}`} className="text-pipe hover:underline">
                    {order.pickup.branch.phone}
                  </a>
                </p>
              )}
              {order.pickup.slotStart && (
                <p className="pt-1">
                  Pickup time: <strong>{formatDateTime(order.pickup.slotStart)}{endTime ? `–${endTime}` : ""}</strong>
                </p>
              )}
            </Panel>
          ) : (
            <Panel title={DELIVERY_METHOD[order.deliveryMethod]} icon={<Truck className="size-5 text-steel" aria-hidden />}>
              {addr ? (
                <>
                  <p className="font-medium">{addr.fullName}</p>
                  <p className="text-steel">{addressLine(addr)}</p>
                  {addr.landmark && <p className="text-steel">Near {addr.landmark}</p>}
                  {addr.phone && <p className="text-steel">{addr.phone}</p>}
                </>
              ) : (
                <p className="text-steel">No address on this order.</p>
              )}
            </Panel>
          )}

          <Panel title="Payment">
            <p className="font-medium">{PAYMENT_METHOD[order.paymentMethod]}</p>
            <p className="text-steel">
              {cod ? (pickup ? "Pay at the counter when you collect" : "Pay the driver on delivery") : PAYMENT_STATUS[order.paymentStatus]}
            </p>
          </Panel>

          <Panel title="Tax invoice">
            {order.companyName && <p className="font-medium">{order.companyName}</p>}
            {order.trn && <p className="text-steel">TRN {order.trn}</p>}
            {!order.companyName && !order.trn && <p className="text-steel">Issued to {order.contact.fullName}</p>}
            {order.invoice ? (
              <p className="text-steel">
                Invoice {order.invoice.number}, {formatDate(order.invoice.issuedAt)}
              </p>
            ) : (
              <p className="text-steel">The invoice will be ready once the order is confirmed.</p>
            )}
          </Panel>

          <Panel title="Contact">
            <p>{order.contact.fullName}</p>
            <p className="text-steel">{order.contact.email}</p>
            <p className="text-steel">{order.contact.phone}</p>
            {order.notes && (
              <p className="pt-2">
                <span className="text-steel">Your note: </span>
                {order.notes}
              </p>
            )}
          </Panel>

          <p className="px-1 text-sm text-steel">
            Questions about this order?{" "}
            {store.phone && (
              <>
                Call{" "}
                <a href={`tel:${store.phone.replace(/\s/g, "")}`} className="text-pipe hover:underline">
                  {store.phone}
                </a>
                {store.whatsapp ? " or " : " "}
              </>
            )}
            {store.whatsapp && (
              <a
                href={whatsappLink(store.whatsapp, `Hello, I have a question about order ${order.orderNumber}.`)}
                target="_blank"
                rel="noopener"
                className="text-pipe hover:underline"
              >
                message us on WhatsApp
              </a>
            )}{" "}
            and quote {order.orderNumber}.
          </p>
        </div>
      </div>
    </div>
  );
}
