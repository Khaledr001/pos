import type { Branch } from "@al-lahiq/api-client";
import type { Metadata } from "next";
import Link from "next/link";
import { BranchCard } from "@/components/store/content/branch-card";
import { Breadcrumbs } from "@/components/store/listing";
import { cached, publicApi, tags } from "@/lib/api-server";

export const metadata: Metadata = {
  title: "Branches and opening hours",
  description: "Visit or collect your order from our branches in Dubai, Sharjah and Abu Dhabi. Addresses, phone numbers and opening hours.",
  alternates: { canonical: "/branches" },
};

export default async function BranchesPage() {
  const branches = await publicApi.get<Branch[]>("/content/branches", cached([tags.content])).catch(() => [] as Branch[]);
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Breadcrumbs items={[{ href: "/branches", label: "Branches" }]} />
      <h1 className="mt-3 text-4xl">Branches and opening hours</h1>
      <p className="mt-1 max-w-[65ch] text-steel">
        Come in to see the range, or order online and collect from a branch with store pickup. Pickup is free and usually ready in about 2 hours.
      </p>
      {branches.length ? (
        <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {branches.map((b) => (
            <BranchCard key={b.code} branch={b} />
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-steel">
          Branch details aren&apos;t available right now. <Link href="/contact" className="text-pipe underline">Contact us</Link> for directions.
        </p>
      )}
    </div>
  );
}
