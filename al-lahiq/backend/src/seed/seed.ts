/**
 * Loads demo data for local development:  pnpm --filter backend seed
 *
 * POS-owned data (products, stock, price lists) goes through the real
 * PosEventHandler, exactly as if the POS had sent webhooks. Website-owned
 * content (categories, descriptions, pages...) is written directly.
 */
import 'dotenv/config';
process.env.QUEUES_ENABLED = 'false';
process.env.SCHEDULER_ENABLED = 'false';

import { NestFactory } from '@nestjs/core';
import argon2 from 'argon2';
import { AppModule } from '../app.module.js';
import { PosEventHandler } from '../modules/pos-sync/pos-event-handler.service.js';
import { SettingsService } from '../modules/settings/settings.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ATTRIBUTES, BRANCHES, BRANDS, CATEGORIES, LINKS, OPENING_HOURS, PRODUCTS } from './catalog-data.js';
import { PAGES } from './pages-data.js';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const prisma = app.get(PrismaService);
const pos = app.get(PosEventHandler);
const settings = app.get(SettingsService);
const log = (msg: string) => console.log(`  ✓ ${msg}`);

console.log('Seeding Al-Lahiq demo data…');

// ── branches, categories, brands, attributes (website-owned) ──
for (const b of BRANCHES) {
  await prisma.branch.upsert({
    where: { code: b.code },
    create: { ...b, openingHours: OPENING_HOURS },
    update: { ...b, openingHours: OPENING_HOURS },
  });
}
log(`${BRANCHES.length} branches`);

const categoryIds = new Map<string, string>();
for (const [i, [slug, name, parent]] of CATEGORIES.entries()) {
  const data = { name, parentId: parent ? categoryIds.get(parent)! : null, sortOrder: i };
  const c = await prisma.category.upsert({ where: { slug }, create: { slug, ...data }, update: data });
  categoryIds.set(slug, c.id);
}
log(`${CATEGORIES.length} categories`);

const brandIds = new Map<string, string>();
for (const [slug, name, featured] of BRANDS) {
  const b = await prisma.brand.upsert({
    where: { slug },
    create: { slug, name, featured, description: `Genuine ${name} products, supplied with the manufacturer's UAE warranty.` },
    update: { name, featured },
  });
  brandIds.set(slug, b.id);
}
log(`${BRANDS.length} brands`);

const attributeIds = new Map<string, string>();
for (const [code, name, unit, sortOrder] of ATTRIBUTES) {
  const a = await prisma.attribute.upsert({
    where: { code },
    create: { code, name, unit, sortOrder },
    update: { name, unit, sortOrder },
  });
  attributeIds.set(code, a.id);
}
log(`${ATTRIBUTES.length} attributes`);

// ── POS data, through the sync handler ──
const version = Math.floor(Date.now() / 1000);
let skuCount = 0;
for (const p of PRODUCTS) {
  for (const v of p.variants) {
    await pos.applyProduct(
      {
        sku: v.sku,
        name: v.options ? `${p.name} ${Object.values(v.options).join(' ')}` : p.name,
        barcode: null,
        groupCode: p.group,
        groupName: p.name,
        baseUom: v.baseUom ?? 'pc',
        weightGrams: v.weightGrams,
        vatClass: 'STANDARD_5',
        active: true,
        options: v.options ?? null,
        uomConversions: v.uomConversions ?? [],
        version,
      },
      true,
    );
    skuCount++;
  }
}
log(`${skuCount} SKUs in ${PRODUCTS.length} products (via POS product.upsert)`);

const in30Days = new Date(Date.now() + 30 * 86_400_000).toISOString();
const lists = [
  { code: 'RETAIL', name: 'Retail', type: 'RETAIL' as const, channel: 'ALL' as const, priority: 0 },
  { code: 'TRADE-A', name: 'Contractor A', type: 'TRADE' as const, channel: 'ALL' as const, priority: 10 },
  { code: 'WEB-PROMO', name: 'Online offers', type: 'PROMO' as const, channel: 'ONLINE' as const, priority: 20, validTo: in30Days },
];
for (const l of lists) {
  await pos.applyPriceList({ validFrom: null, validTo: null, active: true, ...l, version }, true);
}
const rows = (fn: (v: (typeof PRODUCTS)[number]['variants'][number]) => { minQty: number; netPriceFils: number }[]) =>
  PRODUCTS.flatMap((p) => p.variants.flatMap((v) => fn(v).map((r) => ({ sku: v.sku, uom: v.baseUom ?? 'pc', ...r }))));
