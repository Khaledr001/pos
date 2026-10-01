import type { Metadata } from "next";
import { DevPay } from "@/components/store/checkout/dev-pay";

export const metadata: Metadata = { title: "Test payment", robots: { index: false } };

/** Stand-in for the card gateway in development (DEV_PAYMENTS=true on the API). */
export default async function DevPayPage({ searchParams }: PageProps<"/checkout/pay/dev">) {
  const sp = await searchParams;
  return <DevPay reference={String(sp.ref ?? "")} order={String(sp.order ?? "")} />;
}
