import type { Metadata } from "next";
import { DeliverySettings } from "@/components/admin/settings/delivery";

export const metadata: Metadata = { title: "Delivery rates" };

export default function Page() {
  return <DeliverySettings />;
}
