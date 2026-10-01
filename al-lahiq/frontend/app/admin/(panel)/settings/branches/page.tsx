import type { Metadata } from "next";
import { BranchesSettings } from "@/components/admin/settings/branches";

export const metadata: Metadata = { title: "Branches" };

export default function Page() {
  return <BranchesSettings />;
}
