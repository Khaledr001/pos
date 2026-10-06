import { ApiError, type BrandDetail, type ProductList } from "@devsfleet/storefront-client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Listing } from "@/components/store/listing";
import { cached, publicApi, tags } from "@/lib/api-server";
import { apiQuery, parseListing } from "@/lib/listing";
import { getStore } from "@/lib/data";
import { displayName } from "@/lib/format";
import { socialMeta } from "@/lib/seo";

async function getBrand(slug: string) {
  try {
    return await publicApi.get<BrandDetail>(`/catalog/brands/${slug}`, cached([tags.catalog, tags.brand(slug)]));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/brand/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const [b, store] = await Promise.all([getBrand(slug), getStore()]);
  const title = `${displayName(b.name)} products`;
  return { title, description: b.description ?? undefined, ...socialMeta({ title, description: b.description, path: `/brand/${slug}`, image: b.logoUrl, siteName: store.name }) };
}

export default async function BrandPage({ params, searchParams }: PageProps<"/brand/[slug]">) {
  const { slug } = await params;
  const query = parseListing(await searchParams);
  // The brand filter is fixed by the URL.
  const [brand, data] = await Promise.all([
    getBrand(slug),
    publicApi.get<ProductList>(`/catalog/products${apiQuery({ ...query, brand: [slug] })}`, cached([tags.catalog, tags.brand(slug)], 600)),
  ]);
  data.facets.brands = [];
  return (
    <Listing
      title={displayName(brand.name)}
      intro={brand.description}
      crumbs={[{ href: "/brands", label: "Brands" }, { href: `/brand/${slug}`, label: displayName(brand.name) }]}
      data={data}
      query={{ ...query, brand: [] }}
      path={`/brand/${slug}`}
    />
  );
}
