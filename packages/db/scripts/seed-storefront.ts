/**
 * Put a tenant's online store on the air.
 *
 *   pnpm db:seed:storefront -- --tenant <slug> --domain shop.example.ae[,localhost]
 *
 * Idempotent, and additive only: it never unpublishes, renames or deletes
 * anything, so it is safe to run against a tenant that already sells online.
 * What it does:
 *
 *   - creates the tenant's storefront and attaches the given domains;
 *   - creates the non-stock "Delivery" variant a courier fee is invoiced on;
 *   - lists and publishes every active product that has no listing yet;
 *   - adds starter pages (about, delivery & returns, …), banners and the two
 *     demo coupons — each only if a row with that slug / code is missing.
 *
 * Prices, stock and product names are not touched. They are the POS's.
 */
import { DEFAULT_STOREFRONT_SETTINGS, type StorefrontSettings } from "@devsfleet/shared-types";
import { slugify, variantSearchKey } from "@devsfleet/shared-utils";
import { config } from "dotenv";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import postgres from "postgres";
import * as schema from "../src/schema/index.js";

config({ path: resolve(import.meta.dirname, "../../../.env") });
config({ path: resolve(process.cwd(), ".env") });

const { values: args } = parseArgs({
  options: {
    tenant: { type: "string" },
    domain: { type: "string" },
    /** The shop's public origin, when https://<first domain> is wrong — e.g. http://localhost:3000. */
    "site-url": { type: "string" },
  },
  // pnpm forwards a literal "--" ahead of the script's own arguments.
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
});

const url = process.env.DATABASE_URL_MIGRATOR;
if (!url || !args.tenant || !args.domain) {
  console.error("Usage: DATABASE_URL_MIGRATOR=... pnpm db:seed:storefront -- --tenant <slug> --domain <host>[,<host>] [--site-url http://localhost:3000]");
  process.exit(1);
}

const domains = args.domain
  .split(",")
  .map((d) => d.trim().toLowerCase().replace(/:\d+$/, ""))
  .filter(Boolean);

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema, casing: "snake_case" });

const PAGES: { slug: string; title: string; body: string; kind?: "page" | "blog"; excerpt?: string }[] = [
  {
    slug: "about",
    title: "About us",
    body: "We supply hardware, electrical, sanitary ware and building materials to homeowners and contractors across the UAE.\n\nEvery product on this site is the same stock we sell over the counter, at the same prices.",
  },
  {
    slug: "delivery-returns",
    title: "Delivery & returns",
    body: "## Delivery\n\nCourier delivery to every emirate. Heavy and bulky items are pickup only — they are marked on the product page.\n\n## Store pickup\n\nChoose a branch and a time slot at checkout. We will message you when your order is ready.\n\n## Returns\n\nUnused items in their original packaging can be returned within 14 days with the tax invoice.",
  },
  { slug: "warranty", title: "Warranty", body: "Manufacturer warranties apply. The warranty period is printed on your tax invoice." },
  { slug: "faq", title: "Frequently asked questions", body: "## Are prices VAT-inclusive?\n\nYes. Every price shown includes 5% VAT, and your tax invoice shows the breakdown." },
  { slug: "privacy", title: "Privacy policy", body: "We use your details only to process and deliver your order, in line with the UAE Personal Data Protection Law." },
  { slug: "terms", title: "Terms & conditions", body: "Orders are confirmed once stock has been reserved. Prices are those shown at the time the order is placed." },
  {
    slug: "choosing-the-right-cable-size",
    kind: "blog",
    title: "Choosing the right cable size",
    excerpt: "A quick guide to cable cross-sections for common household circuits.",
    body: "Lighting circuits typically use 1.5 mm² cable and socket circuits 2.5 mm². Always confirm with a licensed electrician for your installation.",
  },
];

