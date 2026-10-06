import type { ProductCard, ProductDetail, StockLabel } from "@devsfleet/storefront-client";
import { displayName } from "./format";
import type { SavedProduct } from "./hooks/local-list";

export function savedFromCard(p: ProductCard): SavedProduct {
  return {
    slug: p.slug,
    name: displayName(p.name),
    brand: p.brand ? displayName(p.brand.name) : null,
    image: p.image,
    price: p.fromPrice?.formatted ?? null,
  };
}

/** The cheapest first-unit price across variants, compared by fils (an integer), never by parsed floats. */
export function lowestPrice(p: ProductDetail) {
  let best: { fils: number; formatted: string } | null = null;
  for (const v of p.variants) {
    const price = v.units[0]?.price.unit;
    if (price && (!best || price.fils < best.fils)) best = price;
  }
  return best;
}

export function savedFromDetail(p: ProductDetail): SavedProduct {
  return {
    slug: p.slug,
    name: displayName(p.name),
    brand: p.brand ? displayName(p.brand.name) : null,
    image: p.images[0] ?? null,
    price: lowestPrice(p)?.formatted ?? null,
  };
}

/** The best stock state any variant is in: one buyable option is enough to call the product available. */
export function bestStock(p: ProductDetail): StockLabel | null {
  const labels = p.variants.map((v) => v.availability.label);
  if (labels.length === 0) return null;
  return labels.includes("IN_STOCK") ? "IN_STOCK" : labels.includes("LOW_STOCK") ? "LOW_STOCK" : "OUT_OF_STOCK";
}
