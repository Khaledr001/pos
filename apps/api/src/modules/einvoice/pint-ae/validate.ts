import { CREDIT_NOTE_REASONS, UAE_SUBDIVISIONS, type EinvoiceIssue } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { AED, LEGAL_REGISTRATION_TYPES, MAX_EXCHANGE_RATE_DECIMALS, STANDARD_RATE_PERCENT, TRN_PATTERN, VAT_SLACK_MINOR4 } from "./constants.js";
import { decimalPlaces } from "./format.js";
import { isUneceUnitCode } from "./unit-codes.js";
import type { EinvoiceSnapshot, PartySnapshot } from "./snapshot-types.js";

type Draft = Omit<EinvoiceIssue, "severity"> & { severity?: EinvoiceIssue["severity"] };

/** Packaging codes people reach for that are not in Recommendation 20; Recommendation 21 prefixes them with X. */
const PACKAGING_HINTS: Record<string, string> = { BX: "XBX (box)", PK: "XPK (package)", ROL: "XRO (roll)", BG: "XBG (bag)", CT: "XCT (carton)", CTN: "XCT (carton)", BOX: "XBX (box)" };
const COUNTRY = /^[A-Z]{2}$/;

/**
 * Checks a snapshot against the PINT AE rules that the data model can break,
 * and says — in the admin's terms — what to fix.
 *
 * This mirrors the specification's Schematron for the cases an invoice built
 * from this platform can actually hit (the Schematron itself is run against
 * generated documents in the test suite when the specification's resources are
 * available). A document with an `error` is never sent: it is held as
 * "rejected" with these messages, so staff correct the data and retry instead
 * of the network bouncing it.
 */
