import { Injectable, Logger } from '@nestjs/common';
import { slugify } from '../../common/slug.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, Tx } from '../../prisma/prisma.service.js';
import { CatalogIndexer } from '../catalog/catalog-indexer.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { RevalidationService } from '../revalidation/revalidation.service.js';
import {
  customerPriceListSchema,
  orderStatusChangedSchema,
  PosEnvelope,
  priceItemsChangedSchema,
  PriceListUpsert,
  priceListUpsertSchema,
  PriceRow,
  ProductUpsert,
  productUpsertSchema,
  StockItem,
  stockUpdatedSchema,
} from './pos-events.js';

const tags = RevalidationService.tags;

export type ApplyResult = 'applied' | 'skipped';

/** Thrown for events that can't be applied yet (e.g. price list not known). Retried. */
export class RetryableEventError extends Error {}

/**
 * Applies POS events to the read-only copy. With `force` (reconciliation
 * snapshots) an equal version is applied too, so drift is corrected.
 */
@Injectable()
export class PosEventHandler {
  private readonly logger = new Logger(PosEventHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly indexer: CatalogIndexer,
    private readonly pricing: PricingService,
    private readonly revalidation: RevalidationService,
    private readonly orders: OrdersService,
  ) {}

  async handle(event: PosEnvelope): Promise<ApplyResult> {
    switch (event.type) {
      case 'product.upsert':
        return this.applyProduct(productUpsertSchema.parse(event.data));
      case 'stock.updated': {
        const { items } = stockUpdatedSchema.parse(event.data);
        const r = await this.applyStock(items);
        return r.applied ? 'applied' : 'skipped';
      }
      case 'price_list.upserted':
        return this.applyPriceList(priceListUpsertSchema.parse(event.data));
      case 'price_items.changed':
        return this.applyPriceItems(priceItemsChangedSchema.parse(event.data));
      case 'customer_price_list.assigned':
        return this.assignCustomerLists(customerPriceListSchema.parse(event.data));
      case 'order.status_changed': {
        const d = orderStatusChangedSchema.parse(event.data);
        return this.orders.applyPosStatus(d);
      }
      default:
        this.logger.warn(`Ignoring unknown POS event type ${event.type}`);
        return 'skipped';
    }
  }

  // ── products ──

