import type { Metadata } from "next";
import { BrandsView } from "@/components/admin/catalog/brands";

export const metadata: Metadata = { title: "Brands" };

export default function Page() {
  return <BrandsView />;
}
