/**
 * Multi-Tenant Seed Script for DevsFleet SaaS Platform
 *
 * Populates all tables across 3 distinct business tenants:
 *   1. devsfleet (DevsFleet Trading LLC - Hardware, Tools & Electricals)
 *   2. almanar-paints (Al Manar Paint & Decor LLC - Custom Tinting & Coatings)
 *   3. gulf-sanitary (Gulf Sanitary & MEP Supplies W.L.L - Plumbing & Sanitary)
 *
 * Idempotent: Safe to re-run. Checks and updates existing records gracefully.
 * Run with: pnpm db:seed
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
config({ path: resolve(process.cwd(), ".env") });

const url = process.env.DATABASE_URL_MIGRATOR;
if (!url) {
  console.error("DATABASE_URL_MIGRATOR is not set in environment or .env.");
  process.exit(1);
}

const client = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(client, { schema, casing: "snake_case" });

/**
 * The same cost the API uses, not a cheaper one.
 *
 * This was pinned at 10 while `BCRYPT_ROUNDS` defaults to 12, which made every
 * seeded account — including the administrator a real install signs in with on
 * day one — four times cheaper to attack offline than one created through the
 * admin panel.
 */
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 12);
const DEFAULT_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe123!";
const DEFAULT_PIN = process.env.SEED_ADMIN_PIN ?? "1234";

interface TenantSeedConfig {
  name: string;
  slug: string;
  adminEmail: string;
  currency: "AED" | "SAR";
  branches: { name: string; code: string; phone: string; address: string }[];
  categories: string[];
  brands: string[];
  suppliers: { name: string; company: string; phone: string; email: string; trn: string; address: string; terms: number }[];
  customers: { name: string; company?: string; phone: string; whatsappPhone: string; email: string; trn?: string; type: "retail" | "wholesale" | "vip"; creditLimit: string; creditBalance: string; terms: number; points: number }[];
  products: {
    sku: string;
    name: string;
    category: string;
    brand?: string;
    unit: string;
    variants: {
      name: string;
      sku: string;
      barcode: string;
      retail: string;
      wholesale: string;
      cost: string;
      stockQty: number;
    }[];
  }[];
  isPaintSpecialist?: boolean;
}

