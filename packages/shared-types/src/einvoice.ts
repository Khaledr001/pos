/**
 * UAE VAT and e-invoicing vocabulary: tax categories, credit-note reasons, the
 * party identifiers PINT AE needs, the settings a tenant fills in, and the
 * shapes the admin reads back.
 *
 * Code values come from the PINT AE specification (docs.peppol.eu/poac/ae/
 * pint-ae, v1.0.x) — change them only against that document.
 */

const asConst = <const T extends readonly string[]>(values: T) => values;

// ── tax categories ───────────────────────────────────────────────────────

/**
 * S standard-rated · Z zero-rated · E exempt · O out of scope / not subject.
 * (PINT AE also has AE reverse charge and N additional-VAT; neither is a retail
 * case this platform issues yet.)
 */
export const TAX_CATEGORIES = asConst(["S", "Z", "E", "O"]);
export type TaxCategory = (typeof TAX_CATEGORIES)[number];

export const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  S: "Standard rate",
  Z: "Zero-rated",
  E: "Exempt",
  O: "Out of scope",
};

/** Reasons for exemption (PINT AE `Aligned-TaxExemptionCodes`). Apply to category E. */
export const TAX_EXEMPTION_CODES = asConst(["DL8.46.1", "DL8.46.2", "DL8.46.3", "DL8.46.4"]);
export type TaxExemptionCode = (typeof TAX_EXEMPTION_CODES)[number];

export const TAX_EXEMPTION_LABELS: Record<TaxExemptionCode, string> = {
  "DL8.46.1": "Certain financial services",
  "DL8.46.2": "Residential units (lease or sale)",
  "DL8.46.3": "Bare land",
  "DL8.46.4": "Local passenger transport",
};

/** What a line with no stored category is: a taxed line is standard, an untaxed one zero-rated. */
export function defaultTaxCategory(ratePercent: string | number): TaxCategory {
  return Number(ratePercent) > 0 ? "S" : "Z";
}

/** A line's category must agree with its rate: S needs a rate, Z/E/O are 0%. */
export function taxCategoryMatchesRate(category: TaxCategory, ratePercent: string | number): boolean {
  const positive = Number(ratePercent) > 0;
  return category === "S" ? positive : !positive;
}

// ── credit notes ─────────────────────────────────────────────────────────

/** PINT AE `AE-CreditReason`. The code is what is stored and sent. */
export const CREDIT_NOTE_REASONS = asConst(["DL8.61.1.D", "DL8.61.1.A", "DL8.61.1.C", "VD", "DL8.61.1.E", "DL8.61.1.B"]);
export type CreditNoteReason = (typeof CREDIT_NOTE_REASONS)[number];

export const CREDIT_NOTE_REASON_LABELS: Record<CreditNoteReason, string> = {
  "DL8.61.1.D": "Goods or services returned",
  "DL8.61.1.A": "Supply cancelled",
  "DL8.61.1.C": "Agreed price changed",
  VD: "Volume discount",
  "DL8.61.1.E": "Tax charged in error",
  "DL8.61.1.B": "Tax treatment changed",
};

export const DEFAULT_CREDIT_NOTE_REASON: CreditNoteReason = "DL8.61.1.D";

// ── parties and identifiers ──────────────────────────────────────────────

/** Peppol electronic-address scheme for a UAE Tax Identification Number. */
export const EAS_UAE_TIN = "0235";
/** Scheme code on a VAT/TRN party tax scheme. */
export const TAX_SCHEME_VAT = "VAT";

/** Collapse spaces and dashes; digits only for a UAE TRN. */
export function normalizeTrn(value: string): string {
  return value.replace(/[\s-]/g, "");
}

/** A UAE TRN: 15 digits starting 100. */
export function isValidTrn(value: string | null | undefined): boolean {
  return !!value && /^100\d{12}$/.test(normalizeTrn(value));
}

/** The 10-digit TIN is the first ten digits of a TRN. */
export function tinFromTrn(trn: string): string | null {
  const n = normalizeTrn(trn);
  return isValidTrn(n) ? n.slice(0, 10) : null;
}

