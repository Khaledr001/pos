import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/store/listing";
import { getCategories } from "@/lib/data";
import { alphabetical, displayName } from "@/lib/format";

export const metadata: Metadata = {
  title: "All departments",
  alternates: { canonical: "/departments" },
};

/**
 * Every department on one page. The header only has room for the busiest few;
 * this is where the rest live — for shoppers on a phone, and for search engines.
 */
export default async function DepartmentsPage() {
  const categories = alphabetical(await getCategories());
  // Grouped by first letter so a long list stays scannable.
  const groups = new Map<string, typeof categories>();
  for (const c of categories) {
    const letter = /[a-z]/i.test(c.name.charAt(0)) ? c.name.charAt(0).toUpperCase() : "#";
    groups.set(letter, [...(groups.get(letter) ?? []), c]);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <Breadcrumbs items={[{ href: "/departments", label: "All departments" }]} />
      <div className="mt-3 mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-4xl">All departments</h1>
        <p className="text-steel">{categories.length} departments</p>
      </div>

      <nav aria-label="Jump to letter" className="mb-6 flex flex-wrap gap-1.5">
        {[...groups.keys()].map((letter) => (
          <a
            key={letter}
            href={`#letter-${letter}`}
            className="inline-flex size-9 items-center justify-center rounded-[var(--radius-tag)] border border-galv bg-paper font-semibold hover:border-pipe hover:text-pipe"
          >
            {letter}
          </a>
        ))}
      </nav>

      <div className="space-y-8">
        {[...groups.entries()].map(([letter, items]) => (
          <section key={letter} id={`letter-${letter}`} aria-labelledby={`heading-${letter}`} className="scroll-mt-40">
            <h2 id={`heading-${letter}`} className="mb-3 border-b border-galv pb-2 text-2xl">
              {letter}
            </h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/category/${c.slug}`}
                    className="group flex h-full flex-col rounded-[var(--radius-panel)] border border-galv bg-paper p-4 transition-colors hover:border-pipe"
                  >
                    <span className="font-cond text-xl font-semibold group-hover:text-pipe">{displayName(c.name)}</span>
                    <span className="mt-0.5 text-sm text-steel">
                      {c.productCount === 1 ? "1 product" : `${c.productCount} products`}
                    </span>
                    {c.children.length > 0 && (
                      <span className="mt-2 line-clamp-2 text-sm text-steel">
                        {alphabetical(c.children).map((s) => displayName(s.name)).join(" · ")}
                      </span>
                    )}
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
