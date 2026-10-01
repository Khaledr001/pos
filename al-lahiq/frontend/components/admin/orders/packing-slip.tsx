"use client";

import type { AdminOrderView } from "@al-lahiq/api-client";
import { Printer } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { DELIVERY_METHOD, formatDateTime, formatQty, PAYMENT_METHOD, uomCount } from "@/lib/format";
import { useAdminQuery } from "../data";
import { ErrorState, Loading } from "../ui";
import { addressLines } from "./order-detail";

/** Print-friendly picking list: what to pick, how many, and where it goes. */
export function PackingSlip({ id, storeName, storePhone }: { id: string; storeName: string; storePhone: string | null }) {
  const { data: order, error, isPending, refetch } = useAdminQuery<AdminOrderView>(`/admin/orders/${id}`);
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isPending) return <Loading label="Loading order" />;

  const pickup = order.deliveryMethod === "PICKUP";
  const cod = order.paymentMethod === "COD" && order.paymentStatus !== "PAID";
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <ButtonLink href={`/admin/orders/${order.id}`} variant="ghost" size="sm">
          Back to order {order.orderNumber}
        </ButtonLink>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden />
          Print packing slip
        </Button>
      </div>

      <article className="mx-auto max-w-3xl rounded-[var(--radius-panel)] border border-galv bg-paper p-6 sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-ink pb-4">
          <div>
            <p className="text-sm text-steel">{storeName}</p>
            <h1 className="text-[34px] leading-none">Packing slip</h1>
          </div>
          <div className="text-right">
            <p className="font-cond text-[34px] font-bold leading-none">{order.orderNumber}</p>
            <p className="mt-1 text-sm text-steel">Placed {formatDateTime(order.placedAt ?? order.createdAt)}</p>
          </div>
        </header>

        <section className="grid gap-6 border-b border-galv py-4 sm:grid-cols-2 print:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold text-steel">{pickup ? "Store pickup" : "Deliver to"}</h2>
            {pickup && order.pickup ? (
              <div className="mt-1">
                <p className="text-lg font-semibold">{order.pickup.branch.name}</p>
                <p>{order.pickup.branch.address}</p>
                {order.pickup.slotStart && (
                  <p className="mt-1 font-semibold">
                    Slot: {formatDateTime(order.pickup.slotStart)}
                    {order.pickup.slotEnd && ` to ${formatDateTime(order.pickup.slotEnd).split(", ").pop()}`}
                  </p>
                )}
              </div>
            ) : (
              <address className="mt-1 not-italic">
                {addressLines(order.shippingAddress).map((l, i) => (
                  <p key={i} className={i === 0 ? "text-lg font-semibold" : undefined}>
                    {l}
                  </p>
                ))}
              </address>
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-steel">Customer</h2>
            <p className="mt-1 text-lg font-semibold">{order.contact.fullName}</p>
            {order.companyName && <p>{order.companyName}</p>}
            <p>{order.contact.phone}</p>
            <p className="mt-2 text-sm">
              {DELIVERY_METHOD[order.deliveryMethod]}, {PAYMENT_METHOD[order.paymentMethod]}
            </p>
            {cod && (
              <p className="mt-2 inline-block rounded-[var(--radius-tag)] border-2 border-ink px-2 py-1 font-semibold">
                Collect {order.totals.total.formatted} cash
              </p>
            )}
          </div>
        </section>

        <table className="mt-4 w-full border-collapse text-[15px]">
          <thead>
            <tr className="border-b-2 border-ink text-left text-sm">
              <th scope="col" className="w-12 py-2 pr-2">
                Picked
              </th>
              <th scope="col" className="py-2 pr-3">
                SKU
              </th>
              <th scope="col" className="py-2 pr-3">
                Item
              </th>
              <th scope="col" className="py-2 text-right">
                Qty
              </th>
            </tr>
          </thead>
          <tbody>
            {order.lines.map((l) => (
              <tr key={l.id} className="border-b border-galv align-top break-inside-avoid">
                <td className="py-3 pr-2">
                  <span className="block size-6 rounded-[3px] border-2 border-ink" aria-label="Not picked yet" role="img" />
                </td>
                <td className="py-3 pr-3 font-mono text-sm whitespace-nowrap">{l.sku}</td>
                <td className="py-3 pr-3">{l.name}</td>
                <td className="py-3 text-right font-cond text-xl font-bold whitespace-nowrap">{uomCount(l.quantity, l.uom)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3 text-right text-sm text-steel">
                Lines
              </td>
              <td className="pt-3 text-right font-cond text-lg font-bold">{formatQty(order.lines.length)}</td>
            </tr>
          </tfoot>
        </table>

        {order.notes && (
          <section className="mt-5 rounded-[var(--radius-tag)] border-2 border-ink p-3">
            <h2 className="text-sm font-semibold">Customer note</h2>
            <p className="whitespace-pre-line">{order.notes}</p>
          </section>
        )}

        <footer className="mt-8 grid gap-6 text-sm sm:grid-cols-2 print:grid-cols-2">
          <p className="border-t border-ink pt-1 text-steel">Packed by</p>
          <p className="border-t border-ink pt-1 text-steel">{pickup ? "Collected by (name and signature)" : "Checked by"}</p>
        </footer>
        {storePhone && <p className="mt-6 text-center text-xs text-steel">Questions about this order? Call {storePhone}.</p>}
      </article>
    </>
  );
}
