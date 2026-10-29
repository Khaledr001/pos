import {
  EINVOICE_SENT_STATUSES,
  UAE_SUBDIVISIONS,
  isValidTrn,
  normalizeTrn,
  tinFromTrn,
  type EinvoiceStatus,
} from "@devsfleet/shared-types";

/**
 * Admin-side helpers for UAE e-invoicing. Pure — no fetching — so the same rules
 * drive the customer forms, the sales screens and the register.
 *
 * Nothing here is the control: the API validates every one of these (rule 9).
 * These exist so the interface tells the person the truth before the request.
 */

/** What a sale row carries about its e-invoice (absent on older payloads or when none applies). */
export interface EinvoiceRef {
  id: string;
  status: EinvoiceStatus;
  uuid?: string;
}

export const EINVOICE_STATUS_TONE: Record<EinvoiceStatus, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  queued: "secondary",
  submitting: "warning",
  submitted: "default",
  delivered: "success",
  rejected: "destructive",
  failed: "destructive",
  cancelled: "secondary",
};

/** Has this document gone (or is it going) to the network? Then only a credit note can correct it. */
export function isSentEinvoice(status: EinvoiceStatus | null | undefined): boolean {
  return !!status && EINVOICE_SENT_STATUSES.includes(status);
}

export const SENT_INVOICE_HINT = "Sent to the e-invoicing network — issue a credit note instead.";

// ── customers ────────────────────────────────────────────────────────────

export interface EinvoiceCustomerFields {
  trn: string;
  addressLine1: string;
  addressLine2: string;
  addressCity: string;
  addressSubdivision: string;
  addressPostalCode: string;
  addressCountry: string;
  einvoiceScheme: string;
  einvoiceEndpoint: string;
}

export const EMPTY_EINVOICE_FIELDS: EinvoiceCustomerFields = {
  trn: "",
  addressLine1: "",
  addressLine2: "",
  addressCity: "",
  addressSubdivision: "",
  addressPostalCode: "",
  addressCountry: "AE",
  einvoiceScheme: "",
  einvoiceEndpoint: "",
};

/** The e-invoice-relevant slice of a customer row, every field optional (older payloads lack them). */
export interface EinvoiceCustomerLike {
  trn?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressSubdivision?: string | null;
  addressPostalCode?: string | null;
  addressCountry?: string | null;
  einvoiceScheme?: string | null;
  einvoiceEndpoint?: string | null;
}

export function einvoiceFieldsFrom(c: EinvoiceCustomerLike | null | undefined): EinvoiceCustomerFields {
  return {
    trn: c?.trn ?? "",
    addressLine1: c?.addressLine1 ?? "",
    addressLine2: c?.addressLine2 ?? "",
    addressCity: c?.addressCity ?? "",
    addressSubdivision: c?.addressSubdivision ?? "",
    addressPostalCode: c?.addressPostalCode ?? "",
    addressCountry: c?.addressCountry || "AE",
    einvoiceScheme: c?.einvoiceScheme ?? "",
    einvoiceEndpoint: c?.einvoiceEndpoint ?? "",
  };
}

const STRUCTURED_KEYS = [
  "addressLine1",
  "addressLine2",
  "addressCity",
  "addressSubdivision",
  "addressPostalCode",
  "einvoiceScheme",
  "einvoiceEndpoint",
] as const;

/**
 * The request body for the structured fields.
 *
 * Blank and never set → omitted. Blank but previously set → `null`, so a mistaken
 * value can be cleared (the existing forms send `undefined` for blanks, which
 * can only ever add). The country is always sent: it has a default.
 */
export function einvoiceFieldsPayload(
  f: EinvoiceCustomerFields,
  original?: EinvoiceCustomerLike | null,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of STRUCTURED_KEYS) {
    const value = f[key].trim();
    if (value) out[key] = value;
    else if (original?.[key]) out[key] = null;
  }
  out.addressCountry = (f.addressCountry.trim() || "AE").toUpperCase();
  return out;
}

/** Why a business customer (one with a TRN) cannot be invoiced electronically yet. Empty = ready. */
export function customerEinvoiceProblems(c: EinvoiceCustomerLike): string[] {
  const problems: string[] = [];
  if (!c.trn) return problems;
  if (!isValidTrn(c.trn)) problems.push("TRN must be 15 digits starting 100");
  if (!c.addressLine1?.trim()) problems.push("Street address is missing");
  if (!c.addressCity?.trim()) problems.push("City is missing");
  const country = (c.addressCountry || "AE").toUpperCase();
  const sub = c.addressSubdivision?.trim();
  if (!sub) problems.push(country === "AE" ? "Emirate is missing" : "Region is missing");
  else if (country === "AE" && !(UAE_SUBDIVISIONS as readonly string[]).includes(sub)) problems.push("Emirate is not recognised");
  if (!!c.einvoiceScheme?.trim() !== !!c.einvoiceEndpoint?.trim()) problems.push("Peppol address needs both a scheme and an id");
  return problems;
}

/** True only when the payload carries the structured fields at all, so a list that omits them never shows a false "missing". */
export function hasEinvoiceFields(c: EinvoiceCustomerLike): boolean {
  return c.addressCountry !== undefined || c.addressLine1 !== undefined || c.addressCity !== undefined;
}

export { isValidTrn, normalizeTrn, tinFromTrn };

// ── "where to fix it" links for an issue's `field` ──────────────────────

export function fixLinkFor(field: string | undefined): { href: string; label: string } | null {
  if (!field) return null;
  const root = field.split(".")[0]!.toLowerCase();
  if (root === "seller" || root === "settings" || root === "tenant" || root === "provider")
    return { href: "/settings/einvoicing", label: "E-invoicing settings" };
  if (root === "customer" || root === "buyer") return { href: "/customers", label: "Customers" };
  if (root === "product" || root === "item" || root === "line" || root === "variant") return { href: "/products", label: "Products" };
  if (root === "unit") return { href: "/units", label: "Units" };
  return null;
}
