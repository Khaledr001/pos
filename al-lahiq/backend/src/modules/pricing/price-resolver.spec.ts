import { PriceCandidate, resolvePrice, sellableUoms, VariantPricingMeta } from './price-resolver.js';

const meta = (over: Partial<VariantPricingMeta> = {}): VariantPricingMeta => ({
  sku: 'SKU-1',
  baseUom: 'pc',
  vatRateBps: 500,
  conversions: {},
  ...over,
});

const row = (over: Partial<PriceCandidate>): PriceCandidate => ({
  priceListId: 'retail',
  priceListCode: 'RETAIL',
  type: 'RETAIL',
  priority: 0,
  version: 1,
  uom: 'pc',
  minQty: 1,
  netPriceFils: 1000,
  ...over,
});

describe('resolvePrice', () => {
  it('returns null when no price applies', () => {
    expect(resolvePrice([], meta(), 'pc', 1)).toBeNull();
  });

  it('uses the highest quantity break that the quantity reaches', () => {
    const rows = [row({ minQty: 1, netPriceFils: 1000 }), row({ minQty: 10, netPriceFils: 900 }), row({ minQty: 50, netPriceFils: 800 })];
    expect(resolvePrice(rows, meta(), 'pc', 9)!.unitNetFils).toBe(1000);
    expect(resolvePrice(rows, meta(), 'pc', 10)!.unitNetFils).toBe(900);
    expect(resolvePrice(rows, meta(), 'pc', 75)!.unitNetFils).toBe(800);
  });

  it('gives the lowest price across applicable lists, with retail for comparison', () => {
    const rows = [
      row({ netPriceFils: 1000 }),
      row({ priceListId: 'trade', priceListCode: 'TRADE-A', type: 'TRADE', netPriceFils: 850, version: 7 }),
      row({ priceListId: 'promo', priceListCode: 'PROMO', type: 'PROMO', netPriceFils: 900 }),
    ];
    const p = resolvePrice(rows, meta(), 'pc', 1)!;
    expect(p.unitNetFils).toBe(850);
    expect(p.priceListCode).toBe('TRADE-A');
    expect(p.priceVersion).toBe(7);
    expect(p.retailUnitNetFils).toBe(1000);
  });

  it('prefers the higher priority list when prices tie', () => {
    const rows = [
      row({ netPriceFils: 900 }),
      row({ priceListId: 'promo', priceListCode: 'PROMO', type: 'PROMO', priority: 20, netPriceFils: 900 }),
    ];
    expect(resolvePrice(rows, meta(), 'pc', 1)!.priceListCode).toBe('PROMO');
  });

  it('a retail quantity break can beat a flat trade price', () => {
    const rows = [
      row({ minQty: 1, netPriceFils: 1000 }),
      row({ minQty: 100, netPriceFils: 700 }),
      row({ priceListId: 'trade', priceListCode: 'TRADE-A', type: 'TRADE', netPriceFils: 800 }),
    ];
    expect(resolvePrice(rows, meta(), 'pc', 5)!.priceListCode).toBe('TRADE-A');
    expect(resolvePrice(rows, meta(), 'pc', 100)!.priceListCode).toBe('RETAIL');
  });

  it('adds 5% VAT and rounds each line', () => {
    const p = resolvePrice([row({ netPriceFils: 1333 })], meta(), 'pc', 3)!;
    expect(p.unitGrossFils).toBe(1400); // 1333 × 1.05 = 1399.65
    expect(p.lineNetFils).toBe(3999);
    expect(p.lineVatFils).toBe(200); // 199.95
    expect(p.lineGrossFils).toBe(4199);
  });

  it('charges no VAT for zero-rated items', () => {
    const p = resolvePrice([row({ netPriceFils: 1000 })], meta({ vatRateBps: 0 }), 'pc', 2)!;
    expect(p.lineVatFils).toBe(0);
    expect(p.lineGrossFils).toBe(2000);
  });

  it('supports fractional quantities (cable by the metre)', () => {
    const p = resolvePrice([row({ uom: 'm', netPriceFils: 150 })], meta({ baseUom: 'm' }), 'm', 2.5)!;
    expect(p.lineNetFils).toBe(375);
  });

  describe('unit conversion', () => {
    const cable = meta({ baseUom: 'm', conversions: { roll: 100 } });
    const cableRows = [
      row({ uom: 'm', minQty: 1, netPriceFils: 150 }),
      row({ uom: 'm', minQty: 100, netPriceFils: 132 }),
      row({ uom: 'm', minQty: 500, netPriceFils: 125 }),
    ];

    it('prices a converted unit from the base unit, using the base-unit break it reaches', () => {
      const p = resolvePrice(cableRows, cable, 'roll', 1)!;
      expect(p.unitNetFils).toBe(13_200); // 1 roll = 100 m → 100 m break
      expect(resolvePrice(cableRows, cable, 'roll', 5)!.unitNetFils).toBe(12_500);
    });

    it('shows converted breaks as whole units', () => {
      const tile = meta({ baseUom: 'sqm', conversions: { box: 1.44 } });
      const rows = [row({ uom: 'sqm', netPriceFils: 3900 }), row({ uom: 'sqm', minQty: 50, netPriceFils: 3600 })];
      const p = resolvePrice(rows, tile, 'box', 1)!;
      expect(p.unitNetFils).toBe(5616); // 3900 × 1.44
      expect(p.tiers.map((t) => t.minQty)).toEqual([1, 35]); // 50 / 1.44 = 34.7 → 35 boxes
      expect(resolvePrice(rows, tile, 'box', 35)!.unitNetFils).toBe(5184);
    });

    it('a direct price in that unit wins over conversion', () => {
      const rows = [...cableRows, row({ uom: 'roll', netPriceFils: 12_000 })];
      expect(resolvePrice(rows, cable, 'roll', 1)!.unitNetFils).toBe(12_000);
    });

    it('returns null for a unit with neither a price nor a conversion', () => {
      expect(resolvePrice(cableRows, cable, 'box', 1)).toBeNull();
    });
  });

  it('builds the quantity-break table the customer sees, merging equal steps', () => {
    const rows = [
      row({ minQty: 1, netPriceFils: 1000 }),
      row({ minQty: 10, netPriceFils: 900 }),
      row({ priceListId: 'trade', type: 'TRADE', priceListCode: 'T', minQty: 1, netPriceFils: 850 }),
      row({ minQty: 50, netPriceFils: 800 }),
    ];
    const p = resolvePrice(rows, meta(), 'pc', 1)!;
    expect(p.tiers.map((t) => [t.minQty, t.unitNetFils])).toEqual([
      [1, 850],
      [50, 800],
    ]);
  });
});

describe('sellableUoms', () => {
  it('lists the base unit first, then converted units', () => {
    const m = meta({ baseUom: 'm', conversions: { roll: 100 } });
    expect(sellableUoms([row({ uom: 'm' })], m)).toEqual(['m', 'roll']);
  });

  it('does not offer conversions when the base unit has no price', () => {
    const m = meta({ baseUom: 'm', conversions: { roll: 100 } });
    expect(sellableUoms([row({ uom: 'roll' })], m)).toEqual(['roll']);
  });
});
