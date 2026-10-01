import { grossFor, money, VAT_RATE_BPS } from '../../common/money.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const productCardInclude = {
  brand: { select: { slug: true, name: true } },
  images: { orderBy: { sortOrder: 'asc' }, take: 1 },
  variants: { where: { active: true }, select: { id: true, baseUom: true } },
} satisfies Prisma.ProductInclude;

export type ProductCardRow = Prisma.ProductGetPayload<{
  include: typeof productCardInclude;
}>;

export function toProductCard(p: ProductCardRow) {
  const rate = VAT_RATE_BPS[p.vatClass];
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    brand: p.brand,
    image: p.images[0] ? { url: p.images[0].url, alt: p.images[0].alt ?? p.name } : null,
    fromPrice:
      p.fromNetPriceFils != null ? money(grossFor(p.fromNetPriceFils, rate)) : null,
    baseUom: p.variants[0]?.baseUom ?? 'pc',
    variantCount: p.variants.length,
    inStock: p.inStock,
    pickupOnly: p.pickupOnly,
  };
}

export type ProductCard = ReturnType<typeof toProductCard>;
