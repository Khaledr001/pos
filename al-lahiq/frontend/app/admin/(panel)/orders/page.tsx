import type { Metadata } from "next";
import { Suspense } from "react";
import { OrderList } from "@/components/admin/orders/order-list";
import { Loading } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <Suspense fallback={<Loading label="Loading orders" />}>
      <OrderList />
    </Suspense>
  );
}
