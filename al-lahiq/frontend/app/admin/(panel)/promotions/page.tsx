import type { Metadata } from "next";
import { PromotionsView } from "@/components/admin/promotions";

export const metadata: Metadata = { title: "Promotions" };

export default function PromotionsPage() {
  return <PromotionsView />;
}
