import { CREDIT_NOTE_REASONS, DEFAULT_CREDIT_NOTE_REASON, type CreditNoteReason } from "@devsfleet/shared-types";

/**
 * The credit-note reason a return request resolves to.
 *
 * `reason` carries a PINT AE code from current clients and a plain sentence
 * from ones written before credit notes existed (the admin and the till both
 * sent "customer changed their mind" there). A sentence becomes the note and
 * the code defaults to "goods returned" — the overwhelming meaning of a
 * return at a counter — so an old client keeps working and the e-invoice
 * still has the reason it must carry.
 */
export function resolveCreditNote(input: { reason?: string | undefined; reasonNote?: string | undefined }): {
  code: CreditNoteReason;
  note: string | null;
} {
  const reason = input.reason?.trim();
  const explicitNote = input.reasonNote?.trim() || null;

  if (reason && (CREDIT_NOTE_REASONS as readonly string[]).includes(reason)) {
    return { code: reason as CreditNoteReason, note: explicitNote };
  }
  return { code: DEFAULT_CREDIT_NOTE_REASON, note: explicitNote ?? (reason || null) };
}
