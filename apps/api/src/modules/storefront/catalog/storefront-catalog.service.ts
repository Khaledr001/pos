import { schema, sql, type SQL, type Transaction } from "@devsfleet/db";
import type { TaxMode } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, Money, searchKey } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { currentShopper } from "../context/storefront.guard.js";
import { moneyView, unitNetGross, type MoneyView } from "../pricing/money-view.js";
import { StorefrontPricing, type PricingSubject, type PriceView } from "../pricing/storefront-pricing.service.js";
import type { ListProductsDto } from "./dto.js";

export type StockLabel = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export interface ProductCard {
  id: string;
  slug: string;
  name: string;
  brand: { slug: string; name: string } | null;
  image: { url: string; alt: string } | null;
  fromPrice: MoneyView | null;
  baseUom: string;
  variantCount: number;
  inStock: boolean;
  pickupOnly: boolean;
}

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  children: CategoryNode[];
}

type Crumb = { slug: string; name: string };

/** A shopper's `%` or `_` is a character to find, not a wildcard. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

/** `IN (...)` for a list of values. Callers guard the empty list themselves. */
const list = (values: readonly string[]): SQL => sql.join(values.map((v) => sql`${v}`), sql`, `);

/**
 * The shop window onto the POS catalogue.
 *
 * Reads the POS's own products, variants, prices and inventory — there is no
 * second copy to drift. What makes a product appear here is a published
 * `product_listings` row; everything else (name, price, stock) is whatever the
 * till would say at this moment.
 *
 * Every query runs through `db.run()`, scoped to the storefront's tenant by
 * RLS. None of them names a tenant.
 */
