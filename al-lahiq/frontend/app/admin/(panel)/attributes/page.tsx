import type { Metadata } from "next";
import { AttributesView } from "@/components/admin/catalog/attributes";

export const metadata: Metadata = { title: "Filter attributes" };

export default function Page() {
  return <AttributesView />;
}
