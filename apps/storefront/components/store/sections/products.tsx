import type { HomeData, ProductCard } from "@devsfleet/storefront-client";
import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { ProductGrid } from "@/components/store/product-card";
import { SectionFrame, SectionHeader } from "./section-header";

const SOURCES = {
  best_sellers: { title: "Best sellers", href: "/search?q=", link: "Browse all products" },
  new_arrivals: { title: "New arrivals", href: "/search?q=&sort=newest", link: "See everything new" },
} as const;

/**
 * A product row is cut to whole rows of four, so a grid never ends on a
 * single orphaned card; fewer than four are shown as they are.
 */
function wholeRows(products: ProductCard[]): ProductCard[] {
  return products.length < 4 ? products : products.slice(0, products.length - (products.length % 4));
}

export function Products({
  id,
  settings,
  home,
  priority,
}: {
  id: string;
  settings: HomeSectionSettings["products"];
  home: HomeData;
  /** Eager-load the first row's images: this is the first product row on the page. */
  priority: boolean;
}) {
  const source = SOURCES[settings.source ?? "best_sellers"] ?? SOURCES.best_sellers;
  const all = settings.source === "new_arrivals" ? home.newArrivals : home.bestSellers;
  const limit = Math.max(1, Math.min(settings.limit ?? all.length, 24));
  const products = wholeRows(all.slice(0, limit));
  if (products.length === 0) return null;
  const heading = `products-${id}`;
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={heading}>
        <SectionHeader id={heading} title={settings.title?.trim() || source.title} href={source.href} link={source.link} />
        <ProductGrid products={products} priorityCount={priority ? 4 : 0} className="lg:grid-cols-4" />
      </section>
    </SectionFrame>
  );
}
