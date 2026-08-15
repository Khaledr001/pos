/**
 * Seed a working development tenant.
 *
 * Idempotent — safe to re-run. Everything is keyed on the tenant slug, so a
 * second run updates rather than duplicating.
 *
 * Runs as MIGRATOR with platform-admin context, because it creates the tenant
 * that all the RLS policies are scoped to; there is no tenant to be inside yet.
 *
 *   pnpm db:seed
 */
import {
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_TENANT_SETTINGS,
  SYSTEM_ROLES,
} from "@devsfleet/shared-types";
import { searchKey, slugify } from "@devsfleet/shared-utils";
import bcrypt from "bcryptjs";
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { resolve } from "node:path";
import postgres from "postgres";
import * as schema from "../src/schema/index.js";

config({ path: resolve(import.meta.dirname, "../../../.env") });

const url = process.env.DATABASE_URL_MIGRATOR;
if (!url) {
  console.error("DATABASE_URL_MIGRATOR is not set.");
  process.exit(1);
}

const TENANT_SLUG = "devsfleet";
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@devsfleet.com";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const ADMIN_PIN = process.env.SEED_ADMIN_PIN ?? "1234";

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema, casing: "snake_case" });

try {
  await db.transaction(async (tx) => {
    // Seeding creates the tenant itself, so it cannot run inside a tenant context.
    await tx.execute(sql`SELECT set_config('app.is_platform_admin', 'on', true)`);

    // -------------------------------------------------------------------------
    // Tenant
    // -------------------------------------------------------------------------
    const [tenant] = await tx
      .insert(schema.tenants)
      .values({
        name: "DevsFleet Trading",
        slug: TENANT_SLUG,
        settings: DEFAULT_TENANT_SETTINGS,
      })
      .onConflictDoUpdate({
        target: schema.tenants.slug,
        set: { updatedAt: new Date() },
      })
      .returning();

    if (!tenant) throw new Error("failed to create tenant");
    const tenantId = tenant.id;
    console.log(`✓ tenant ${tenant.name} (${tenantId})`);

    // -------------------------------------------------------------------------
    // Branches — the plan assumes at least two, minimum two terminals each
    // -------------------------------------------------------------------------
    const branchSeed = [
      { name: "Dubai — Main", code: "DXB", phone: "+97140000000" },
      { name: "Sharjah", code: "SHJ", phone: "+97160000000" },
    ];

    const branches = [];
    for (const b of branchSeed) {
      const [branch] = await tx
        .insert(schema.branches)
        .values({ tenantId, ...b })
        .onConflictDoUpdate({
          target: [schema.branches.tenantId, schema.branches.code],
          set: { name: b.name, updatedAt: new Date() },
        })
        .returning();
      if (branch) branches.push(branch);
    }
    console.log(`✓ ${branches.length} branches`);

    // -------------------------------------------------------------------------
    // Roles
    // -------------------------------------------------------------------------
    const roles = new Map<string, string>();
    for (const roleName of SYSTEM_ROLES) {
      const [role] = await tx
        .insert(schema.roles)
        .values({
          tenantId,
          name: roleName,
          isSystem: true,
          permissions: [...(DEFAULT_ROLE_PERMISSIONS[roleName] ?? [])],
        })
        .onConflictDoUpdate({
          target: [schema.roles.tenantId, schema.roles.name],
          set: { permissions: [...(DEFAULT_ROLE_PERMISSIONS[roleName] ?? [])] },
        })
        .returning();
      if (role) roles.set(roleName, role.id);
    }
    console.log(`✓ ${roles.size} roles`);

    // -------------------------------------------------------------------------
    // Admin user
    // -------------------------------------------------------------------------
    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
    const [admin] = await tx
      .insert(schema.users)
      .values({
        tenantId,
        branchId: null, // null = access to every branch
        roleId: roles.get("admin")!,
        name: "Administrator",
        email: ADMIN_EMAIL,
        passwordHash: await bcrypt.hash(ADMIN_PASSWORD, rounds),
        pinHash: await bcrypt.hash(ADMIN_PIN, rounds),
      })
      .onConflictDoNothing()
      .returning();

    if (admin) console.log(`✓ admin user ${ADMIN_EMAIL}`);
    else console.log(`· admin user ${ADMIN_EMAIL} already exists`);

    // -------------------------------------------------------------------------
    // Units — base units this catalogue is stocked in
    // -------------------------------------------------------------------------
    const unitSeed = [
      { name: "Piece", abbreviation: "pcs", allowsFractions: false },
      { name: "Box", abbreviation: "box", allowsFractions: false },
      { name: "Roll", abbreviation: "roll", allowsFractions: false },
      { name: "Metre", abbreviation: "m", allowsFractions: true },
      { name: "Kilogram", abbreviation: "kg", allowsFractions: true },
      { name: "Litre", abbreviation: "ltr", allowsFractions: true },
      { name: "Bag", abbreviation: "bag", allowsFractions: false },
      { name: "Set", abbreviation: "set", allowsFractions: false },
    ];

    const units = new Map<string, string>();
    for (const u of unitSeed) {
      const [unit] = await tx
        .insert(schema.units)
        .values({ tenantId, ...u })
        .onConflictDoUpdate({
          target: [schema.units.tenantId, schema.units.abbreviation],
          set: { name: u.name },
        })
        .returning();
      if (unit) units.set(unit.abbreviation, unit.id);
    }
    console.log(`✓ ${units.size} units`);

    // -------------------------------------------------------------------------
    // Price lists — the resolution tiers the pricing engine walks
    // -------------------------------------------------------------------------
    const priceListSeed = [
      { name: "Retail", type: "retail" as const, isDefault: true },
      { name: "Wholesale", type: "wholesale" as const, isDefault: false },
      { name: "VIP", type: "special" as const, isDefault: false },
    ];

    const priceLists = new Map<string, string>();
    for (const pl of priceListSeed) {
      const existing = await tx.query.priceLists.findFirst({
        where: (t, { and, eq: e }) => and(e(t.tenantId, tenantId), e(t.name, pl.name)),
      });
      if (existing) {
        priceLists.set(pl.name, existing.id);
        continue;
      }
      const [created] = await tx
        .insert(schema.priceLists)
        .values({ tenantId, ...pl, currency: "AED" })
        .returning();
      if (created) priceLists.set(pl.name, created.id);
    }
    console.log(`✓ ${priceLists.size} price lists`);

    // -------------------------------------------------------------------------
    // Categories — placeholder tree, replaced when the real price list arrives
    // -------------------------------------------------------------------------
    const categorySeed = ["Plumbing", "Electrical", "Sanitary", "Paint", "Hardware"];
    const categories = new Map<string, string>();
    for (const [i, name] of categorySeed.entries()) {
      const slug = slugify(name);
      const [category] = await tx
        .insert(schema.categories)
        .values({ tenantId, name, slug, path: slug, depth: 0, sortOrder: i })
        .onConflictDoUpdate({
          target: [schema.categories.tenantId, schema.categories.slug],
          set: { name, sortOrder: i },
        })
        .returning();
      if (category) categories.set(name, category.id);
    }
    console.log(`✓ ${categories.size} categories`);

    // -------------------------------------------------------------------------
    // Sample products — just enough to exercise search, pricing and stock.
    // The real 5,000-SKU catalogue arrives through tools/import.
    // -------------------------------------------------------------------------
    const productSeed = [
      {
        sku: "PVC-ELB-001",
        name: 'PVC Elbow 1" 90 Degree',
        category: "Plumbing",
        unit: "pcs",
        barcode: "6291000000017",
        attributes: { size: '1in', angle: "90", material: "PVC" },
        retail: "2.75",
        wholesale: "2.20",
        cost: "1.60",
        floor: "2.00",
      },
      {
        sku: "PVC-ELB-002",
        name: 'PVC Elbow 3/4" 90 Degree',
        category: "Plumbing",
        unit: "pcs",
        barcode: "6291000000024",
        attributes: { size: "3/4in", angle: "90", material: "PVC" },
        retail: "2.10",
        wholesale: "1.70",
        cost: "1.20",
        floor: "1.55",
      },
      {
        sku: "CBL-25-RED",
        name: "Electrical Cable 2.5mm Red",
        category: "Electrical",
        unit: "m",
        barcode: "6291000000031",
        attributes: { gauge: "2.5mm", colour: "red", material: "copper" },
        retail: "3.50",
        wholesale: "2.95",
        cost: "2.30",
        floor: "2.75",
      },
      {
        sku: "PNT-WHT-4L",
        name: "Emulsion Paint White 4 Litre",
        category: "Paint",
        unit: "ltr",
        barcode: "6291000000048",
        attributes: { colour: "white", volume: "4ltr", finish: "matt" },
        retail: "48.00",
        wholesale: "41.00",
        cost: "33.00",
        floor: "38.00",
      },
      {
        sku: "TAP-MIX-CHR",
        name: "Basin Mixer Tap Chrome",
        category: "Sanitary",
        unit: "pcs",
        barcode: "6291000000055",
        attributes: { finish: "chrome", type: "mixer" },
        retail: "135.00",
        wholesale: "112.00",
        cost: "88.00",
        floor: "105.00",
      },
    ];

    let productCount = 0;
    for (const p of productSeed) {
      const [product] = await tx
        .insert(schema.products)
        .values({
          tenantId,
          sku: p.sku,
          name: p.name,
          barcode: p.barcode,
          searchKey: searchKey(p.name, p.sku),
          categoryId: categories.get(p.category)!,
          unitId: units.get(p.unit)!,
          attributes: p.attributes,
        })
        .onConflictDoUpdate({
          target: [schema.products.tenantId, schema.products.sku],
          set: { name: p.name, searchKey: searchKey(p.name, p.sku) },
        })
        .returning();

      if (!product) continue;
      productCount += 1;

      for (const [listName, price] of [
        ["Retail", p.retail],
        ["Wholesale", p.wholesale],
        ["VIP", p.wholesale],
      ] as const) {
        const priceListId = priceLists.get(listName);
        if (!priceListId) continue;

        const existing = await tx.query.productPrices.findFirst({
          where: (t, { and, eq: e, isNull }) =>
            and(
              e(t.productId, product.id),
              e(t.priceListId, priceListId),
              isNull(t.effectiveTo),
            ),
        });
        if (existing) continue;

        await tx.insert(schema.productPrices).values({
          tenantId,
          productId: product.id,
          priceListId,
          purchasePrice: p.cost,
          sellingPrice: price,
          minSellingPrice: p.floor,
        });
      }

      // Opening stock at every branch, with a ledger row so the balance is
      // explained rather than appearing from nowhere.
      for (const branch of branches) {
        const [inv] = await tx
          .insert(schema.inventory)
          .values({
            tenantId,
            productId: product.id,
            branchId: branch.id,
            quantity: "100",
            reorderLevel: "20",
            reorderQuantity: "100",
            averageCost: p.cost,
          })
          .onConflictDoNothing()
          .returning();

        if (inv) {
          await tx.insert(schema.inventoryTransactions).values({
            tenantId,
            productId: product.id,
            branchId: branch.id,
            type: "opening_balance",
            quantity: "100",
            balanceAfter: "100",
            unitCost: p.cost,
            notes: "Seed opening balance",
          });
        }
      }
    }
    console.log(`✓ ${productCount} products with prices and opening stock`);

    // -------------------------------------------------------------------------
    // Devices — two terminals per branch, per the plan
    // -------------------------------------------------------------------------
    let deviceCount = 0;
    for (const branch of branches) {
      for (const n of [1, 2]) {
        const name = `${branch.code}-POS-${String(n).padStart(2, "0")}`;
        const [device] = await tx
          .insert(schema.devices)
          .values({ tenantId, branchId: branch.id, name, type: "pos" })
          .onConflictDoNothing()
          .returning();
        if (device) deviceCount += 1;
      }
    }
    console.log(`✓ ${deviceCount} POS devices`);
  });

  console.log("\n✓ seed complete");
  console.log(`  tenant slug : ${TENANT_SLUG}`);
  console.log(`  admin email : ${ADMIN_EMAIL}`);
  console.log(`  password    : ${ADMIN_PASSWORD}`);
  console.log(`  POS PIN     : ${ADMIN_PIN}`);
  console.log("\n  Change these before the first deployment.");
} catch (error) {
  console.error("✗ seed failed:", error);
  process.exit(1);
} finally {
  await client.end();
}
