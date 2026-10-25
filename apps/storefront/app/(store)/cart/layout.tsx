import type { ReactNode } from "react";
import { requireFeature } from "@/lib/features";

/** This route only exists on a site with the `cart` feature; see lib/features.ts. */
export default async function Layout({ children }: { children: ReactNode }) {
  await requireFeature("cart");
  return children;
}
