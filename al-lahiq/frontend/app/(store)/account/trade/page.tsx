import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TradeContent } from "@/components/store/account/trade";
import { hasSession } from "@/lib/account-server";

export const metadata: Metadata = { title: "Trade account", robots: { index: false } };

export default async function AccountTradePage() {
  // Linked from the header and home page: visitors who aren't logged in see the public page.
  if (!(await hasSession())) redirect("/trade");
  return <TradeContent />;
}
