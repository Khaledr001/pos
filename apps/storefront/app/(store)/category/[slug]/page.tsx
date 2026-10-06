import type { CategoryDetail, ProductList } from "@devsfleet/storefront-client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/store/json-ld";
import { crumbsFrom, Listing } from "@/components/store/listing";
import { ApiError } from "@devsfleet/storefront-client";
import { cached, publicApi, tags } from "@/lib/api-server";
import { apiQuery, parseListing } from "@/lib/listing";
import { getStore } from "@/lib/data";
import { displayName } from "@/lib/format";
import { breadcrumbLd, socialMeta } from "@/lib/seo";
import { siteOrigin } from "@/lib/site";

async function getCategory(slug: string) {
  try {
    return await publicApi.get<CategoryDetail>(`/catalog/categories/${slug}`, cached([tags.catalog, tags.category(slug)]));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/category/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const [c, store] = await Promise.all([getCategory(slug), getStore()]);
  const title = c.seoTitle ?? `${displayName(c.name)} in the UAE`;
  const description = c.seoDescription ?? `Buy ${c.name.toLowerCase()} online. Prices include VAT; delivery across the UAE or store pickup.`;
  return { title, description, ...socialMeta({ title, description, path: `/category/${slug}`, image: c.imageUrl, siteName: store.name }) };
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/category/[slug]">) {
  const { slug } = await params;
  const query = parseListing(await searchParams);
  const [category, data, site] = await Promise.all([
    getCategory(slug),
    publicApi.get<ProductList>(
      `/catalog/products${apiQuery(query, { category: slug })}`,
      cached([tags.catalog, tags.category(slug)], 600),
    ),
    siteOrigin(),
  ]);
  const crumbs = crumbsFrom(category.breadcrumbs);
  return (
    <>
      <JsonLd data={breadcrumbLd(site, crumbs)} />
      <Listing
        title={displayName(category.name)}
        intro={category.description}
        crumbs={crumbs}
        subcategories={category.children}
        data={data}
        query={query}
        path={`/category/${slug}`}
      />
    </>
  );
}
