import type { HomeData } from "@devsfleet/storefront-client";
import type { HomeSectionSettings } from "@devsfleet/shared-types";
import Link from "next/link";
import { displayName } from "@/lib/format";
import { SectionFrame, SectionHeader } from "./section-header";

export function Brands({ settings, home }: { settings: HomeSectionSettings["brands"]; home: HomeData }) {
  if (home.featuredBrands.length === 0) return null;
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby="brands">
        <SectionHeader id="brands" title={settings.title?.trim() || "Brands we carry"} href="/brands" link="All brands" />
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {home.featuredBrands.map((b) => (
            <li key={b.slug}>
              <Link
                href={`/brand/${b.slug}`}
                className="flex h-20 items-center justify-center rounded-[var(--radius-panel)] border border-galv bg-paper px-4 text-center font-cond text-xl font-semibold transition-colors hover:border-ink"
              >
                {b.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded logos of unknown size
                  <img src={b.logoUrl} alt={displayName(b.name)} className="max-h-10 max-w-full object-contain" loading="lazy" />
                ) : (
                  displayName(b.name)
                )}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </SectionFrame>
  );
}
