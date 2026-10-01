import { sql, type Transaction } from "@devsfleet/db";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { StorefrontCatalogService } from "../catalog/storefront-catalog.service.js";

const HOME_CARDS = 8;

@Injectable()
export class StorefrontContentService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly catalog: StorefrontCatalogService,
  ) {}

  async home() {
    return this.db.run(async (tx) => {
      const [banners, categories, brands, bestSellers, newArrivals] = await Promise.all([
        this.activeBanners(tx),
        this.catalog.categoryTreeIn(tx),
        tx.query.brands.findMany({
          where: (t, { and: a, eq: e, isNull: n }) => a(e(t.isActive, true), e(t.isFeatured, true), n(t.deletedAt)),
          columns: { slug: true, name: true, logoUrl: true },
          orderBy: (t, { asc }) => asc(t.name),
          limit: 12,
        }),
        this.bestSellers(tx),
        this.catalog.cardsWhere(tx, sql`true`, sql`product_listings.published_at DESC NULLS LAST, products.created_at DESC`, HOME_CARDS),
      ]);

      return {
        hero: banners.filter((b) => b.placement === "home_hero").map(toBanner),
        strip: banners.filter((b) => b.placement === "home_strip").map(toBanner),
        categories: categories.map((c) => ({
          slug: c.slug,
          name: c.name,
          imageUrl: c.imageUrl,
          children: c.children.map((child) => ({ slug: child.slug, name: child.name })),
        })),
        featuredBrands: brands.map((b) => ({ ...b, featured: true })),
        bestSellers,
        newArrivals,
      };
    });
  }

  async page(slug: string) {
    return this.db.run(async (tx) => {
      const page = await tx.query.storefrontPages.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.slug, slug), e(t.isPublished, true)),
      });
      if (!page) throw new AppError(ERROR_CODES.NOT_FOUND, "That page does not exist.");
      return {
        id: page.id,
        slug: page.slug,
        title: page.title,
        body: page.body,
        kind: page.kind,
        excerpt: page.excerpt,
        coverImageUrl: page.coverImageUrl,
        published: page.isPublished,
        publishedAt: page.publishedAt,
        seoTitle: page.seoTitle,
        seoDescription: page.seoDescription,
        createdAt: page.createdAt,
        updatedAt: page.updatedAt,
      };
    });
  }

  async blog(page: number, pageSize: number) {
    return this.db.run(async (tx) => {
      const [countRow] = await tx.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM storefront_pages WHERE kind = 'blog' AND is_published`,
      );
      const items = await tx.query.storefrontPages.findMany({
        where: (t, { and: a, eq: e }) => a(e(t.kind, "blog"), e(t.isPublished, true)),
        columns: { slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true },
        orderBy: (t, { desc }) => desc(t.publishedAt),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      return { total: Number(countRow?.total ?? 0), page, items };
    });
  }

  /** Branches shown online, with pickup and map details from the storefront settings. */
  async branches() {
    const { settings } = RequestContext.requireStorefront();
    return this.db.run(async (tx) => {
      const rows = await tx.query.branches.findMany({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.isActive, true), n(t.deletedAt)),
        columns: { id: true, code: true, name: true, address: true, phone: true },
        orderBy: (t, { asc }) => asc(t.name),
      });
      const shown = new Map(settings.branches.map((b) => [b.branchId, b]));
      return rows
        .filter((b) => shown.has(b.id))
        .map((b) => {
          const online = shown.get(b.id)!;
          return {
            id: b.id,
            code: b.code,
            name: b.name,
            emirate: online.emirate,
            address: b.address ?? "",
            phone: b.phone,
            lat: online.lat,
            lng: online.lng,
            openingHours: online.openingHours,
            pickupEnabled: online.pickupEnabled,
          };
        });
    });
  }

  /** Who the shop is: printed in the footer, on invoices, and on the checkout's COD limit. */
  store() {
    const { name, tenantName, settings, tenantSettings } = RequestContext.requireStorefront();
    const codMax = Money.toMinor(settings.checkout.cod.maxTotal);
    return {
      name: settings.displayName ?? name,
      tagline: settings.tagline ?? null,
      logoUrl: tenantSettings.logoUrl ?? null,
      legalName: tenantSettings.legalName ?? tenantName,
      trn: tenantSettings.trn ?? "",
      address: (tenantSettings.addressLines ?? []).join(", "),
      phone: tenantSettings.phone ?? "",
      email: tenantSettings.email ?? "",
      whatsapp: settings.whatsapp ?? "",
      currency: tenantSettings.currency.base,
      cod: {
        enabled: settings.checkout.cod.enabled,
        max: Money.toDecimalString(codMax, 2),
        maxFils: Number(Money.roundTo(codMax, 2) / 100n),
      },
    };
  }

  private async activeBanners(tx: Transaction) {
    const now = new Date();
    const rows = await tx.query.storefrontBanners.findMany({
      where: (t, { eq: e }) => e(t.isActive, true),
      orderBy: (t, { asc }) => [asc(t.placement), asc(t.sortOrder)],
    });
    return rows.filter((b) => (!b.startsAt || b.startsAt <= now) && (!b.endsAt || b.endsAt > now));
  }

  /**
   * Best sellers by quantity over the last 90 days, across EVERY channel — a
   * product that flies off the counter is a best seller online too. Topped up
   * with featured listings while the history is thin.
   */
  private async bestSellers(tx: Transaction) {
    const sold = await this.catalog.cardsWhere(
      tx,
      sql`products.id IN (
        SELECT v.product_id FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        JOIN product_variants v ON v.id = si.variant_id
        WHERE s.created_at > now() - interval '90 days' AND s.status = 'completed'
        GROUP BY v.product_id ORDER BY sum(si.quantity) DESC LIMIT ${HOME_CARDS * 2})`,
      sql`(SELECT coalesce(sum(si.quantity), 0) FROM sale_items si JOIN product_variants v ON v.id = si.variant_id
           JOIN sales s ON s.id = si.sale_id
           WHERE v.product_id = products.id AND s.created_at > now() - interval '90 days' AND s.status = 'completed') DESC`,
      HOME_CARDS,
    );
    if (sold.length >= HOME_CARDS) return sold;

    const featured = await this.catalog.cardsWhere(
      tx,
      sold.length
        ? sql`product_listings.is_featured AND products.id NOT IN (${sql.join(sold.map((c) => sql`${c.id}`), sql`, `)})`
        : sql`product_listings.is_featured`,
      sql`products.name ASC`,
      HOME_CARDS - sold.length,
    );
    return [...sold, ...featured];
  }
}

function toBanner(b: {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  ctaLabel: string | null;
}) {
  return {
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    imageUrl: b.imageUrl,
    linkUrl: b.linkUrl,
    ctaLabel: b.ctaLabel,
  };
}