/**
 * The seven emirates as PINT AE country-subdivision values. Mapped from this
 * platform's zone codes (`EMIRATES`) so a stored address converts without a lookup table elsewhere.
 */
export const UAE_SUBDIVISIONS = asConst(["AUH", "DXB", "SHJ", "UAQ", "FUJ", "AJM", "RAK"]);
export type UaeSubdivision = (typeof UAE_SUBDIVISIONS)[number];

export const UAE_SUBDIVISION_LABELS: Record<UaeSubdivision, string> = {
  AUH: "Abu Dhabi",
  DXB: "Dubai",
  SHJ: "Sharjah",
  UAQ: "Umm Al Quwain",
  FUJ: "Fujairah",
  AJM: "Ajman",
  RAK: "Ras Al Khaimah",
};

export const ZONE_TO_UAE_SUBDIVISION: Record<string, UaeSubdivision> = {
  ABU_DHABI: "AUH",
  DUBAI: "DXB",
  SHARJAH: "SHJ",
  UMM_AL_QUWAIN: "UAQ",
  FUJAIRAH: "FUJ",
  AJMAN: "AJM",
  RAS_AL_KHAIMAH: "RAK",
};

export interface PartyAddress {
  line1: string;
  line2?: string;
  city: string;
  /** Emirate for the UAE (see `UAE_SUBDIVISIONS`); region or state elsewhere. */
  subdivision: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2. */
  countryCode: string;
}

/** PINT AE `UNCL4461` subset: how payment was made, per this platform's payment methods. */
export const PAYMENT_MEANS_CODES = {
  cash: "10",
  card: "54",
  bank_transfer: "30",
  cheque: "20",
  online: "68",
  credit: "30",
  other: "1",
} as const;

/** UN/ECE Recommendation 20 unit codes a tenant is most likely to need (X-prefixed are Recommendation 21 packaging codes, as PINT AE requires). */
export const UNIT_CODE_PRESETS = [
  { code: "C62", label: "Each / piece" },
  { code: "MTR", label: "Metre" },
  { code: "KGM", label: "Kilogram" },
  { code: "LTR", label: "Litre" },
  { code: "XBX", label: "Box" },
  { code: "XPK", label: "Pack" },
  { code: "XRO", label: "Roll" },
  { code: "SET", label: "Set" },
  { code: "PR", label: "Pair" },
  { code: "MTK", label: "Square metre" },
  { code: "MTQ", label: "Cubic metre" },
  { code: "GRM", label: "Gram" },
  { code: "MLT", label: "Millilitre" },
  { code: "HUR", label: "Hour" },
  { code: "DAY", label: "Day" },
] as const;
export const DEFAULT_UNIT_CODE = "C62";

// ── tenant settings ──────────────────────────────────────────────────────

export const EINVOICE_PROVIDERS = asConst(["sandbox", "gateway"]);
export type EinvoiceProvider = (typeof EINVOICE_PROVIDERS)[number];

export const EINVOICE_MODES = asConst(["sandbox", "live"]);
export type EinvoiceMode = (typeof EINVOICE_MODES)[number];

/** Shape of the `einvoice` block of `tenants.settings`. */
export interface EinvoiceSettings {
  enabled: boolean;
  /** `sandbox` never reaches the tax authority's network; `live` does, through the ASP. */
  mode: EinvoiceMode;
  /** Local date (tenant timezone) from which documents are e-invoiced, "YYYY-MM-DD". Earlier ones never are. */
  startDate: string | null;
  /** Send automatically once a document is issued. Off = hold in the queue for review. */
  autoSubmit: boolean;
  /** The seller's Peppol address. Null = derived from the TRN (scheme 0235 + TIN). */
  endpoint: { scheme: string; id: string } | null;
  /** Trade licence (or other) registration, shown to the buyer. */
  legalRegistration: { id: string; type: string; authority: string } | null;
}

