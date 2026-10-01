import type { ProductList } from "@al-lahiq/api-client";
import type { Metadata } from "next";
import { Listing } from "@/components/store/listing";
import { cached, publicApi, tags } from "@/lib/api-server";
import { apiQuery, parseListing } from "@/lib/listing";

export async function generateMetadata({ searchParams }: PageProps<"/search">): Promise<Metadata> {
  const q = parseListing(await searchParams).q;
  return { title: q ? `Search results for “${q}”` : "All products", robots: { index: false } };
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const query = parseListing(await searchParams);
  const data = await publicApi.get<ProductList>(`/catalog/products${apiQuery(query)}`, cached([tags.catalog], 300));
  return (
    <Listing
      title={query.q ? `Results for “${query.q}”` : "All products"}
      crumbs={[{ href: "/search", label: query.q ? "Search" : "All products" }]}
      data={data}
      query={query}
      path="/search"
    />
  );
}
