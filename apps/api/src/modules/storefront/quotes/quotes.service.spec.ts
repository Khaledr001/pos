import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { describe, expect, it, vi } from "vitest";
import { RequestContext, type StorefrontScope } from "../../../common/context/request-context.js";
import type { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { CartService } from "../cart/cart.service.js";
import type { StorefrontPricing } from "../pricing/storefront-pricing.service.js";
import { quoteTotals, withinDiscountCeiling } from "./quote-math.js";
import { assertShopperMayRespond, assertStaffMayClose, assertStaffMayPrice, effectiveStatus } from "./quote-status.js";
import { QuotesAdminService } from "./quotes-admin.service.js";
import { QuotesService } from "./quotes.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ACCOUNT = "22222222-2222-4222-8222-222222222222";
const CUSTOMER = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "44444444-4444-4444-8444-444444444444";
const QUOTE_ID = "55555555-5555-4555-8555-555555555555";

const storefront = {
  tenantId: TENANT,
  tenantSettings: { tax: { mode: "exclusive", defaultRate: 5 }, currency: { base: "AED", decimals: 2 } },
} as unknown as StorefrontScope;

const withShopper = <T>(accountId: string, fn: () => Promise<T>) =>
  RequestContext.run({ requestId: "t", startedAt: Date.now(), tenantId: TENANT, storefront, shopper: { accountId, customerId: CUSTOMER } }, fn);

const quoteRow = (over: Record<string, unknown> = {}) => ({
  id: QUOTE_ID,
  number: "QT-WEB-2026-000001",
  accountId: ACCOUNT,
  clientId: CLIENT_ID,
  status: "requested",
  contactName: "Sam",
  contactEmail: "sam@example.com",
  contactPhone: "+971501234567",
  companyName: null,
  notes: null,
  staffNotes: "internal only",
  currency: "AED",
  taxMode: "exclusive",
  discountPercent: "0.00",
  subtotal: "32.5000",
  discountAmount: "0.0000",
  taxAmount: "1.6300",
  total: "34.1300",
  requestedAt: new Date("2026-01-01"),
  quotedAt: null,
  quotedBy: null,
  validUntil: null,
  respondedAt: null,
  convertedOrderId: null,
  ...over,
});

const itemRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  quoteId: QUOTE_ID,
  variantId: "v",
  unitId: "u",
  sortOrder: 0,
  productName: "Elbow",
  variantName: "20mm",
  productSku: `SKU-${id}`,
  uom: "pc",
  taxPercent: "5.00",
  quantity: "3.0000",
  unitPrice: "10.0000",
  quotedUnitPrice: null,
  ...over,
});

/** A transaction whose query results are fixed and whose writes are recorded. */
function fakeTx(options: { quote?: unknown; items?: unknown[]; insertedQuote?: unknown } = {}) {
  const inserts: { table: unknown; values: unknown }[] = [];
  const updates: { table: unknown; set: Record<string, unknown> }[] = [];
  const tx = {
    query: {
      webQuotes: { findFirst: vi.fn(async () => options.quote) },
      webQuoteItems: { findMany: vi.fn(async () => options.items ?? []) },
      tenants: { findFirst: vi.fn(async () => ({ settings: {} })) },
      productVariants: {
        findMany: vi.fn(async () => [
          { id: "v1", sku: "A", variantName: "20mm", product: { name: "Elbow" } },
          { id: "v2", sku: "B", variantName: "25mm", product: { name: "Tee" } },
        ]),
      },
    },
    execute: vi.fn(async () => [{ next_document_number: 1 }]),
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        inserts.push({ table, values });
        const result = Promise.resolve([]);
        return Object.assign(result, {
          onConflictDoNothing: () => ({ returning: async () => (options.insertedQuote ? [options.insertedQuote] : []) }),
        });
      },
    })),
    update: vi.fn((table: unknown) => ({
      set: (set: Record<string, unknown>) => {
        updates.push({ table, set });
        return { where: () => Object.assign(Promise.resolve([]), { returning: async () => [quoteRow(set)] }) };
      },
    })),
  };
  return { tx, inserts, updates };
}

const dbOf = (tx: unknown) => ({ run: (fn: (t: unknown) => unknown) => fn(tx) }) as unknown as TenantDatabase;

