/**
 * Literals of the UAE PINT AE specification (docs.peppol.eu/poac/ae/pint-ae).
 *
 * Every value here was taken from the official example documents and rule set
 * in the specification's resources.zip (Standard tax invoice.xml, Standard tax
 * credit Note.xml, PINT-jurisdiction-aligned-rules.sch) — not from memory. When
 * the specification moves, this file and PINT_AE_VERSION are the places to edit.
 */

/** The specification release the generated XML targets. One place to change. */
export const PINT_AE_VERSION = "1.0.4";

/** IBT-024. Rule aligned-ibrp-001-ae: must START with this value. */
export const CUSTOMIZATION_ID = "urn:peppol:pint:billing-1@ae-1";
/** IBT-023. Rule aligned-ibrp-002-ae. */
export const PROFILE_ID = "urn:peppol:bis:billing";
/**
 * BTAE-02: eight 0/1 flags — free trade zone, deemed supply, margin scheme,
 * summary invoice, continuous supply, agent billing, e-commerce, exports.
 * A plain B2B sale is none of them. Rule ibr-154-ae: exactly 8 digits.
 */
export const PROFILE_EXECUTION_ID = "00000000";

export const INVOICE_TYPE_CODE = "380";
export const CREDIT_NOTE_TYPE_CODE = "381";

export const NS_INVOICE = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
export const NS_CREDIT_NOTE = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2";
export const NS_CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
export const NS_CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";

/** Document-currency code that needs no conversion. */
export const AED = "AED";

/** Rule ibr-190-ae: a standard-rated category must carry exactly this percentage. */
export const STANDARD_RATE_PERCENT = "5";

/** Rule ibr-132-ae: a VAT identifier is 15 digits, starts with 1, ends with 03. */
export const TRN_PATTERN = /^1\d{12}03$/;
/** Rule ibr-148-ae: the 10-digit TIN, 1XXXXXXXXX. */
export const TIN_PATTERN = /^1\d{9}$/;

/** Rule ibr-173-ae: seller legal-registration types (BTAE-15). */
export const LEGAL_REGISTRATION_TYPES = ["TL", "EID", "PAS", "CD"] as const;
export type LegalRegistrationType = (typeof LEGAL_REGISTRATION_TYPES)[number];

/** UNCL5189 "95" = Discount, as used on line allowances in the official examples. */
export const LINE_ALLOWANCE_REASON_CODE = "95";
export const LINE_ALLOWANCE_REASON = "Discount";

/** Rule ibr-002-ae: the exchange rate has at most 6 decimal places. */
export const MAX_EXCHANGE_RATE_DECIMALS = 6;

/** Rule aligned-ibrp-s-09: the standard-rated VAT on a breakdown may differ from rate × taxable by this much. */
export const VAT_SLACK_MINOR4 = 200n; // 0.02
