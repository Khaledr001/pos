import { sql, type Transaction } from "@devsfleet/db";
import {
  COMMERCE_SECTION_TYPES,
  HOME_SECTION_TYPES,
  resolveSiteFeatures,
  type HomeSection,
  type SiteFeatures,
} from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { StorefrontCatalogService } from "../catalog/storefront-catalog.service.js";

/** Enough for the largest product-row section (limit 12); each section slices what it shows. */
const HOME_CARDS = 12;

/**
 * The sections a visitor may be shown. A type this build does not know (a newer
 * admin saved it) is skipped rather than breaking the page; a site with no
 * products (showcase) never renders the sections that need them, even if a
 * template or an earlier mode left them in the list.
 */
export function visibleSections(sections: readonly HomeSection[] | null | undefined, features: SiteFeatures): HomeSection[] {
  const known = new Set<string>(HOME_SECTION_TYPES);
  const commerce = new Set<string>(COMMERCE_SECTION_TYPES);
  return (sections ?? []).filter((s) => s.enabled && known.has(s.type) && (features.products || !commerce.has(s.type)));
}

@Injectable()
export class StorefrontContentService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly catalog: StorefrontCatalogService,
  ) {}

  async home() {
    const { settings } = RequestContext.requireStorefront();
    const features = resolveSiteFeatures(settings.site);
    const sections = visibleSections(settings.homeSections, features);
    return this.db.run(async (tx) => {
      // A site with no products runs no catalogue queries at all.
      const [banners, categories, brands, bestSellers, newArrivals] = await Promise.all([
        this.activeBanners(tx),
        features.products ? this.catalog.categoryTreeIn(tx) : [],
        features.products
          ? tx.query.brands.findMany({
              where: (t, { and: a, eq: e, isNull: n }) => a(e(t.isActive, true), e(t.isFeatured, true), n(t.deletedAt)),
              columns: { slug: true, name: true, logoUrl: true },
              orderBy: (t, { asc }) => asc(t.name),
              limit: 12,
            })
          : [],
        features.products ? this.bestSellers(tx) : [],
        features.products
          ? this.catalog.cardsWhere(tx, sql`true`, sql`product_listings.published_at DESC NULLS LAST, products.created_at DESC`, HOME_CARDS)
          : [],
      ]);

      return {
        hero: banners.filter((b) => b.placement === "home_hero").map(toBanner),
        strip: banners.filter((b) => b.placement === "home_strip").map(toBanner),
        categories: categories.map((c) => ({
          slug: c.slug,
          name: c.name,
          imageUrl: c.imageUrl,
          productCount: c.productCount,
          children: c.children.map((child) => ({ slug: child.slug, name: child.name })),
        })),
        featuredBrands: brands.map((b) => ({ ...b, featured: true })),
        bestSellers,
        newArrivals,
        sections,
      };
    });
  }

  async page(slug: string) {
    const { settings } = RequestContext.requireStorefront();
    const features = resolveSiteFeatures(settings.site);
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
        // null = a plain text page; a page with sections is rendered from them.
        sections: page.sections ? visibleSections(page.sections, features) : null,
        layout: page.layout,
        updatedAt: page.updatedAt,
      };
    });
  }

  /** Published content pages, for the sitemap. Blog guides are listed by `blog()`. */
  async pages() {
    return this.db.run(async (tx) => {
      const rows = await tx.query.storefrontPages.findMany({
        where: (t, { and: a, eq: e }) => a(e(t.kind, "page"), e(t.isPublished, true)),
        columns: { slug: true, title: true, updatedAt: true },
        orderBy: (t, { asc }) => asc(t.slug),
        limit: 500,
      });
      return rows;
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
      timezone: tenantSettings.locale.timezone,
      theme: settings.theme,
      navigation: settings.navigation,
      region: settings.region,
      site: settings.site,
      // Derived here once so the storefront never re-implements the mode rules; the API enforces the same flags.
      features: resolveSiteFeatures(settings.site),
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
