import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error.js';
import { grossFor, money, VAT_RATE_BPS } from '../../common/money.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { RevalidationService } from '../revalidation/revalidation.service.js';
import {
  AdminProductQueryDto,
  AttributeDto,
  BrandDto,
  CategoryDto,
  ReplaceDocumentsDto,
  ReplaceImagesDto,
  ReplaceLinksDto,
  ReplaceVariantAttributesDto,
  UpdateAttributeDto,
  UpdateBrandDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './admin.dto.js';

const tags = RevalidationService.tags;

/** Map Prisma unique-constraint errors to a friendly 409. */
async function unique<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw ApiError.conflict('DUPLICATE', `A ${what} with this slug or code already exists`);
    }
    throw err;
  }
}

/**
 * Website-owned catalog content. SKUs, prices and stock are read-only here:
 * they come from the POS.
 */
@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly pricing: PricingService,
    private readonly inventory: InventoryService,
    private readonly revalidation: RevalidationService,
  ) {}

  async products(q: AdminProductQueryDto) {
    const where: Prisma.ProductWhereInput = {
      ...(q.status ? { published: q.status === 'published' } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { variants: { some: { sku: { contains: q.q, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          brand: { select: { name: true } },
          category: { select: { name: true } },
          images: { take: 1, orderBy: { sortOrder: 'asc' } },
          variants: { select: { sku: true, active: true } },
        },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        brand: p.brand?.name ?? null,
        category: p.category?.name ?? null,
        imageUrl: p.images[0]?.url ?? null,
        skus: p.variants.map((v) => v.sku),
        activeVariants: p.variants.filter((v) => v.active).length,
        published: p.published,
        inStock: p.inStock,
        fromPrice: p.fromNetPriceFils != null ? money(grossFor(p.fromNetPriceFils, VAT_RATE_BPS[p.vatClass])) : null,
        // A product needs content before it goes live.
        missing: [
          !p.description && 'description',
          !p.images.length && 'images',
          !p.categoryId && 'category',
          p.fromNetPriceFils == null && 'price',
        ].filter((m): m is string => !!m),
        updatedAt: p.updatedAt,
      })),
    };
  }

  async product(id: string) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: {
        brand: true,
        category: true,
        images: { orderBy: { sortOrder: 'asc' } },
        documents: true,
        links: { include: { to: { select: { id: true, name: true, slug: true } } } },
        variants: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: { attributes: { include: { attribute: true } }, uomConversions: true },
        },
      },
    });
    if (!p) throw ApiError.notFound('Product');
    const [sheet, avail] = await Promise.all([
      this.pricing.priceSheet(p.variants.map((v) => v.sku)),
      this.inventory.availability(p.variants.map((v) => v.id)),
    ]);
    const stock = await this.prisma.stockLevel.findMany({
      where: { variantId: { in: p.variants.map((v) => v.id) } },
      include: { branch: { select: { code: true, name: true } } },
    });
    return {
      ...p,
      variants: p.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        name: v.name,
        options: v.options,
        baseUom: v.baseUom,
        weightGrams: v.weightGrams,
        active: v.active,
        sortOrder: v.sortOrder,
        posVersion: v.posVersion,
        uomConversions: v.uomConversions.map((c) => ({ uom: c.uom, factor: Number(c.factor) })),
        attributes: v.attributes.map((a) => ({ attributeId: a.attributeId, code: a.attribute.code, name: a.attribute.name, value: a.value })),
        prices: (sheet.get(v.sku) ?? []).map(({ uom, price }) => ({
          uom,
          unit: money(price.unitGrossFils),
          unitNet: money(price.unitNetFils),
          priceListCode: price.priceListCode,
          tiers: price.tiers.map((t) => ({ minQty: t.minQty, unitNet: money(t.unitNetFils) })),
        })),
        available: avail.get(v.id)?.available ?? 0,
        stock: stock
          .filter((s) => s.variantId === v.id)
          .map((s) => ({ branch: s.branch.name, code: s.branch.code, quantity: Number(s.quantity), updatedAt: s.updatedAt })),
      })),
    };
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    const before = await this.prisma.product.findUnique({ where: { id } });
    if (!before) throw ApiError.notFound('Product');
    const { specs, ...rest } = dto;
    const p = await unique(
      () =>
        this.prisma.product.update({
          where: { id },
          data: { ...rest, ...(specs ? { specs: specs as unknown as Prisma.InputJsonValue } : {}) },
        }),
      'product',
    );
    this.revalidation.revalidate(tags.product(before.slug), tags.product(p.slug), tags.catalog, tags.home);
    return this.product(id);
  }

  async replaceImages(id: string, dto: ReplaceImagesDto) {
    const p = await this.prisma.product.findUniqueOrThrow({ where: { id } });
    await this.prisma.$transaction([
      this.prisma.productImage.deleteMany({ where: { productId: id } }),
      this.prisma.productImage.createMany({
        data: dto.images.map((img, i) => ({ productId: id, url: img.url, alt: img.alt ?? null, sortOrder: i })),
      }),
    ]);
    this.revalidation.revalidate(tags.product(p.slug), tags.catalog);
    return this.product(id);
  }

  async replaceDocuments(id: string, dto: ReplaceDocumentsDto) {
    const p = await this.prisma.product.findUniqueOrThrow({ where: { id } });
    await this.prisma.$transaction([
      this.prisma.productDocument.deleteMany({ where: { productId: id } }),
      this.prisma.productDocument.createMany({ data: dto.documents.map((d) => ({ ...d, productId: id })) }),
    ]);
    this.revalidation.revalidate(tags.product(p.slug));
    return this.product(id);
  }

  async replaceLinks(id: string, dto: ReplaceLinksDto) {
    const p = await this.prisma.product.findUniqueOrThrow({ where: { id } });
    const links = dto.links.filter((l) => l.toId !== id);
    await this.prisma.$transaction([
      this.prisma.productLink.deleteMany({ where: { fromId: id } }),
      this.prisma.productLink.createMany({
        data: links.map((l, i) => ({ fromId: id, toId: l.toId, kind: l.kind, sortOrder: i })),
        skipDuplicates: true,
      }),
    ]);
    this.revalidation.revalidate(tags.product(p.slug));
    return this.product(id);
  }

  async replaceVariantAttributes(variantId: string, dto: ReplaceVariantAttributesDto) {
    const v = await this.prisma.variant.findUnique({ where: { id: variantId }, include: { product: true } });
    if (!v) throw ApiError.notFound('Variant');
    await this.prisma.$transaction([
      this.prisma.variantAttribute.deleteMany({ where: { variantId } }),
      this.prisma.variantAttribute.createMany({
        data: dto.attributes.map((a) => {
          const n = Number.parseFloat(a.value);
          return { variantId, attributeId: a.attributeId, value: a.value, numericValue: Number.isFinite(n) ? n : null };
        }),
      }),
    ]);
    this.revalidation.revalidate(tags.product(v.product.slug), tags.catalog);
    return this.product(v.productId);
  }

  async updateVariant(variantId: string, dto: UpdateVariantDto) {
    const v = await this.prisma.variant.update({ where: { id: variantId }, data: dto, include: { product: true } });
    this.revalidation.revalidate(tags.product(v.product.slug));
    return this.product(v.productId);
  }

  // ── categories ──

  categories() {
    return this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true, children: true } } },
    });
  }

  async createCategory(dto: CategoryDto) {
    const c = await unique(() => this.prisma.category.create({ data: dto }), 'category');
    this.revalidation.revalidate(tags.catalog, tags.home);
    return c;
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    if (dto.parentId === id) throw ApiError.badRequest('INVALID_PARENT', 'A category cannot be its own parent');
    if (dto.parentId && (await this.isDescendant(dto.parentId, id))) {
      throw ApiError.badRequest('INVALID_PARENT', 'A category cannot be moved under its own subcategory');
    }
    const c = await unique(() => this.prisma.category.update({ where: { id }, data: dto }), 'category');
    this.revalidation.revalidate(tags.catalog, tags.home, tags.category(c.slug));
    return c;
  }

  async deleteCategory(id: string) {
    const c = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true, children: true } } },
    });
    if (!c) throw ApiError.notFound('Category');
    if (c._count.products || c._count.children) {
      throw ApiError.conflict('CATEGORY_IN_USE', 'Move its products and subcategories first');
    }
    await this.prisma.category.delete({ where: { id } });
    this.revalidation.revalidate(tags.catalog, tags.home);
  }

  private async isDescendant(candidateId: string, ancestorId: string) {
    let id: string | null = candidateId;
    for (let i = 0; id && i < 20; i++) {
      if (id === ancestorId) return true;
      const row: { parentId: string | null } | null = await this.prisma.category.findUnique({
        where: { id },
        select: { parentId: true },
      });
      id = row?.parentId ?? null;
    }
    return false;
  }

  // ── brands ──

  brands() {
    return this.prisma.brand.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
  }

  async createBrand(dto: BrandDto) {
    const b = await unique(() => this.prisma.brand.create({ data: dto }), 'brand');
    this.revalidation.revalidate(tags.catalog, tags.home);
    return b;
  }

  async updateBrand(id: string, dto: UpdateBrandDto) {
    const b = await unique(() => this.prisma.brand.update({ where: { id }, data: dto }), 'brand');
    this.revalidation.revalidate(tags.catalog, tags.home, tags.brand(b.slug));
    return b;
  }

  async deleteBrand(id: string) {
    const count = await this.prisma.product.count({ where: { brandId: id } });
    if (count) throw ApiError.conflict('BRAND_IN_USE', `${count} products use this brand`);
    await this.prisma.brand.delete({ where: { id } });
    this.revalidation.revalidate(tags.catalog, tags.home);
  }

  // ── attributes ──

  attributes() {
    return this.prisma.attribute.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  }

  createAttribute(dto: AttributeDto) {
    return unique(() => this.prisma.attribute.create({ data: dto }), 'attribute');
  }

  updateAttribute(id: string, dto: UpdateAttributeDto) {
    return unique(() => this.prisma.attribute.update({ where: { id }, data: dto }), 'attribute');
  }

  async deleteAttribute(id: string) {
    await this.prisma.attribute.delete({ where: { id } });
    this.revalidation.revalidate(tags.catalog);
  }

  /** Search helper for the "related products" picker. */
  async pick(q: string) {
    return this.catalog.productCards(
      { OR: [{ name: { contains: q, mode: 'insensitive' } }, { variants: { some: { sku: { startsWith: q, mode: 'insensitive' } } } }] },
      10,
    );
  }
}