async function main(): Promise<void> {
  await db.transaction(async (tx) => {
    // The migrator role is subject to FORCE ROW LEVEL SECURITY too; this is
    // the deliberate platform-wide context, scoped to this transaction.
    await tx.execute(sql`SELECT set_config('app.is_platform_admin', 'on', true)`);

    const tenant = await tx.query.tenants.findFirst({ where: eq(schema.tenants.slug, args.tenant!) });
    if (!tenant) throw new Error(`No tenant with slug "${args.tenant}".`);
    const tenantId = tenant.id;

    const branches = await tx.query.branches.findMany({
      where: and(eq(schema.branches.tenantId, tenantId), eq(schema.branches.isActive, true), isNull(schema.branches.deletedAt)),
      orderBy: schema.branches.name,
    });
    if (branches.length === 0) throw new Error("The tenant has no active branch to fulfil online orders from.");

    // --- delivery line -----------------------------------------------------
    const deliveryVariantId = await ensureDeliveryVariant(tx, tenantId);

    // --- storefront ----------------------------------------------------------
    let storefront = await tx.query.storefronts.findFirst({ where: eq(schema.storefronts.tenantId, tenantId) });
    if (!storefront) {
      const settings: Partial<StorefrontSettings> = {
        ...DEFAULT_STOREFRONT_SETTINGS,
        ...(args["site-url"] ? { siteUrl: args["site-url"] } : {}),
        checkout: {
          ...DEFAULT_STOREFRONT_SETTINGS.checkout,
          fulfilmentBranchId: branches[0]!.id,
          deliveryVariantId,
        },
        branches: branches.map((b) => ({
          branchId: b.id,
          emirate: "DUBAI",
          lat: null,
          lng: null,
          openingHours: { "mon-sat": "08:00-20:00", sun: "closed" },
          pickupEnabled: true,
        })),
        search: { synonyms: [["tap", "faucet", "mixer"], ["bulb", "lamp"], ["wire", "cable"]] },
      };
      [storefront] = await tx.insert(schema.storefronts).values({ tenantId, name: tenant.name, settings }).returning();
      console.log(`✓ storefront created for ${tenant.name}`);
    } else {
      console.log(`· storefront already exists for ${tenant.name}`);
    }

    for (const [index, domain] of domains.entries()) {
      const taken = await tx.query.storefrontDomains.findFirst({ where: eq(schema.storefrontDomains.domain, domain) });
      if (taken && taken.tenantId !== tenantId) {
        throw new Error(`Domain "${domain}" already belongs to another tenant's storefront.`);
      }
      if (!taken) {
        await tx.insert(schema.storefrontDomains).values({
          tenantId,
          storefrontId: storefront!.id,
          domain,
          isPrimary: index === 0,
        });
        console.log(`✓ domain ${domain}`);
      }
    }

    // --- listings ------------------------------------------------------------
    const unlisted = await tx.execute<{ id: string; name: string; sku: string }>(sql`
      SELECT p.id, p.name, p.sku FROM products p
      WHERE p.tenant_id = ${tenantId} AND p.is_active AND p.deleted_at IS NULL
        AND p.is_stock_tracked
        AND NOT EXISTS (SELECT 1 FROM product_listings l WHERE l.product_id = p.id)
      ORDER BY p.created_at`);
    const taken = new Set(
      (
        await tx
          .select({ slug: schema.productListings.slug })
          .from(schema.productListings)
          .where(eq(schema.productListings.tenantId, tenantId))
      ).map((r) => r.slug),
    );
    for (const product of unlisted) {
      let slug = slugify(product.name) || slugify(product.sku);
      if (taken.has(slug)) slug = `${slug}-${slugify(product.sku)}`.slice(0, 255);
      taken.add(slug);
      await tx.insert(schema.productListings).values({
        tenantId,
        productId: product.id,
        slug,
        isPublished: true,
        publishedAt: new Date(),
      });
    }
    console.log(`✓ ${unlisted.length} product(s) listed and published`);

    // Feature the brands with the most products, so the home page has a strip.
    await tx.execute(sql`
      UPDATE brands SET is_featured = true WHERE id IN (
        SELECT brand_id FROM products WHERE tenant_id = ${tenantId} AND brand_id IS NOT NULL
        GROUP BY brand_id ORDER BY count(*) DESC LIMIT 6)
      AND NOT EXISTS (SELECT 1 FROM brands b2 WHERE b2.tenant_id = ${tenantId} AND b2.is_featured)`);

    // --- content -------------------------------------------------------------
    for (const page of PAGES) {
      await tx
        .insert(schema.storefrontPages)
        .values({
          tenantId,
          slug: page.slug,
          title: page.title,
          body: page.body,
          kind: page.kind ?? "page",
          excerpt: page.excerpt ?? null,
          isPublished: true,
          publishedAt: new Date(),
        })
        .onConflictDoNothing({ target: [schema.storefrontPages.tenantId, schema.storefrontPages.slug] });
    }

    const hasBanners = await tx.query.storefrontBanners.findFirst({ where: eq(schema.storefrontBanners.tenantId, tenantId) });
    if (!hasBanners) {
      await tx.insert(schema.storefrontBanners).values([
        { tenantId, placement: "home_hero", title: "Everything for the build, in one place", subtitle: "Hardware, electrical, sanitary and paint — at counter prices.", ctaLabel: "Shop now", linkUrl: "/search", sortOrder: 0 },
        { tenantId, placement: "home_hero", title: "Trade account?", subtitle: "Contractors get their own price list online.", ctaLabel: "Apply", linkUrl: "/trade", sortOrder: 1 },
        { tenantId, placement: "home_strip", title: "Free delivery over AED 300 in Dubai and Sharjah", sortOrder: 0 },
      ]);
    }

    await tx
      .insert(schema.coupons)
      .values([
        { tenantId, code: "WELCOME10", type: "percent", value: "10", minSubtotal: "100" },
        { tenantId, code: "FREESHIP", type: "free_shipping", value: "0", minSubtotal: "200" },
      ])
      .onConflictDoNothing({ target: [schema.coupons.tenantId, schema.coupons.code] });

    console.log("✓ pages, banners and coupons in place");
  });
}

/**
 * A courier fee is a line on the order, taxed and invoiced by the same
 * calculateDocument call as the goods. It needs a variant to hang off: one
 * non-stock-tracked product per tenant, never listed online.
 */
async function ensureDeliveryVariant(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], tenantId: string) {
  const sku = "WEB-DELIVERY";
  const existing = await tx.query.productVariants.findFirst({
    where: and(eq(schema.productVariants.tenantId, tenantId), eq(schema.productVariants.sku, sku)),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const units = await tx.query.units.findMany({ where: eq(schema.units.tenantId, tenantId) });
  let unit = units.find((u) => ["pc", "pcs", "piece"].includes(u.abbreviation.toLowerCase())) ?? units[0];
  if (!unit) {
    [unit] = await tx.insert(schema.units).values({ tenantId, name: "Piece", abbreviation: "pc" }).returning();
  }

  const [product] = await tx
    .insert(schema.products)
    .values({ tenantId, sku, name: "Delivery", unitId: unit!.id, isStockTracked: false })
    .returning({ id: schema.products.id });
  const [variant] = await tx
    .insert(schema.productVariants)
    .values({
      tenantId,
      productId: product!.id,
      sku,
      searchKey: variantSearchKey({ productName: "Delivery", sku }),
    })
    .returning({ id: schema.productVariants.id });
  console.log("✓ delivery line created (WEB-DELIVERY)");
  return variant!.id;
}

try {
  await main();
} catch (error) {
  console.error("✗", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
