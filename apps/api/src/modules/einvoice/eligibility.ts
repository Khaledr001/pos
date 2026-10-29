import { type EinvoiceSettings } from "@devsfleet/shared-types";

export type Eligibility = { eligible: true } | { eligible: false; reason: string };

export interface EligibilityInput {
  settings: EinvoiceSettings;
  /** The document's issue date in the business timezone, YYYY-MM-DD. */
  issueDate: string;
  voided: boolean;
  isCredit: boolean;
  /** Credit notes: does the invoice being corrected have an e-invoice document? */
  originalHasDocument: boolean;
  /** The customer's TRN as stored, if any. */
  buyerTrn: string | null;
  hasCustomer: boolean;
}

/**
 * Does this sale or return go to the e-invoicing pipeline?
 *
 * - Only when the business has switched e-invoicing on, and only from its start date.
 * - Never a voided sale.
 * - An invoice only to a business that quotes a TRN: B2C is outside the mandate
 *   for now, and a retail till sale must never be held up by it. A TRN that is
 *   present but malformed still qualifies — it fails validation visibly in the
 *   register, which is better than a business customer silently never reported.
 * - A credit note exactly when the invoice it corrects was e-invoiced, whoever the
 *   customer is today: the correction must follow the original.
 */
export function decideEligibility(input: EligibilityInput): Eligibility {
  const { settings } = input;
  if (!settings.enabled) return { eligible: false, reason: "E-invoicing is switched off" };
  if (input.voided) return { eligible: false, reason: "The sale was voided" };
  if (settings.startDate && input.issueDate < settings.startDate) return { eligible: false, reason: `Issued before the e-invoicing start date ${settings.startDate}` };
  if (input.isCredit) {
    return input.originalHasDocument ? { eligible: true } : { eligible: false, reason: "The invoice it corrects was never e-invoiced" };
  }
  if (!input.hasCustomer) return { eligible: false, reason: "Retail sale with no customer (outside the B2B mandate)" };
  if (!input.buyerTrn || input.buyerTrn.trim() === "") return { eligible: false, reason: "The customer has no TRN (outside the B2B mandate)" };
  return { eligible: true };
}