describe("quote totals", () => {
  it("sums lines through calculateDocument, rounding VAT once per line", () => {
    // 3 x 10.00 -> 30.00 + 1.50 VAT; 1 x 2.50 -> 2.50 + 0.13 VAT (0.125 rounds up).
    const totals = quoteTotals(
      [
        { quantity: "3", unitPrice: "10", taxPercent: "5" },
        { quantity: "1", unitPrice: "2.5", taxPercent: "5" },
      ],
      "exclusive",
      2,
    );
    expect(totals).toEqual({ subtotal: "32.5000", discountAmount: "0.0000", taxAmount: "1.6300", total: "34.1300" });
  });

  it("applies a document discount before tax, so VAT falls with it", () => {
    const totals = quoteTotals([{ quantity: "10", unitPrice: "10", taxPercent: "5" }], "exclusive", 2, "10");
    expect(totals).toEqual({ subtotal: "90.0000", discountAmount: "10.0000", taxAmount: "4.5000", total: "94.5000" });
  });

  it("extracts VAT from a tax-inclusive price rather than adding it again", () => {
    const totals = quoteTotals([{ quantity: "1", unitPrice: "105", taxPercent: "5" }], "inclusive", 2);
    expect(totals.total).toBe("105.0000");
    expect(totals.taxAmount).toBe("5.0000");
  });

  it("checks a discount ceiling exactly, in integers", () => {
    expect(withinDiscountCeiling("100", "90", "0", "10")).toBe(true);
    expect(withinDiscountCeiling("100", "89.9999", "0", "10")).toBe(false);
    // 5% off the line plus 5% off the document is a 9.75% discount in all.
    expect(withinDiscountCeiling("100", "95", "5", "10")).toBe(true);
    expect(withinDiscountCeiling("100", "95", "5", "9")).toBe(false);
  });
});

describe("quote status rules", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const past = new Date("2026-05-01T00:00:00Z");
  const future = new Date("2026-07-01T00:00:00Z");

  it("reads a quoted quote past its date as expired", () => {
    expect(effectiveStatus("quoted", past, now)).toBe("expired");
    expect(effectiveStatus("quoted", future, now)).toBe("quoted");
    expect(effectiveStatus("accepted", past, now)).toBe("accepted");
  });

  it("lets the shopper answer only a quoted, in-date quote", () => {
    expect(() => assertShopperMayRespond("quoted", future, now)).not.toThrow();
    for (const status of ["requested", "accepted", "declined", "converted"] as const) {
      expect(() => assertShopperMayRespond(status, future, now), status).toThrow(expect.objectContaining({ code: ERROR_CODES.QUOTE_INVALID_STATUS }) as AppError);
    }
    for (const status of ["quoted", "expired"] as const) {
      expect(() => assertShopperMayRespond(status, past, now), status).toThrow(expect.objectContaining({ code: ERROR_CODES.QUOTE_EXPIRED }) as AppError);
    }
  });

  it("lets staff price an open quote and nothing the shopper has answered", () => {
    expect(() => assertStaffMayPrice("requested")).not.toThrow();
    expect(() => assertStaffMayPrice("quoted")).not.toThrow();
    for (const status of ["accepted", "declined", "expired", "converted"] as const) {
      expect(() => assertStaffMayPrice(status), status).toThrow(expect.objectContaining({ code: ERROR_CODES.QUOTE_INVALID_STATUS }) as AppError);
    }
  });

  it("only lapses a quote that was sent, and only withdraws an open one", () => {
    expect(() => assertStaffMayClose("requested", "declined")).not.toThrow();
    expect(() => assertStaffMayClose("quoted", "expired")).not.toThrow();
    expect(() => assertStaffMayClose("requested", "expired")).toThrow();
    expect(() => assertStaffMayClose("accepted", "declined")).toThrow();
  });
});