export const DEFAULT_EINVOICE_SETTINGS: EinvoiceSettings = {
  enabled: false,
  mode: "sandbox",
  startDate: null,
  autoSubmit: true,
  endpoint: null,
  legalRegistration: null,
};

export function resolveEinvoiceSettings(stored: Partial<EinvoiceSettings> | undefined): EinvoiceSettings {
  return { ...DEFAULT_EINVOICE_SETTINGS, ...stored };
}

// ── document lifecycle ───────────────────────────────────────────────────

/**
 * queued      waiting to be built and sent (or held, when auto-submit is off)
 * submitting  being sent right now
 * submitted   accepted by the ASP; delivery to the buyer's side not yet confirmed
 * delivered   confirmed delivered / acknowledged
 * rejected    failed validation (ours or the ASP's); needs a data fix, then retry
 * failed      technical failure after retries; retry when the cause is fixed
 * cancelled   the sale was voided before anything was sent
 */
export const EINVOICE_STATUSES = asConst(["queued", "submitting", "submitted", "delivered", "rejected", "failed", "cancelled"]);
export type EinvoiceStatus = (typeof EINVOICE_STATUSES)[number];

export const EINVOICE_STATUS_LABELS: Record<EinvoiceStatus, string> = {
  queued: "Queued",
  submitting: "Sending",
  submitted: "Submitted",
  delivered: "Delivered",
  rejected: "Rejected",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const EINVOICE_DOC_TYPES = asConst(["invoice", "credit_note"]);
export type EinvoiceDocType = (typeof EINVOICE_DOC_TYPES)[number];

/** Once a document is at or past this point it has been sent and can only be corrected by a credit note. */
export const EINVOICE_SENT_STATUSES: readonly EinvoiceStatus[] = ["submitting", "submitted", "delivered"];

// ── admin API shapes ─────────────────────────────────────────────────────

export interface EinvoiceIssue {
  /** A PINT AE rule id (e.g. "IBR-010") or one of ours ("TRN_INVALID"). */
  code: string;
  message: string;
  /** Where to fix it, in the admin's terms: "customer.address", "seller.trn". */
  field?: string;
  severity: "error" | "warning";
}

export interface EinvoiceEventRow {
  at: string;
  status: EinvoiceStatus;
  message: string;
}

export interface EinvoiceDocumentRow {
  id: string;
  saleId: string;
  /** The invoice or credit-note number printed on the document. */
  documentNumber: string;
  docType: EinvoiceDocType;
  status: EinvoiceStatus;
  /** PINT AE unique identifier number (BTAE-07). */
  uuid: string;
  buyerName: string | null;
  total: string;
  currency: string;
  issuedAt: string;
  submittedAt: string | null;
  deliveredAt: string | null;
  attempts: number;
  lastError: string | null;
}

export interface EinvoiceDocumentDetail extends EinvoiceDocumentRow {
  issues: EinvoiceIssue[];
  events: EinvoiceEventRow[];
  providerRef: string | null;
  xmlSha256: string | null;
  pintVersion: string | null;
}

export interface EinvoiceDocumentPage {
  total: number;
  page: number;
  items: EinvoiceDocumentRow[];
  counts: Record<EinvoiceStatus, number>;
}

export interface EinvoiceProviderView {
  provider: EinvoiceProvider;
  /** `gateway` only. */
  endpointUrl: string | null;
  /** The secret itself is never sent back. */
  hasCredentials: boolean;
  /** Path (on the API) the ASP calls with status updates; includes a per-tenant token. */
  callbackPath: string;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
}

export interface EinvoiceReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface EinvoiceReadiness {
  ready: boolean;
  checks: EinvoiceReadinessCheck[];
  /** Business customers (with a TRN) that cannot be invoiced electronically yet, and why. */
  customerIssues: { id: string; name: string; problems: string[] }[];
  customerIssueTotal: number;
}

export interface EinvoiceSettingsView {
  settings: EinvoiceSettings;
  provider: EinvoiceProviderView | null;
  readiness: EinvoiceReadiness;
}
