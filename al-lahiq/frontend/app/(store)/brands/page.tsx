import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/store/listing";
import { getBrands } from "@/lib/data";

export const metadata: Metadata = { title: "Brands", alternates: { canonical: "/brands" } };

export default async function BrandsPage() {
  const brands = await getBrands();
  const groups = new Map<string, typeof brands>();
  for (const b of brands.toSorted((a, b) => a.name.localeCompare(b.name))) {
    const letter = /[a-z]/i.test(b.name[0]) ? b.name[0].toUpperCase() : "#";
    groups.set(letter, [...(groups.get(letter) ?? []), b]);
  }
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Breadcrumbs items={[{ href: "/brands", label: "Brands" }]} />
      <h1 className="mt-3 text-4xl">Brands</h1>
      <p className="mt-1 text-steel">Genuine products with the manufacturer&apos;s UAE warranty.</p>
      <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {[...groups].map(([letter, list]) => (
          <section key={letter}>
            <h2 className="mb-2 border-b border-galv pb-1 text-2xl">{letter}</h2>
            <ul className="space-y-1">
              {list.map((b) => (
                <li key={b.slug}>
                  <Link href={`/brand/${b.slug}`} className="text-[15px] hover:text-pipe">
                    {b.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
