import type { OrderView } from "@al-lahiq/api-client";
import { CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PurchaseEvent } from "@/components/store/checkout/purchase-event";
import { ButtonLink } from "@/components/ui/button";
import { publicApi } from "@/lib/api-server";
import { DELIVERY_METHOD, formatDateTime, PAYMENT_METHOD } from "@/lib/format";

export const metadata: Metadata = { title: "Order placed", robots: { index: false } };

export default async function SuccessPage({ searchParams }: PageProps<"/checkout/success">) {
  const token = (await searchParams).order;
  const order =
    typeof token === "string" ? await publicApi.get<OrderView>(`/orders/track/${token}`, { cache: "no-store" }).catch(() => null) : null;
  if (!order) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-4xl">Thank you</h1>
        <p className="mt-2 text-steel">Your order was received. Check your email for the confirmation.</p>
      </div>
    );
  }
  const awaitingPayment = order.status === "PENDING_PAYMENT";
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      {!awaitingPayment && <PurchaseEvent order={order} />}
      <div className="rounded-[var(--radius-panel)] border border-galv bg-paper p-6 sm:p-8">
        <CheckCircle2 className="size-10 text-pipe" aria-hidden />
        <h1 className="mt-3 text-4xl">{awaitingPayment ? "We're confirming your payment" : "Order placed"}</h1>
        <p className="mt-2 text-lg">
          Order number <strong className="font-cond text-2xl">{order.orderNumber}</strong>
        </p>
        <p className="mt-2 text-steel">
          {awaitingPayment
            ? "This usually takes a few seconds. Refresh this page, or follow the link in your confirmation email."
            : `We've sent a confirmation to ${order.contact.email}. ${
                order.deliveryMethod === "PICKUP"
                  ? "We'll message you when it's ready to collect."
                  : "We'll message you when it's on its way."
              }`}
        </p>

        <dl className="mt-6 grid gap-4 border-t border-galv pt-6 sm:grid-cols-3 text-[15px]">
          <div>
            <dt className="text-steel">Total</dt>
            <dd className="tag-price text-2xl">{order.totals.total.formatted}</dd>
          </div>
          <div>
            <dt className="text-steel">Payment</dt>
            <dd className="font-medium">{PAYMENT_METHOD[order.paymentMethod]}</dd>
          </div>
          <div>
            <dt className="text-steel">{DELIVERY_METHOD[order.deliveryMethod]}</dt>
            <dd className="font-medium">
              {order.pickup
                ? `${order.pickup.branch.name}, ${formatDateTime(order.pickup.slotStart)}`
                : [order.shippingAddress?.area, order.shippingAddress?.emirate].filter(Boolean).join(", ")}
            </dd>
          </div>
        </dl>

        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href={`/track/${order.trackingToken}`}>Track this order</ButtonLink>
          {order.invoice && (
            <a href={`/api/v1/orders/track/${order.trackingToken}/invoice.pdf`} className="inline-flex h-10 items-center px-4 font-semibold text-pipe hover:underline">
              Download tax invoice
            </a>
          )}
          <Link href="/" className="inline-flex h-10 items-center px-4 text-steel hover:text-ink">
            Continue shopping
          </Link>
        </div>
      </div>
    </div>
  );
}
