import type { BlogList, BrandSummary, CategoryNode, ProductList } from "@devsfleet/storefront-client";
import type { MetadataRoute } from "next";
import { cached, publicApi, tags } from "@/lib/api-server";
import { orFallback } from "@/lib/fallback";
import { siteOrigin } from "@/lib/site";

/** One sitemap per shop: built for the host it is requested on, never once at build time. */
export const dynamic = "force-dynamic";

/** Content pages that exist on every install (the footer links to them). */
const CONTENT_PAGES = ["about", "delivery-returns", "warranty", "faq", "privacy", "terms"];

const PAGE_SIZE = 60;
/** Safety stop: 200 pages × 60 = 12,000 products, well under the 50,000-URL sitemap limit. */
const MAX_PAGES = 200;

async function allProducts() {
  const items: ProductList["items"] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await publicApi.get<ProductList>(`/catalog/products?pageSize=${PAGE_SIZE}&page=${page}`, cached([tags.catalog]));
    items.push(...data.items);
    if (data.items.length === 0 || items.length >= data.total) break;
  }
  return items;
}

async function allGuides() {
  const items: BlogList["items"] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = await publicApi.get<BlogList>(`/content/blog?page=${page}`, cached([tags.content]));
    items.push(...data.items);
    if (data.items.length === 0 || items.length >= data.total) break;
  }
  return items;
}

function flatten(nodes: CategoryNode[]): CategoryNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, products, brands, guides] = await Promise.all([
    publicApi.get<CategoryNode[]>("/catalog/categories", cached([tags.catalog])).catch(orFallback([] as CategoryNode[])),
    allProducts().catch(orFallback([] as ProductList["items"])),
    publicApi.get<BrandSummary[]>("/catalog/brands", cached([tags.catalog])).catch(orFallback([] as BrandSummary[])),
    allGuides().catch(orFallback([] as BlogList["items"])),
  ]);

  const site = await siteOrigin();
  const url = (path: string) => `${site}${path}`;
  return [
    { url: url("/"), changeFrequency: "daily", priority: 1 },
    ...flatten(categories).map((c) => ({ url: url(`/category/${c.slug}`), changeFrequency: "daily" as const, priority: 0.8 })),
    ...products.map((p) => ({ url: url(`/product/${p.slug}`), changeFrequency: "weekly" as const, priority: 0.7 })),
    { url: url("/brands"), changeFrequency: "weekly", priority: 0.5 },
    ...brands.map((b) => ({ url: url(`/brand/${b.slug}`), changeFrequency: "weekly" as const, priority: 0.5 })),
    { url: url("/blog"), changeFrequency: "weekly", priority: 0.5 },
    ...guides.map((g) => ({
      url: url(`/blog/${g.slug}`),
      lastModified: g.publishedAt ?? undefined,
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
    { url: url("/branches"), changeFrequency: "monthly", priority: 0.4 },
    { url: url("/contact"), changeFrequency: "monthly", priority: 0.4 },
    { url: url("/trade"), changeFrequency: "monthly", priority: 0.4 },
    { url: url("/track"), changeFrequency: "yearly", priority: 0.2 },
    ...CONTENT_PAGES.map((slug) => ({ url: url(`/pages/${slug}`), changeFrequency: "monthly" as const, priority: 0.3 })),
  ];
}
