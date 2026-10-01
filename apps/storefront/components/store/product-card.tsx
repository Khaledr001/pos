import type { ProductCard as Card } from "@devsfleet/storefront-client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PriceTag } from "@/components/ui/price-tag";
import { ProductImage } from "@/components/ui/product-image";

export function ProductCard({ product, priority }: { product: Card; priority?: boolean }) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[var(--radius-panel)] border border-galv bg-paper">
      <ProductImage image={product.image} name={product.name} brand={product.brand?.name} priority={priority} />
      <div className="flex flex-1 flex-col gap-2 border-t border-galv p-3">
        {product.brand && <p className="text-sm font-medium text-steel">{product.brand.name}</p>}
        <h3 className="font-sans text-[15px] font-medium leading-snug line-clamp-2">
          <Link href={`/product/${product.slug}`} className="after:absolute after:inset-0 group-hover:underline underline-offset-2">
            {product.name}
          </Link>
        </h3>
        <div className="mt-auto pt-1">
          {product.fromPrice ? (
            <PriceTag price={product.fromPrice} uom={product.baseUom} from={product.variantCount > 1} />
          ) : (
            <p className="text-sm text-steel">Price on request</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {!product.inStock && <Badge tone="signal">Out of stock</Badge>}
            {product.pickupOnly && <Badge tone="neutral">Store pickup only</Badge>}
            {product.variantCount > 1 && <Badge tone="neutral">{product.variantCount} options</Badge>}
          </div>
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products, priorityCount = 0 }: { products: Card[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
      {products.map((p, i) => (
        <li key={p.id} className="flex">
          <div className="w-full">
            <ProductCard product={p} priority={i < priorityCount} />
          </div>
        </li>
      ))}
    </ul>
  );
}