await pos.replacePriceItems(
  'RETAIL',
  rows((v) => [{ minQty: 1, netPriceFils: v.retail }, ...(v.tiers ?? []).map(([minQty, netPriceFils]) => ({ minQty, netPriceFils }))]),
);
await pos.replacePriceItems('TRADE-A', rows((v) => (v.trade ? [{ minQty: 1, netPriceFils: v.trade }] : [])));
await pos.replacePriceItems('WEB-PROMO', rows((v) => (v.promo ? [{ minQty: 1, netPriceFils: v.promo }] : [])));
log('price lists RETAIL, TRADE-A, WEB-PROMO (via POS price events)');

const stock = PRODUCTS.flatMap((p) =>
  p.variants.flatMap((v) => Object.entries(v.stock).map(([branchCode, quantity]) => ({ sku: v.sku, branchCode, quantity, version }))),
);
await pos.applyStock(stock, true);
log(`${stock.length} stock rows (via POS stock.updated)`);

// ── website content for the products ──
for (const p of PRODUCTS) {
  const product = await prisma.product.findUniqueOrThrow({ where: { posGroupCode: p.group } });
  await prisma.product.update({
    where: { id: product.id },
    data: {
      description: p.description,
      specs: p.specs.map(([label, value]) => ({ label, value })),
      categoryId: categoryIds.get(p.category)!,
      brandId: brandIds.get(p.brand)!,
      pickupOnly: p.pickupOnly ?? false,
      featured: p.featured ?? false,
      published: true,
      seoDescription: p.description.slice(0, 160),
    },
  });
  for (const v of p.variants) {
    const variant = await prisma.variant.findUniqueOrThrow({ where: { sku: v.sku } });
    await prisma.variantAttribute.deleteMany({ where: { variantId: variant.id } });
    for (const [code, value] of Object.entries(v.attrs ?? {})) {
      const n = Number.parseFloat(value);
      await prisma.variantAttribute.create({
        data: { variantId: variant.id, attributeId: attributeIds.get(code)!, value, numericValue: Number.isFinite(n) ? n : null },
      });
    }
  }
}
for (const [from, to, kind] of LINKS) {
  const [a, b] = await Promise.all([
    prisma.product.findUniqueOrThrow({ where: { posGroupCode: from } }),
    prisma.product.findUniqueOrThrow({ where: { posGroupCode: to } }),
  ]);
  await prisma.productLink.upsert({
    where: { fromId_toId_kind: { fromId: a.id, toId: b.id, kind } },
    create: { fromId: a.id, toId: b.id, kind },
    update: {},
  });
}
log('product descriptions, specs, attributes and links — published');

// ── delivery, promotions, settings ──
const rates: [string, number, number, number | null, number][] = [
  // emirate, base AED (≤5 kg), per extra kg AED, free over AED (net), eta days
  ['DUBAI', 20, 2, 500, 1],
  ['SHARJAH', 25, 2, 600, 1],
  ['AJMAN', 25, 2, 600, 2],
  ['ABU_DHABI', 35, 3, 750, 2],
  ['UMM_AL_QUWAIN', 35, 3, 750, 2],
  ['RAS_AL_KHAIMAH', 40, 3, 900, 3],
  ['FUJAIRAH', 45, 3, 900, 3],
];
for (const [emirate, base, perKg, freeOver, eta] of rates) {
  const data = { baseFils: base * 100, baseWeightKg: 5, perKgFils: perKg * 100, freeOverFils: freeOver ? freeOver * 100 : null, maxWeightKg: 30, etaDays: eta, active: true };
  await prisma.shippingRate.upsert({ where: { emirate: emirate as never }, create: { emirate: emirate as never, ...data }, update: data });
}
log('courier rates for all 7 emirates');

