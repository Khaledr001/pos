"use client";

import Link from "next/link";
import { ProductImage } from "@/components/ui/product-image";
import { useRecentlyViewed } from "@/lib/hooks/recently-viewed";

/** Nothing renders until the browser reports at least one visit, so first-time visitors see no empty shell. */
export function RecentlyViewed({ excludeSlug, className }: { excludeSlug?: string; className?: string }) {
  const items = useRecentlyViewed().filter((p) => p.slug !== excludeSlug);
  if (items.length === 0) return null;
  return (
    <section className={className} aria-labelledby="recently-viewed">
      <h2 id="recently-viewed" className="mb-4 text-2xl sm:text-3xl">
        Recently viewed
      </h2>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {items.map((p) => (
          <li key={p.slug} className="w-40 shrink-0 snap-start sm:w-48">
            <article className="group relative flex h-full flex-col overflow-hidden rounded-[var(--radius-panel)] border border-galv bg-paper">
              <ProductImage image={p.image} name={p.name} brand={p.brand} sizes="192px" />
              <div className="flex flex-1 flex-col gap-1 border-t border-galv p-3">
                {p.brand && <p className="text-sm font-medium text-steel">{p.brand}</p>}
                <h3 className="font-sans text-[15px] font-medium leading-snug line-clamp-2">
                  <Link href={`/product/${p.slug}`} className="after:absolute after:inset-0 group-hover:underline underline-offset-2">
                    {p.name}
                  </Link>
                </h3>
                <p className="mt-auto pt-1 font-cond text-lg font-bold">{p.price ?? <span className="font-sans text-sm font-normal text-steel">Price on request</span>}</p>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
