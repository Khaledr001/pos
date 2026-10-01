import { ApiError, type OrderView } from "@al-lahiq/api-client";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AddToCartAction } from "@/components/store/account/add-to-cart-result";
import { OrderDetail } from "@/components/store/account/order-detail";
import { accountGet, requireSession } from "@/lib/account-server";
import { getStore } from "@/lib/data";

export const metadata: Metadata = { title: "Order details", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderPage({ params }: PageProps<"/account/orders/[id]">) {
  const { id } = await params;
  const path = `/account/orders/${id}`;
  await requireSession(path);
  if (!UUID.test(id)) notFound();
  const [order, store] = await Promise.all([
    accountGet<OrderView>(`/me/orders/${id}`, path).catch((err) => {
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
      throw err;
    }),
    getStore(),
  ]);
  if (!order) notFound();

  const names = Object.fromEntries(order.lines.map((l) => [l.sku, l.name]));
  return (
    <OrderDetail
      order={order}
      store={store}
      invoiceHref={`/api/v1/me/orders/${order.id}/invoice.pdf`}
      back={
        <Link href="/account/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-steel hover:text-ink">
          <ChevronLeft className="size-4" aria-hidden /> All orders
        </Link>
      }
      actions={<AddToCartAction path={`/me/orders/${order.id}/reorder`} label="Order again" names={names} className="sm:max-w-sm" />}
    />
  );
}
