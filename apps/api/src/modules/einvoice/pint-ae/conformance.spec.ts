import { calculateDocument, Money } from "@devsfleet/shared-utils";
import { beforeAll, describe, expect, it } from "vitest";
import { schematronAvailable, schematronFindings } from "../../../../test/einvoice/schematron.js";
import { renderPintAeXml } from "./render.js";
import { buildSnapshot, type SnapshotSource } from "./snapshot.js";
import { creditNoteSource, invoiceSource, line } from "./test-fixtures.js";
import { validateSnapshot } from "./validate.js";

/** Seeded PRNG (mulberry32): the same documents on every run, so a failure is reproducible. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random but realistic document, priced by the platform's own calculateDocument — the figures the database would hold. */
function randomSource(seed: number, kind: "invoice" | "credit_note"): SnapshotSource {
  const rand = prng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const taxMode = rand() < 0.4 ? "inclusive" : "exclusive";
  const count = int(1, 12);
  const raw = Array.from({ length: count }, (_, i) => {
    const category = i === 0 ? "S" : (["S", "S", "S", "Z", "E"] as const)[int(0, 4)]!;
    return {
      category,
      quantity: rand() < 0.5 ? String(int(1, 200)) : (int(1, 9999) / 10 ** int(0, 3)).toFixed(3),
      unitPrice: (int(1, 99999) / 10 ** int(0, 4)).toFixed(4),
      discountPercent: rand() < 0.4 ? String(int(1, 25)) : "0",
      rate: category === "S" ? "5" : "0",
    };
  });
  const docDiscount = rand() < 0.3 ? String(int(1, 15)) : undefined;
  const totals = calculateDocument({
    taxMode,
    ...(docDiscount ? { documentDiscountPercent: docDiscount } : {}),
    lines: raw.map((r) => ({ quantity: r.quantity, unitPrice: r.unitPrice, discountPercent: r.discountPercent, taxPercent: r.rate })),
  });
  const sign = kind === "credit_note" ? -1n : 1n;
  const money = (v: bigint) => Money.toDecimalString(v * sign, 4);
  const currency = rand() < 0.25 ? "USD" : "AED";
  const base = invoiceSource();
  const source: SnapshotSource = {
    ...base,
    docType: kind,
    sale: {
      ...base.sale,
      currency,
      exchangeRate: currency === "USD" ? "3.6725" : "1.0000",
      taxMode,
      subtotal: money(totals.subtotal),
      taxAmount: money(totals.taxAmount),
      total: money(totals.total),
      dueAmount: kind === "credit_note" ? "0.0000" : money(totals.total),
      creditReason: kind === "credit_note" ? "DL8.61.1.D" : null,
    },
    lines: raw.map((r, i) => {
      const t = totals.lines[i]!;
      return line({
        sortOrder: i,
        productName: `Item ${i + 1}`,
        quantity: kind === "credit_note" ? `-${r.quantity}` : r.quantity,
        unitPrice: r.unitPrice,
        taxPercent: `${r.rate}.0000`,
        taxCategory: r.category,
        taxExemptionCode: r.category === "E" ? "DL8.46.1" : null,
        unitCode: ["C62", "MTR", "KGM", "XBX"][int(0, 3)]!,
        lineSubtotal: money(t.net),
        taxAmount: money(t.tax),
      });
    }),
    original: kind === "credit_note" ? { saleNumber: "INV-DXB-2026-000001", occurredAt: new Date("2026-10-30T10:00:00Z") } : null,
  };
  if (kind === "invoice") source.docType = "invoice";
  return source;
}

const DOCS = Number(process.env.EINVOICE_CONFORMANCE_DOCS ?? 60);

describe("generated documents, arithmetic", () => {
  it("the XML figures agree with each other exactly (IBR-CO-10..16, IBR-147)", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const kind = seed % 5 === 0 ? "credit_note" : "invoice";
      const s = buildSnapshot(randomSource(seed, kind));
      const net = s.lines.reduce((sum, l) => sum + Money.toMinor(l.net), 0n);
      const tax = s.lines.reduce((sum, l) => sum + Money.toMinor(l.tax), 0n);
      expect(Money.toMinor(s.totals.net)).toBe(net);
      expect(Money.toMinor(s.totals.tax)).toBe(tax);
      expect(Money.toMinor(s.totals.total)).toBe(net + tax);
      // The breakdown covers every line and every cent of VAT.
      expect(s.breakdown.reduce((sum, b) => sum + Money.toMinor(b.taxable), 0n)).toBe(net);
      expect(s.breakdown.reduce((sum, b) => sum + Money.toMinor(b.tax), 0n)).toBe(tax);
      // ibr-147: net = round2(quantity × price/base − allowance), checked in exact integer arithmetic.
      for (const l of s.lines) {
        const gross = (Money.toMinor(l.quantity) * Money.toMinor(l.unitPrice)) / Money.toMinor(l.priceBaseQuantity);
        const expected = Money.toMinor(l.net) + Money.toMinor(l.allowance);
        expect(Money.roundTo(Money.divideRoundHalfUp(Money.toMinor(l.quantity) * Money.toMinor(l.unitPrice) * 1n, Money.toMinor(l.priceBaseQuantity) * 1n * 1n), 2)).toBe(expected);
        void gross;
      }
    }
  });

  it("only ever flags the documents the platform's own rounding makes non-conformant", () => {
    for (let seed = 1; seed <= 400; seed++) {
      const codes = new Set(validateSnapshot(buildSnapshot(randomSource(seed, seed % 5 === 0 ? "credit_note" : "invoice"))).map((i) => i.code));
      codes.delete("VAT_ROUNDING_DEVIATION");
      expect([...codes]).toEqual([]);
    }
  });
});

