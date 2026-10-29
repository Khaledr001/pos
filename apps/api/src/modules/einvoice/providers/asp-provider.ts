import type { EinvoiceDocType } from "@devsfleet/shared-types";

/** What an accredited service provider (ASP) is handed for one document. */
export interface AspSubmission {
  /** BTAE-07. The provider's idempotency key: submitting the same uuid twice must not report twice. */
  uuid: string;
  docType: EinvoiceDocType;
  documentNumber: string;
  issuedAt: string;
  xml: string;
  xmlSha256: string;
  /** A sandbox submission never reaches the live network. */
  sandbox: boolean;
}

export interface AspError {
  code: string;
  message: string;
}

export type AspResult =
  /** Accepted. `delivered` when the provider already confirmed delivery to the buyer's side. */
  | { ok: true; providerRef: string; status: "submitted" | "delivered" }
  /** The provider (or the network) refused the document as invalid. Staff fix the data and retry. */
  | { ok: false; kind: "rejected"; errors: AspError[]; providerRef?: string }
  /** A temporary failure: a timeout, a 5xx, rate limiting. Retried with backoff. */
  | { ok: false; kind: "retry"; message: string }
  /** A failure retrying cannot fix: bad credentials, a blocked or missing endpoint. */
  | { ok: false; kind: "permanent"; message: string };

export interface AspProvider {
  readonly name: "sandbox" | "gateway";
  submit(submission: AspSubmission): Promise<AspResult>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

/** A status the provider reports after the fact, to the callback endpoint. */
export interface AspCallback {
  /** The providerRef the document was accepted under. */
  id: string;
  status: "accepted" | "delivered" | "rejected";
  errors: AspError[];
}
