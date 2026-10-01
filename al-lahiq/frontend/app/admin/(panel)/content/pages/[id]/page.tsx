import type { Metadata } from "next";
import { PageEditorLoader } from "@/components/admin/content/page-editor";

export const metadata: Metadata = { title: "Edit page" };

export default async function EditContentPage({ params }: PageProps<"/admin/content/pages/[id]">) {
  const { id } = await params;
  return <PageEditorLoader id={id} />;
}
