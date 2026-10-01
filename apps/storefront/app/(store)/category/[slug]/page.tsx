import type { CategoryDetail, ProductList } from "@devsfleet/storefront-client";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { crumbsFrom, Listing } from "@/components/store/listing";
import { ApiError } from "@devsfleet/storefront-client";
import { cached, publicApi, tags } from "@/lib/api-server";
import { apiQuery, parseListing } from "@/lib/listing";

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
  const c = await getCategory(slug);
  return {
    title: c.seoTitle ?? `${c.name} in the UAE`,
    description: c.seoDescription ?? `Buy ${c.name.toLowerCase()} online. Prices include VAT; delivery across the UAE or store pickup.`,
    alternates: { canonical: `/category/${slug}` },
  };
}

export default async function CategoryPage({ params, searchParams }: PageProps<"/category/[slug]">) {
  const { slug } = await params;
  const query = parseListing(await searchParams);
  const [category, data] = await Promise.all([
    getCategory(slug),
    publicApi.get<ProductList>(
      `/catalog/products${apiQuery(query, { category: slug })}`,
      cached([tags.catalog, tags.category(slug)], 600),
    ),
  ]);
  return (
    <Listing
      title={category.name}
      intro={category.description}
      crumbs={crumbsFrom(category.breadcrumbs)}
      subcategories={category.children}
      data={data}
      query={query}
      path={`/category/${slug}`}
    />
  );
}
