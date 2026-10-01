import type { Metadata } from "next";
import { ListDetail } from "@/components/store/account/list-detail";
import { requireSession } from "@/lib/account-server";

export const metadata: Metadata = { title: "List", robots: { index: false } };

export default async function ListPage({ params }: PageProps<"/account/lists/[id]">) {
  const { id } = await params;
  await requireSession(`/account/lists/${id}`);
  return <ListDetail key={id} id={id} />;
}
