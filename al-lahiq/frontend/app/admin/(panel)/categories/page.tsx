import type { Metadata } from "next";
import { CategoriesView } from "@/components/admin/catalog/categories";

export const metadata: Metadata = { title: "Categories" };

export default function Page() {
  return <CategoriesView />;
}