const TENANTS_CONFIG: TenantSeedConfig[] = [
  // ── Tenant 1: DevsFleet Trading (Hardware & Electrical) ──
  {
    name: "DevsFleet Trading LLC",
    slug: "devsfleet",
    adminEmail: "admin@devsfleet.com",
    currency: "AED",
    branches: [
      { name: "Sharjah Main Branch & Central Warehouse", code: "SHJ", phone: "+971 6 500 0001", address: "Industrial Area 4, Sharjah, UAE" },
      { name: "Dubai Deira Trade Outlet", code: "DXB", phone: "+971 4 200 0002", address: "Al Nakhal Rd, Deira, Dubai, UAE" },
      { name: "Abu Dhabi Mussafah Hub", code: "AUH", phone: "+971 2 600 0003", address: "Mussafah M-12, Abu Dhabi, UAE" },
    ],
    categories: ["Electrical", "Plumbing", "Hardware & Tools", "Sanitary", "Fasteners & Fixings"],
    brands: ["Ducab", "Schneider Electric", "Stanley", "Grohe", "Fischer Fixings"],
    suppliers: [
      { name: "Ducab Cable Manufacturing", company: "Dubai Cable Company (Pvt) Ltd", phone: "+971 4 815 8888", email: "sales@ducab.com", trn: "100123456700003", address: "Jebel Ali Industrial Area, Dubai", terms: 60 },
      { name: "Schneider Electric Gulf", company: "Schneider Electric FZE", phone: "+971 4 708 5555", email: "orders@se.com", trn: "100234567800003", address: "Dubai Silicon Oasis, Dubai", terms: 45 },
      { name: "Stanley Black & Decker ME", company: "Stanley Tools Middle East", phone: "+971 4 883 1111", email: "distribution@stanley.ae", trn: "100345678900003", address: "JAFZA South, Dubai", terms: 30 },
    ],
    customers: [
      { name: "Eng. Tariq Al-Nuaimi", company: "Al Falaj Building Contracting LLC", phone: "+971 50 123 4567", whatsappPhone: "+971501234567", email: "tariq@alfalaj.ae", trn: "100456789000003", type: "wholesale", creditLimit: "50000.00", creditBalance: "12450.00", terms: 30, points: 1450 },
      { name: "Mohammad Rashid", company: "Bin Hamoodah MEP Contracting", phone: "+971 55 987 6543", whatsappPhone: "+971559876543", email: "rashid@binhamoodah.com", trn: "100567890100003", type: "wholesale", creditLimit: "100000.00", creditBalance: "48200.00", terms: 45, points: 3200 },
      { name: "Salim Khan", company: "Khan Electromechanical Works", phone: "+971 56 444 8811", whatsappPhone: "+971564448811", email: "salim.khan@gmail.com", type: "retail", creditLimit: "10000.00", creditBalance: "1200.00", terms: 15, points: 420 },
      { name: "Walk-in Retail Customer", phone: "+971 50 000 0000", whatsappPhone: "+971500000000", email: "walkin@devsfleet.com", type: "retail", creditLimit: "0.00", creditBalance: "0.00", terms: 0, points: 50 },
    ],
    products: [
      {
        sku: "EL-CBL-3CX25",
        name: "Ducab 3-Core 2.5mm² Flexible Copper Cable",
        category: "Electrical",
        brand: "Ducab",
        unit: "roll",
        variants: [
          { name: "100m Roll", sku: "EL-CBL-3CX25-100M", barcode: "6291000010016", retail: "245.00", wholesale: "215.00", cost: "180.00", stockQty: 85 },
          { name: "50m Roll", sku: "EL-CBL-3CX25-50M", barcode: "6291000010023", retail: "135.00", wholesale: "118.00", cost: "98.00", stockQty: 40 },
        ],
      },
      {
        sku: "PVC-ELB-90",
        name: 'PVC 90° High Pressure Elbow Fitting',
        category: "Plumbing",
        unit: "pcs",
        variants: [
          { name: '1 Inch', sku: "PVC-ELB-90-1IN", barcode: "6291000020015", retail: "2.75", wholesale: "2.20", cost: "1.60", stockQty: 450 },
          { name: '3/4 Inch', sku: "PVC-ELB-90-34IN", barcode: "6291000020022", retail: "2.10", wholesale: "1.70", cost: "1.20", stockQty: 600 },
          { name: '1/2 Inch', sku: "PVC-ELB-90-12IN", barcode: "6291000020039", retail: "1.60", wholesale: "1.25", cost: "0.85", stockQty: 800 },
        ],
      },
      {
        sku: "TL-STN-DRL",
        name: "Stanley FatMax 18V Cordless Hammer Drill",
        category: "Hardware & Tools",
        brand: "Stanley",
        unit: "set",
        variants: [
          { name: "Kit with 2x 2.0Ah Batteries & Case", sku: "TL-STN-DRL-18V", barcode: "6291000030014", retail: "485.00", wholesale: "420.00", cost: "340.00", stockQty: 25 },
        ],
      },
      {
        sku: "EL-SW-SCH-1G",
        name: "Schneider Electric Vivace 1-Gang 1-Way Switch",
        category: "Electrical",
        brand: "Schneider Electric",
        unit: "pcs",
        variants: [
          { name: "White Standard", sku: "EL-SW-SCH-1GW", barcode: "6291000040013", retail: "14.50", wholesale: "11.25", cost: "8.50", stockQty: 320 },
          { name: "Silver Metallic", sku: "EL-SW-SCH-1GS", barcode: "6291000040020", retail: "19.00", wholesale: "15.50", cost: "11.80", stockQty: 180 },
        ],
      },
    ],
  },

  // ── Tenant 2: Al Manar Paint & Decor (Paints & Coatings Specialist) ──
  {
    name: "Al Manar Paint & Decor LLC",
    slug: "almanar-paints",
    adminEmail: "admin@almanarpaints.com",
    currency: "AED",
    branches: [
      { name: "Sharjah Industrial Color Studio", code: "SHJ-PNT", phone: "+971 6 533 1122", address: "Industrial Area 11, Sharjah, UAE" },
      { name: "Dubai Al Quoz Design Center", code: "DXB-AQ", phone: "+971 4 340 9988", address: "Al Quoz 3, Dubai, UAE" },
    ],
    categories: ["Interior Paints", "Exterior Paints", "Wood Finishes", "Primers & Sealers", "Painting Accessories"],
    brands: ["Jotun", "National Paints", "Caparol", "Dulux", "Harris Brushes"],
    suppliers: [
      { name: "Jotun Paints UAE Ltd", company: "Jotun U.A.E. Ltd. (L.L.C.)", phone: "+971 4 339 5000", email: "orders.dxb@jotun.com", trn: "100678901200003", address: "Al Quoz Industrial Area 4, Dubai", terms: 30 },
      { name: "National Paints Factories", company: "National Paints Factories Co. Ltd", phone: "+971 6 534 0111", email: "sales@nationalpaints.ae", trn: "100789012300003", address: "Industrial Area 13, Sharjah", terms: 45 },
    ],
    customers: [
      { name: "Hassan Al-Majid", company: "Majid Villa Renovation & Painting", phone: "+971 50 888 7766", whatsappPhone: "+971508887766", email: "hassan@majiddecor.ae", trn: "100890123400003", type: "wholesale", creditLimit: "35000.00", creditBalance: "8900.00", terms: 30, points: 980 },
      { name: "Zainab Al-Husseini", company: "Luxe Interior Design Studio", phone: "+971 52 111 2233", whatsappPhone: "+971521112233", email: "zainab@luxedecor.com", type: "vip", creditLimit: "80000.00", creditBalance: "21400.00", terms: 60, points: 4100 },
    ],
    products: [
      {
        sku: "PNT-JOT-FENO-18L",
        name: "Jotun Fenomastic Pure Colours Matt Interior Base",
        category: "Interior Paints",
        brand: "Jotun",
        unit: "ltr",
        variants: [
          { name: "18 Litre Drum (Base A)", sku: "PNT-JOT-FENO-18LA", barcode: "6292000010015", retail: "215.00", wholesale: "185.00", cost: "145.00", stockQty: 65 },
          { name: "18 Litre Drum (Base C)", sku: "PNT-JOT-FENO-18LC", barcode: "6292000010022", retail: "235.00", wholesale: "205.00", cost: "160.00", stockQty: 42 },
          { name: "4 Litre Gallon (Base A)", sku: "PNT-JOT-FENO-4LA", barcode: "6292000010039", retail: "65.00", wholesale: "54.00", cost: "42.00", stockQty: 110 },
        ],
      },
      {
        sku: "PNT-JOT-JOTASH",
        name: "Jotun Jotashield Extreme Exterior Matt",
        category: "Exterior Paints",
        brand: "Jotun",
        unit: "ltr",
        variants: [
          { name: "18 Litre Exterior Base", sku: "PNT-JOT-JOTASH-18L", barcode: "6292000020014", retail: "285.00", wholesale: "245.00", cost: "195.00", stockQty: 48 },
        ],
      },
    ],
    isPaintSpecialist: true,
  },

  // ── Tenant 3: Gulf Sanitary & Plumbing (Sanitary & MEP Supplies) ──
  {
    name: "Gulf Sanitary & Plumbing Supplies W.L.L",
    slug: "gulf-sanitary",
    adminEmail: "admin@gulfsanitary.com",
    currency: "SAR",
    branches: [
      { name: "Riyadh Central Showroom", code: "RUH", phone: "+966 11 400 1122", address: "King Fahd Rd, Riyadh, Saudi Arabia" },
      { name: "Jeddah Port Distribution Center", code: "JED", phone: "+966 12 600 3344", address: "Al Jamiah, Jeddah, Saudi Arabia" },
    ],
    categories: ["Sanitary Ware", "Mixers & Taps", "Pipes & Fittings", "Water Heaters", "Valves & Pumps"],
    brands: ["Grohe", "Roca", "Ariston", "RAK Ceramics", "Pegler"],
    suppliers: [
      { name: "Grohe Middle East FZE", company: "Grohe Middle East", phone: "+971 4 810 5000", email: "me.sales@grohe.com", trn: "300123456700003", address: "Dubai Media City, Dubai", terms: 60 },
      { name: "Ariston Thermo Gulf", company: "Ariston Middle East FZE", phone: "+971 4 886 0055", email: "gulf.sales@ariston.com", trn: "300234567800003", address: "JAFZA, Dubai", terms: 45 },
    ],
    customers: [
      { name: "Eng. Fahad Al-Otaibi", company: "Al-Otaibi Modern Contracting Co", phone: "+966 50 112 3344", whatsappPhone: "+966501123344", email: "fahad@alotaibi.sa", trn: "300345678900003", type: "wholesale", creditLimit: "150000.00", creditBalance: "62000.00", terms: 45, points: 5400 },
      { name: "Abdullah Al-Ghamdi", company: "Red Sea Plumbers & Maintenance", phone: "+966 55 998 7766", whatsappPhone: "+966559987766", email: "abdullah@redseaplumb.sa", type: "retail", creditLimit: "20000.00", creditBalance: "4500.00", terms: 15, points: 670 },
    ],
    products: [
      {
        sku: "SAN-GRO-EUPH",
        name: "Grohe Euphoria Shower System 260 with Thermostat",
        category: "Mixers & Taps",
        brand: "Grohe",
        unit: "set",
        variants: [
          { name: "Chrome Finish 260mm Head", sku: "SAN-GRO-EUPH-CHR", barcode: "4005176428981", retail: "1850.00", wholesale: "1550.00", cost: "1220.00", stockQty: 18 },
        ],
      },
      {
        sku: "SAN-ARS-WTR-50L",
        name: "Ariston PRO1 R 50L Electric Water Heater",
        category: "Water Heaters",
        brand: "Ariston",
        unit: "pcs",
        variants: [
          { name: "50 Litre Vertical", sku: "SAN-ARS-50L-VERT", barcode: "5414849642011", retail: "460.00", wholesale: "395.00", cost: "310.00", stockQty: 32 },
        ],
      },
    ],
  },
];

