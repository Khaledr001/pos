import { grossFor, lineNetFor, roundFils, vatFor } from '../../common/money.js';

/**
 * Pure price resolution (no I/O), so it can be unit-tested exhaustively.
 * See PLAN.md → "Price List Handling".
 */

export type ListType = 'RETAIL' | 'TRADE' | 'PROMO';

/** One price_list_items row joined with its list, already filtered to lists
 *  that apply to this customer, channel and date. */
export interface PriceCandidate {
  priceListId: string;
  priceListCode: string;
  type: ListType;
  priority: number;
  version: number;
  uom: string;
  minQty: number;
  netPriceFils: number;
}

export interface VariantPricingMeta {
  sku: string;
  baseUom: string;
  vatRateBps: number;
  /** uom → how many base units it contains */
  conversions: Record<string, number>;
}

export interface PriceTier {
  minQty: number;
  unitNetFils: number;
  unitGrossFils: number;
}

export interface ResolvedPrice {
  sku: string;
  uom: string;
  qty: number;
  unitNetFils: number;
  unitGrossFils: number;
  retailUnitNetFils: number;
  retailUnitGrossFils: number;
  vatRateBps: number;
  priceListId: string;
  priceListCode: string;
  priceListType: ListType;
  priceVersion: number;
  lineNetFils: number;
  lineVatFils: number;
  lineGrossFils: number;
  tiers: PriceTier[];
}

interface Effective {
  candidate: PriceCandidate;
  unitNetFils: number; // in the requested uom
  minQty: number; // exact threshold in the requested uom (may be fractional)
  displayMinQty: number; // what the customer must order, in whole units when converted
}

/**
 * Rows priced directly in `uom` win; otherwise base-uom rows are converted
 * (e.g. price per sqm × 1.44 sqm per box).
 */
function effectiveRows(
  rows: PriceCandidate[],
  meta: VariantPricingMeta,
  uom: string,
): Effective[] {
  const byList = new Map<string, PriceCandidate[]>();
  for (const r of rows) {
    const list = byList.get(r.priceListId) ?? [];
    list.push(r);
    byList.set(r.priceListId, list);
  }

  const out: Effective[] = [];
  const factor = uom === meta.baseUom ? 1 : meta.conversions[uom];
  for (const listRows of byList.values()) {
    const direct = listRows.filter((r) => r.uom === uom);
    if (direct.length) {
      for (const r of direct) {
        out.push({ candidate: r, unitNetFils: r.netPriceFils, minQty: r.minQty, displayMinQty: r.minQty });
      }
      continue;
    }
    if (!factor || uom === meta.baseUom) continue;
    for (const r of listRows.filter((x) => x.uom === meta.baseUom)) {
      out.push({
        candidate: r,
        unitNetFils: roundFils(r.netPriceFils * factor),
        // Compare on the exact threshold (100 m = 1 roll, 10 sqm = 6.94 boxes);
        // converted units are bought whole, so show the rounded-up count.
        minQty: r.minQty / factor,
        displayMinQty: Math.max(1, Math.ceil(r.minQty / factor - 1e-9)),
      });
    }
  }
  return out;
}

/** Best row per list at `qty`, then the lowest across lists. */
function pick(rows: Effective[], qty: number): Effective | null {
  const bestPerList = new Map<string, Effective>();
  for (const r of rows) {
    if (r.minQty > qty + 1e-9) continue;
    const cur = bestPerList.get(r.candidate.priceListId);
    if (!cur || r.minQty > cur.minQty) bestPerList.set(r.candidate.priceListId, r);
  }
  let best: Effective | null = null;
  for (const r of bestPerList.values()) {
    if (
      !best ||
      r.unitNetFils < best.unitNetFils ||
      (r.unitNetFils === best.unitNetFils &&
        r.candidate.priority > best.candidate.priority)
    ) {
      best = r;
    }
  }
  return best;
}

export function resolvePrice(
  candidates: PriceCandidate[],
  meta: VariantPricingMeta,
  uom: string,
  qty: number,
): ResolvedPrice | null {
  const rows = effectiveRows(candidates, meta, uom);
  const chosen = pick(rows, qty);
  if (!chosen) return null;

  const retailRows = rows.filter((r) => r.candidate.type === 'RETAIL');
  const retail = pick(retailRows, qty) ?? chosen;

  // Quantity-break table as the customer actually experiences it.
  const thresholds = [...new Set(rows.map((r) => r.displayMinQty))].sort((a, b) => a - b);
  const tiers: PriceTier[] = [];
  for (const t of thresholds) {
    const p = pick(rows, t);
    if (!p) continue;
    if (tiers.length && tiers[tiers.length - 1].unitNetFils === p.unitNetFils) continue;
    tiers.push({
      minQty: t,
      unitNetFils: p.unitNetFils,
      unitGrossFils: grossFor(p.unitNetFils, meta.vatRateBps),
    });
  }

  const lineNetFils = lineNetFor(chosen.unitNetFils, qty);
  const lineVatFils = vatFor(lineNetFils, meta.vatRateBps);
  return {
    sku: meta.sku,
    uom,
    qty,
    unitNetFils: chosen.unitNetFils,
    unitGrossFils: grossFor(chosen.unitNetFils, meta.vatRateBps),
    retailUnitNetFils: retail.unitNetFils,
    retailUnitGrossFils: grossFor(retail.unitNetFils, meta.vatRateBps),
    vatRateBps: meta.vatRateBps,
    priceListId: chosen.candidate.priceListId,
    priceListCode: chosen.candidate.priceListCode,
    priceListType: chosen.candidate.type,
    priceVersion: chosen.candidate.version,
    lineNetFils,
    lineVatFils,
    lineGrossFils: lineNetFils + lineVatFils,
    tiers,
  };
}

/** Units this SKU can be bought in, given the candidate rows and conversions. */
export function sellableUoms(
  candidates: PriceCandidate[],
  meta: VariantPricingMeta,
): string[] {
  const uoms = new Set(candidates.map((c) => c.uom));
  if (uoms.has(meta.baseUom)) {
    for (const u of Object.keys(meta.conversions)) uoms.add(u);
  }
  return [...uoms].sort((a, b) =>
    a === meta.baseUom ? -1 : b === meta.baseUom ? 1 : a.localeCompare(b),
  );
}