describe.skipIf(!schematronAvailable)("generated documents, official Schematron (set PINT_AE_RESOURCES)", { timeout: 600_000 }, () => {
  beforeAll(async () => {
    await schematronFindings(renderPintAeXml(buildSnapshot(invoiceSource())), "trn-invoice");
    await schematronFindings(renderPintAeXml(buildSnapshot(creditNoteSource())), "trn-creditnote");
  }, 180_000);

  it(`${DOCS} random invoices and credit notes conform, and the validator agrees with the Schematron`, async () => {
    const failures: string[] = [];
    for (let seed = 1000; seed < 1000 + DOCS; seed++) {
      const kind = seed % 4 === 0 ? "credit_note" : "invoice";
      const snapshot = buildSnapshot(randomSource(seed, kind));
      const issues = validateSnapshot(snapshot);
      const findings = await schematronFindings(renderPintAeXml(snapshot), kind === "credit_note" ? "trn-creditnote" : "trn-invoice");
      if (issues.length === 0 && findings.length > 0) failures.push(`seed ${seed} (${kind}): validator passed but the Schematron says ${findings.join(" | ")}`);
      if (issues.some((i) => i.code === "VAT_ROUNDING_DEVIATION") && !findings.some((f) => f.includes("s-09"))) failures.push(`seed ${seed}: validator flagged VAT rounding, Schematron did not`);
    }
    expect(failures).toEqual([]);
  });

  it("agrees on the 100-line rounding case the validator rejects", async () => {
    const many = Array.from({ length: 100 }, (_, i) => line({ sortOrder: i, quantity: "1.0000", unitPrice: "0.3000", lineSubtotal: "0.3000", taxAmount: "0.0200" }));
    const source = invoiceSource({ lines: many, sale: { ...invoiceSource().sale, subtotal: "30.0000", taxAmount: "2.0000", total: "32.0000" } });
    const snapshot = buildSnapshot(source);
    expect(validateSnapshot(snapshot).map((i) => i.code)).toContain("VAT_ROUNDING_DEVIATION");
    expect((await schematronFindings(renderPintAeXml(snapshot), "trn-invoice")).join("\n")).toMatch(/s-09/);
  });
});

/** n identical lines priced by the platform's own calculateDocument, the way a long wholesale invoice is. */
function longInvoice(n: number, unitPrice: string, taxMode: "exclusive" | "inclusive"): SnapshotSource {
  const totals = calculateDocument({ taxMode, lines: Array.from({ length: n }, () => ({ quantity: "1", unitPrice, taxPercent: "5" })) });
  const money = (v: bigint) => Money.toDecimalString(v, 4);
  const base = invoiceSource();
  return {
    ...base,
    sale: { ...base.sale, taxMode, subtotal: money(totals.subtotal), taxAmount: money(totals.taxAmount), total: money(totals.total), dueAmount: money(totals.total) },
    lines: totals.lines.map((t, i) => line({ sortOrder: i, productName: `Item ${i + 1}`, quantity: "1.0000", unitPrice, taxPercent: "5.0000", lineSubtotal: money(t.net), taxAmount: money(t.tax) })),
  };
}

describe("a long invoice priced by calculateDocument", () => {
  for (const taxMode of ["exclusive", "inclusive"] as const) {
    it(`100 lines of 0.30, tax ${taxMode}: VAT is settled per rate, so the VAT-rounding rule is not tripped`, () => {
      const snapshot = buildSnapshot(longInvoice(100, "0.3000", taxMode));
      expect(validateSnapshot(snapshot).map((i) => i.code)).not.toContain("VAT_ROUNDING_DEVIATION");
    });
  }

  it.skipIf(!schematronAvailable)("and the official Schematron agrees (no aligned-ibrp-s-09)", { timeout: 180_000 }, async () => {
    for (const taxMode of ["exclusive", "inclusive"] as const) {
      const findings = await schematronFindings(renderPintAeXml(buildSnapshot(longInvoice(100, "0.3000", taxMode))), "trn-invoice");
      expect(findings.join("\n")).not.toMatch(/s-09/);
    }
  });
});
