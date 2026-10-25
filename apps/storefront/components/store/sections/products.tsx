import type { HomeSectionSettings } from "@devsfleet/shared-types";
import type { HomeData, ProductCard, ProductList, StoreInfo } from "@devsfleet/storefront-client";
import { ProductGrid } from "@/components/store/product-card";
import { cached, publicApi, tags } from "@/lib/api-server";
import { orFallback } from "@/lib/fallback";
import { SectionFrame, SectionHeader } from "./section-header";

const SOURCES = {
  best_sellers: { title: "Best sellers", href: "/search?q=", link: "Browse all products", needsSearch: true },
  new_arrivals: { title: "New arrivals", href: "/search?q=&sort=newest", link: "See everything new", needsSearch: true },
} as const;

/**
 * A product row is cut to whole rows of four, so a grid never ends on a
 * single orphaned card; fewer than four are shown as they are.
 */
function wholeRows(products: ProductCard[]): ProductCard[] {
  return products.length < 4 ? products : products.slice(0, products.length - (products.length % 4));
}

export async function Products({
  id,
  settings,
  home,
  store,
  priority,
}: {
  id: string;
  settings: HomeSectionSettings["products"];
  home: HomeData;
  store: StoreInfo;
  /** Eager-load the first row's images: this is the first product row on the page. */
  priority: boolean;
}) {
  const limit = Math.max(1, Math.min(settings.limit ?? 24, 24));
  let all: ProductCard[];
  let title: string;
  let more: { href: string; link: string } | null;

  if (settings.source === "category") {
    const slug = settings.categorySlug?.trim();
    if (!slug) return null;
    const list = await publicApi
      .get<ProductList>(`/catalog/products?category=${encodeURIComponent(slug)}&pageSize=${limit}`, cached([tags.catalog, tags.category(slug)], 600))
      .catch(orFallback(null));
    all = list?.items ?? [];
    title = "Featured products";
    more = { href: `/category/${encodeURIComponent(slug)}`, link: "View all" };
  } else {
    const source = SOURCES[settings.source ?? "best_sellers"] ?? SOURCES.best_sellers;
    all = settings.source === "new_arrivals" ? home.newArrivals : home.bestSellers;
    title = source.title;
    // The "browse all" link goes to search, which a catalogue without search does not have.
    more = store.features.search ? { href: source.href, link: source.link } : null;
  }

  const products = wholeRows(all.slice(0, limit));
  if (products.length === 0) return null;
  const heading = `products-${id}`;
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={heading}>
        <SectionHeader id={heading} title={settings.title?.trim() || title} href={more?.href} link={more?.link} />
        <ProductGrid products={products} priorityCount={priority ? 4 : 0} className="lg:grid-cols-4" />
      </section>
    </SectionFrame>
  );
}
