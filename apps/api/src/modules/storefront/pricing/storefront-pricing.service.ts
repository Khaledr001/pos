import { and, inArray, isNull, or, schema, sql, type Transaction } from "@devsfleet/db";
import type { PriceListType } from "@devsfleet/shared-types";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import {
  listedUnitPrice,
  PriceResolverService,
  type ResolvedPrice,
} from "../../pricing/price-resolver.service.js";
import { moneyView, unitNetGross, type MoneyView } from "./money-view.js";

/** The storefront's vocabulary for where a price came from. */
export type PriceViewListType = "RETAIL" | "TRADE" | "PROMO";

export interface PriceView {
  /** VAT-inclusive, for one unit at the base tier. What UAE law requires shown. */
  unit: MoneyView;
  unitNet: MoneyView;
  /** The retail (default list) price, for a crossed-out comparison. */
  retailUnit: MoneyView;
  discounted: boolean;
  priceListType: PriceViewListType;
  tiers: { minQty: number; unit: MoneyView; unitNet: MoneyView }[];
}

export interface SellableUnit {
  /** The base unit when null-free; a packaging otherwise. */
  unitId: string;
  uom: string;
  conversionFactor: string;
  priceOverride: string | null;
}

export interface PricingSubject {
  variantId: string;
  /** products.taxRate, or null to inherit the tenant default — resolved here. */
  taxRate: string | null;
  units: SellableUnit[];
}

export interface PricedLineInput {
  variantId: string;
  unitId: string;
  /** In the SOLD unit, as entered — a quantity break is not scaled by packaging, same as the till. */
  quantity: string;
}

export interface PricedLine extends PricedLineInput {
  conversionFactor: string;
  /** Per sold unit, in the tenant's tax mode — what goes on the order line. */
  unitPrice: string;
  retailUnitPrice: string;
  taxPercent: string;
  priceListId: string | null;
}

const LIST_TYPE: Record<PriceListType, PriceViewListType> = {
  retail: "RETAIL",
  wholesale: "TRADE",
  special: "PROMO",
};

/**
 * Prices for the shop window, from the same ladder the till uses.
 *
 * Nothing here decides a price. PriceResolverService picks the tier and the
 * list, `listedUnitPrice` scales it to the packaging, and calculateLine turns
 * it into the VAT-inclusive figure — this class only arranges those answers
 * into the shape a product page reads.
 */
@Injectable()
export class StorefrontPricing {
  constructor(private readonly resolver: PriceResolverService) {}

  /** The VAT rate a line uses: the product's own, else the tenant default. Never null on the wire. */
  taxPercentFor(taxRate: string | null): string {
    const { tenantSettings } = RequestContext.requireStorefront();
    return taxRate ?? String(tenantSettings.tax.defaultRate);
  }

  /**
   * Every sellable unit of every subject, priced for this customer (or a
   * guest). Keyed by variant id, in the order the units were given.
   */
  async priceSheet(
    tx: Transaction,
    subjects: PricingSubject[],
    customerId: string | null,
  ): Promise<Map<string, { uom: string; unitId: string; price: PriceView }[]>> {
    const sheet = new Map<string, { uom: string; unitId: string; price: PriceView }[]>();
    if (subjects.length === 0) return sheet;

    const variantIds = subjects.map((s) => s.variantId);
    const [mine, retail] = await Promise.all([
      this.resolver.resolveMany(tx, { variantIds, customerId }),
      customerId ? this.resolver.resolveMany(tx, { variantIds, customerId: null }) : null,
    ]);
    const mineBy = new Map(mine.map((p) => [p.variantId, p]));
    const retailBy = new Map((retail ?? mine).map((p) => [p.variantId, p]));

    const listIds = [...new Set(mine.map((p) => p.priceListId).filter((id): id is string => !!id))];
    const [lists, tiers] = await Promise.all([
      listIds.length
        ? tx
            .select({ id: schema.priceLists.id, type: schema.priceLists.type })
            .from(schema.priceLists)
            .where(inArray(schema.priceLists.id, listIds))
        : [],
      this.tiersFor(tx, variantIds, listIds),
    ]);
    const listTypeBy = new Map(lists.map((l) => [l.id, l.type]));

    const { tenantSettings } = RequestContext.requireStorefront();
    const mode = tenantSettings.tax.mode;
    const currency = tenantSettings.currency.base;
    const decimals = tenantSettings.currency.decimals;
    const view = (unitPrice: string, tax: string) => {
      const { net, gross } = unitNetGross(unitPrice, tax, mode, decimals);
      return { net, gross, netView: moneyView(net, currency, decimals), grossView: moneyView(gross, currency, decimals) };
    };

    for (const subject of subjects) {
      const own = mineBy.get(subject.variantId);
      const base = retailBy.get(subject.variantId);
      if (!own) continue; // Unpriced: not for sale online, exactly as at the till.

      const tax = this.taxPercentFor(subject.taxRate);
      const listType: PriceViewListType =
        own.source === "customer" ? "TRADE" : (LIST_TYPE[listTypeBy.get(own.priceListId ?? "") ?? "retail"] ?? "RETAIL");
      const variantTiers =
        own.source === "customer"
          ? [] // A negotiated price is one agreement, not a ladder.
          : (tiers.get(`${subject.variantId}:${own.priceListId}`) ?? []);

      const units = subject.units.map((unit) => {
        const packaging = { conversionFactor: unit.conversionFactor, priceOverride: unit.priceOverride };
        const ownPrice = view(listedUnitPrice(own, packaging)!, tax);
        const retailPrice = base ? view(listedUnitPrice(base, packaging)!, tax) : ownPrice;

        return {
          uom: unit.uom,
          unitId: unit.unitId,
          price: {
            unit: ownPrice.grossView,
            unitNet: ownPrice.netView,
            retailUnit: retailPrice.grossView,
            discounted: ownPrice.net < retailPrice.net,
            priceListType: listType,
            tiers: unit.priceOverride
              ? []
              : variantTiers.map((tier) => {
                  const tierPrice = view(listedUnitPrice({ unitPrice: tier.sellingPrice }, packaging)!, tax);
                  return { minQty: Number(tier.minQuantity), unit: tierPrice.grossView, unitNet: tierPrice.netView };
                }),
          },
        };
      });
      sheet.set(subject.variantId, units);
    }
    return sheet;
  }

