import { ApiError, type OrderView } from "@devsfleet/storefront-client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OrderDetail } from "@/components/store/account/order-detail";
import { publicApi } from "@/lib/api-server";
import { getStore } from "@/lib/data";

export const metadata: Metadata = { title: "Track your order", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TrackOrderPage({ params }: PageProps<"/track/[token]">) {
  const { token } = await params;
  if (!UUID.test(token)) notFound();
  const [order, store] = await Promise.all([
    publicApi.get<OrderView>(`/orders/track/${token}`, { cache: "no-store" }).catch((err) => {
      // 404: unknown token. 400: malformed token. Both mean "no such order".
      if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
      throw err;
    }),
    getStore(),
  ]);
  if (!order) notFound();

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <OrderDetail order={order} store={store} invoiceHref={`/api/v1/orders/track/${token}/invoice.pdf`} />
    </div>
  );
}
