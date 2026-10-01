import type { Metadata } from "next";
import { GeneralSettings } from "@/components/admin/settings/general";

export const metadata: Metadata = { title: "Settings" };

export default function Page() {
  return <GeneralSettings />;
}
