/**
 * Human-facing document numbers: INV-2026-000123, QT-2026-000045, TRF-2026-000007.
 *
 * These are NOT identifiers. Every row has a UUID primary key; the number is a
 * label a customer can read over the phone. Keeping the two separate means the
 * POS can create a sale offline (UUID available immediately) and have the server
 * assign the invoice number on sync, without the terminal ever inventing a
 * number that another terminal might also invent.
 *
 * Allocation happens server-side via `document_sequences`, incremented inside
 * the same transaction as the document. See packages/db/src/schema/sequences.ts.
 */

export const DOCUMENT_PREFIXES = {
  quotation: "QT",
  order: "ORD",
  sale: "INV",
  credit_note: "CRN",
  purchase_order: "PO",
  goods_receipt: "GRN",
  stock_transfer: "TRF",
  stock_adjustment: "ADJ",
  stock_count: "SC",
  payment: "PAY",
  cash_session: "CS",
} as const;

export type DocumentKind = keyof typeof DOCUMENT_PREFIXES;

const SEQUENCE_PAD = 6;

export interface DocumentNumberParts {
  kind: DocumentKind;
  year: number;
  sequence: number;
  /** Branch code, e.g. "DXB". Present when the tenant numbers per branch. */
  branchCode?: string;
}

/**
 * INV-2026-000123, or INV-DXB-2026-000123 when a branch code is supplied.
 *
 * Sequences reset per year and per (tenant, branch, kind) — that is what
 * accountants expect, and it keeps the number short enough to read aloud.
 */
export function formatDocumentNumber(parts: DocumentNumberParts): string {
  const prefix = DOCUMENT_PREFIXES[parts.kind];
  const seq = String(parts.sequence).padStart(SEQUENCE_PAD, "0");
  const segments = parts.branchCode
    ? [prefix, parts.branchCode, parts.year, seq]
    : [prefix, parts.year, seq];
  return segments.join("-");
}

/** Inverse of formatDocumentNumber. Returns null on anything unrecognised. */
export function parseDocumentNumber(value: string): DocumentNumberParts | null {
  const match = /^([A-Z]{2,3})-(?:([A-Z0-9]{2,10})-)?(\d{4})-(\d+)$/.exec(value.trim());
  if (!match) return null;

  const [, prefix, branchCode, year, sequence] = match;
  const kind = (Object.keys(DOCUMENT_PREFIXES) as DocumentKind[]).find(
    (k) => DOCUMENT_PREFIXES[k] === prefix,
  );
  if (!kind || !year || !sequence) return null;

  return {
    kind,
    year: Number(year),
    sequence: Number(sequence),
    ...(branchCode ? { branchCode } : {}),
  };
}

/** Key for the `document_sequences` table. Scope of a single counter. */
export function sequenceKey(
  kind: DocumentKind,
  year: number,
  branchCode?: string | null,
): string {
  return branchCode ? `${kind}:${branchCode}:${year}` : `${kind}:${year}`;
}