await prisma.coupon.upsert({
  where: { code: 'WELCOME10' },
  create: { code: 'WELCOME10', type: 'PERCENT', value: 10, minSubtotalFils: 10_000 },
  update: {},
});
await prisma.coupon.upsert({
  where: { code: 'FREESHIP' },
  create: { code: 'FREESHIP', type: 'FREE_SHIPPING', value: 0, minSubtotalFils: 20_000 },
  update: {},
});
log('coupons WELCOME10, FREESHIP');

await settings.set('stock', { safetyBuffer: 2, fulfilmentBranchCode: 'MAIN' });

// ── content ──
for (const page of PAGES) {
  await prisma.page.upsert({
    where: { slug: page.slug },
    create: { ...page, published: true, publishedAt: new Date() },
    update: { title: page.title, body: page.body, excerpt: page.excerpt },
  });
}
await prisma.banner.deleteMany({});
await prisma.banner.createMany({
  data: [
    { placement: 'home_hero', title: 'Everything to build, fix and finish', subtitle: 'Plumbing, electrical, sanitary ware and tools from brands you trust — delivered across the UAE or ready for pickup.', linkUrl: '/category/plumbing', ctaLabel: 'Shop plumbing', sortOrder: 0 },
    { placement: 'home_hero', title: 'Contractor? Get trade prices', subtitle: 'Open a trade account for project pricing, bulk breaks and tax invoices with your TRN.', linkUrl: '/account/trade', ctaLabel: 'Apply for trade', sortOrder: 1 },
    { placement: 'home_strip', title: 'Free delivery in Dubai over AED 525', subtitle: 'Store pickup ready in 2 hours at Al Quoz, Sharjah and Mussafah.', linkUrl: '/pages/delivery-returns', sortOrder: 0 },
  ],
});
log(`${PAGES.length} pages and 3 banners`);

// ── people ──
const demoPassword = 'Demo@12345';
const staff = [
  { email: 'owner@al-lahiq.test', name: 'Store Owner', role: 'OWNER' as const },
  { email: 'manager@al-lahiq.test', name: 'Store Manager', role: 'MANAGER' as const },
  { email: 'orders@al-lahiq.test', name: 'Order Desk', role: 'ORDER_STAFF' as const },
  { email: 'content@al-lahiq.test', name: 'Content Editor', role: 'CONTENT_EDITOR' as const },
];
const hash = await argon2.hash(demoPassword);
for (const s of staff) {
  await prisma.staffUser.upsert({ where: { email: s.email }, create: { ...s, passwordHash: hash }, update: { role: s.role } });
}
const retail = await prisma.customer.upsert({
  where: { email: 'customer@al-lahiq.test' },
  create: { email: 'customer@al-lahiq.test', firstName: 'Aisha', lastName: 'Rahman', phone: '+971501234567', passwordHash: hash, projectLists: { create: { name: 'Wishlist', isWishlist: true } } },
  update: {},
});
await prisma.customer.upsert({
  where: { email: 'contractor@al-lahiq.test' },
  create: {
    email: 'contractor@al-lahiq.test', firstName: 'Omar', lastName: 'Haddad', phone: '+971552345678',
    companyName: 'Haddad Contracting LLC', trn: '100123456700003', passwordHash: hash, posCustomerCode: 'C-1001',
    projectLists: { create: { name: 'Wishlist', isWishlist: true } },
  },
  update: {},
});
await pos.assignCustomerLists({ posCustomerCode: 'C-1001', customerEmail: 'contractor@al-lahiq.test', priceListCodes: ['TRADE-A'] });
await prisma.address.deleteMany({ where: { customerId: retail.id } });
await prisma.address.create({
  data: { customerId: retail.id, label: 'Home', fullName: 'Aisha Rahman', phone: '+971501234567', emirate: 'DUBAI', area: 'Al Barsha 2', street: 'Street 23', building: 'Villa 14', isDefault: true },
});
log('staff, a retail customer and a trade customer (TRADE-A via POS assignment)');

await app.close();
console.log(`
Done. Logins (password for all: ${demoPassword})
  Admin:    owner@al-lahiq.test · manager@ · orders@ · content@
  Shop:     customer@al-lahiq.test (retail) · contractor@al-lahiq.test (trade prices)
  Coupons:  WELCOME10 (10% over AED 100) · FREESHIP (over AED 200)`);
