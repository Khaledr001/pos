import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { officialExample, schematronAvailable, schematronFindings } from "../../../../test/einvoice/schematron.js";
import { PINT_AE_VERSION } from "./constants.js";
import { renderPintAeXml } from "./render.js";
import { buildSnapshot } from "./snapshot.js";
import { creditNoteSource, CUSTOMER, invoiceSource, line, tenantSettings } from "./test-fixtures.js";
import { validateSnapshot } from "./validate.js";

const render = (source: ReturnType<typeof invoiceSource>) => renderPintAeXml(buildSnapshot(source));

describe("PINT AE rendering", () => {
  it("carries the literals from the official examples", () => {
    const xml = render(invoiceSource());
    expect(xml).toContain("<cbc:CustomizationID>urn:peppol:pint:billing-1@ae-1</cbc:CustomizationID>");
    expect(xml).toContain("<cbc:ProfileID>urn:peppol:bis:billing</cbc:ProfileID>");
    expect(xml).toContain("<cbc:ProfileExecutionID>00000000</cbc:ProfileExecutionID>");
    expect(xml).toContain("<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>");
    expect(xml).toContain('<cbc:EndpointID schemeID="0235">1002345678</cbc:EndpointID>');
    expect(PINT_AE_VERSION).toBe("1.0.4");
  });

  it("is byte-for-byte reproducible: same snapshot, same hash", () => {
    const a = render(invoiceSource());
    const b = render(invoiceSource());
    expect(createHash("sha256").update(a).digest("hex")).toBe(createHash("sha256").update(b).digest("hex"));
  });

  it("renders a credit note as a CreditNote document with the reason and the invoice it corrects", () => {
    const xml = render(creditNoteSource());
    expect(xml).toContain("<CreditNote ");
    expect(xml).toContain("<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>");
    expect(xml).toContain("<cbc:ResponseCode>DL8.61.1.D</cbc:ResponseCode>");
    expect(xml).toContain("<cbc:ID>INV-DXB-2026-000123</cbc:ID>");
    expect(xml).toContain("<cbc:CreditedQuantity");
    expect(xml).not.toContain("<cbc:DueDate>");
    // A return is stored negative; a credit note is positive.
    expect(xml).not.toMatch(/>-\d/);
  });

  it("leaves out the preceding-invoice reference for a volume-discount credit note (IBR-055)", () => {
    const xml = render(creditNoteSource({ sale: { ...creditNoteSource().sale, creditReason: "VD" } }));
    expect(xml).not.toContain("<cac:BillingReference>");
  });

  it("sends a foreign-currency invoice with its AED rate, AED VAT and AED total", () => {
    const xml = render(
      invoiceSource({ sale: { ...invoiceSource().sale, currency: "USD", exchangeRate: "3.6725" }, payments: [{ method: "bank_transfer", amount: "115.5" }] }),
    );
    expect(xml).toContain("<cbc:TaxCurrencyCode>AED</cbc:TaxCurrencyCode>");
    expect(xml).toContain("<cbc:CalculationRate>3.6725</cbc:CalculationRate>");
    expect(xml).toContain("<cbc:DocumentTypeCode>aedtotal-incl-vat</cbc:DocumentTypeCode>");
    expect(xml).toContain('<cbc:TaxAmount currencyID="AED">20.2100</cbc:TaxAmount>'.replace("20.2100", "20.20"));
  });

  it("escapes everything that came from a person (torture test)", () => {
    const nasty = `Pipe & "Fitting" <5mm> 'x' ]]> مواسير 🔧 \u0007\u0000`;
    const xml = render(
      invoiceSource({
        lines: [line({ productName: nasty })],
        customer: { ...CUSTOMER, company: `Noor & Sons <LLC> "quoted"` },
      }),
    );
    expect(xml).toContain("Pipe &amp; &quot;Fitting&quot; &lt;5mm&gt;".replace(/&quot;/g, '"'));
    expect(xml).toContain("Noor &amp; Sons &lt;LLC&gt;");
    expect(xml).toContain("مواسير 🔧");
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/);
    expect(xml).not.toContain("<5mm>");
    expect(xml).not.toContain("]]>");
  });
});

