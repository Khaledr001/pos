import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { VAT_RATE_BPS } from '../../common/money.js';
import { PrismaService, Tx } from '../../prisma/prisma.service.js';
import { REDIS } from '../../redis/redis.module.js';
import {
  PriceCandidate,
  resolvePrice,
  ResolvedPrice,
  sellableUoms,
  VariantPricingMeta,
} from './price-resolver.js';

/** A price_list_items row with its list's metadata, as cached per SKU. */
interface CachedRow extends PriceCandidate {
  channel: 'ALL' | 'POS' | 'ONLINE';
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
}

export interface QuoteRequest {
  sku: string;
  uom: string;
  qty: number;
}

const GEN_KEY = 'price:gen';
const ROW_TTL = 600;

/**
 * Works out prices from the read-only copy of the POS price lists.
 * Cache keys include a generation number; pos-sync bumps it on any price change,
 * which invalidates every cached SKU at once.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async invalidate() {
    await this.redis.incr(GEN_KEY);
  }

  async quote(
    requests: QuoteRequest[],
    customerId?: string,
    at: Date = new Date(),
    tx?: Tx,
  ): Promise<(ResolvedPrice | null)[]> {
    const skus = [...new Set(requests.map((r) => r.sku))];
    // A transaction has one connection: run its queries one after another.
    const [metas, rowsBySku, customerLists] = tx
      ? [await this.variantMeta(skus, tx), await this.rowsFor(skus, tx), await this.customerListIds(customerId, tx)]
      : await Promise.all([this.variantMeta(skus), this.rowsFor(skus), this.customerListIds(customerId)]);

    return requests.map((r) => {
      const meta = metas.get(r.sku);
      if (!meta) return null;
      const candidates = this.applicable(rowsBySku.get(r.sku) ?? [], customerLists, at);
      return resolvePrice(candidates, meta, r.uom, r.qty);
    });
  }

  async quoteOne(req: QuoteRequest, customerId?: string, tx?: Tx) {
    const [q] = await this.quote([req], customerId, new Date(), tx);
    return q;
  }

  /** Units each SKU can be bought in, plus its qty=1 price in each unit. */
  async priceSheet(skus: string[], customerId?: string) {
    const [metas, rowsBySku, customerLists] = await Promise.all([
      this.variantMeta(skus),
      this.rowsFor(skus),
      this.customerListIds(customerId),
    ]);
    const now = new Date();
    const out = new Map<string, { uom: string; price: ResolvedPrice }[]>();
    for (const sku of skus) {
      const meta = metas.get(sku);
      if (!meta) continue;
      const candidates = this.applicable(rowsBySku.get(sku) ?? [], customerLists, now);
      const entries: { uom: string; price: ResolvedPrice }[] = [];
      for (const uom of sellableUoms(candidates, meta)) {
        const price = resolvePrice(candidates, meta, uom, 1);
        if (price) entries.push({ uom, price });
      }
      out.set(sku, entries);
    }
    return out;
  }

  // ── internals ──

  private applicable(rows: CachedRow[], customerLists: Set<string>, at: Date) {
    const t = at.getTime();
    return rows.filter(
      (r) =>
        r.active &&
        (r.channel === 'ALL' || r.channel === 'ONLINE') &&
        (!r.validFrom || new Date(r.validFrom).getTime() <= t) &&
        (!r.validTo || new Date(r.validTo).getTime() >= t) &&
        // trade lists only for customers they are assigned to
        (r.type !== 'TRADE' || customerLists.has(r.priceListId)),
    );
  }

  private async customerListIds(customerId?: string, tx?: Tx) {
    if (!customerId) return new Set<string>();
    const rows = await (tx ?? this.prisma).customerPriceList.findMany({
      where: { customerId },
      select: { priceListId: true },
    });
    return new Set(rows.map((r) => r.priceListId));
  }

  private async variantMeta(skus: string[], tx?: Tx) {
    const variants = await (tx ?? this.prisma).variant.findMany({
      where: { sku: { in: skus } },
      select: {
        sku: true,
        baseUom: true,
        uomConversions: { select: { uom: true, factor: true } },
        product: { select: { vatClass: true } },
      },
    });
    const map = new Map<string, VariantPricingMeta>();
    for (const v of variants) {
      map.set(v.sku, {
        sku: v.sku,
        baseUom: v.baseUom,
        vatRateBps: VAT_RATE_BPS[v.product.vatClass],
        conversions: Object.fromEntries(
          v.uomConversions.map((c) => [c.uom, Number(c.factor)]),
        ),
      });
    }
    return map;
  }

  /** Inside a transaction we always read fresh rows (checkout must not use stale cache). */
  private async rowsFor(skus: string[], tx?: Tx) {
    const out = new Map<string, CachedRow[]>();
    if (tx) {
      for (const [sku, rows] of await this.loadRows(skus, tx)) out.set(sku, rows);
      return out;
    }

    const gen = (await this.redis.get(GEN_KEY)) ?? '0';
    const keys = skus.map((s) => `price:${gen}:${s}`);
    const cached = keys.length ? await this.redis.mget(...keys) : [];
    const missing: string[] = [];
    skus.forEach((sku, i) => {
      const hit = cached[i];
      if (hit) out.set(sku, JSON.parse(hit) as CachedRow[]);
      else missing.push(sku);
    });

    if (missing.length) {
      const loaded = await this.loadRows(missing);
      const pipeline = this.redis.pipeline();
      for (const sku of missing) {
        const rows = loaded.get(sku) ?? [];
        out.set(sku, rows);
        pipeline.set(`price:${gen}:${sku}`, JSON.stringify(rows), 'EX', ROW_TTL);
      }
      await pipeline.exec();
    }
    return out;
  }

  private async loadRows(skus: string[], tx?: Tx) {
    const items = await (tx ?? this.prisma).priceListItem.findMany({
      where: { sku: { in: skus } },
      include: { priceList: true },
    });
    const map = new Map<string, CachedRow[]>();
    for (const it of items) {
      const pl = it.priceList;
      const rows = map.get(it.sku) ?? [];
      rows.push({
        priceListId: pl.id,
        priceListCode: pl.code,
        type: pl.type,
        priority: pl.priority,
        version: pl.version,
        channel: pl.channel,
        active: pl.active,
        validFrom: pl.validFrom?.toISOString() ?? null,
        validTo: pl.validTo?.toISOString() ?? null,
        uom: it.uom,
        minQty: Number(it.minQty),
        netPriceFils: it.netPriceFils,
      });
      map.set(it.sku, rows);
    }
    return map;
  }
}
