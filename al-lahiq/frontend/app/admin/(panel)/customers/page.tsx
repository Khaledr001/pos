import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomerList } from "@/components/admin/customers/customers";
import { Loading } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <Suspense fallback={<Loading label="Loading customers" />}>
      <CustomerList />
    </Suspense>
  );
}
