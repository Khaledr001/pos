import { and, eq, isNull, or, schema, sql, type Transaction } from "@devsfleet/db";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";

/**
 * What does this customer pay for this variant?
 *
 * ONE implementation, called by the POS, the WhatsApp bot, quotations and the
 * admin panel. Four places that must agree on a price, and the only way they
 * can is by asking the same code.
 *
 * The ladder, highest priority first:
 *
 *   1. customer_prices   negotiated for this customer and this variant
 *   2. product_prices    on the customer's assigned price list
 *   3. product_prices    on the tenant's default price list
 *   4. refuse
 *
 * Step 4 matters. Falling back to zero would give the item away; falling back
 * to cost would sell at no margin. Both are worse than refusing to sell an
 * item nobody has priced, which is a data problem someone can fix in a minute.
 *
 * Every tier is date-bounded, so a promotional price expires by itself rather
 * than needing a job to unwind it.
 */

interface PriceTierRow {
  variantId: string;
  sellingPrice: string;
  minSellingPrice: string | null;
  purchasePrice: string | null;
  minQuantity: string;
}

export interface ResolvedPrice {
  variantId: string;
  /** What to charge, before line discounts. */
  unitPrice: string;
  /** Below this needs `price:override_floor`. null = no floor set. */
  minSellingPrice: string | null;
  /** Landed cost. Only populated for callers holding `canViewCost`. */
  purchasePrice: string | null;
  /** Which rung of the ladder answered. Shown in the UI and useful in support. */
  source: "customer" | "price_list" | "default";
  priceListId: string | null;
}

@Injectable()
export class PriceResolverService {
  /**
   * Resolve one variant.
   *
   * `asOf` exists so a document can be re-priced as it was on its own date —
   * reprinting last year's quotation must not silently apply today's prices.
   */
  async resolve(
    tx: Transaction,
    input: {
      variantId: string;
      customerId?: string | null;
      includeCost?: boolean;
      asOf?: Date;
      /** Quantity being bought. Picks the right tier — see resolveMany. */
      quantity?: string;
    },
  ): Promise<ResolvedPrice> {
    const [resolved] = await this.resolveMany(tx, {
      variantIds: [input.variantId],
      customerId: input.customerId ?? null,
      includeCost: input.includeCost ?? false,
      asOf: input.asOf ?? new Date(),
      quantities: input.quantity ? { [input.variantId]: input.quantity } : undefined,
    });

    if (!resolved) {
      throw new AppError(
        ERROR_CODES.NO_PRICE_FOR_PRODUCT,
        "This item has no price on any list. Set one before selling it.",
        { variantId: input.variantId },
      );
    }
    return resolved;
  }

