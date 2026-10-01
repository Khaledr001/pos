import type { Metadata } from "next";
import { DashboardView } from "@/components/admin/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function AdminHome() {
  return <DashboardView />;
}
