import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error.js';
import { money } from '../../common/money.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { ResolvedPrice } from '../pricing/price-resolver.js';
import { PricingService } from '../pricing/pricing.service.js';
import { SearchService } from '../search/search.service.js';
import { ListProductsDto } from './dto/list-products.dto.js';
import { productCardInclude, toProductCard } from './product.mapper.js';

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  children: CategoryNode[];
}

export function toPriceView(p: ResolvedPrice) {
  return {
    unit: money(p.unitGrossFils),
    unitNet: money(p.unitNetFils),
    retailUnit: money(p.retailUnitGrossFils),
    discounted: p.unitNetFils < p.retailUnitNetFils,
    priceListType: p.priceListType,
    tiers: p.tiers.map((t) => ({
      minQty: t.minQty,
      unit: money(t.unitGrossFils),
      unitNet: money(t.unitNetFils),
    })),
  };
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly inventory: InventoryService,
    private readonly search: SearchService,
  ) {}

  // ── categories & brands ──

  async categoryTree(): Promise<CategoryNode[]> {
    const all = await this.prisma.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, parentId: true, slug: true, name: true, imageUrl: true },
    });
    const nodes = new Map<string, CategoryNode>(
      all.map((c) => [c.id, { id: c.id, slug: c.slug, name: c.name, imageUrl: c.imageUrl, children: [] }]),
    );
    const roots: CategoryNode[] = [];
    for (const c of all) {
      const node = nodes.get(c.id)!;
      const parent = c.parentId ? nodes.get(c.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async category(slug: string) {
    const cat = await this.prisma.category.findFirst({
      where: { slug, active: true },
      include: {
        children: { where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
      },
    });
    if (!cat) throw ApiError.notFound('Category');
    return {
      id: cat.id,
      slug: cat.slug,
      name: cat.name,
      description: cat.description,
      imageUrl: cat.imageUrl,
      seoTitle: cat.seoTitle,
      seoDescription: cat.seoDescription,
      breadcrumbs: await this.breadcrumbs(cat.id),
      children: cat.children.map((c) => ({ slug: c.slug, name: c.name, imageUrl: c.imageUrl })),
    };
  }

  private async breadcrumbs(categoryId: string | null) {
    const trail: { slug: string; name: string }[] = [];
    let id = categoryId;
    for (let depth = 0; id && depth < 10; depth++) {
      const c = await this.prisma.category.findUnique({
        where: { id },
        select: { slug: true, name: true, parentId: true },
      });
      if (!c) break;
      trail.unshift({ slug: c.slug, name: c.name });
      id = c.parentId;
    }
    return trail;
  }

  private async descendantIds(rootId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      WITH RECURSIVE tree AS (
        SELECT id FROM categories WHERE id = ${rootId}::uuid
        UNION ALL
        SELECT c.id FROM categories c JOIN tree t ON c."parentId" = t.id
      ) SELECT id FROM tree`;
    return rows.map((r) => r.id);
  }

  async brands() {
    return this.prisma.brand.findMany({
      where: { active: true },
      orderBy: [{ featured: 'desc' }, { name: 'asc' }],
      select: { slug: true, name: true, logoUrl: true, featured: true },
    });
  }

  async brand(slug: string) {
    const b = await this.prisma.brand.findFirst({ where: { slug, active: true } });
    if (!b) throw ApiError.notFound('Brand');
    return { slug: b.slug, name: b.name, logoUrl: b.logoUrl, description: b.description };
  }

  // ── product listing ──

  async listProducts(dto: ListProductsDto) {
    const base: Prisma.ProductWhereInput[] = [{ published: true, variants: { some: { active: true } } }];
    let relevance: Map<string, number> | null = null;

    if (dto.category) {
      const cat = await this.prisma.category.findFirst({ where: { slug: dto.category, active: true } });
      if (!cat) throw ApiError.notFound('Category');
      base.push({ categoryId: { in: await this.descendantIds(cat.id) } });
    }
    if (dto.q?.trim()) {
      const hits = await this.search.search(dto.q);
      relevance = new Map(hits.map((h) => [h.productId, h.score]));
      base.push({ id: { in: [...relevance.keys()] } });
    }

    const filters: Prisma.ProductWhereInput[] = [];
    if (dto.brand?.length) filters.push({ brand: { slug: { in: dto.brand } } });
    if (dto.inStock) filters.push({ inStock: true });
    // Price filters are VAT-inclusive AED; the stored "from" price is net fils.
    if (dto.minPrice != null) filters.push({ fromNetPriceFils: { gte: Math.floor((dto.minPrice * 100) / 1.05) } });
    if (dto.maxPrice != null) filters.push({ fromNetPriceFils: { lte: Math.ceil((dto.maxPrice * 100) / 1.05) } });
    for (const [code, raw] of Object.entries(dto.attr ?? {})) {
      const values = String(raw).split(',').map((v) => v.trim()).filter(Boolean);
      if (!values.length) continue;
      filters.push({
        variants: {
          some: { active: true, attributes: { some: { attribute: { code }, value: { in: values } } } },
        },
      });
    }

    const where: Prisma.ProductWhereInput = { AND: [...base, ...filters] };
    const sort = dto.sort ?? (relevance ? 'relevance' : 'newest');
    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      sort === 'price_asc'
        ? [{ fromNetPriceFils: { sort: 'asc', nulls: 'last' } }]
        : sort === 'price_desc'
          ? [{ fromNetPriceFils: { sort: 'desc', nulls: 'last' } }]
          : sort === 'name'
            ? [{ name: 'asc' }]
            : [{ inStock: 'desc' }, { createdAt: 'desc' }];

    const total = await this.prisma.product.count({ where });
    let rows;
    if (sort === 'relevance' && relevance) {
      // Rank in memory: the search already capped the candidate set.
      const all = await this.prisma.product.findMany({ where, include: productCardInclude });
      all.sort((a, b) => (relevance.get(b.id) ?? 0) - (relevance.get(a.id) ?? 0));
      rows = all.slice((dto.page - 1) * dto.pageSize, dto.page * dto.pageSize);
    } else {
      rows = await this.prisma.product.findMany({
        where,
        orderBy,
        include: productCardInclude,
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
      });
    }

    if (dto.q?.trim() && dto.page === 1) await this.search.log(dto.q, total);

    return {
      items: rows.map(toProductCard),
      total,
      page: dto.page,
      pageSize: dto.pageSize,
      facets: await this.facets({ AND: base }),
    };
  }

  /** Facets over the category/search set, before brand/attribute/price filters. */
  private async facets(where: Prisma.ProductWhereInput) {
    const ids = (await this.prisma.product.findMany({ where, select: { id: true } })).map((p) => p.id);
    if (!ids.length) return { brands: [], attributes: [], price: null };

    const [brandCounts, attrRows, price] = await Promise.all([
      this.prisma.product.groupBy({
        by: ['brandId'],
        where: { id: { in: ids }, brandId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.$queryRaw<
        { code: string; name: string; unit: string | null; value: string; count: bigint }[]
      >`
        SELECT a.code, a.name, a.unit, va.value, COUNT(DISTINCT v."productId") AS count
        FROM variant_attributes va
        JOIN attributes a ON a.id = va."attributeId" AND a.filterable
        JOIN variants v ON v.id = va."variantId" AND v.active
        WHERE v."productId" = ANY(${ids}::uuid[])
        GROUP BY a.code, a.name, a.unit, a."sortOrder", va.value, va."numericValue"
        ORDER BY a."sortOrder", a.code, va."numericValue" NULLS LAST, va.value`,
      this.prisma.product.aggregate({
        where: { id: { in: ids } },
        _min: { fromNetPriceFils: true },
        _max: { fromNetPriceFils: true },
      }),
    ]);

    const brands = await this.prisma.brand.findMany({
      where: { id: { in: brandCounts.map((b) => b.brandId!) } },
      select: { id: true, slug: true, name: true },
    });
    const brandFacet = brands
      .map((b) => ({
        slug: b.slug,
        name: b.name,
        count: brandCounts.find((c) => c.brandId === b.id)?._count._all ?? 0,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const attributes: { code: string; name: string; unit: string | null; values: { value: string; count: number }[] }[] = [];
    for (const r of attrRows) {
      let a = attributes.find((x) => x.code === r.code);
      if (!a) {
        a = { code: r.code, name: r.name, unit: r.unit, values: [] };
        attributes.push(a);
      }
      a.values.push({ value: r.value, count: Number(r.count) });
    }

    const toGross = (n: number | null) => (n == null ? null : Math.round(n * 1.05) / 100);
    return {
      brands: brandFacet,
      attributes: attributes.filter((a) => a.values.length > 1),
      price:
        price._min.fromNetPriceFils != null
          ? { min: toGross(price._min.fromNetPriceFils), max: toGross(price._max.fromNetPriceFils) }
          : null,
    };
  }

  async productCards(where: Prisma.ProductWhereInput, take: number, orderBy?: Prisma.ProductOrderByWithRelationInput[]) {
    const rows = await this.prisma.product.findMany({
      where: { AND: [{ published: true, variants: { some: { active: true } } }, where] },
      include: productCardInclude,
      orderBy: orderBy ?? [{ inStock: 'desc' }, { createdAt: 'desc' }],
      take,
    });
    return rows.map(toProductCard);
  }

  /** Best sellers by quantity ordered in the last 90 days. */
  async bestSellers(take = 8) {
    const rows = await this.prisma.$queryRaw<{ productId: string }[]>`
      SELECT v."productId"
      FROM order_lines ol
      JOIN orders o ON o.id = ol."orderId"
      JOIN variants v ON v.id = ol."variantId"
      WHERE o."placedAt" > now() - interval '90 days' AND o.status NOT IN ('CANCELLED', 'PENDING_PAYMENT')
      GROUP BY v."productId"
      ORDER BY SUM(ol.quantity) DESC
      LIMIT ${take}`;
    const ids = rows.map((r) => r.productId);
    const sold = (await this.productCards({ id: { in: ids } }, take)).sort(
      (a, b) => ids.indexOf(a.id) - ids.indexOf(b.id),
    );
    if (sold.length >= take) return sold;
    // Not enough sales history yet: top up with featured products.
    const featured = await this.productCards({ featured: true, id: { notIn: ids } }, take - sold.length);
    return [...sold, ...featured];
  }

  // ── product detail ──

  async product(slug: string) {
    const p = await this.prisma.product.findFirst({
      where: { slug, published: true },
      include: {
        brand: true,
        category: true,
        images: { orderBy: { sortOrder: 'asc' } },
        documents: true,
        variants: {
          where: { active: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: {
            uomConversions: true,
            attributes: { include: { attribute: true } },
          },
        },
        links: {
          orderBy: { sortOrder: 'asc' },
          include: { to: { include: productCardInclude } },
        },
      },
    });
    if (!p || !p.variants.length) throw ApiError.notFound('Product');

    const skus = p.variants.map((v) => v.sku);
    const [sheet, avail] = await Promise.all([
      this.pricing.priceSheet(skus),
      this.inventory.availability(p.variants.map((v) => v.id)),
    ]);

    const optionAxes = new Map<string, Set<string>>();
    for (const v of p.variants) {
      for (const [k, val] of Object.entries((v.options ?? {}) as Record<string, string>)) {
        if (!optionAxes.has(k)) optionAxes.set(k, new Set());
        optionAxes.get(k)!.add(String(val));
      }
    }

    const linked = (kind: string) =>
      p.links.filter((l) => l.kind === kind && l.to.published).map((l) => toProductCard(l.to));

    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      specs: (p.specs ?? []) as { label: string; value: string }[],
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      pickupOnly: p.pickupOnly,
      vatClass: p.vatClass,
      brand: p.brand ? { slug: p.brand.slug, name: p.brand.name, logoUrl: p.brand.logoUrl } : null,
      category: p.category ? { slug: p.category.slug, name: p.category.name } : null,
      breadcrumbs: await this.breadcrumbs(p.categoryId),
      images: p.images.map((i) => ({ url: i.url, alt: i.alt ?? p.name })),
      documents: p.documents.map((d) => ({ title: d.title, url: d.url, kind: d.kind })),
      optionAxes: [...optionAxes.entries()].map(([code, values]) => ({ code, values: [...values] })),
      variants: p.variants.map((v) => {
        const a = avail.get(v.id)!;
        return {
          id: v.id,
          sku: v.sku,
          name: v.name,
          options: (v.options ?? {}) as Record<string, string>,
          baseUom: v.baseUom,
          weightGrams: v.weightGrams,
          attributes: v.attributes.map((x) => ({
            code: x.attribute.code,
            name: x.attribute.name,
            value: x.value,
            unit: x.attribute.unit,
          })),
          units: (sheet.get(v.sku) ?? []).map(({ uom, price }) => ({
            uom,
            factor:
              uom === v.baseUom
                ? 1
                : Number(v.uomConversions.find((c) => c.uom === uom)?.factor ?? 1),
            price: toPriceView(price),
          })),
          availability: {
            label: a.label,
            available: a.available,
            branches: a.branches.map((b) => ({
              code: b.branchCode,
              name: b.branchName,
              label: b.label,
            })),
          },
        };
      }),
      related: linked('RELATED'),
      alternatives: linked('ALTERNATIVE'),
      boughtTogether: linked('BOUGHT_TOGETHER'),
    };
  }

  /** Personalised prices (e.g. trade customers). Not cacheable. */
  async prices(skus: string[], customerId?: string) {
    const sheet = await this.pricing.priceSheet(skus.slice(0, 100), customerId);
    return Object.fromEntries(
      [...sheet.entries()].map(([sku, units]) => [
        sku,
        units.map(({ uom, price }) => ({ uom, price: toPriceView(price) })),
      ]),
    );
  }

  async suggest(q: string) {
    const term = q.trim();
    if (term.length < 2) return { products: [], categories: [], brands: [] };
    const hits = await this.search.search(term, 8);
    const ids = hits.map((h) => h.productId);
    const [products, categories, brands] = await Promise.all([
      this.productCards({ id: { in: ids } }, 8),
      this.prisma.category.findMany({
        where: { active: true, name: { contains: term, mode: 'insensitive' } },
        select: { slug: true, name: true },
        take: 4,
      }),
      this.prisma.brand.findMany({
        where: { active: true, name: { contains: term, mode: 'insensitive' } },
        select: { slug: true, name: true },
        take: 4,
      }),
    ]);
    products.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    return { products, categories, brands };
  }
}