describe("validation", () => {
  const issuesFor = (source: ReturnType<typeof invoiceSource>) => validateSnapshot(buildSnapshot(source)).map((i) => i.code);

  it("passes a complete B2B invoice and credit note", () => {
    expect(issuesFor(invoiceSource())).toEqual([]);
    expect(issuesFor(creditNoteSource())).toEqual([]);
  });

  it("says what is missing on the buyer, where to fix it", () => {
    const issues = validateSnapshot(buildSnapshot(invoiceSource({ customer: { ...CUSTOMER, trn: "12345", addressSubdivision: "Dubai", addressLine1: null } })));
    const codes = issues.map((i) => i.code);
    expect(codes).toContain("BUYER_TRN_INVALID");
    expect(codes).toContain("BUYER_ADDRESS_INCOMPLETE");
    expect(issues.find((i) => i.code === "BUYER_TRN_INVALID")?.field).toBe("customer.trn");
    expect(issues.find((i) => i.code === "BUYER_ADDRESS_INCOMPLETE")?.message).toMatch(/street/);
  });

  it("flags an unknown emirate, and a business with no licence or address", () => {
    expect(issuesFor(invoiceSource({ customer: { ...CUSTOMER, addressSubdivision: "Dubai" } }))).toContain("BUYER_SUBDIVISION_INVALID");
    const bare = tenantSettings({ legalAddress: undefined, einvoice: { ...tenantSettings().einvoice, legalRegistration: null } });
    const codes = issuesFor(invoiceSource({ tenant: { name: "X", settings: bare } }));
    expect(codes).toEqual(expect.arrayContaining(["SELLER_ADDRESS_INCOMPLETE", "SELLER_LEGAL_REGISTRATION_MISSING"]));
  });

  it("rejects a unit code that is not UN/ECE Rec 20/21, with the packaging code to use instead", () => {
    const issues = validateSnapshot(buildSnapshot(invoiceSource({ lines: [line({ unitCode: "BX" })] })));
    const unit = issues.find((i) => i.code === "UNIT_CODE_INVALID");
    expect(unit?.message).toMatch(/XBX/);
    expect(unit?.field).toBe("unit.unitCode");
    expect(issuesFor(invoiceSource({ lines: [line({ unitCode: "XBX" })] }))).toEqual([]);
    expect(issuesFor(invoiceSource({ lines: [line({ unitCode: "H87" })] }))).toEqual([]);
  });

  it("requires the TRN to end in 03 (IBR-132)", () => {
    expect(issuesFor(invoiceSource({ customer: { ...CUSTOMER, trn: "100987654300004" } }))).toContain("BUYER_TRN_INVALID");
  });

  it("requires an exemption reason on exempt lines and refuses an invoice of only exempt lines", () => {
    const exempt = line({ taxCategory: "E", taxPercent: "0.0000", taxAmount: "0.0000" });
    const codes = issuesFor(invoiceSource({ lines: [exempt], sale: { ...invoiceSource().sale, taxAmount: "0.0000", total: "110.0000" } }));
    expect(codes).toEqual(expect.arrayContaining(["EXEMPTION_REASON_MISSING", "ONLY_EXEMPT_LINES"]));
  });

  it("rejects a standard rate other than 5% and VAT on a zero-rated line", () => {
    expect(issuesFor(invoiceSource({ lines: [line({ taxPercent: "7.0000", taxAmount: "7.7000" })], sale: { ...invoiceSource().sale, taxAmount: "7.7000", total: "117.7000" } }))).toContain("VAT_RATE_NOT_STANDARD");
    expect(issuesFor(invoiceSource({ lines: [line({ taxCategory: "Z", taxPercent: "0.0000", taxAmount: "5.5000" })] }))).toContain("TAX_ON_ZERO_CATEGORY");
  });

  it("detects per-line rounding that drifts past the 0.02 PINT allows", () => {
    // 100 lines of 0.30 each: 0.015 VAT rounds to 0.02 per line, so 2.00 against 5% of 30.00 = 1.50.
    const many = Array.from({ length: 100 }, (_, i) => line({ sortOrder: i, quantity: "1.0000", unitPrice: "0.3000", lineSubtotal: "0.3000", taxAmount: "0.0200" }));
    const codes = issuesFor(invoiceSource({ lines: many, sale: { ...invoiceSource().sale, subtotal: "30.0000", taxAmount: "2.0000", total: "32.0000" } }));
    expect(codes).toContain("VAT_ROUNDING_DEVIATION");
  });

  it("detects totals that disagree with the document the customer holds", () => {
    expect(issuesFor(invoiceSource({ sale: { ...invoiceSource().sale, total: "999.0000" } }))).toContain("DOCUMENT_TOTALS_MISMATCH");
  });

  it("needs a usable AED rate for a foreign document, and a reason for a credit note", () => {
    expect(issuesFor(invoiceSource({ sale: { ...invoiceSource().sale, currency: "USD", exchangeRate: "1.0000" } }))).toContain("EXCHANGE_RATE_MISSING");
    expect(issuesFor(creditNoteSource({ sale: { ...creditNoteSource().sale, creditReason: null } }))).toContain("CREDIT_REASON_MISSING");
    expect(issuesFor(creditNoteSource({ original: null }))).toContain("CREDIT_ORIGINAL_MISSING");
  });
});

describe.skipIf(!schematronAvailable)("official PINT AE Schematron (set PINT_AE_RESOURCES)", { timeout: 180_000 }, () => {
  // The first run compiles the specification's XSLT (a few seconds each); later runs reuse the cache.
  beforeAll(async () => {
    await schematronFindings(render(invoiceSource()), "trn-invoice");
    await schematronFindings(render(creditNoteSource()), "trn-creditnote");
  }, 180_000);

  it("accepts the official example (proves the harness itself)", async () => {
    expect(await schematronFindings(officialExample("trn-invoice", "Standard tax invoice.xml"), "trn-invoice")).toEqual([]);
  });

  it("rejects a broken document (proves the harness can fail)", async () => {
    const broken = officialExample("trn-invoice", "Standard tax invoice.xml").replace("<cbc:ProfileExecutionID>00000000", "<cbc:ProfileExecutionID>0");
    expect((await schematronFindings(broken, "trn-invoice")).join("\n")).toMatch(/ibr-154-ae/);
  });

  it("accepts an invoice and a credit note built from this platform's data", async () => {
    expect(await schematronFindings(render(invoiceSource()), "trn-invoice")).toEqual([]);
    expect(await schematronFindings(render(creditNoteSource()), "trn-creditnote")).toEqual([]);
  });
});
