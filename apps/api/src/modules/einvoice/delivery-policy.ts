import type { EinvoiceStatus } from "@devsfleet/shared-types";
import type { AspCallback } from "./providers/asp-provider.js";

/** A document left `submitting` this long belongs to a worker that died. */
export const STUCK_SUBMITTING_MS = 10 * 60_000;

/** How long a claimed `queued` document is reserved for the worker that took it, before another may. */
export const LEASE_MS = 10 * 60_000;

/** Attempts (including the first) before a transient failure becomes `failed`. */
export const MAX_ATTEMPTS = 6;

/** Wait before attempt 2, 3, 4…: 1 min, 5 min, 15 min, 1 h, 6 h. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000] as const;

export function backoffMs(attemptsSoFar: number): number {
  return BACKOFF_MS[Math.min(Math.max(attemptsSoFar, 1), BACKOFF_MS.length) - 1]!;
}

export type RetryOutcome = { status: "queued"; nextAttemptAt: Date } | { status: "failed" };

/** What a transient failure does to a document. `attempts` already counts the attempt that just failed. */
export function afterTransientFailure(attempts: number, now = new Date()): RetryOutcome {
  if (attempts >= MAX_ATTEMPTS) return { status: "failed" };
  return { status: "queued", nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) };
}

/**
 * How a status report from the provider changes a document, or null when it
 * changes nothing. Providers report late, twice and out of order, so this is
 * tolerant: a report never moves a document backwards, and a repeat is a no-op.
 *
 * - accepted: only advances a document that is being sent.
 * - delivered: advances anything the provider evidently holds — including a
 *   document we had given up on after a timeout — except one we cancelled.
 * - rejected: only turns around a document still in flight; a rejection after
 *   delivery contradicts it and is ignored.
 */
export function transitionForCallback(current: EinvoiceStatus, reported: AspCallback["status"]): EinvoiceStatus | null {
  switch (reported) {
    case "accepted":
      return current === "submitting" ? "submitted" : null;
    case "delivered":
      return current === "delivered" || current === "cancelled" ? null : "delivered";
    case "rejected":
      return current === "submitting" || current === "submitted" ? "rejected" : null;
  }
}

/** Manual actions, and the statuses they apply to. */
export const RETRYABLE: readonly EinvoiceStatus[] = ["rejected", "failed"];
