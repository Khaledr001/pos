import { formatAed, grossFor, vatFor } from './money.js';
import { allocateDiscount, computeTotals } from './totals.js';

describe('money', () => {
  it('rounds VAT half away from zero', () => {
    expect(vatFor(1010, 500)).toBe(51); // 50.5
    expect(vatFor(1009, 500)).toBe(50); // 50.45
    expect(grossFor(10_000, 500)).toBe(10_500);
  });

  it('formats AED with two decimals and thousands separators', () => {
    expect(formatAed(123_456)).toBe('AED 1,234.56');
    expect(formatAed(5)).toBe('AED 0.05');
  });
});

describe('allocateDiscount', () => {
  it('splits a discount in proportion and the parts add up exactly', () => {
    const lines = [
      { lineNetFils: 1000, vatRateBps: 500 },
      { lineNetFils: 2000, vatRateBps: 500 },
      { lineNetFils: 3333, vatRateBps: 500 },
    ];
    const parts = allocateDiscount(lines, 1001);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(parts[2]).toBeGreaterThan(parts[1]);
  });

  it('never discounts more than the subtotal', () => {
    expect(allocateDiscount([{ lineNetFils: 500, vatRateBps: 500 }], 900)).toEqual([500]);
  });
});

describe('computeTotals', () => {
  it('charges VAT on the discounted amount and on delivery', () => {
    const t = computeTotals([{ lineNetFils: 72_300, vatRateBps: 500 }], 7_230, 2_000);
    expect(t.subtotalNetFils).toBe(72_300);
    expect(t.discountNetFils).toBe(7_230);
    // (72300 - 7230) × 5% = 3253.5 → 3254; delivery 2000 × 5% = 100
    expect(t.vatFils).toBe(3_354);
    expect(t.totalFils).toBe(72_300 - 7_230 + 2_000 + 3_354);
  });

  it('keeps zero-rated lines VAT free after the discount', () => {
    const t = computeTotals(
      [
        { lineNetFils: 10_000, vatRateBps: 500 },
        { lineNetFils: 10_000, vatRateBps: 0 },
      ],
      2_000,
      0,
    );
    expect(t.lineVatFils).toEqual([450, 0]);
    expect(t.vatFils).toBe(450);
  });
});
