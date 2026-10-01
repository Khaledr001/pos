import type { Metadata } from "next";
import { TradeContent } from "@/components/store/account/trade";

export const metadata: Metadata = {
  title: "Trade accounts for contractors",
  description:
    "Project pricing and quantity breaks for contractors and maintenance companies, with tax invoices in your company name and TRN.",
  alternates: { canonical: "/trade" },
};

export default function TradePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <TradeContent standalone />
    </div>
  );
}