async function seedTenant(tx: any, config: TenantSeedConfig, passwordHash: string, pinHash: string) {
  console.log(`\n══════════════════════════════════════════════════════════════`);
  console.log(`  Seeding Tenant: ${config.name} (${config.slug})`);
  console.log(`══════════════════════════════════════════════════════════════`);

  // 1. Tenant Record
  const [tenant] = await tx
    .insert(schema.tenants)
    .values({
      name: config.name,
      slug: config.slug,
      settings: {
        ...DEFAULT_TENANT_SETTINGS,
        currency: { ...DEFAULT_TENANT_SETTINGS.currency, base: config.currency },
      },
    })
    .onConflictDoUpdate({
      target: schema.tenants.slug,
      set: { name: config.name, updatedAt: new Date() },
    })
    .returning();

  const tenantId = tenant.id;
  console.log(`✓ Tenant created: ${tenant.name} (${tenantId})`);

  // 2. Branches
  const branches: any[] = [];
  for (const b of config.branches) {
    const [branch] = await tx
      .insert(schema.branches)
      .values({ tenantId, ...b })
      .onConflictDoUpdate({
        target: [schema.branches.tenantId, schema.branches.code],
        set: { name: b.name, phone: b.phone, address: b.address, updatedAt: new Date() },
      })
      .returning();
    if (branch) branches.push(branch);
  }
  console.log(`✓ ${branches.length} branches seeded`);
  const mainBranch = branches[0];

  // 3. Roles
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
  console.log(`✓ ${roles.size} system roles created`);

  // 4. Users (Admin, Manager, Cashier)
  const usersToSeed = [
    { name: "Super Administrator", email: config.adminEmail, role: "admin", branchId: null, maxDiscount: "100", canRefund: true, canCost: true },
    { name: "Branch Manager", email: `manager@${config.slug}.com`, role: "manager", branchId: mainBranch.id, maxDiscount: "25", canRefund: true, canCost: true },
    { name: "Counter Cashier 1", email: `cashier1@${config.slug}.com`, role: "cashier", branchId: mainBranch.id, maxDiscount: "10", canRefund: false, canCost: false },
  ];

  const userMap = new Map<string, string>();
  for (const u of usersToSeed) {
    const existingUser = await tx.query.users.findFirst({
      where: (t: any, { and, eq: e, isNull }: any) =>
        and(e(t.tenantId, tenantId), e(t.email, u.email), isNull(t.deletedAt)),
    });

    if (existingUser) {
      userMap.set(u.email, existingUser.id);
    } else {
      const [created] = await tx
        .insert(schema.users)
        .values({
          tenantId,
          branchId: u.branchId,
          roleId: roles.get(u.role)!,
          name: u.name,
          email: u.email,
          passwordHash,
          pinHash,
          maxDiscountPercent: u.maxDiscount,
          maxSaleAmount: null,
          canApproveRefund: u.canRefund,
          canViewCost: u.canCost,
          allowedBranchIds: [],
        })
        .returning();
      if (created) userMap.set(u.email, created.id);
    }
  }
  console.log(`✓ ${userMap.size} users provisioned (Admin: ${config.adminEmail})`);
  const adminUserId = userMap.get(config.adminEmail)!;

  // 5. Units
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
  const unitsMap = new Map<string, string>();
  for (const u of unitSeed) {
    const [unit] = await tx
      .insert(schema.units)
      .values({ tenantId, ...u })
      .onConflictDoUpdate({
        target: [schema.units.tenantId, schema.units.abbreviation],
        set: { name: u.name },
      })
      .returning();
    if (unit) unitsMap.set(u.abbreviation, unit.id);
  }
  console.log(`✓ ${unitsMap.size} measurement units configured`);

  // 6. Price Lists
  const priceListsMap = new Map<string, string>();
  for (const pl of [
    { name: "Retail", type: "retail" as const, isDefault: true },
    { name: "Wholesale", type: "wholesale" as const, isDefault: false },
    { name: "VIP", type: "special" as const, isDefault: false },
  ]) {
    const existing = await tx.query.priceLists.findFirst({
      where: (t: any, { and, eq: e }: any) => and(e(t.tenantId, tenantId), e(t.name, pl.name)),
    });
    if (existing) {
      priceListsMap.set(pl.name, existing.id);
    } else {
      const [created] = await tx
        .insert(schema.priceLists)
        .values({ tenantId, ...pl, currency: config.currency })
        .returning();
      if (created) priceListsMap.set(pl.name, created.id);
    }
  }
  console.log(`✓ ${priceListsMap.size} pricing tiers seeded`);

  // 7. Categories & Brands
  const categoriesMap = new Map<string, string>();
  for (const [i, name] of config.categories.entries()) {
    const slug = slugify(name);
    const [category] = await tx
      .insert(schema.categories)
      .values({ tenantId, name, slug, path: slug, depth: 0, sortOrder: i })
      .onConflictDoUpdate({
        target: [schema.categories.tenantId, schema.categories.slug],
        set: { name, sortOrder: i },
      })
      .returning();
    if (category) categoriesMap.set(name, category.id);
  }

  const brandsMap = new Map<string, string>();
  for (const name of config.brands) {
    const slug = slugify(name);
    const [brand] = await tx
      .insert(schema.brands)
      .values({ tenantId, name, slug })
      .onConflictDoUpdate({
        target: [schema.brands.tenantId, schema.brands.slug],
        set: { name },
      })
      .returning();
    if (brand) brandsMap.set(name, brand.id);
  }
  console.log(`✓ ${categoriesMap.size} categories and ${brandsMap.size} brands created`);

  // 8. Suppliers
  const suppliersMap = new Map<string, any>();
  for (const sup of config.suppliers) {
    const existingSup = await tx.query.suppliers.findFirst({
      where: (t: any, { and, eq: e, isNull }: any) =>
        and(e(t.tenantId, tenantId), e(t.name, sup.name), isNull(t.deletedAt)),
    });

    if (existingSup) {
      suppliersMap.set(sup.name, existingSup);
    } else {
      const [supplier] = await tx
        .insert(schema.suppliers)
        .values({
          tenantId,
          name: sup.name,
          company: sup.company,
          phone: sup.phone,
          email: sup.email,
          trn: sup.trn,
          address: sup.address,
          paymentTermDays: sup.terms,
          contactPerson: "Key Accounts Manager",
        })
        .returning();
      if (supplier) suppliersMap.set(sup.name, supplier);
    }
  }
  console.log(`✓ ${suppliersMap.size} suppliers created`);

  // 9. Customers
  const customersMap = new Map<string, any>();
  for (const cust of config.customers) {
    const existingCust = await tx.query.customers.findFirst({
      where: (t: any, { and, eq: e, isNull }: any) =>
        and(e(t.tenantId, tenantId), e(t.phone, cust.phone), isNull(t.deletedAt)),
    });

    if (existingCust) {
      customersMap.set(cust.name, existingCust);
    } else {
      const [customer] = await tx
        .insert(schema.customers)
        .values({
          tenantId,
          branchId: mainBranch.id,
          name: cust.name,
          company: cust.company,
          phone: cust.phone,
          whatsappPhone: cust.whatsappPhone,
          email: cust.email,
          trn: cust.trn,
          type: cust.type,
          priceListId: cust.type === "wholesale" ? priceListsMap.get("Wholesale") : priceListsMap.get("Retail"),
          creditLimit: cust.creditLimit,
          creditBalance: cust.creditBalance,
          paymentTermDays: cust.terms,
          loyaltyPoints: cust.points,
        })
        .returning();
      if (customer) customersMap.set(cust.name, customer);
    }
  }
  console.log(`✓ ${customersMap.size} customer accounts created`);

  // 10. Products, Variants, Prices & Inventory Stock
  const seededVariants: any[] = [];
  for (const p of config.products) {
    const [product] = await tx
      .insert(schema.products)
      .values({
        tenantId,
        sku: p.sku,
        name: p.name,
        categoryId: categoriesMap.get(p.category),
        brandId: p.brand ? brandsMap.get(p.brand) : undefined,
        unitId: unitsMap.get(p.unit)!,
        hasVariants: p.variants.length > 1,
      })
      .onConflictDoUpdate({
        target: [schema.products.tenantId, schema.products.sku],
        set: { name: p.name, hasVariants: p.variants.length > 1 },
      })
      .returning();

    if (!product) continue;

    for (const [idx, v] of p.variants.entries()) {
      const [variant] = await tx
        .insert(schema.productVariants)
        .values({
          tenantId,
          productId: product.id,
          variantName: v.name,
          sku: v.sku,
          barcode: v.barcode,
          searchKey: searchKey(p.name, v.name, v.sku),
          minStock: "20",
          reorderQuantity: "100",
          sortOrder: idx,
        })
        .onConflictDoUpdate({
          target: [schema.productVariants.tenantId, schema.productVariants.sku],
          set: { searchKey: searchKey(p.name, v.name, v.sku) },
        })
        .returning();

      if (!variant) continue;
      seededVariants.push({ ...variant, retail: v.retail, wholesale: v.wholesale, cost: v.cost, productName: p.name });

      // Prices
      for (const [listName, price] of [
        ["Retail", v.retail],
        ["Wholesale", v.wholesale],
        ["VIP", v.wholesale],
      ] as const) {
        const priceListId = priceListsMap.get(listName);
        if (!priceListId) continue;
        await tx
          .insert(schema.productPrices)
          .values({
            tenantId,
            variantId: variant.id,
            priceListId,
            purchasePrice: v.cost,
            sellingPrice: price,
            minSellingPrice: v.cost,
          })
          .onConflictDoNothing();
      }

      // Inventory across all branches
      for (const br of branches) {
        const [inv] = await tx
          .insert(schema.inventory)
          .values({
            tenantId,
            variantId: variant.id,
            branchId: br.id,
            quantity: String(v.stockQty),
            reorderLevel: "20",
            reorderQuantity: "100",
            averageCost: v.cost,
          })
          .onConflictDoNothing()
          .returning();

        if (inv) {
          await tx
            .insert(schema.inventoryTransactions)
            .values({
              tenantId,
              variantId: variant.id,
              branchId: br.id,
              type: "opening_balance",
              quantity: String(v.stockQty),
              balanceAfter: String(v.stockQty),
              unitCost: v.cost,
              notes: "Initial inventory setup",
            })
            .onConflictDoNothing();
        }
      }
    }
  }
  console.log(`✓ ${config.products.length} products with ${seededVariants.length} sellable variants and branch stock levels`);

  // 11. POS Devices
  for (const br of branches) {
    for (const n of [1, 2]) {
      const devName = `${br.code}-POS-${String(n).padStart(2, "0")}`;
      await tx
        .insert(schema.devices)
        .values({ tenantId, branchId: br.id, name: devName, type: "pos" })
        .onConflictDoNothing();
    }
  }
  console.log(`✓ POS terminals generated`);

  // 12. Cash Sessions & Sales Invoices
  const firstCustomer = Array.from(customersMap.values())[0];
  const wholesaleCustomer = Array.from(customersMap.values())[1] || firstCustomer;

  if (seededVariants.length > 0 && firstCustomer) {
    // Open Cash Session
    const [cashSession] = await tx
      .insert(schema.cashSessions)
      .values({
        tenantId,
        branchId: mainBranch.id,
        userId: adminUserId,
        sessionNumber: `${mainBranch.code}-CS-${Date.now().toString().slice(-6)}`,
        status: "open",
        openingAmount: "500.00",
      })
      .onConflictDoNothing()
      .returning();

    const sampleVariant1 = seededVariants[0];
    const sampleVariant2 = seededVariants[1] || seededVariants[0];

    // Sale 1: Cash retail sale
    const invNumber1 = `INV-${mainBranch.code}-2026-000142`;
    const existingSale1 = await tx.query.sales.findFirst({
      where: (t: any, { and, eq: e }: any) => and(e(t.tenantId, tenantId), e(t.saleNumber, invNumber1)),
    });

    if (!existingSale1) {
      const qty1 = 2;
      const price1 = parseFloat(sampleVariant1.retail);
      const subtotal1 = qty1 * price1;
      const vat1 = subtotal1 * 0.05;
      const total1 = subtotal1 + vat1;

      const [sale1] = await tx
        .insert(schema.sales)
        .values({
          tenantId,
          branchId: mainBranch.id,
          cashSessionId: cashSession?.id,
          customerId: firstCustomer.id,
          saleNumber: invNumber1,
          source: "pos",
          status: "completed",
          currency: config.currency,
          subtotal: subtotal1.toFixed(2),
          taxAmount: vat1.toFixed(2),
          total: total1.toFixed(2),
          paidAmount: total1.toFixed(2),
        })
        .returning();

      if (sale1) {
        await tx.insert(schema.saleItems).values({
          tenantId,
          saleId: sale1.id,
          variantId: sampleVariant1.id,
          productName: sampleVariant1.productName,
          productSku: sampleVariant1.sku,
          variantName: sampleVariant1.variantName,
          quantity: String(qty1),
          unitPrice: String(price1),
          taxPercent: "5",
          taxAmount: vat1.toFixed(2),
          lineSubtotal: subtotal1.toFixed(2),
          total: total1.toFixed(2),
          costPrice: sampleVariant1.cost,
        });

        await tx.insert(schema.payments).values({
          tenantId,
          branchId: mainBranch.id,
          saleId: sale1.id,
          cashSessionId: cashSession?.id,
          method: "cash",
          amount: total1.toFixed(2),
          currency: config.currency,
        });
      }
    }

    // Sale 2: Wholesale Credit Sale
    const invNumber2 = `INV-${mainBranch.code}-2026-000143`;
    const existingSale2 = await tx.query.sales.findFirst({
      where: (t: any, { and, eq: e }: any) => and(e(t.tenantId, tenantId), e(t.saleNumber, invNumber2)),
    });

    if (!existingSale2) {
      const qty2 = 10;
      const price2 = parseFloat(sampleVariant2.wholesale);
      const subtotal2 = qty2 * price2;
      const vat2 = subtotal2 * 0.05;
      const total2 = subtotal2 + vat2;

      const [sale2] = await tx
        .insert(schema.sales)
        .values({
          tenantId,
          branchId: mainBranch.id,
          customerId: wholesaleCustomer.id,
          saleNumber: invNumber2,
          source: "whatsapp",
          status: "completed",
          currency: config.currency,
          subtotal: subtotal2.toFixed(2),
          taxAmount: vat2.toFixed(2),
          total: total2.toFixed(2),
          paidAmount: "0.00",
        })
        .returning();

      if (sale2) {
        await tx.insert(schema.saleItems).values({
          tenantId,
          saleId: sale2.id,
          variantId: sampleVariant2.id,
          productName: sampleVariant2.productName,
          productSku: sampleVariant2.sku,
          variantName: sampleVariant2.variantName,
          quantity: String(qty2),
          unitPrice: String(price2),
          taxPercent: "5",
          taxAmount: vat2.toFixed(2),
          lineSubtotal: subtotal2.toFixed(2),
          total: total2.toFixed(2),
          costPrice: sampleVariant2.cost,
        });

        await tx.insert(schema.payments).values({
          tenantId,
          branchId: mainBranch.id,
          saleId: sale2.id,
          method: "credit",
          amount: total2.toFixed(2),
          currency: config.currency,
        });
      }
    }
    console.log(`✓ Completed sales and payment transactions recorded`);

    // 13. Quotation
    const quoteNum = `QT-${mainBranch.code}-2026-000418`;
    const existingQuote = await tx.query.quotations.findFirst({
      where: (t: any, { and, eq: e }: any) => and(e(t.tenantId, tenantId), e(t.quotationNumber, quoteNum)),
    });

    if (!existingQuote) {
      const [quotation] = await tx
        .insert(schema.quotations)
        .values({
          tenantId,
          branchId: mainBranch.id,
          customerId: wholesaleCustomer.id,
          quotationNumber: quoteNum,
          status: "accepted",
          currency: config.currency,
          subtotal: "540.00",
          taxAmount: "27.00",
          total: "567.00",
          notes: "Wholesale contractor quote with delivery terms",
        })
        .returning();

      if (quotation) {
        await tx.insert(schema.quotationItems).values({
          tenantId,
          quotationId: quotation.id,
          variantId: sampleVariant1.id,
          productName: sampleVariant1.productName,
          productSku: sampleVariant1.sku,
          variantName: sampleVariant1.variantName,
          quantity: "50",
          unitPrice: sampleVariant1.wholesale,
          taxPercent: "5",
          taxAmount: "5.50",
          lineSubtotal: "110.00",
          total: "115.50",
        });
      }
    }
    console.log(`✓ Quotations generated`);
  }

  // 14. Purchase Orders & Goods Receipts
  const firstSupplier = Array.from(suppliersMap.values())[0];
  if (firstSupplier && seededVariants.length > 0) {
    const poNum = `PO-${mainBranch.code}-2026-000088`;
    const existingPo = await tx.query.purchaseOrders.findFirst({
      where: (t: any, { and, eq: e }: any) => and(e(t.tenantId, tenantId), e(t.poNumber, poNum)),
    });

    if (!existingPo) {
      const [po] = await tx
        .insert(schema.purchaseOrders)
        .values({
          tenantId,
          branchId: mainBranch.id,
          supplierId: firstSupplier.id,
          poNumber: poNum,
          status: "received",
          currency: config.currency,
          subtotal: "12400.00",
          taxAmount: "620.00",
          total: "13020.00",
        })
        .returning();

      if (po) {
        await tx.insert(schema.purchaseOrderItems).values({
          tenantId,
          purchaseOrderId: po.id,
          variantId: seededVariants[0].id,
          productName: seededVariants[0].productName,
          productSku: seededVariants[0].sku,
          quantity: "100",
          receivedQuantity: "100",
          unitPrice: seededVariants[0].cost,
          taxPercent: "5",
          taxAmount: "9.00",
          lineSubtotal: "180.00",
          total: "189.00",
        });

        const [grn] = await tx
          .insert(schema.goodsReceipts)
          .values({
            tenantId,
            branchId: mainBranch.id,
            supplierId: firstSupplier.id,
            purchaseOrderId: po.id,
            grnNumber: `GRN-${mainBranch.code}-2026-000088`,
            status: "completed",
          })
          .returning();

        if (grn) {
          await tx.insert(schema.goodsReceiptItems).values({
            tenantId,
            goodsReceiptId: grn.id,
            variantId: seededVariants[0].id,
            quantity: "100",
            landedUnitCost: seededVariants[0].cost,
          });
        }
      }
    }
    console.log(`✓ Purchase orders & Goods Receipts (GRN) populated`);
  }

  // 15. Store Expenses
  await tx
    .insert(schema.expenses)
    .values([
      {
        tenantId,
        branchId: mainBranch.id,
        userId: adminUserId,
        title: "Store Van Diesel & Delivery Tolls",
        amount: "350.00",
        category: "Logistics & Transport",
        expenseDate: new Date().toISOString().split("T")[0],
        paymentMethod: "cash",
      },
      {
        tenantId,
        branchId: mainBranch.id,
        userId: adminUserId,
        title: "Packaging Tape & Strapping Supplies",
        amount: "180.00",
        category: "Packaging Supplies",
        expenseDate: new Date().toISOString().split("T")[0],
        paymentMethod: "cash",
      },
    ])
    .onConflictDoNothing();
  console.log(`✓ Petty cash store expenses recorded`);

  // 16. WhatsApp Conversations & AI Actions
  if (wholesaleCustomer) {
    const existingConv = await tx.query.whatsappConversations.findFirst({
      where: (t: any, { and, eq: e }: any) =>
        and(e(t.tenantId, tenantId), e(t.phoneNumber, wholesaleCustomer.whatsappPhone || wholesaleCustomer.phone)),
    });

    if (!existingConv) {
      const [conv] = await tx
        .insert(schema.whatsappConversations)
        .values({
          tenantId,
          branchId: mainBranch.id,
          customerId: wholesaleCustomer.id,
          phoneNumber: wholesaleCustomer.whatsappPhone || wholesaleCustomer.phone,
          profileName: wholesaleCustomer.name,
          status: "active",
          locale: "en",
        })
        .returning();

      if (conv) {
        await tx.insert(schema.whatsappMessages).values([
          {
            tenantId,
            conversationId: conv.id,
            direction: "inbound",
            messageType: "text",
            content: "Salam, please send price for 50 pcs 1 inch elbow and 2 rolls 2.5mm cable.",
            status: "delivered",
          },
          {
            tenantId,
            conversationId: conv.id,
            direction: "outbound",
            messageType: "text",
            content: "Walaikum Assalam! We have stock ready at Sharjah and Dubai branches. Quotation QT-2026-000418 has been generated at AED 567.00 total.",
            status: "read",
          },
        ]);

        await tx.insert(schema.aiActions).values({
          tenantId,
          conversationId: conv.id,
          actionType: "create_quotation",
          status: "completed",
          payload: { itemsCount: 2, total: 567.0 },
        });
      }
    }
    console.log(`✓ WhatsApp AI dialogue & automated actions logged`);
  }

  // 17. Paint Formulas (For paint specialist tenant)
  if (config.isPaintSpecialist && seededVariants.length > 0) {
    const baseVariant = seededVariants[0];
    const existingFormula = await tx.query.paintFormulas.findFirst({
      where: (t: any, { and, eq: e }: any) => and(e(t.tenantId, tenantId), e(t.colorCode, "RAL 9010")),
    });

    if (!existingFormula) {
      const [formula] = await tx
        .insert(schema.paintFormulas)
        .values({
          tenantId,
          colorCode: "RAL 9010",
          colorName: "Pure White Satin",
          baseVariantId: baseVariant.id,
          sizeMl: 18000,
          notes: "Interior satin finish with antibacterial formulation",
        })
        .returning();

      if (formula) {
        await tx.insert(schema.formulaComponents).values([
          { tenantId, formulaId: formula.id, componentName: "White Titanium Oxide (PW6)", quantityMl: "450.00", sortOrder: 1 },
          { tenantId, formulaId: formula.id, componentName: "Raw Umber Tint (PBr7)", quantityMl: "12.50", sortOrder: 2 },
        ]);
      }
    }
    console.log(`✓ Custom paint mixing formulas registered`);
  }
}

