import type { HomeData } from "@devsfleet/storefront-client";
import Link from "next/link";
import { ProductGrid } from "@/components/store/product-card";
import { SearchBox } from "@/components/store/search-box";
import { ButtonLink } from "@/components/ui/button";
import { cached, publicApi, tags } from "@/lib/api-server";
import { Suspense } from "react";

const QUICK_SEARCHES = ["PPR pipe 20 mm", "2.5 mm² cable", "Basin mixer", "MCB 20 A", "Silicone sealant", "Porcelain tiles"];

export default async function HomePage() {
  const home = await publicApi.get<HomeData>("/content/home", cached([tags.home, tags.catalog], 600));
  const lead = home.hero[0];

  return (
    <>
      {/* The search is the hero: trade buyers come looking for a specific part. */}
      <section className="border-b border-galv bg-paper">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 lg:grid-cols-[1.1fr_1fr] lg:py-14">
          <div className="flex flex-col justify-center">
            <h1 className="text-4xl sm:text-5xl lg:text-[56px] max-w-[16ch]">
              {lead?.title ?? "Everything to build, fix and finish"}
            </h1>
            <p className="mt-4 max-w-[52ch] text-lg text-steel">
              {lead?.subtitle ??
                "Plumbing, electrical, sanitary ware and tools from brands you trust — delivered across the UAE or ready for pickup."}
            </p>
            <Suspense>
              <SearchBox className="mt-6 max-w-xl" />
            </Suspense>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUICK_SEARCHES.map((q) => (
                <Link
                  key={q}
                  href={`/search?q=${encodeURIComponent(q)}`}
                  className="rounded-full border border-galv px-3 py-1 text-sm text-steel hover:border-steel-light hover:text-ink"
                >
                  {q}
                </Link>
              ))}
            </div>
          </div>

          {/* Department index, like the first page of a parts catalogue. */}
          <nav aria-label="Shop by department" className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-galv bg-galv">
            {home.categories.map((c) => (
              <div key={c.slug} className="bg-paper p-4">
                <Link href={`/category/${c.slug}`} className="font-cond text-xl font-semibold hover:text-pipe">
                  {c.name}
                </Link>
                <ul className="mt-1.5 space-y-0.5">
                  {c.children.slice(0, 4).map((s) => (
                    <li key={s.slug}>
                      <Link href={`/category/${s.slug}`} className="text-sm text-steel hover:text-ink">
                        {s.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
      </section>

      {home.strip[0] && (
        <section className="bg-pipe text-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold">{home.strip[0].title}</p>
            {home.strip[0].subtitle && <p className="text-white/85 text-sm">{home.strip[0].subtitle}</p>}
          </div>
        </section>
      )}

      <div className="mx-auto max-w-7xl px-4">
        <section className="mt-12" aria-labelledby="best-sellers">
          <div className="mb-4 flex items-end justify-between gap-4">
            <h2 id="best-sellers" className="text-3xl">Most ordered this season</h2>
            <Link href="/search?q=" className="text-sm font-semibold text-pipe hover:underline">
              Browse all products
            </Link>
          </div>
          <ProductGrid products={home.bestSellers} priorityCount={4} />
        </section>

        {home.hero[1] && (
          <section className="mt-12 grid gap-6 rounded-[var(--radius-panel)] bg-ink p-6 text-white sm:p-10 lg:grid-cols-[2fr_1fr] lg:items-center">
            <div>
              <h2 className="text-3xl sm:text-4xl">{home.hero[1].title}</h2>
              {home.hero[1].subtitle && <p className="mt-3 max-w-[60ch] text-white/80">{home.hero[1].subtitle}</p>}
            </div>
            {home.hero[1].linkUrl && (
              <div className="lg:justify-self-end">
                <ButtonLink href={home.hero[1].linkUrl} variant="brass" size="lg">
                  {home.hero[1].ctaLabel ?? "Find out more"}
                </ButtonLink>
              </div>
            )}
          </section>
        )}

        {home.featuredBrands.length > 0 && (
          <section className="mt-12" aria-labelledby="brands">
            <h2 id="brands" className="mb-4 text-3xl">Brands we stock</h2>
            <ul className="flex flex-wrap gap-2">
              {home.featuredBrands.map((b) => (
                <li key={b.slug}>
                  <Link
                    href={`/brand/${b.slug}`}
                    className="inline-flex h-12 items-center rounded-[var(--radius-tag)] border border-galv bg-paper px-5 font-cond text-lg font-semibold hover:border-ink"
                  >
                    {b.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/brands" className="inline-flex h-12 items-center px-3 text-sm font-semibold text-pipe hover:underline">
                  All brands
                </Link>
              </li>
            </ul>
          </section>
        )}

        <section className="mt-12" aria-labelledby="new">
          <h2 id="new" className="mb-4 text-3xl">New in stock</h2>
          <ProductGrid products={home.newArrivals} />
        </section>
      </div>
    </>
  );
}
