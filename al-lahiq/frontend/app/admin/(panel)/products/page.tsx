import type { Metadata } from "next";
import { Suspense } from "react";
import { ProductList } from "@/components/admin/products/product-list";
import { Loading } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Products" };

export default function ProductsPage() {
  return (
    <Suspense fallback={<Loading label="Loading products" />}>
      <ProductList />
    </Suspense>
  );
}