async function main() {
  console.log("Starting full multi-tenant SaaS seeding...");
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, BCRYPT_ROUNDS);
  const pinHash = await bcrypt.hash(DEFAULT_PIN, BCRYPT_ROUNDS);

  try {
    await db.transaction(async (tx) => {
      // Elevate to platform admin to bypass RLS during tenant seeding
      await tx.execute(sql`SELECT set_config('app.is_platform_admin', 'on', true)`);

      for (const tenantConfig of TENANTS_CONFIG) {
        await seedTenant(tx, tenantConfig, passwordHash, pinHash);
      }
    });

    console.log(`\n══════════════════════════════════════════════════════════════`);
    console.log(`🎉 MULTI-TENANT SEEDING COMPLETE!`);
    console.log(`══════════════════════════════════════════════════════════════\n`);
    console.log(`Available Tenant Accounts (Password for all: ${DEFAULT_PASSWORD} | PIN: ${DEFAULT_PIN}):\n`);
    for (const t of TENANTS_CONFIG) {
      console.log(`  🏢 ${t.name.padEnd(42)} [${t.slug.padEnd(16)}] Login: ${t.adminEmail}`);
    }
    console.log("\nAll core, commerce, purchasing, inventory, financial, and AI tables populated.\n");
  } catch (err) {
    console.error("\n❌ Seeding failed with error:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
