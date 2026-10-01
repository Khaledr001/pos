import type { Metadata } from "next";
import { ListsPage } from "@/components/store/account/lists";
import { requireSession } from "@/lib/account-server";

export const metadata: Metadata = { title: "Lists", robots: { index: false } };

export default async function AccountListsPage() {
  await requireSession("/account/lists");
  return <ListsPage />;
}
