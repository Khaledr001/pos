import { CREDIT_NOTE_REASON_LABELS, TAX_SCHEME_VAT } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import {
  AED,
  CREDIT_NOTE_TYPE_CODE,
  CUSTOMIZATION_ID,
  INVOICE_TYPE_CODE,
  LINE_ALLOWANCE_REASON,
  LINE_ALLOWANCE_REASON_CODE,
  NS_CAC,
  NS_CBC,
  NS_CREDIT_NOTE,
  NS_INVOICE,
  PROFILE_EXECUTION_ID,
  PROFILE_ID,
} from "./constants.js";
import type { EinvoiceSnapshot, LineSnapshot, PartySnapshot, TaxBreakdownSnapshot } from "./snapshot-types.js";
import { leaf, node, serialize, withAttrs, type XmlNode } from "./xml-writer.js";

const cbc = (name: string, value: string | number, attrs: Record<string, string> = {}) => leaf(`cbc:${name}`, value, attrs);
const cac = (name: string, ...children: Parameters<typeof node>[1][]) => node(`cac:${name}`, ...children);
const money = (name: string, value: string, currency: string) => cbc(name, value, { currencyID: currency });

const taxScheme = () => cac("TaxScheme", cbc("ID", TAX_SCHEME_VAT));

function taxCategory(category: string, rate: string | null, exemptionCode: string | null) {
  return [
    cbc("ID", category),
    rate !== null ? cbc("Percent", rate) : null,
    exemptionCode ? cbc("TaxExemptionReasonCode", exemptionCode) : null,
    taxScheme(),
  ];
}

function party(p: PartySnapshot, role: "seller" | "buyer"): XmlNode {
  const a = p.address;
  const registration = p.legalRegistration;
  return cac(
    "Party",
    p.endpoint ? cbc("EndpointID", p.endpoint.id, { schemeID: p.endpoint.scheme }) : null,
    a
      ? cac(
          "PostalAddress",
          cbc("StreetName", a.line1),
          a.line2 ? cbc("AdditionalStreetName", a.line2) : null,
          cbc("CityName", a.city),
          a.postalCode ? cbc("PostalZone", a.postalCode) : null,
          cbc("CountrySubentity", a.subdivision),
          cac("Country", cbc("IdentificationCode", a.countryCode)),
        )
      : null,
    p.trn ? cac("PartyTaxScheme", cbc("CompanyID", p.trn), taxScheme()) : null,
    cac(
      "PartyLegalEntity",
      cbc("RegistrationName", p.name),
      role === "seller" && registration
        ? cbc("CompanyID", registration.id, { schemeAgencyID: registration.type, schemeAgencyName: registration.authority })
        : null,
    ),
    p.email || p.phone ? cac("Contact", p.phone ? cbc("Telephone", p.phone) : null, p.email ? cbc("ElectronicMail", p.email) : null) : null,
  );
}

function line(l: LineSnapshot, currency: string, isCredit: boolean): XmlNode {
  const hasAllowance = Money.isPositive(Money.toMinor(l.allowance));
  return cac(
    isCredit ? "CreditNoteLine" : "InvoiceLine",
    cbc("ID", l.id),
    cbc(isCredit ? "CreditedQuantity" : "InvoicedQuantity", l.quantity, { unitCode: l.unitCode }),
    money("LineExtensionAmount", l.net, currency),
    hasAllowance
      ? cac(
          "AllowanceCharge",
          cbc("ChargeIndicator", "false"),
          cbc("AllowanceChargeReasonCode", LINE_ALLOWANCE_REASON_CODE),
          cbc("AllowanceChargeReason", LINE_ALLOWANCE_REASON),
          money("Amount", l.allowance, currency),
        )
      : null,
    cac(
      "Item",
      cbc("Description", l.description),
      cbc("Name", l.name),
      l.sku ? cac("SellersItemIdentification", cbc("ID", l.sku)) : null,
      cac("ClassifiedTaxCategory", ...taxCategory(l.taxCategory, l.taxRate, l.taxCategory === "E" ? l.taxExemptionCode : null)),
    ),
    cac(
      "Price",
      money("PriceAmount", l.unitPrice, currency),
      cbc("BaseQuantity", l.priceBaseQuantity, { unitCode: l.unitCode }),
      // Rule ibr-126-ae: the gross price must be present; there is no price-level discount here, the discount is on the line.
      cac("AllowanceCharge", cbc("ChargeIndicator", "false"), money("Amount", "0.00", currency), money("BaseAmount", l.unitPrice, currency)),
    ),
    // BTAE-10 and BTAE-08: the line in AED. Category E carries no VAT line amount (ibr-163-ae).
    cac(
      "ItemPriceExtension",
      money("Amount", l.amountAed, AED),
      l.taxCategory === "E" ? null : cac("TaxTotal", money("TaxAmount", l.taxAed, AED)),
    ),
  );
}

