import type { Metadata } from "next";
import { StaffView } from "@/components/admin/staff";

export const metadata: Metadata = { title: "Staff accounts" };

export default function StaffPage() {
  return <StaffView />;
}