export function validateSnapshot(s: EinvoiceSnapshot): EinvoiceIssue[] {
  const issues: EinvoiceIssue[] = [];
  const add = (issue: Draft) => issues.push({ severity: "error", ...issue });

  if (!s.documentNumber.trim()) add({ code: "DOCUMENT_NUMBER_MISSING", message: "The document has no number.", field: "sale" });

  checkSeller(s.seller, add);
  checkBuyer(s.buyer, add);

  if (s.lines.length === 0) add({ code: "LINES_MISSING", message: "The document has no lines (PINT rule IBR-016).", field: "sale" });

  for (const l of s.lines) {
    const where = `Line ${l.id} (${l.name || l.sku})`;
    if (!l.name.trim()) add({ code: "LINE_NAME_MISSING", message: `${where} has no item name (IBR-025).`, field: "product.name" });
    if (!Money.isPositive(Money.toMinor(l.quantity))) add({ code: "LINE_QUANTITY_INVALID", message: `${where} has no quantity.`, field: "sale" });
    if (!isUneceUnitCode(l.unitCode)) {
      const hint = PACKAGING_HINTS[l.unitCode];
      add({
        code: "UNIT_CODE_INVALID",
        message: `${where} has the unit code "${l.unitCode}", which is not a UN/ECE Recommendation 20/21 code (IBR-CL-23).${hint ? ` Use ${hint}.` : " Use one such as C62 (each), MTR, KGM, LTR or XBX (box)."}`,
        field: "unit.unitCode",
      });
    }

    const rate = Money.toMinor(l.taxRate ?? "0");
    const tax = Money.toMinor(l.tax);
    if (l.taxCategory === "S") {
      if (!Money.isPositive(rate)) {
        add({ code: "TAX_CATEGORY_RATE_MISMATCH", message: `${where} is standard-rated but has no VAT rate.`, field: "product.taxCategory" });
      } else if (l.taxRate !== STANDARD_RATE_PERCENT) {
        add({ code: "VAT_RATE_NOT_STANDARD", message: `${where} is standard-rated at ${l.taxRate}%. PINT AE requires the standard rate to be exactly ${STANDARD_RATE_PERCENT}% (IBR-190).`, field: "product.taxRate" });
      }
    } else if (Money.isPositive(tax)) {
      add({ code: "TAX_ON_ZERO_CATEGORY", message: `${where} is categorised ${l.taxCategory} (no VAT) but carries VAT of ${l.tax}.`, field: "product.taxCategory" });
    }
    if (l.taxCategory === "E" && !l.taxExemptionCode) {
      add({ code: "EXEMPTION_REASON_MISSING", message: `${where} is exempt but has no exemption reason (IBR-167).`, field: "product.taxExemptionCode" });
    }
  }

  if (s.lines.length > 0 && s.lines.every((l) => l.taxCategory === "E" || l.taxCategory === "O")) {
    add({
      code: "ONLY_EXEMPT_LINES",
      message: "A tax invoice or credit note needs at least one standard-rated or zero-rated line; every line here is exempt or out of scope (IBR-151).",
      field: "product.taxCategory",
    });
  }

  // aligned-ibrp-s-09: the VAT on a standard-rated breakdown must be rate × taxable, give or take 0.02.
  for (const b of s.breakdown) {
    if (b.category !== "S" || b.rate === null) continue;
    const expected = Money.roundTo(Money.percentOf(Money.toMinor(b.taxable), b.rate), 2);
    const difference = Money.abs(Money.toMinor(b.tax) - expected);
    if (difference > VAT_SLACK_MINOR4) {
      add({
        code: "VAT_ROUNDING_DEVIATION",
        message: `VAT on the ${b.rate}% lines is ${b.tax}, but ${b.rate}% of ${b.taxable} is ${Money.toDecimalString(expected, 2)}. PINT AE allows a difference of at most 0.02, and per-line rounding on this invoice exceeds it (aligned-ibrp-s-09).`,
        field: "sale",
      });
    }
  }

  // The XML must say what the printed document says.
  const same = (a: string, b: string) => Money.toMinor(a) === Money.toMinor(b);
  if (!same(s.totals.net, s.recorded.net) || !same(s.totals.tax, s.recorded.tax) || !same(s.totals.total, s.recorded.total)) {
    add({
      code: "DOCUMENT_TOTALS_MISMATCH",
      message: `The lines add up to ${s.totals.total} (net ${s.totals.net}, VAT ${s.totals.tax}), but the document records ${s.recorded.total} (net ${s.recorded.net}, VAT ${s.recorded.tax}).`,
      field: "sale",
    });
  }

  if (s.currency !== AED) {
    if (s.baseCurrency !== AED) {
      add({ code: "EXCHANGE_RATE_UNSUPPORTED", message: `This document is in ${s.currency} and the business keeps its books in ${s.baseCurrency}; PINT AE needs the AED exchange rate, which the platform cannot derive.`, field: "sale" });
    } else if (!s.exchangeRate || Money.toMinor(s.exchangeRate) === 10_000n) {
      add({ code: "EXCHANGE_RATE_MISSING", message: `This document is in ${s.currency} but has no usable ${s.currency}→AED exchange rate (IBR-159).`, field: "sale" });
    } else if (decimalPlaces(s.exchangeRate) > MAX_EXCHANGE_RATE_DECIMALS) {
      add({ code: "EXCHANGE_RATE_PRECISION", message: `The exchange rate ${s.exchangeRate} has more than ${MAX_EXCHANGE_RATE_DECIMALS} decimal places (IBR-002).`, field: "sale" });
    }
  }

  if (s.docType === "credit_note") {
    const reason = s.credit?.reason ?? null;
    if (!reason || !(CREDIT_NOTE_REASONS as readonly string[]).includes(reason)) {
      add({ code: "CREDIT_REASON_MISSING", message: "A credit note needs one of the PINT AE credit-note reasons (IBR-158, IBR-001).", field: "sale.creditReason" });
    }
    if (reason !== "VD" && !s.credit?.originalNumber) {
      add({ code: "CREDIT_ORIGINAL_MISSING", message: "A credit note must refer to the invoice it corrects (IBR-055).", field: "sale.returnOfSale" });
    }
  }

  return issues;
}

type Add = (issue: Draft) => void;

