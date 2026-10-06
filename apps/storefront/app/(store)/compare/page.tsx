import type { Metadata } from "next";
import { CompareView } from "@/components/store/compare/compare-view";

export const metadata: Metadata = { title: "Compare products", robots: { index: false } };

export default function ComparePage() {
  return <CompareView />;
}