describe("QuotesService (shopper)", () => {
  const unit = { unitId: "u", allowsFractions: false, taxRate: "5", packaging: { unitId: "u", uom: "pc", conversionFactor: "1", priceOverride: null } };
  const carts = { unitFor: vi.fn(async () => unit) } as unknown as CartService;
  const pricing = {
    priceLines: vi.fn(async (_tx: unknown, lines: { variantId: string }[]) =>
      lines.map((l) => ({ unitPrice: l.variantId === "v1" ? "10" : "2.5", taxPercent: "5" })),
    ),
  } as unknown as StorefrontPricing;

  const dto = {
    clientId: CLIENT_ID,
    contact: { fullName: "Sam", email: "sam@example.com", phone: "+971501234567" },
    lines: [
      { variantId: "v1", quantity: 3 },
      { variantId: "v2", quantity: 1 },
    ],
  };

  it("snapshots the lines and stores totals from calculateDocument", async () => {
    const { tx, inserts } = fakeTx({ insertedQuote: quoteRow() });
    const service = new QuotesService(dbOf(tx), carts, pricing);
    await withShopper(ACCOUNT, () => service.create(undefined, dto));

    const [quoteInsert, itemInsert] = inserts;
    expect(quoteInsert!.values).toMatchObject({
      accountId: ACCOUNT,
      clientId: CLIENT_ID,
      currency: "AED",
      taxMode: "exclusive",
      number: "QT-WEB-2026-000001".replace(/\d{4}/, String(new Date().getFullYear())),
      subtotal: "32.5000",
      taxAmount: "1.6300",
      total: "34.1300",
    });
    expect(itemInsert!.values).toEqual([
      expect.objectContaining({ productName: "Elbow", productSku: "A", taxPercent: "5", quantity: "3.0000", unitPrice: "10" }),
      expect.objectContaining({ productName: "Tee", productSku: "B", quantity: "1.0000", unitPrice: "2.5" }),
    ]);
  });

  it("never reads a price from the request", async () => {
    const { tx, inserts } = fakeTx({ insertedQuote: quoteRow() });
    const service = new QuotesService(dbOf(tx), carts, pricing);
    const tampered = { ...dto, lines: [{ variantId: "v1", quantity: 3, unitPrice: "0.01" }] } as typeof dto;
    await withShopper(ACCOUNT, () => service.create(undefined, tampered));
    expect((inserts[1]!.values as { unitPrice: string }[])[0]!.unitPrice).toBe("10");
  });

  it("returns the quote already created for a repeated client id, writing nothing", async () => {
    const { tx, inserts } = fakeTx({ quote: quoteRow(), items: [itemRow("i1")] });
    const service = new QuotesService(dbOf(tx), carts, pricing);

    const first = await withShopper(ACCOUNT, () => service.create(undefined, dto));
    const second = await withShopper(ACCOUNT, () => service.create(undefined, dto));

    expect(inserts).toHaveLength(0);
    expect(tx.execute).not.toHaveBeenCalled();
    expect(second).toEqual(first);
    expect(first.number).toBe("QT-WEB-2026-000001");
  });

  it("does not hand another shopper's quote to someone reusing its client id", async () => {
    const { tx } = fakeTx({ quote: quoteRow({ accountId: "99999999-9999-4999-8999-999999999999" }) });
    const service = new QuotesService(dbOf(tx), carts, pricing);
    await expect(withShopper(ACCOUNT, () => service.create(undefined, dto))).rejects.toMatchObject({ code: ERROR_CODES.CONFLICT });
  });

  it("hides staff notes from the shopper", async () => {
    const { tx } = fakeTx({ quote: quoteRow(), items: [itemRow("i1")] });
    const service = new QuotesService(dbOf(tx), carts, pricing);
    const view = await withShopper(ACCOUNT, () => service.get(QUOTE_ID));
    expect(JSON.stringify(view)).not.toContain("internal only");
    expect(view.status).toBe("REQUESTED");
    expect(view.estimate).toBe(true);
  });

  it("refuses to accept a quote that is not quoted, and one that has lapsed", async () => {
    const declined = fakeTx({ quote: quoteRow({ status: "declined" }) });
    await expect(withShopper(ACCOUNT, () => new QuotesService(dbOf(declined.tx), carts, pricing).accept(QUOTE_ID))).rejects.toMatchObject({
      code: ERROR_CODES.QUOTE_INVALID_STATUS,
    });

    const lapsed = fakeTx({ quote: quoteRow({ status: "quoted", validUntil: new Date(Date.now() - 1000) }) });
    await expect(withShopper(ACCOUNT, () => new QuotesService(dbOf(lapsed.tx), carts, pricing).accept(QUOTE_ID))).rejects.toMatchObject({
      code: ERROR_CODES.QUOTE_EXPIRED,
    });
    expect(lapsed.updates).toHaveLength(0);
  });

  it("accepts an in-date quoted quote", async () => {
    const open = fakeTx({ quote: quoteRow({ status: "quoted", validUntil: new Date(Date.now() + 86_400_000) }) });
    await withShopper(ACCOUNT, () => new QuotesService(dbOf(open.tx), carts, pricing).accept(QUOTE_ID));
    expect(open.updates[0]!.set).toMatchObject({ status: "accepted" });
  });
});