function checkSeller(p: PartySnapshot, add: Add): void {
  if (!p.name.trim()) add({ code: "SELLER_NAME_MISSING", message: "The business has no legal name.", field: "settings.legalName" });
  if (!p.trn) add({ code: "SELLER_TRN_MISSING", message: "The business has no Tax Registration Number.", field: "settings.trn" });
  else if (!TRN_PATTERN.test(p.trn)) {
    add({ code: "SELLER_TRN_INVALID", message: `The business TRN ${p.trn} is not valid: a TRN is 15 digits, starting 1 and ending 03 (IBR-132).`, field: "settings.trn" });
  }
  checkAddress(p, "SELLER", "The business", "settings.legalAddress", add);
  if (!p.endpoint) {
    add({ code: "SELLER_ENDPOINT_MISSING", message: "The business has no Peppol electronic address: add a valid TRN, or set the address in the e-invoicing settings (IBR-081).", field: "settings.einvoice.endpoint" });
  }

  const reg = p.legalRegistration;
  if (!reg || !reg.id.trim()) {
    add({ code: "SELLER_LEGAL_REGISTRATION_MISSING", message: "The business needs its trade licence (or other legal registration) number in the e-invoicing settings (IBR-150).", field: "settings.einvoice.legalRegistration" });
  } else {
    if (!(LEGAL_REGISTRATION_TYPES as readonly string[]).includes(reg.type)) {
      add({ code: "SELLER_LEGAL_REGISTRATION_TYPE_INVALID", message: `The legal registration type "${reg.type}" must be one of ${LEGAL_REGISTRATION_TYPES.join(", ")} (IBR-173).`, field: "settings.einvoice.legalRegistration" });
    }
    if (reg.type === "TL" && !reg.authority.trim()) {
      add({ code: "SELLER_LICENSE_AUTHORITY_MISSING", message: "A trade licence needs the name of the authority that issued it (IBR-172).", field: "settings.einvoice.legalRegistration" });
    }
    if (reg.type === "PAS" && !COUNTRY.test(reg.authority.trim().toUpperCase())) {
      add({ code: "SELLER_PASSPORT_COUNTRY_MISSING", message: "A passport registration needs the issuing country's two-letter code in the authority field (IBR-012).", field: "settings.einvoice.legalRegistration" });
    }
  }
}

function checkBuyer(p: PartySnapshot, add: Add): void {
  if (!p.name.trim()) add({ code: "BUYER_NAME_MISSING", message: "The customer has no name.", field: "customer.name" });
  if (!p.trn) add({ code: "BUYER_TRN_MISSING", message: "The customer has no Tax Registration Number.", field: "customer.trn" });
  else if (!TRN_PATTERN.test(p.trn)) {
    add({ code: "BUYER_TRN_INVALID", message: `The customer's TRN ${p.trn} is not valid: a TRN is 15 digits, starting 1 and ending 03 (IBR-132).`, field: "customer.trn" });
  }
  checkAddress(p, "BUYER", "The customer", "customer.address", add);
  if (!p.endpoint) add({ code: "BUYER_ENDPOINT_MISSING", message: "The customer has no Peppol electronic address; a valid TRN provides one (IBR-080).", field: "customer.trn" });
}

function checkAddress(p: PartySnapshot, prefix: "SELLER" | "BUYER", who: string, field: string, add: Add): void {
  const a = p.address;
  const rule = prefix === "SELLER" ? "IBR-143" : "IBR-144";
  if (!a || !a.line1.trim() || !a.city.trim() || !a.subdivision.trim()) {
    const missing = !a ? "address" : [!a.line1.trim() && "street", !a.city.trim() && "city", !a.subdivision.trim() && "emirate"].filter(Boolean).join(", ");
    add({ code: `${prefix}_ADDRESS_INCOMPLETE`, message: `${who} needs a structured address with street, city and emirate — missing: ${missing} (${rule}).`, field });
    return;
  }
  if (!COUNTRY.test(a.countryCode)) add({ code: `${prefix}_COUNTRY_INVALID`, message: `${who}'s country code "${a.countryCode}" must be a two-letter ISO code.`, field });
  else if (a.countryCode === "AE" && !(UAE_SUBDIVISIONS as readonly string[]).includes(a.subdivision)) {
    add({ code: `${prefix}_SUBDIVISION_INVALID`, message: `${who}'s emirate "${a.subdivision}" must be one of ${UAE_SUBDIVISIONS.join(", ")} (IBR-128).`, field });
  }
}