@Injectable()
export class StorefrontCatalogService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly pricing: StorefrontPricing,
  ) {}

  // ---------------------------------------------------------------------------
  // Categories & brands
  // ---------------------------------------------------------------------------

  async categoryTree(): Promise<CategoryNode[]> {
    return this.db.run((tx) => this.categoryTreeIn(tx));
  }

  async categoryTreeIn(tx: Transaction): Promise<CategoryNode[]> {
    const rows = await this.activeCategories(tx);
    const nodes = new Map<string, CategoryNode>(
      rows.map((c) => [c.id, { id: c.id, slug: c.slug, name: c.name, imageUrl: c.imageUrl, children: [] }]),
    );
    const roots: CategoryNode[] = [];
    for (const row of rows) {
      const node = nodes.get(row.id)!;
      const parent = row.parentId ? nodes.get(row.parentId) : undefined;
      (parent ? parent.children : roots).push(node);
    }
    return roots;
  }

  async category(slug: string) {
    return this.db.run(async (tx) => {
      const all = await this.activeCategories(tx);
      const category = all.find((c) => c.slug === slug);
      if (!category) throw new AppError(ERROR_CODES.NOT_FOUND, "That category does not exist.");
      return {
        id: category.id,
        slug: category.slug,
        name: category.name,
        description: category.description,
        imageUrl: category.imageUrl,
        seoTitle: category.seoTitle,
        seoDescription: category.seoDescription,
        breadcrumbs: this.breadcrumbs(all, category.id),
        children: all
          .filter((c) => c.parentId === category.id)
          .map((c) => ({ slug: c.slug, name: c.name, imageUrl: c.imageUrl })),
      };
    });
  }

  async brands() {
    return this.db.run(async (tx) => {
      const rows = await tx.query.brands.findMany({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.isActive, true), n(t.deletedAt)),
        columns: { slug: true, name: true, logoUrl: true, isFeatured: true },
        orderBy: (t, { asc, desc }) => [desc(t.isFeatured), asc(t.name)],
      });
      return rows.map((b) => ({ slug: b.slug, name: b.name, logoUrl: b.logoUrl, featured: b.isFeatured }));
    });
  }

  async brand(slug: string) {
    return this.db.run(async (tx) => {
      const brand = await tx.query.brands.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.slug, slug), e(t.isActive, true), n(t.deletedAt)),
      });
      if (!brand) throw new AppError(ERROR_CODES.NOT_FOUND, "That brand does not exist.");
      return { slug: brand.slug, name: brand.name, logoUrl: brand.logoUrl, description: brand.description };
    });
  }

  // ---------------------------------------------------------------------------
  // Listing
  // ---------------------------------------------------------------------------

  async listProducts(dto: ListProductsDto) {
    return this.db.run(async (tx) => {
      const ctx = await this.listingContext(tx);
      const base: SQL[] = [this.publishedPredicate()];
      let score: SQL | null = null;

      if (dto.category) {
        const category = await tx.query.categories.findFirst({
          where: (t, { and: a, eq: e, isNull: n }) => a(e(t.slug, dto.category!), e(t.isActive, true), n(t.deletedAt)),
          columns: { path: true },
        });
        if (!category) throw new AppError(ERROR_CODES.NOT_FOUND, "That category does not exist.");
        base.push(
          sql`products.category_id IN (SELECT c.id FROM categories c WHERE c.deleted_at IS NULL AND (c.path = ${category.path} OR c.path LIKE ${`${category.path}/%`}))`,
        );
      }

      const terms = dto.q ? this.searchTerms(dto.q) : [];
      if (dto.q && terms.length === 0) {
        return { items: [], total: 0, page: dto.page, pageSize: dto.pageSize, facets: emptyFacets() };
      }
      if (terms.length > 0) {
        const match = this.searchMatch(terms, dto.q!);
        base.push(match.where);
        score = match.score;
      }

      const filters: SQL[] = [];
      if (dto.brand?.length) {
        filters.push(sql`products.brand_id IN (SELECT b.id FROM brands b WHERE b.slug IN (${list(dto.brand)}))`);
      }
      if (dto.inStock) filters.push(this.inStockPredicate(ctx));
      const gross = this.grossFromPrice(ctx);
      if (dto.minPrice != null) filters.push(sql`${gross} >= ${String(dto.minPrice)}::numeric`);
      if (dto.maxPrice != null) filters.push(sql`${gross} <= ${String(dto.maxPrice)}::numeric`);
      for (const [code, raw] of Object.entries(dto.attr ?? {})) {
        const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
        if (values.length === 0) continue;
        filters.push(sql`EXISTS (
          SELECT 1 FROM variant_attribute_values vav
          JOIN attribute_definitions ad ON ad.id = vav.attribute_definition_id
          JOIN product_variants av ON av.id = vav.variant_id
          WHERE av.product_id = products.id AND av.is_active AND av.deleted_at IS NULL
            AND ad.name = ${code} AND vav.value IN (${list(values)}))`);
      }

      const where = sql.join([...base, ...filters], sql` AND `);
      const sort = dto.sort ?? (score ? "relevance" : "newest");
      const orderBy =
        sort === "relevance" && score
          ? sql`${score} DESC, products.name ASC`
          : sort === "price_asc"
            ? sql`${gross} ASC NULLS LAST, products.name ASC`
            : sort === "price_desc"
              ? sql`${gross} DESC NULLS LAST, products.name ASC`
              : sort === "name"
                ? sql`products.name ASC`
                : sql`product_listings.published_at DESC NULLS LAST, products.created_at DESC`;

      const [countRow] = await tx.execute<{ total: number }>(sql`
        SELECT count(*)::int AS total
        FROM products JOIN product_listings ON product_listings.product_id = products.id
        WHERE ${where}`);
      const total = Number(countRow?.total ?? 0);

      const ids = await tx.execute<{ id: string }>(sql`
        SELECT products.id
        FROM products JOIN product_listings ON product_listings.product_id = products.id
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${dto.pageSize} OFFSET ${(dto.page - 1) * dto.pageSize}`);

      if (dto.q && dto.page === 1) {
        const tenantId = RequestContext.requireTenantId();
        await tx.insert(schema.storefrontSearchLogs).values({ tenantId, term: dto.q.slice(0, 120), results: total });
      }

      return {
        items: await this.cards(tx, ids.map((r) => r.id), ctx),
        total,
        page: dto.page,
        pageSize: dto.pageSize,
        facets: await this.facets(tx, sql.join(base, sql` AND `), ctx),
      };
    });
  }

  /** Cards for an explicit set of products, in the order given. Unpublished ones drop out. */
  async productCards(tx: Transaction, productIds: string[]): Promise<ProductCard[]> {
    return this.cards(tx, productIds, await this.listingContext(tx));
  }

  /** Newest, featured, best-selling: cards matching a SQL predicate, in a SQL order. */
  async cardsWhere(tx: Transaction, predicate: SQL, orderBy: SQL, limit: number): Promise<ProductCard[]> {
    const ctx = await this.listingContext(tx);
    const ids = await tx.execute<{ id: string }>(sql`
      SELECT products.id
      FROM products JOIN product_listings ON product_listings.product_id = products.id
      WHERE ${this.publishedPredicate()} AND ${predicate}
      ORDER BY ${orderBy}
      LIMIT ${limit}`);
    return this.cards(tx, ids.map((r) => r.id), ctx);
  }

  // ---------------------------------------------------------------------------
  // Product detail
  // ---------------------------------------------------------------------------

  async product(slug: string) {
    return this.db.run(async (tx) => {
      const listing = await tx.query.productListings.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.slug, slug), e(t.isPublished, true)),
      });
      const product = listing
        ? await tx.query.products.findFirst({
            where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, listing.productId), e(t.isActive, true), n(t.deletedAt)),
            with: {
              brand: true,
              category: true,
              unit: true,
              images: { orderBy: (t, { asc, desc }) => [desc(t.isPrimary), asc(t.sortOrder)] },
              variants: {
                where: (t, { and: a, eq: e, isNull: n }) => a(e(t.isActive, true), n(t.deletedAt)),
                orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.variantName)],
                with: {
                  packagings: { with: { unit: true } },
                  attributeValues: { with: { definition: true } },
                },
              },
            },
          })
        : null;
      if (!listing || !product || product.variants.length === 0) {
        throw new AppError(ERROR_CODES.PRODUCT_NOT_FOUND, "That product is not available online.");
      }

      const ctx = await this.listingContext(tx);
      const subjects: PricingSubject[] = product.variants.map((v) => ({
        variantId: v.id,
        taxRate: product.taxRate,
        units: [
          { unitId: product.unitId, uom: product.unit.abbreviation, conversionFactor: "1", priceOverride: null },
          ...v.packagings
            .filter((p) => p.isSellable)
            .map((p) => ({
              unitId: p.unitId,
              uom: p.unit.abbreviation,
              conversionFactor: p.conversionFactor,
              priceOverride: p.priceOverride,
            })),
        ],
      }));

      const customerId = currentShopper()?.customerId ?? null;
      const [sheet, availability, categories, links] = await Promise.all([
        this.pricing.priceSheet(tx, subjects, customerId),
        this.availability(tx, product.variants.map((v) => ({ id: v.id, minStock: v.minStock })), product.isStockTracked, ctx),
        this.activeCategories(tx),
        tx.query.productLinks.findMany({
          where: (t, { eq: e }) => e(t.productId, product.id),
          orderBy: (t, { asc }) => asc(t.sortOrder),
        }),
      ]);

      const linkedCards = await this.cards(tx, [...new Set(links.map((l) => l.linkedProductId))], ctx);
      const cardBy = new Map(linkedCards.map((c) => [c.id, c]));
      const linked = (kind: string) =>
        links.filter((l) => l.kind === kind).map((l) => cardBy.get(l.linkedProductId)).filter((c): c is ProductCard => !!c);

      const optionAxes = new Map<string, Set<string>>();
      for (const variant of product.variants) {
        for (const [key, value] of Object.entries(variant.attributes ?? {})) {
          if (!optionAxes.has(key)) optionAxes.set(key, new Set());
          optionAxes.get(key)!.add(String(value));
        }
      }

      const images = product.images.length
        ? product.images.map((i) => ({ url: i.url, alt: i.altText ?? product.name }))
        : product.imageUrl
          ? [{ url: product.imageUrl, alt: product.name }]
          : [];
      const taxPercent = this.pricing.taxPercentFor(product.taxRate);

      return {
        id: product.id,
        slug: listing.slug,
        name: product.name,
        description: product.description,
        specs: listing.specs,
        seoTitle: listing.seoTitle,
        seoDescription: listing.seoDescription,
        pickupOnly: listing.pickupOnly,
        taxPercent,
        vatClass: Money.isZero(Money.toMinor(taxPercent)) ? ("ZERO" as const) : ("STANDARD_5" as const),
        brand: product.brand ? { slug: product.brand.slug, name: product.brand.name, logoUrl: product.brand.logoUrl } : null,
        category: product.category ? { slug: product.category.slug, name: product.category.name } : null,
        breadcrumbs: product.categoryId ? this.breadcrumbs(categories, product.categoryId) : [],
        images,
        documents: listing.documents,
        optionAxes: [...optionAxes.entries()].map(([code, values]) => ({ code, values: [...values] })),
        variants: product.variants.map((variant) => {
          const stock = availability.get(variant.id)!;
          return {
            id: variant.id,
            sku: variant.sku,
            name: variant.variantName,
            options: Object.fromEntries(Object.entries(variant.attributes ?? {}).map(([k, v]) => [k, String(v)])),
            baseUom: product.unit.abbreviation,
            weightGrams: variant.weight ? Math.round(Number(variant.weight) * 1000) : 0,
            attributes: variant.attributeValues.map((av) => ({
              code: av.definition.name,
              name: av.definition.label,
              value: av.value,
              unit: av.definition.unit,
            })),
            units: (sheet.get(variant.id) ?? []).map((u) => ({
              uom: u.uom,
              unitId: u.unitId,
              factor: Number(subjects.find((s) => s.variantId === variant.id)!.units.find((x) => x.unitId === u.unitId)!.conversionFactor),
              price: u.price,
            })),
            availability: stock,
          };
        }),
        related: linked("related"),
        alternatives: linked("alternative"),
        boughtTogether: linked("bought_together"),
      };
    });
  }

  /** Personalised prices — trade customers see their own list. Never cached for everyone. */
  async prices(skus: string[]) {
    if (skus.length === 0) return {};
    return this.db.run(async (tx) => {
      const variants = await tx.query.productVariants.findMany({
        where: (t, { and: a, inArray: i, eq: e, isNull: n }) => a(i(t.sku, skus), e(t.isActive, true), n(t.deletedAt)),
        with: { product: { with: { unit: true } }, packagings: { with: { unit: true } } },
      });
      const subjects: PricingSubject[] = variants.map((v) => ({
        variantId: v.id,
        taxRate: v.product.taxRate,
        units: [
          { unitId: v.product.unitId, uom: v.product.unit.abbreviation, conversionFactor: "1", priceOverride: null },
          ...v.packagings
            .filter((p) => p.isSellable)
            .map((p) => ({ unitId: p.unitId, uom: p.unit.abbreviation, conversionFactor: p.conversionFactor, priceOverride: p.priceOverride })),
        ],
      }));
      const sheet = await this.pricing.priceSheet(tx, subjects, currentShopper()?.customerId ?? null);
      return Object.fromEntries(
        variants.map((v) => [v.sku, (sheet.get(v.id) ?? []).map((u) => ({ uom: u.uom, price: u.price }))]),
      ) as Record<string, { uom: string; price: PriceView }[]>;
    });
  }

  async suggest(q: string) {
    const terms = this.searchTerms(q);
    if (q.trim().length < 2 || terms.length === 0) return { products: [], categories: [], brands: [] };
    return this.db.run(async (tx) => {
      const match = this.searchMatch(terms, q);
      const like = `%${escapeLike(q.trim())}%`;
      const [products, categories, brands] = await Promise.all([
        this.cardsWhere(tx, match.where, sql`${match.score} DESC`, 8),
        tx.execute<Crumb>(sql`SELECT slug, name FROM categories WHERE is_active AND deleted_at IS NULL AND name ILIKE ${like} ORDER BY name LIMIT 4`),
        tx.execute<Crumb>(sql`SELECT slug, name FROM brands WHERE is_active AND deleted_at IS NULL AND name ILIKE ${like} ORDER BY name LIMIT 4`),
      ]);
      return { products, categories: [...categories], brands: [...brands] };
    });
  }

  // ---------------------------------------------------------------------------
  // Availability
  // ---------------------------------------------------------------------------

  /**
   * What the shop may promise, per variant and per branch shown online.
   *
   * On hand minus reserved minus the safety buffer — the buffer is what stops
   * the last unit being sold at the counter and online in the same minute.
   */
  async availability(
    tx: Transaction,
    variants: { id: string; minStock: string }[],
    isStockTracked: boolean,
    ctx?: ListingContext,
  ) {
    const context = ctx ?? (await this.listingContext(tx));
    const result = new Map<
      string,
      { label: StockLabel; available: number; branches: { code: string; name: string; label: StockLabel }[] }
    >();
    if (variants.length === 0) return result;

    const rows = context.branchIds.length
      ? await tx.execute<{ variant_id: string; branch_id: string; free: string }>(sql`
          SELECT variant_id, branch_id, (quantity - reserved_quantity)::text AS free
          FROM inventory
          WHERE variant_id IN (${list(variants.map((v) => v.id))}) AND branch_id IN (${list(context.branchIds)})`)
      : [];
    const freeBy = new Map(rows.map((r) => [`${r.variant_id}:${r.branch_id}`, Money.toMinor(r.free)]));
    const buffer = Money.toMinor(String(context.buffer));

    for (const variant of variants) {
      const minStock = Money.toMinor(variant.minStock);
      const label = (free: bigint): StockLabel =>
        !isStockTracked ? "IN_STOCK" : free <= 0n ? "OUT_OF_STOCK" : free <= minStock ? "LOW_STOCK" : "IN_STOCK";

      let total = 0n;
      const branches = context.branches.map((branch) => {
        const free = Money.max((freeBy.get(`${variant.id}:${branch.id}`) ?? 0n) - buffer, 0n);
        total += free;
        return { code: branch.code, name: branch.name, label: label(free) };
      });
      result.set(variant.id, {
        label: label(total),
        available: isStockTracked ? Number(Money.toDecimalString(total, 0)) : 9999,
        branches,
      });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** Settings every listing query needs, read once per request. */
  async listingContext(tx: Transaction): Promise<ListingContext> {
    const { settings, tenantSettings } = RequestContext.requireStorefront();
    const shown = new Set(settings.branches.map((b) => b.branchId));
    const branches = (
      await tx.query.branches.findMany({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.isActive, true), n(t.deletedAt)),
        columns: { id: true, code: true, name: true },
        orderBy: (t, { asc }) => asc(t.name),
      })
    ).filter((b) => shown.size === 0 || shown.has(b.id));

    return {
      branches,
      branchIds: branches.map((b) => b.id),
      buffer: settings.checkout.stockSafetyBuffer,
      defaultListId: await this.pricing.defaultListId(tx),
      defaultTaxRate: String(tenantSettings.tax.defaultRate),
      taxInclusive: tenantSettings.tax.mode === "inclusive",
      currency: tenantSettings.currency.base,
      decimals: tenantSettings.currency.decimals,
      taxMode: tenantSettings.tax.mode,
    };
  }

  private publishedPredicate(): SQL {
    return sql`product_listings.is_published AND products.is_active AND products.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = products.id AND pv.is_active AND pv.deleted_at IS NULL)`;
  }

  private inStockPredicate(ctx: ListingContext): SQL {
    if (ctx.branchIds.length === 0) return sql`NOT products.is_stock_tracked`;
    return sql`(NOT products.is_stock_tracked OR EXISTS (
      SELECT 1 FROM inventory i JOIN product_variants iv ON iv.id = i.variant_id
      WHERE iv.product_id = products.id AND iv.is_active AND iv.deleted_at IS NULL
        AND i.branch_id IN (${list(ctx.branchIds)})
        AND i.quantity - i.reserved_quantity > ${String(ctx.buffer)}::numeric))`;
  }

  /** Lowest base-tier price on the default list, net, per product. */
  private netFromPrice(ctx: ListingContext): SQL {
    if (!ctx.defaultListId) return sql`NULL::numeric`;
    return sql`(SELECT min(pp.selling_price) FROM product_prices pp
      JOIN product_variants fv ON fv.id = pp.variant_id
      WHERE fv.product_id = products.id AND fv.is_active AND fv.deleted_at IS NULL
        AND pp.price_list_id = ${ctx.defaultListId} AND pp.min_quantity = 1
        AND pp.effective_from <= current_date AND (pp.effective_to IS NULL OR pp.effective_to >= current_date))`;
  }

  /**
   * The same figure, VAT-inclusive, for filtering and sorting only. Display
   * goes through calculateLine — see `cards`.
   */
  private grossFromPrice(ctx: ListingContext): SQL {
    const net = this.netFromPrice(ctx);
    if (ctx.taxInclusive) return net;
    return sql`(${net} * (1 + coalesce(products.tax_rate, ${ctx.defaultTaxRate}::numeric) / 100))`;
  }

  /**
   * The query as word slots: each slot is one typed word plus its synonyms.
   * A product matches when every slot does — "brass tap" must find brass
   * taps, not everything brass and everything that is a tap.
   */
  private searchTerms(q: string): string[][] {
    const key = searchKey(q);
    if (!key) return [];
    const { settings } = RequestContext.requireStorefront();
    const groups = settings.search.synonyms.map((group) => group.map((w) => searchKey(w)).filter(Boolean));
    return key
      .split(" ")
      .slice(0, 6)
      .map((word) => [...new Set([word, ...groups.filter((g) => g.includes(word)).flat()])]);
  }

  /**
   * Typo-tolerant match on the variant search key the POS already maintains
   * (trigram-indexed), with English full text on the product name as a
   * fallback for stemmed plurals.
   *
   * Fuzzy matching is for words of five letters or more. Below that, trigram
   * similarity says "wire" resembles "with", and every product with a
   * description reading "with 2 batteries" turns up under cable.
   */
  private searchMatch(slots: string[][], raw: string): { where: SQL; score: SQL } {
    const wordMatch = (word: string) =>
      word.length >= 5
        ? sql`(sv.search_key ILIKE ${`%${word}%`} OR word_similarity(${word}, sv.search_key) >= 0.4)`
        : sql`sv.search_key ILIKE ${`%${word}%`}`;
    const allSlots = sql.join(
      slots.map((slot) => sql`(${sql.join(slot.map(wordMatch), sql` OR `)})`),
      sql` AND `,
    );
    const where = sql`(EXISTS (SELECT 1 FROM product_variants sv
        WHERE sv.product_id = products.id AND sv.is_active AND sv.deleted_at IS NULL
          AND ((${allSlots}) OR sv.barcode = ${raw.trim()} OR sv.sku ILIKE ${`${escapeLike(raw.trim())}%`}))
      OR products.name_search @@ plainto_tsquery('english', ${raw}))`;
    const slotScore = sql.join(
      slots.map((slot) => sql`greatest(${sql.join(slot.map((w) => sql`word_similarity(${w}, sv.search_key)`), sql`, `)})`),
      sql` + `,
    );
    const score = sql`(SELECT coalesce(max(${slotScore}), 0) FROM product_variants sv
        WHERE sv.product_id = products.id AND sv.is_active AND sv.deleted_at IS NULL)
      + ts_rank(products.name_search, plainto_tsquery('english', ${raw}))`;
    return { where, score };
  }

  private async cards(tx: Transaction, productIds: string[], ctx: ListingContext): Promise<ProductCard[]> {
    if (productIds.length === 0) return [];
    const rows = await tx.execute<{
      id: string;
      slug: string;
      name: string;
      brand_slug: string | null;
      brand_name: string | null;
      image_url: string | null;
      image_alt: string | null;
      base_uom: string;
      variant_count: number;
      pickup_only: boolean;
      tax_rate: string | null;
      net_from: string | null;
      in_stock: boolean;
    }>(sql`
      SELECT products.id, product_listings.slug, products.name,
        b.slug AS brand_slug, b.name AS brand_name,
        coalesce(pi.url, products.image_url) AS image_url, pi.alt_text AS image_alt,
        u.abbreviation AS base_uom,
        (SELECT count(*)::int FROM product_variants cv WHERE cv.product_id = products.id AND cv.is_active AND cv.deleted_at IS NULL) AS variant_count,
        product_listings.pickup_only,
        products.tax_rate::text AS tax_rate,
        ${this.netFromPrice(ctx)}::text AS net_from,
        ${this.inStockPredicate(ctx)} AS in_stock
      FROM products
      JOIN product_listings ON product_listings.product_id = products.id
      JOIN units u ON u.id = products.unit_id
      LEFT JOIN brands b ON b.id = products.brand_id
      LEFT JOIN LATERAL (
        SELECT url, alt_text FROM product_images WHERE product_id = products.id
        ORDER BY is_primary DESC, sort_order ASC LIMIT 1
      ) pi ON true
      WHERE products.id IN (${list(productIds)}) AND ${this.publishedPredicate()}`);

    const byId = new Map(
      rows.map((r) => {
        const fromPrice = r.net_from
          ? moneyView(
              unitNetGross(r.net_from, r.tax_rate ?? ctx.defaultTaxRate, ctx.taxMode, ctx.decimals).gross,
              ctx.currency,
              ctx.decimals,
            )
          : null;
        const card: ProductCard = {
          id: r.id,
          slug: r.slug,
          name: r.name,
          brand: r.brand_slug ? { slug: r.brand_slug, name: r.brand_name! } : null,
          image: r.image_url ? { url: r.image_url, alt: r.image_alt ?? r.name } : null,
          fromPrice,
          baseUom: r.base_uom,
          variantCount: Number(r.variant_count),
          inStock: Boolean(r.in_stock),
          pickupOnly: Boolean(r.pickup_only),
        };
        return [r.id, card] as const;
      }),
    );
    return productIds.map((id) => byId.get(id)).filter((c): c is ProductCard => !!c);
  }

  /** Facets over the category/search set, before brand, price and attribute filters narrow it. */
  private async facets(tx: Transaction, base: SQL, ctx: ListingContext) {
    const scope = sql`SELECT products.id FROM products JOIN product_listings ON product_listings.product_id = products.id WHERE ${base}`;
    const gross = this.grossFromPrice(ctx);
    const [brands, attributes, price] = await Promise.all([
      tx.execute<{ slug: string; name: string; count: number }>(sql`
        SELECT b.slug, b.name, count(*)::int AS count
        FROM products JOIN brands b ON b.id = products.brand_id
        WHERE products.id IN (${scope})
        GROUP BY b.slug, b.name ORDER BY count DESC, b.name`),
      tx.execute<{ code: string; name: string; unit: string | null; value: string; count: number }>(sql`
        SELECT ad.name AS code, ad.label AS name, ad.unit, vav.value, count(DISTINCT av.product_id)::int AS count
        FROM variant_attribute_values vav
        JOIN attribute_definitions ad ON ad.id = vav.attribute_definition_id
        JOIN product_variants av ON av.id = vav.variant_id AND av.is_active AND av.deleted_at IS NULL
        WHERE av.product_id IN (${scope})
        GROUP BY ad.name, ad.label, ad.unit, ad.sort_order, vav.value
        ORDER BY ad.sort_order, ad.name, vav.value`),
      tx.execute<{ min: string | null; max: string | null }>(sql`
        SELECT min(g)::text AS min, max(g)::text AS max FROM (
          SELECT ${gross} AS g FROM products WHERE products.id IN (${scope})
        ) prices`),
    ]);

    const grouped: { code: string; name: string; unit: string | null; values: { value: string; count: number }[] }[] = [];
    for (const row of attributes) {
      let facet = grouped.find((f) => f.code === row.code);
      if (!facet) grouped.push((facet = { code: row.code, name: row.name, unit: row.unit, values: [] }));
      facet.values.push({ value: row.value, count: Number(row.count) });
    }

    // Slider bounds, in major units. Display only — nothing is computed from them.
    const bound = (value: string | null) => (value == null ? null : Number(Money.toDecimalString(Money.toMinor(value), 2)));
    const [range] = price;
    return {
      brands: [...brands].map((b) => ({ slug: b.slug, name: b.name, count: Number(b.count) })),
      // A filter with one value cannot narrow anything.
      attributes: grouped.filter((f) => f.values.length > 1),
      price: range?.min != null ? { min: bound(range.min), max: bound(range.max) } : null,
    };
  }

  private async activeCategories(tx: Transaction) {
    return tx.query.categories.findMany({
      where: (t, { and: a, eq: e, isNull: n }) => a(e(t.isActive, true), n(t.deletedAt)),
      columns: {
        id: true,
        parentId: true,
        slug: true,
        name: true,
        imageUrl: true,
        description: true,
        seoTitle: true,
        seoDescription: true,
      },
      orderBy: (t, { asc }) => [asc(t.sortOrder), asc(t.name)],
    });
  }

  private breadcrumbs(all: { id: string; parentId: string | null; slug: string; name: string }[], categoryId: string): Crumb[] {
    const byId = new Map(all.map((c) => [c.id, c]));
    const trail: Crumb[] = [];
    let current = byId.get(categoryId);
    // Depth is capped at 5 by CategoriesService; the bound guards a corrupt cycle.
    for (let depth = 0; current && depth < 10; depth++) {
      trail.unshift({ slug: current.slug, name: current.name });
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return trail;
  }
}

export interface ListingContext {
  branches: { id: string; code: string; name: string }[];
  branchIds: string[];
  buffer: number;
  defaultListId: string | null;
  defaultTaxRate: string;
  taxInclusive: boolean;
  taxMode: TaxMode;
  currency: string;
  decimals: number;
}

function emptyFacets() {
  return { brands: [], attributes: [], price: null };
}