  /**
   * Resolve a whole cart at once.
   *
   * Two queries total, regardless of cart size. Resolving per line would mean
   * two round trips per item — on a 40-line wholesale order that is 80 queries
   * while a customer waits at the counter.
   */
  async resolveMany(
    tx: Transaction,
    input: {
      variantIds: string[];
      customerId?: string | null;
      includeCost?: boolean;
      asOf?: Date;
      /**
       * Quantity being bought, per variant. Missing = "1", the untiered
       * price every product had before quantity breaks existed. Applies
       * only to the price-list tier, not a negotiated customer price —
       * a negotiated price is one specific agreement, not a ladder.
       */
      quantities?: Record<string, string>;
    },
  ): Promise<ResolvedPrice[]> {
    const { variantIds, customerId = null, includeCost = false, quantities = {} } = input;
    if (variantIds.length === 0) return [];

    const asOf = (input.asOf ?? new Date()).toISOString().slice(0, 10);

    /** A row is live if it started on or before `asOf` and has not ended. */
    const effective = (from: unknown, to: unknown) =>
      and(
        sql`${from} <= ${asOf}::date`,
        or(isNull(to as never), sql`${to} >= ${asOf}::date`),
      );

    // Which list applies: the customer's own, else the tenant default.
    const customer = customerId
      ? await tx.query.customers.findFirst({
          where: (t, { eq: e }) => e(t.id, customerId),
          columns: { id: true, priceListId: true },
        })
      : null;

    const defaultList = await tx.query.priceLists.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.isDefault, true), e(t.isActive, true)),
      columns: { id: true },
    });

    const listId = customer?.priceListId ?? defaultList?.id ?? null;

    const [negotiated, listed] = await Promise.all([
      customerId
        ? tx
            .select({
              variantId: schema.customerPrices.variantId,
              price: schema.customerPrices.specialPrice,
            })
            .from(schema.customerPrices)
            .where(
              and(
                eq(schema.customerPrices.customerId, customerId),
                sql`${schema.customerPrices.variantId} = ANY(${sql.raw(
                  `ARRAY['${variantIds.join("','")}']::uuid[]`,
                )})`,
                effective(schema.customerPrices.effectiveFrom, schema.customerPrices.effectiveTo),
              ),
            )
        : Promise.resolve([]),

      listId
        ? tx
            .select({
              variantId: schema.productPrices.variantId,
              sellingPrice: schema.productPrices.sellingPrice,
              minSellingPrice: schema.productPrices.minSellingPrice,
              purchasePrice: schema.productPrices.purchasePrice,
              minQuantity: schema.productPrices.minQuantity,
            })
            .from(schema.productPrices)
            .where(
              and(
                eq(schema.productPrices.priceListId, listId),
                sql`${schema.productPrices.variantId} = ANY(${sql.raw(
                  `ARRAY['${variantIds.join("','")}']::uuid[]`,
                )})`,
                effective(schema.productPrices.effectiveFrom, schema.productPrices.effectiveTo),
              ),
            )
        : Promise.resolve([] as PriceTierRow[]),
    ]);

    const negotiatedBy = new Map(negotiated.map((r) => [r.variantId, r.price]));
    // Every tier a variant has on this list — picking ONE happens per
    // variant below, against the quantity actually being bought.
    const tiersBy = new Map<string, PriceTierRow[]>();
    for (const row of listed) {
      const tiers = tiersBy.get(row.variantId);
      if (tiers) tiers.push(row);
      else tiersBy.set(row.variantId, [row]);
    }

    const results: ResolvedPrice[] = [];

    for (const variantId of variantIds) {
      const tiers = tiersBy.get(variantId);
      const special = negotiatedBy.get(variantId);

      // The highest-threshold tier the requested quantity actually reaches.
      // Ties (two tiers at the same minQuantity, which should not happen but
      // is not enforced by the schema) resolve to whichever sorted first.
      const quantity = Number(quantities[variantId] ?? "1");
      const list = tiers
        ?.filter((tier) => Number(tier.minQuantity) <= quantity)
        .sort((a, b) => Number(b.minQuantity) - Number(a.minQuantity))[0];

      if (!special && !list) continue; // Caller decides whether that is fatal.

      // The floor is a cost control, not a promotional lever — it comes from
      // the lowest tier (ordinarily minQuantity "1") even when a higher tier
      // answered the selling price, so a bulk discount cannot also silently
      // switch the floor off.
      const baseTier = tiers
        ?.slice()
        .sort((a, b) => Number(a.minQuantity) - Number(b.minQuantity))[0];

      results.push({
        variantId,
        unitPrice: special ?? list!.sellingPrice,
        /**
         * The floor comes from the price list even when a negotiated price
         * applies. A special price is an agreement about THIS customer; the
         * floor is a control on what staff may do, and one must not disable
         * the other.
         */
        minSellingPrice: list?.minSellingPrice ?? baseTier?.minSellingPrice ?? null,
        // Cost is omitted entirely, not zeroed, for callers without the
        // permission — a zero would be mistaken for a real figure.
        purchasePrice: includeCost ? (list?.purchasePrice ?? null) : null,
        source: special ? "customer" : customer?.priceListId ? "price_list" : "default",
        priceListId: listId,
      });
    }

    return results;
  }

  /**
   * Is this price allowed?
   *
   * Checked on the price AFTER the line discount, because a 20% discount off
   * list lands in the same place as typing the discounted figure directly —
   * and checking only one of those routes is exactly the gap a cashier finds.
   */
  checkFloor(input: {
    unitPrice: string;
    discountPercent?: string;
    minSellingPrice: string | null;
    canOverrideFloor: boolean;
  }): { allowed: boolean; effectivePrice: string; floor: string | null } {
    const unit = Money.toMinor(input.unitPrice);
    const discount = Money.percentOf(unit, input.discountPercent ?? "0");
    const effective = Money.subtract(unit, discount);
    const effectivePrice = Money.toDecimalString(effective, 4);

    if (!input.minSellingPrice) {
      return { allowed: true, effectivePrice, floor: null };
    }

    const floor = Money.toMinor(input.minSellingPrice);
    return {
      allowed: input.canOverrideFloor || effective >= floor,
      effectivePrice,
      floor: input.minSellingPrice,
    };
  }
}
