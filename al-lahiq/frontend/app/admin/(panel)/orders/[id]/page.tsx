import type { Metadata } from "next";
import { OrderDetail } from "@/components/admin/orders/order-detail";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  return <OrderDetail id={id} />;
}
