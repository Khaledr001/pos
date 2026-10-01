import type { Metadata } from "next";
import { PageEditor } from "@/components/admin/content/page-editor";

export const metadata: Metadata = { title: "New page" };

export default function NewContentPage() {
  return <PageEditor page={null} />;
}
