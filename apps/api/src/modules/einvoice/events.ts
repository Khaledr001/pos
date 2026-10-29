import { schema, type Transaction } from "@devsfleet/db";
import type { EinvoiceStatus } from "@devsfleet/shared-types";

/** One row of a document's history. The table is append-only (trigger): history is never rewritten. */
export async function recordEvent(
  tx: Transaction,
  input: { tenantId: string; documentId: string; status: EinvoiceStatus; message: string; detail?: Record<string, unknown> },
): Promise<void> {
  await tx.insert(schema.einvoiceEvents).values({
    tenantId: input.tenantId,
    documentId: input.documentId,
    status: input.status,
    message: input.message.slice(0, 1000),
    ...(input.detail ? { detail: input.detail } : {}),
  });
}

/** A held document waits until this moment; far enough away that the sweep's `next_attempt_at <= now()` never reaches it. */
export const HELD_UNTIL = new Date("9999-12-31T00:00:00Z");

export const isHeld = (nextAttemptAt: Date): boolean => nextAttemptAt.getTime() >= HELD_UNTIL.getTime();

/** The issue the admin shows beside a held document. */
export const HELD_ISSUE = {
  code: "HELD_FOR_REVIEW",
  message: "Held for review: automatic sending is off. Press Send to release it.",
  severity: "warning" as const,
};
