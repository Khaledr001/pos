import type { Metadata } from "next";
import { SyncView } from "@/components/admin/sync";

export const metadata: Metadata = { title: "POS connection" };

export default function SyncPage() {
  return <SyncView />;
}