describe("QuotesAdminService (staff)", () => {
  const user = (permissions: string[], maxDiscountPercent = "10") =>
    ({ id: "staff-1", tenantId: TENANT, permissions, abac: { maxDiscountPercent } }) as never;
  const asStaff = <T>(u: unknown, fn: () => Promise<T>) =>
    RequestContext.run({ requestId: "t", startedAt: Date.now(), tenantId: TENANT, user: u as never }, fn);
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const items = [itemRow("a1"), itemRow("a2", { quantity: "1.0000", unitPrice: "2.5000" })];
  const body = (prices: [string, string]) => ({
    lines: [
      { itemId: "a1", unitPrice: prices[0] },
      { itemId: "a2", unitPrice: prices[1] },
    ],
    discountPercent: "0",
    validUntil: future,
  });

  it("prices every line, totals through calculateDocument and moves the quote to quoted", async () => {
    const { tx, updates } = fakeTx({ quote: quoteRow(), items });
    const service = new QuotesAdminService(dbOf(tx));
    await asStaff(user(["order:write"]), () => service.price(QUOTE_ID, body(["10", "2.5"])));

    const header = updates.find((u) => "status" in u.set)!;
    expect(header.set).toMatchObject({ status: "quoted", quotedBy: "staff-1", total: "34.1300" });
    expect(updates.filter((u) => "quotedUnitPrice" in u.set).map((u) => u.set.quotedUnitPrice)).toEqual(["10", "2.5"]);
  });

  it("refuses a price below list without the discount permission", async () => {
    const { tx, updates } = fakeTx({ quote: quoteRow(), items });
    await expect(
      asStaff(user(["order:write"]), () => new QuotesAdminService(dbOf(tx)).price(QUOTE_ID, body(["9", "2.5"]))),
    ).rejects.toMatchObject({ code: ERROR_CODES.INSUFFICIENT_PERMISSIONS });
    expect(updates).toHaveLength(0);
  });

  it("refuses a price beyond the staff member's discount ceiling", async () => {
    const { tx } = fakeTx({ quote: quoteRow(), items });
    await expect(
      asStaff(user(["order:write", "sale:discount"], "10"), () => new QuotesAdminService(dbOf(tx)).price(QUOTE_ID, body(["8", "2.5"]))),
    ).rejects.toMatchObject({ code: ERROR_CODES.DISCOUNT_EXCEEDS_LIMIT });
  });

  it("will not price a quote the shopper has already answered", async () => {
    const { tx } = fakeTx({ quote: quoteRow({ status: "accepted" }), items });
    await expect(
      asStaff(user(["order:write"]), () => new QuotesAdminService(dbOf(tx)).price(QUOTE_ID, body(["10", "2.5"]))),
    ).rejects.toMatchObject({ code: ERROR_CODES.QUOTE_INVALID_STATUS });
  });

  it("will not send a quote with an unpriced line, or a validity date in the past", async () => {
    const { tx } = fakeTx({ quote: quoteRow(), items });
    const service = new QuotesAdminService(dbOf(tx));
    await expect(
      asStaff(user(["order:write"]), () => service.price(QUOTE_ID, { ...body(["10", "2.5"]), lines: [{ itemId: "a1", unitPrice: "10" }] })),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    await expect(
      asStaff(user(["order:write"]), () => service.price(QUOTE_ID, { ...body(["10", "2.5"]), validUntil: new Date(Date.now() - 1000).toISOString() })),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it("will not close a quote that is already answered", async () => {
    const { tx } = fakeTx({ quote: quoteRow({ status: "converted" }), items });
    await expect(
      asStaff(user(["order:write"]), () => new QuotesAdminService(dbOf(tx)).close(QUOTE_ID, { status: "declined" })),
    ).rejects.toMatchObject({ code: ERROR_CODES.QUOTE_INVALID_STATUS });
  });
});
