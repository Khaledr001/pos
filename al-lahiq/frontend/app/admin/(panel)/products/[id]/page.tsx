import type { Metadata } from "next";
import { ProductEditor } from "@/components/admin/products/product-editor";

export const metadata: Metadata = { title: "Edit product" };

export default async function ProductPage({ params }: PageProps<"/admin/products/[id]">) {
  const { id } = await params;
  return <ProductEditor id={id} />;
}