  /**
   * Price lines for a cart or an order: one resolved unit price per line, in
   * the tenant's tax mode, ready for calculateDocument.
   *
   * Resolved per line quantity, and a variant bought in two units (a box and
   * some loose pieces) is resolved once per line — `resolveMany` keys its
   * quantities by variant, so the two must not share a call.
   */
  async priceLines(
    tx: Transaction,
    lines: (PricedLineInput & { taxRate: string | null; packaging: SellableUnit })[],
    customerId: string | null,
  ): Promise<(PricedLine | null)[]> {
    const results: (PricedLine | null)[] = new Array(lines.length).fill(null);
    let pending = lines.map((line, index) => ({ line, index }));

    while (pending.length > 0) {
      const seen = new Set<string>();
      const batch = pending.filter(({ line }) => !seen.has(line.variantId) && seen.add(line.variantId));
      pending = pending.filter((entry) => !batch.includes(entry));

      const variantIds = batch.map(({ line }) => line.variantId);
      const quantities = Object.fromEntries(batch.map(({ line }) => [line.variantId, line.quantity]));
      const [own, retail] = await Promise.all([
        this.resolver.resolveMany(tx, { variantIds, customerId, quantities }),
        this.resolver.resolveMany(tx, { variantIds, customerId: null, quantities }),
      ]);
      const ownBy = new Map(own.map((p) => [p.variantId, p]));
      const retailBy = new Map(retail.map((p) => [p.variantId, p]));

      for (const { line, index } of batch) {
        const price: ResolvedPrice | undefined = ownBy.get(line.variantId);
        const unitPrice = listedUnitPrice(price, line.packaging);
        if (!price || !unitPrice) continue;
        results[index] = {
          variantId: line.variantId,
          unitId: line.unitId,
          quantity: line.quantity,
          conversionFactor: line.packaging.conversionFactor,
          unitPrice,
          retailUnitPrice: listedUnitPrice(retailBy.get(line.variantId), line.packaging) ?? unitPrice,
          taxPercent: this.taxPercentFor(line.taxRate),
          priceListId: price.priceListId,
        };
      }
    }
    return results;
  }

  /** Current quantity-break rows above the base tier, keyed `${variantId}:${listId}`. */
  private async tiersFor(tx: Transaction, variantIds: string[], listIds: string[]) {
    const byKey = new Map<string, { minQuantity: string; sellingPrice: string }[]>();
    if (variantIds.length === 0 || listIds.length === 0) return byKey;

    const today = new Date().toISOString().slice(0, 10);
    const rows = await tx
      .select({
        variantId: schema.productPrices.variantId,
        priceListId: schema.productPrices.priceListId,
        minQuantity: schema.productPrices.minQuantity,
        sellingPrice: schema.productPrices.sellingPrice,
      })
      .from(schema.productPrices)
      .where(
        and(
          inArray(schema.productPrices.variantId, variantIds),
          inArray(schema.productPrices.priceListId, listIds),
          sql`${schema.productPrices.minQuantity} > 1`,
          sql`${schema.productPrices.effectiveFrom} <= ${today}::date`,
          or(isNull(schema.productPrices.effectiveTo), sql`${schema.productPrices.effectiveTo} >= ${today}::date`),
        ),
      )
      .orderBy(schema.productPrices.minQuantity);

    for (const row of rows) {
      const key = `${row.variantId}:${row.priceListId}`;
      const list = byKey.get(key) ?? [];
      list.push({ minQuantity: row.minQuantity, sellingPrice: row.sellingPrice });
      byKey.set(key, list);
    }
    return byKey;
  }

  /** The tenant's default list, which an anonymous shopper buys from. */
  async defaultListId(tx: Transaction): Promise<string | null> {
    const row = await tx.query.priceLists.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.isDefault, true), e(t.isActive, true)),
      columns: { id: true },
    });
    return row?.id ?? null;
  }
}

