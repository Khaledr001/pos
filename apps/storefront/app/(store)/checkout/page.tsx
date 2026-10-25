import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutForm } from "@/components/store/checkout/checkout-form";
import { getStore } from "@/lib/data";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage() {
  const store = await getStore();
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-4 py-12 text-steel">Loading checkout…</div>}>
      <CheckoutForm offerWhatsappUpdates={!!store.whatsapp} />
    </Suspense>
  );
}
