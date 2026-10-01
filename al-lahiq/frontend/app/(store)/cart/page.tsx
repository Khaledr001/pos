import type { Metadata } from "next";
import { CartPage } from "@/components/store/cart/cart-page";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default function Page() {
  return <CartPage />;
}
