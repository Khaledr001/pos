import { and, count, desc, eq, ilike, inArray, isNull, or, schema, sql } from "@devsfleet/db";
import { AppError, ERROR_CODES, slugify } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { ListListingsDto, ProductLinksDto, UpsertListingDto } from "./dto.js";

/**
 * Which POS products are sold online, and how they are presented.
 *
 * Names, prices and stock are not editable here — they are the product's own,
 * changed where they always were. A listing only decides whether the product
 * is in the shop window, under what URL, and with what extra copy.
 */
@Injectable()
export class ListingsAdminService {
  constructor(private readonly db: TenantDatabase) {}

  async list(dto: ListListingsDto) {
    return this.db.run(async (tx) => {
      const search = dto.q ? `%${dto.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
      const where = and(
        isNull(schema.products.deletedAt),
        // The delivery line is a product too, and never one to sell.
        sql`${schema.products.sku} <> 'WEB-DELIVERY'`,
        search ? or(ilike(schema.products.name, search), ilike(schema.products.sku, search)) : undefined,
        dto.status === "published" ? eq(schema.productListings.isPublished, true) : undefined,
        dto.status === "unpublished" ? eq(schema.productListings.isPublished, false) : undefined,
        dto.status === "unlisted" ? isNull(schema.productListings.id) : undefined,
      );
      const base = () =>
        tx
          .select({
            productId: schema.products.id,
            sku: schema.products.sku,
            name: schema.products.name,
            imageUrl: schema.products.imageUrl,
            isActive: schema.products.isActive,
            brandName: schema.brands.name,
            categoryName: schema.categories.name,
            listingId: schema.productListings.id,
            slug: schema.productListings.slug,
            isPublished: schema.productListings.isPublished,
            isFeatured: schema.productListings.isFeatured,
            pickupOnly: schema.productListings.pickupOnly,
          })
          .from(schema.products)
          .leftJoin(schema.productListings, eq(schema.productListings.productId, schema.products.id))
          .leftJoin(schema.brands, eq(schema.brands.id, schema.products.brandId))
          .leftJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
          .where(where);

      const [total] = await tx
        .select({ value: count() })
        .from(schema.products)
        .leftJoin(schema.productListings, eq(schema.productListings.productId, schema.products.id))
        .where(where);
      const rows = await base()
        .orderBy(desc(schema.products.updatedAt))
        .limit(dto.pageSize)
        .offset((dto.page - 1) * dto.pageSize);

      return {
        items: rows.map((r) => ({
          productId: r.productId,
          sku: r.sku,
          name: r.name,
          imageUrl: r.imageUrl,
          isActive: r.isActive,
          brandName: r.brandName,
          categoryName: r.categoryName,
          listing: r.listingId
            ? { slug: r.slug!, isPublished: r.isPublished!, isFeatured: r.isFeatured!, pickupOnly: r.pickupOnly! }
            : null,
        })),
        total: total?.value ?? 0,
        page: dto.page,
        pageSize: dto.pageSize,
      };
    });
  }

  async get(productId: string) {
    return this.db.run(async (tx) => {
      const product = await tx.query.products.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, productId), n(t.deletedAt)),
        columns: { id: true, sku: true, name: true, description: true, imageUrl: true },
      });
      if (!product) throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, "That product does not exist.");
      const [listing, links] = await Promise.all([
        tx.query.productListings.findFirst({ where: (t, { eq: e }) => e(t.productId, productId) }),
        tx
          .select({ kind: schema.productLinks.kind, productId: schema.products.id, name: schema.products.name, sku: schema.products.sku })
          .from(schema.productLinks)
          .innerJoin(schema.products, eq(schema.products.id, schema.productLinks.linkedProductId))
          .where(eq(schema.productLinks.productId, productId))
          .orderBy(schema.productLinks.sortOrder),
      ]);
      return {
        product,
        listing: listing ?? null,
        suggestedSlug: slugify(product.name) || slugify(product.sku),
        links: {
          related: links.filter((l) => l.kind === "related"),
          alternative: links.filter((l) => l.kind === "alternative"),
          boughtTogether: links.filter((l) => l.kind === "bought_together"),
        },
      };
    });
  }

  /** A slug already used by another product surfaces as DUPLICATE_SLUG from its unique index. */
  async upsert(productId: string, dto: UpsertListingDto) {
    await this.db.run(async (tx) => {
      const product = await tx.query.products.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, productId), n(t.deletedAt)),
        columns: { id: true },
      });
      if (!product) throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, "That product does not exist.");

      const existing = await tx.query.productListings.findFirst({ where: (t, { eq: e }) => e(t.productId, productId) });
      const values = {
        slug: dto.slug,
        isPublished: dto.isPublished,
        isFeatured: dto.isFeatured,
        pickupOnly: dto.pickupOnly,
        seoTitle: dto.seoTitle ?? null,
        seoDescription: dto.seoDescription ?? null,
        specs: dto.specs,
        documents: dto.documents,
        // First publication is a date the shop's "new arrivals" sorts by; it does not move on later edits.
        publishedAt: dto.isPublished ? (existing?.publishedAt ?? new Date()) : (existing?.publishedAt ?? null),
      };
      if (existing) {
        await tx.update(schema.productListings).set(values).where(eq(schema.productListings.id, existing.id));
      } else {
        await tx.insert(schema.productListings).values({ tenantId: RequestContext.requireTenantId(), productId, ...values });
      }
    });
    return this.get(productId);
  }

  async setLinks(productId: string, dto: ProductLinksDto) {
    await this.db.run(async (tx) => {
      const tenantId = RequestContext.requireTenantId();
      await tx.delete(schema.productLinks).where(eq(schema.productLinks.productId, productId));
      const rows = [
        ...dto.related.map((id, i) => ({ linkedProductId: id, kind: "related" as const, sortOrder: i })),
        ...dto.alternative.map((id, i) => ({ linkedProductId: id, kind: "alternative" as const, sortOrder: i })),
        ...dto.boughtTogether.map((id, i) => ({ linkedProductId: id, kind: "bought_together" as const, sortOrder: i })),
      ].filter((r) => r.linkedProductId !== productId);
      if (rows.length) {
        await tx.insert(schema.productLinks).values(rows.map((r) => ({ tenantId, productId, ...r })));
      }
    });
    return this.get(productId);
  }

  /** List and publish every active product that has no listing yet. */
  async publishAllUnlisted() {
    return this.db.run(async (tx) => {
      const tenantId = RequestContext.requireTenantId();
      const unlisted = await tx
        .select({ id: schema.products.id, name: schema.products.name, sku: schema.products.sku })
        .from(schema.products)
        .leftJoin(schema.productListings, eq(schema.productListings.productId, schema.products.id))
        .where(
          and(
            isNull(schema.productListings.id),
            eq(schema.products.isActive, true),
            isNull(schema.products.deletedAt),
            eq(schema.products.isStockTracked, true),
          ),
        );
      if (unlisted.length === 0) return { published: 0 };

      const taken = new Set(
        (await tx.select({ slug: schema.productListings.slug }).from(schema.productListings)).map((r) => r.slug),
      );
      const values = unlisted.map((p) => {
        let slug = slugify(p.name) || slugify(p.sku);
        if (taken.has(slug)) slug = `${slug}-${slugify(p.sku)}`.slice(0, 255);
        taken.add(slug);
        return { tenantId, productId: p.id, slug, isPublished: true, publishedAt: new Date() };
      });
      for (let i = 0; i < values.length; i += 500) {
        await tx.insert(schema.productListings).values(values.slice(i, i + 500)).onConflictDoNothing();
      }
      return { published: values.length };
    });
  }

  async unpublish(productIds: string[]) {
    if (productIds.length === 0) return { updated: 0 };
    return this.db.run(async (tx) => {
      const rows = await tx
        .update(schema.productListings)
        .set({ isPublished: false })
        .where(inArray(schema.productListings.productId, productIds))
        .returning({ id: schema.productListings.id });
      return { updated: rows.length };
    });
  }
}
