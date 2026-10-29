import { EAS_UAE_TIN, normalizeTrn, tinFromTrn, UAE_SUBDIVISIONS, type EinvoiceReadiness, type EinvoiceReadinessCheck, type TenantSettings } from "@devsfleet/shared-types";
import { LEGAL_REGISTRATION_TYPES, TRN_PATTERN } from "./pint-ae/constants.js";

export interface ReadinessCustomer {
  id: string;
  name: string;
  company: string | null;
  trn: string | null;
  addressLine1: string | null;
  addressCity: string | null;
  addressSubdivision: string | null;
  addressCountry: string | null;
}

/** What is wrong with a customer's record for e-invoicing, in plain words. Empty = ready. */
export function customerProblems(c: ReadinessCustomer): string[] {
  const problems: string[] = [];
  const trn = c.trn ? normalizeTrn(c.trn) : "";
  if (!trn) problems.push("No TRN");
  else if (!TRN_PATTERN.test(trn)) problems.push("TRN is not 15 digits starting 1 and ending 03");
  const missing = [!c.addressLine1?.trim() && "street", !c.addressCity?.trim() && "city", !c.addressSubdivision?.trim() && "emirate"].filter(Boolean);
  if (missing.length > 0) problems.push(`Address is missing: ${missing.join(", ")}`);
  else if ((c.addressCountry ?? "AE").toUpperCase() === "AE" && !(UAE_SUBDIVISIONS as readonly string[]).includes(c.addressSubdivision!.trim())) {
    problems.push(`Emirate "${c.addressSubdivision}" must be one of ${UAE_SUBDIVISIONS.join(", ")}`);
  }
  return problems;
}

export interface ReadinessInput {
  settings: TenantSettings;
  provider: { kind: "sandbox" | "gateway"; hasCredentials: boolean; hasEndpoint: boolean } | null;
  encryptionAvailable: boolean;
  /** Customers that quote a TRN (the B2B ones), capped by the caller. */
  customers: ReadinessCustomer[];
}

const CUSTOMER_LIST_LIMIT = 50;

/** Is this business set up to send e-invoices? One check per thing an invoice would be rejected for. */
export function assessReadiness(input: ReadinessInput): EinvoiceReadiness {
  const { settings, provider } = input;
  const e = settings.einvoice;
  const trn = settings.trn ? normalizeTrn(settings.trn) : "";
  const a = settings.legalAddress;
  const reg = e.legalRegistration;
  const checks: EinvoiceReadinessCheck[] = [];
  const check = (key: string, label: string, ok: boolean, detail?: string) => checks.push({ key, label, ok, ...(detail ? { detail } : {}) });

  check("seller_trn", "Business TRN", TRN_PATTERN.test(trn), trn ? (TRN_PATTERN.test(trn) ? undefined : "A TRN is 15 digits, starting 1 and ending 03.") : "Add the business Tax Registration Number in Settings.");

  const addressMissing = !a ? ["street", "city", "emirate"] : [!a.line1?.trim() && "street", !a.city?.trim() && "city", !a.subdivision?.trim() && "emirate"].filter(Boolean);
  const addressBadEmirate = a && (a.countryCode ?? "AE").toUpperCase() === "AE" && a.subdivision?.trim() && !(UAE_SUBDIVISIONS as readonly string[]).includes(a.subdivision.trim());
  check("legal_address", "Business address", addressMissing.length === 0 && !addressBadEmirate, addressMissing.length > 0 ? `Missing: ${addressMissing.join(", ")}.` : addressBadEmirate ? `The emirate must be one of ${UAE_SUBDIVISIONS.join(", ")}.` : undefined);

  const tin = trn ? tinFromTrn(trn) : null;
  check("endpoint", "Peppol electronic address", !!(e.endpoint || tin), e.endpoint || tin ? undefined : `Derived from a valid TRN (scheme ${EAS_UAE_TIN}), or set it explicitly.`);

  const regOk = !!reg && reg.id.trim() !== "" && (LEGAL_REGISTRATION_TYPES as readonly string[]).includes(reg.type) && (reg.type !== "TL" || reg.authority.trim() !== "");
  check("legal_registration", "Trade licence", regOk, regOk ? undefined : "Add the trade licence number and the authority that issued it.");

  const providerOk =
    !!provider && (provider.kind === "sandbox" ? e.mode === "sandbox" : provider.hasCredentials && provider.hasEndpoint && input.encryptionAvailable);
  check(
    "provider",
    "E-invoicing provider",
    providerOk,
    providerOk
      ? undefined
      : provider?.kind === "gateway" && !input.encryptionAvailable
        ? "This server has no APP_ENCRYPTION_KEY, so credentials cannot be stored."
        : e.mode === "live"
          ? "Live mode needs a connected provider (endpoint and credentials)."
          : "No provider is connected; sandbox sending will be used.",
  );

  const issues = input.customers.map((c) => ({ id: c.id, name: c.company?.trim() || c.name, problems: customerProblems(c) })).filter((c) => c.problems.length > 0);
  const readyCustomers = input.customers.length - issues.length;
  check("b2b_customer", "A business customer ready to invoice", readyCustomers > 0, readyCustomers > 0 ? undefined : "No customer has both a valid TRN and a complete address yet.");

  return {
    // Sandbox rehearsal needs no real provider; everything else is required for a document to be accepted.
    ready: checks.every((c) => c.ok || c.key === "provider" && e.mode === "sandbox"),
    checks,
    customerIssues: issues.slice(0, CUSTOMER_LIST_LIMIT),
    customerIssueTotal: issues.length,
  };
}
