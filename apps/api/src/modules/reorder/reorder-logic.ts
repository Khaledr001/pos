import { Money } from "@devsfleet/shared-utils";

/**
 * The arithmetic behind a reorder suggestion, kept free of the database so it
 * can be tested on its own.
 *
 * Quantities are decimals stored at four places, the same scale as money, so
 * they go through `Money`'s scaled bigints rather than floats — a roll of
 * cable sold by the metre is 37.5, and 37.5 − 0.1 must not come out 37.3999.
 */

export interface QuantityInput {
  /** On hand minus reserved, in base units. */
  available: string;
  /** Still to arrive on open purchase orders for this branch, in base units. */
  incoming: string;
  /** Reorder at or below this. */
  threshold: string;
  /** The usual order size; "0" when none is set. */
  reorderQuantity: string;
  /** False for pieces — a suggestion of 2.5 drills is not one anyone can place. */
  allowsFractions: boolean;
}

export interface QuantitySuggestion {
  /** Base units to order. "0" when stock already on order covers it. */
  quantity: string;
  /** Available + incoming is already above the threshold. */
  coveredByIncoming: boolean;
}

const ONE = Money.toMinor("1");

function ceilToWhole(value: bigint): bigint {
  if (value <= 0n) return 0n;
  return ((value + ONE - 1n) / ONE) * ONE;
}

/**
 * How much to order.
 *
 * Stock already on its way counts: re-ordering what a supplier is about to
 * deliver is how a shelf ends up with three months of one item. With an order
 * size set, order it — as many times as it takes to clear the threshold. With
 * none, refill to twice the threshold, so the item does not trip the same
 * alarm on the next sale.
 */
export function suggestQuantity(input: QuantityInput): QuantitySuggestion {
  const available = Money.toMinor(input.available);
  const incoming = Money.max(Money.toMinor(input.incoming), 0n);
  const threshold = Money.toMinor(input.threshold);
  const usual = Money.toMinor(input.reorderQuantity);

  const position = available + incoming;
  if (position > threshold) return { quantity: "0", coveredByIncoming: Money.isPositive(incoming) };

  const deficit = threshold - position;
  let quantity: bigint;
  if (usual > 0n) {
    // Enough whole orders to lift the position above the threshold.
    const orders = deficit / usual + 1n;
    quantity = usual * orders;
  } else {
    quantity = deficit + threshold;
  }

  if (!input.allowsFractions) quantity = ceilToWhole(quantity);
  // A threshold of zero with nothing on hand still deserves one unit, not an
  // order line for nothing.
  if (quantity <= 0n) quantity = ONE;

  return { quantity: trim(quantity), coveredByIncoming: false };
}

export interface SupplierLink {
  supplierId: string;
  /** When the link was last touched — a proxy for the supplier still in use. */
  updatedAt: Date;
}

/**
 * Who to order from.
 *
 * There is no "preferred supplier" flag, so the evidence is what the business
 * actually did: the supplier this item was last ordered from, if that supplier
 * is still linked to it; else the only link; else the most recently updated
 * link; else whoever it was last ordered from even without a link; else no
 * one, and the operator picks.
 */
export function chooseSupplier(links: SupplierLink[], lastOrderedFrom: string | null): string | null {
  if (lastOrderedFrom && links.some((l) => l.supplierId === lastOrderedFrom)) return lastOrderedFrom;
  if (links.length === 1) return links[0]!.supplierId;
  if (links.length > 1) {
    return [...links].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.supplierId.localeCompare(b.supplierId),
    )[0]!.supplierId;
  }
  return lastOrderedFrom;
}

export interface CostEvidence {
  /** `product_supplier_links.last_cost` for the chosen supplier. */
  linkCost: string | null;
  /** Last price paid this supplier, per base unit. */
  lastPaidToSupplier: string | null;
  /** Last price paid anyone, per base unit. */
  lastPaid: string | null;
  /** The default price list's purchase price. */
  listPurchasePrice: string | null;
  /** The branch's weighted-average cost. */
  averageCost: string | null;
}

/**
 * A starting unit cost, per base unit, for the operator to confirm — the PO
 * is a draft, and the supplier's invoice decides what is actually paid. Most
 * specific evidence first.
 */
export function estimateUnitCost(e: CostEvidence): string | null {
  for (const candidate of [e.linkCost, e.lastPaidToSupplier, e.lastPaid, e.listPurchasePrice, e.averageCost]) {
    if (candidate !== null && Money.isPositive(Money.toMinor(candidate))) {
      return Money.toDecimalString(Money.toMinor(candidate), 4);
    }
  }
  return null;
}

/** "12.5000" → "12.5", "3.0000" → "3". */
export function trim(value: bigint): string {
  return Money.toDecimalString(value, 4).replace(/\.?0+$/, "");
}
