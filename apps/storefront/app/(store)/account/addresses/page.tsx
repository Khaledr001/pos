import type { Metadata } from "next";
import { AddressBook } from "@/components/store/account/address-book";
import { requireSession } from "@/lib/account-server";

export const metadata: Metadata = { title: "Addresses", robots: { index: false } };

export default async function AddressesPage() {
  await requireSession("/account/addresses");
  return <AddressBook />;
}