  async applyProduct(p: ProductUpsert, force = false): Promise<ApplyResult> {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.variant.findUnique({
        where: { sku: p.sku },
        include: { product: true },
      });
      if (existing && (force ? p.version < existing.posVersion : p.version <= existing.posVersion)) {
        return null;
      }

      const productId = await this.resolveProduct(tx, p, existing?.productId);
      const data = {
        productId,
        barcode: p.barcode ?? null,
        name: p.groupCode ? variantLabel(p) : p.name,
        options: p.options ?? Prisma.DbNull,
        baseUom: p.baseUom,
        weightGrams: p.weightGrams,
        active: p.active,
        posVersion: p.version,
      };
      const variant = existing
        ? await tx.variant.update({ where: { id: existing.id }, data })
        : await tx.variant.create({ data: { ...data, sku: p.sku } });

      await tx.uomConversion.deleteMany({ where: { variantId: variant.id } });
      if (p.uomConversions.length) {
        await tx.uomConversion.createMany({
          data: p.uomConversions
            .filter((c) => c.uom !== p.baseUom)
            .map((c) => ({ variantId: variant.id, uom: c.uom, factor: c.factor })),
        });
      }
      await tx.product.update({ where: { id: productId }, data: { vatClass: p.vatClass } });

      const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      return { productId, slug: product.slug, oldProductId: existing?.productId };
    });
    if (!result) return 'skipped';

    const ids = [result.productId, result.oldProductId].filter((x): x is string => !!x);
    await this.indexer.refreshProducts(ids);
    await this.pricing.invalidate(); // uom conversions and VAT class feed pricing
    this.revalidation.revalidate(tags.sku(p.sku), tags.product(result.slug), tags.catalog);
    return 'applied';
  }

  /**
   * Finds the product a SKU belongs to. New products are created unpublished,
   * so staff add descriptions and images before they go live.
   */
  private async resolveProduct(tx: Tx, p: ProductUpsert, currentProductId?: string) {
    if (p.groupCode) {
      const group = await tx.product.findUnique({ where: { posGroupCode: p.groupCode } });
      if (group) return group.id;
      const created = await tx.product.create({
        data: {
          posGroupCode: p.groupCode,
          name: p.groupName ?? p.name,
          slug: await this.uniqueSlug(tx, p.groupName ?? p.name),
          vatClass: p.vatClass,
        },
      });
      return created.id;
    }
    if (currentProductId) return currentProductId;
    const created = await tx.product.create({
      data: { name: p.name, slug: await this.uniqueSlug(tx, p.name), vatClass: p.vatClass },
    });
    return created.id;
  }

  private async uniqueSlug(tx: Tx, name: string) {
    const base = slugify(name) || 'product';
    for (let i = 0; i < 50; i++) {
      const slug = i === 0 ? base : `${base}-${i + 1}`;
      if (!(await tx.product.findUnique({ where: { slug } }))) return slug;
    }
    return `${base}-${Date.now()}`;
  }

  // ── stock ──

  async applyStock(items: StockItem[], force = false) {
    const skus = [...new Set(items.map((i) => i.sku))];
    const codes = [...new Set(items.map((i) => i.branchCode))];
    const [variants, branches] = await Promise.all([
      this.prisma.variant.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true } }),
      this.prisma.branch.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } }),
    ]);
    const variantBySku = new Map(variants.map((v) => [v.sku, v.id]));
    const branchByCode = new Map(branches.map((b) => [b.code, b.id]));

    let applied = 0;
    let unknown = 0;
    const changedSkus = new Set<string>();
    for (const item of items) {
      const variantId = variantBySku.get(item.sku);
      const branchId = branchByCode.get(item.branchCode);
      if (!variantId || !branchId) {
        unknown++;
        continue;
      }
      const quantity = new Prisma.Decimal(item.quantity);
      // Snapshots also fix rows whose version matches but quantity drifted
      // (e.g. the local deduction for an order the POS never received).
      const newer = force
        ? Prisma.sql`stock_levels."posVersion" <= EXCLUDED."posVersion" AND stock_levels.quantity <> EXCLUDED.quantity`
        : Prisma.sql`stock_levels."posVersion" < EXCLUDED."posVersion"`;
      // Single statement so concurrent events can't apply out of order.
      const n = await this.prisma.$executeRaw`
        INSERT INTO stock_levels ("variantId", "branchId", quantity, "posVersion", "updatedAt")
        VALUES (${variantId}::uuid, ${branchId}::uuid, ${quantity}, ${item.version}, now())
        ON CONFLICT ("variantId", "branchId") DO UPDATE
          SET quantity = EXCLUDED.quantity, "posVersion" = EXCLUDED."posVersion", "updatedAt" = now()
          WHERE ${newer}`;
      if (n > 0) {
        applied++;
        changedSkus.add(item.sku);
      }
    }
    if (unknown) this.logger.warn(`stock.updated: ${unknown} rows for unknown SKU or branch`);

    if (changedSkus.size) {
      await this.indexer.refreshBySkus([...changedSkus]);
      this.revalidation.revalidate(...[...changedSkus].map(tags.sku), tags.catalog);
    }
    return { applied, unknown };
  }

  // ── price lists ──

  async applyPriceList(pl: PriceListUpsert, force = false): Promise<ApplyResult> {
    const existing = await this.prisma.priceList.findUnique({ where: { code: pl.code } });
    if (existing && (force ? pl.version < existing.version : pl.version <= existing.version)) {
      return 'skipped';
    }
    const data = {
      name: pl.name,
      type: pl.type,
      channel: pl.channel,
      priority: pl.priority,
      validFrom: pl.validFrom ? new Date(pl.validFrom) : null,
      validTo: pl.validTo ? new Date(pl.validTo) : null,
      active: pl.active,
      version: pl.version,
    };
    await this.prisma.priceList.upsert({
      where: { code: pl.code },
      create: { code: pl.code, ...data },
      update: data,
    });
    await this.afterPriceChange();
    return 'applied';
  }

  async applyPriceItems(change: {
    priceListCode: string;
    version: number;
    upsert: PriceRow[];
    delete: { sku: string; uom: string; minQty: number }[];
  }): Promise<ApplyResult> {
    const list = await this.prisma.priceList.findUnique({ where: { code: change.priceListCode } });
    if (!list) throw new RetryableEventError(`Unknown price list ${change.priceListCode}`);
    if (change.version <= list.version) return 'skipped';

    const skus = new Set<string>();
    await this.prisma.$transaction(async (tx) => {
      for (const d of change.delete) {
        await tx.priceListItem.deleteMany({
          where: { priceListId: list.id, sku: d.sku, uom: d.uom, minQty: new Prisma.Decimal(d.minQty) },
        });
        skus.add(d.sku);
      }
      for (const r of change.upsert) {
        await this.upsertRow(tx, list.id, r);
        skus.add(r.sku);
      }
      await tx.priceList.update({ where: { id: list.id }, data: { version: change.version } });
    });
    await this.afterPriceChange([...skus]);
    return 'applied';
  }

  /** Snapshot: make the list's rows exactly match the POS. Returns rows changed. */
  async replacePriceItems(code: string, rows: PriceRow[]) {
    const list = await this.prisma.priceList.findUniqueOrThrow({ where: { code } });
    const current = await this.prisma.priceListItem.findMany({ where: { priceListId: list.id } });
    const key = (r: { sku: string; uom: string; minQty: number | Prisma.Decimal }) =>
      `${r.sku}|${r.uom}|${Number(r.minQty)}`;
    const wanted = new Map(rows.map((r) => [key(r), r]));
    const have = new Map(current.map((r) => [key(r), r]));

    const stale = current.filter((r) => !wanted.has(key(r)));
    const changed = rows.filter((r) => have.get(key(r))?.netPriceFils !== r.netPriceFils);
    if (!stale.length && !changed.length) return { fixed: 0, removed: 0 };

    await this.prisma.$transaction(async (tx) => {
      if (stale.length) await tx.priceListItem.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
      for (const r of changed) await this.upsertRow(tx, list.id, r);
    });
    await this.afterPriceChange([...new Set([...stale, ...changed].map((r) => r.sku))]);
    return { fixed: changed.length, removed: stale.length };
  }

  private upsertRow(tx: Tx, priceListId: string, r: PriceRow) {
    const minQty = new Prisma.Decimal(r.minQty);
    return tx.priceListItem.upsert({
      where: { priceListId_sku_uom_minQty: { priceListId, sku: r.sku, uom: r.uom, minQty } },
      create: { priceListId, sku: r.sku, uom: r.uom, minQty, netPriceFils: r.netPriceFils },
      update: { netPriceFils: r.netPriceFils },
    });
  }

  private async afterPriceChange(skus?: string[]) {
    await this.pricing.invalidate();
    if (skus?.length) {
      await this.indexer.refreshBySkus(skus);
      this.revalidation.revalidate(...skus.map(tags.sku), tags.catalog, tags.home);
    } else {
      await this.indexer.refreshAll();
      this.revalidation.revalidate(tags.catalog, tags.home);
    }
  }

  // ── customers ──

  async assignCustomerLists(d: {
    customerEmail?: string | null;
    posCustomerCode?: string | null;
    priceListCodes: string[];
  }): Promise<ApplyResult> {
    const customer = d.posCustomerCode
      ? ((await this.prisma.customer.findUnique({ where: { posCustomerCode: d.posCustomerCode } })) ??
        (d.customerEmail
          ? await this.prisma.customer.findUnique({ where: { email: d.customerEmail.toLowerCase() } })
          : null))
      : await this.prisma.customer.findUnique({ where: { email: d.customerEmail!.toLowerCase() } });
    if (!customer) throw new RetryableEventError('Customer not found');

    const lists = await this.prisma.priceList.findMany({ where: { code: { in: d.priceListCodes } } });
    if (lists.length !== d.priceListCodes.length) throw new RetryableEventError('Unknown price list code');

    const isTrade = lists.some((l) => l.type === 'TRADE');
    await this.prisma.$transaction([
      this.prisma.customerPriceList.deleteMany({ where: { customerId: customer.id } }),
      this.prisma.customerPriceList.createMany({
        data: lists.map((l) => ({ customerId: customer.id, priceListId: l.id })),
      }),
      this.prisma.customer.update({
        where: { id: customer.id },
        data: {
          posCustomerCode: d.posCustomerCode ?? customer.posCustomerCode,
          ...(isTrade ? { type: 'TRADE', tradeStatus: 'APPROVED' } : {}),
        },
      }),
    ]);
    return 'applied';
  }
}

function variantLabel(p: ProductUpsert) {
  const opts = Object.values(p.options ?? {});
  return opts.length ? opts.join(' · ') : p.name;
}
