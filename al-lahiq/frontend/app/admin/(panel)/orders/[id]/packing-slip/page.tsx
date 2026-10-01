import type { Metadata } from "next";
import { PackingSlip } from "@/components/admin/orders/packing-slip";
import { getStore } from "@/lib/data";

export const metadata: Metadata = { title: "Packing slip" };

export default async function PackingSlipPage({ params }: PageProps<"/admin/orders/[id]/packing-slip">) {
  const { id } = await params;
  const store = await getStore().catch(() => null);
  return <PackingSlip id={id} storeName={store?.name ?? "Al-Lahiq Building Materials"} storePhone={store?.phone ?? null} />;
}