function subtotal(b: TaxBreakdownSnapshot, currency: string): XmlNode {
  return cac(
    "TaxSubtotal",
    money("TaxableAmount", b.taxable, currency),
    money("TaxAmount", b.tax, currency),
    cac("TaxCategory", ...taxCategory(b.category, b.rate, b.category === "E" ? b.exemptionCode : null)),
  );
}

/**
 * The PINT AE document for a snapshot: an `Invoice` (type 380) or a
 * `CreditNote` (type 381), with every element in the order the UBL 2.1 schema
 * lists them.
 *
 * Pure: same snapshot, same bytes. The caller hashes the result; nothing here
 * reads the clock, the database or the environment.
 */
export function renderPintAeXml(s: EinvoiceSnapshot): string {
  const isCredit = s.docType === "credit_note";
  const foreign = s.currency !== AED;
  const c = s.currency;

  const reason = s.credit?.reason ?? null;
  const preceding = isCredit && reason !== "VD" && s.credit?.originalNumber
    ? cac("BillingReference", cac("InvoiceDocumentReference", cbc("ID", s.credit.originalNumber), s.credit.originalIssueDate ? cbc("IssueDate", s.credit.originalIssueDate) : null))
    : null;

  const header = [
    cbc("CustomizationID", CUSTOMIZATION_ID),
    cbc("ProfileID", PROFILE_ID),
    cbc("ProfileExecutionID", PROFILE_EXECUTION_ID),
    cbc("ID", s.documentNumber),
    cbc("UUID", s.uuid),
    cbc("IssueDate", s.issueDate),
    cbc("IssueTime", s.issueTime),
    ...(isCredit
      ? [cbc("CreditNoteTypeCode", CREDIT_NOTE_TYPE_CODE)]
      : [s.dueDate ? cbc("DueDate", s.dueDate) : null, cbc("InvoiceTypeCode", INVOICE_TYPE_CODE)]),
    cbc("DocumentCurrencyCode", c),
    foreign ? cbc("TaxCurrencyCode", AED) : null,
    isCredit && reason ? cac("DiscrepancyResponse", cbc("ResponseCode", reason), CREDIT_NOTE_REASON_LABELS[reason] ? cbc("Description", CREDIT_NOTE_REASON_LABELS[reason]) : null) : null,
    preceding,
    foreign
      ? cac("AdditionalDocumentReference", cbc("ID", AED), cbc("DocumentTypeCode", "aedtotal-incl-vat"), cbc("DocumentDescription", `AED ${s.totals.totalAed}`))
      : null,
    cac("AccountingSupplierParty", party(s.seller, "seller")),
    cac("AccountingCustomerParty", party(s.buyer, "buyer")),
    ...s.paymentMeans.map((code) => cac("PaymentMeans", cbc("PaymentMeansCode", code))),
    foreign && s.exchangeRate
      ? cac("TaxExchangeRate", cbc("SourceCurrencyCode", c), cbc("TargetCurrencyCode", AED), cbc("CalculationRate", s.exchangeRate))
      : null,
    cac("TaxTotal", money("TaxAmount", s.totals.tax, c), cbc("TaxIncludedIndicator", "false"), ...s.breakdown.map((b) => subtotal(b, c))),
    foreign ? cac("TaxTotal", money("TaxAmount", s.totals.taxAed, AED)) : null,
    cac(
      "LegalMonetaryTotal",
      money("LineExtensionAmount", s.totals.net, c),
      money("TaxExclusiveAmount", s.totals.net, c),
      money("TaxInclusiveAmount", s.totals.total, c),
      money("PayableAmount", s.totals.total, c),
    ),
    ...s.lines.map((l) => line(l, c, isCredit)),
  ];

  const root = withAttrs(node(isCredit ? "CreditNote" : "Invoice", ...header), {});
  return serialize(root, {
    xmlns: isCredit ? NS_CREDIT_NOTE : NS_INVOICE,
    "xmlns:cac": NS_CAC,
    "xmlns:cbc": NS_CBC,
  });
}
