import { ApiError, type ProductDetail } from "@devsfleet/storefront-client";
import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { crumbsFrom, Breadcrumbs } from "@/components/store/listing";
import { Markdown } from "@/components/store/markdown";
import { BuyBox } from "@/components/store/product/buy-box";
import { Gallery } from "@/components/store/product/gallery";
import { ProductGrid } from "@/components/store/product-card";
import { cached, publicApi, tags } from "@/lib/api-server";
import { siteOrigin } from "@/lib/site";

async function getProduct(slug: string) {
  try {
    return await publicApi.get<ProductDetail>(`/catalog/products/${slug}`, cached([tags.catalog, tags.product(slug)]));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: PageProps<"/product/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProduct(slug);
  return {
    title: p.seoTitle ?? p.name,
    description: p.seoDescription ?? p.description?.slice(0, 160) ?? undefined,
    alternates: { canonical: `/product/${slug}` },
    openGraph: { title: p.name, images: p.images[0] ? [p.images[0].url] : undefined },
  };
}

function jsonLd(p: ProductDetail, site: string) {
  return {
    "@context": "https://schema.org",
    "@type": "ProductGroup",
    name: p.name,
    description: p.description ?? undefined,
    brand: p.brand ? { "@type": "Brand", name: p.brand.name } : undefined,
    url: `${site}/product/${p.slug}`,
    hasVariant: p.variants.map((v) => ({
      "@type": "Product",
      sku: v.sku,
      name: `${p.name} ${v.name}`,
      image: p.images[0]?.url ? (p.images[0].url.startsWith("http") ? p.images[0].url : `${site}${p.images[0].url}`) : undefined,
      offers: v.units[0]
        ? {
            "@type": "Offer",
            priceCurrency: "AED",
            price: v.units[0].price.unit.amount,
            availability: v.availability.label === "OUT_OF_STOCK" ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
          }
        : undefined,
    })),
  };
}

export default async function ProductPage({ params }: PageProps<"/product/[slug]">) {
  const { slug } = await params;
  const [product, site] = await Promise.all([getProduct(slug), siteOrigin()]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(product, site)).replace(/</g, "\\u003c") }}
      />
      <Breadcrumbs items={[...crumbsFrom(product.breadcrumbs), { href: `/product/${slug}`, label: product.name }]} />

      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <Gallery images={product.images} name={product.name} brand={product.brand?.name} />
        <div>
          {product.brand && (
            <Link href={`/brand/${product.brand.slug}`} className="font-medium text-steel hover:text-ink">
              {product.brand.name}
            </Link>
          )}
          <h1 className="mt-1 text-3xl sm:text-4xl">{product.name}</h1>
          <div className="mt-5">
            <BuyBox product={product} />
          </div>
        </div>
      </div>

      <div className="mt-12 grid gap-10 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="about">
          <h2 id="about" className="mb-3 text-2xl">About this product</h2>
          {product.description ? <Markdown>{product.description}</Markdown> : <p className="text-steel">No description yet.</p>}
        </section>
        <div className="space-y-8">
          {product.specs.length > 0 && (
            <section aria-labelledby="specs">
              <h2 id="specs" className="mb-3 text-2xl">Specifications</h2>
              <table className="w-full text-[15px]">
                <tbody>
                  {product.specs.map((s) => (
                    <tr key={s.label} className="border-b border-galv">
                      <th scope="row" className="py-2 pr-4 text-left font-normal text-steel">
                        {s.label}
                      </th>
                      <td className="py-2 font-medium">{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {product.documents.length > 0 && (
            <section aria-labelledby="docs">
              <h2 id="docs" className="mb-3 text-2xl">Downloads</h2>
              <ul className="space-y-2">
                {product.documents.map((d) => (
                  <li key={d.url}>
                    <a href={d.url} target="_blank" rel="noopener" className="inline-flex items-center gap-2 text-pipe hover:underline">
                      <FileText className="size-4" aria-hidden /> {d.title}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {product.boughtTogether.length > 0 && (
        <section className="mt-12" aria-labelledby="together">
          <h2 id="together" className="mb-4 text-2xl">Often bought together</h2>
          <ProductGrid products={product.boughtTogether} />
        </section>
      )}
      {product.alternatives.length > 0 && (
        <section className="mt-12" aria-labelledby="alternatives">
          <h2 id="alternatives" className="mb-4 text-2xl">Alternatives</h2>
          <ProductGrid products={product.alternatives} />
        </section>
      )}
      {product.related.length > 0 && (
        <section className="mt-12" aria-labelledby="related">
          <h2 id="related" className="mb-4 text-2xl">Related products</h2>
          <ProductGrid products={product.related} />
        </section>
      )}
    </div>
  );
}
