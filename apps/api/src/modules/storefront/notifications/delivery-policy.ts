/** After this many failed attempts a row stops retrying and stays `failed`. */
export const MAX_ATTEMPTS = 5;

/** A row left `sending` this long belongs to a worker that died. */
export const STUCK_SENDING_MS = 5 * 60_000;

const BASE_DELAY_MS = 60_000;
const MAX_DELAY_MS = 6 * 60 * 60_000;

/** 1 min, 2, 4, 8… capped at 6 h. `attempt` is how many have been made so far (>= 1). */
export function backoffMs(attempt: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
}

/** A failure of one send, as the transports report it. */
export interface SendFailure {
  /** Retrying cannot help: a bad address, a rejected or missing template. */
  permanent: boolean;
  message: string;
}

export type FailureOutcome =
  | { status: "queued"; nextAttemptAt: Date }
  | { status: "failed"; nextAttemptAt: null };

/** What happens to a row after a failed attempt. `attempts` already includes this one. */
export function afterFailure(failure: SendFailure, attempts: number, now = new Date()): FailureOutcome {
  if (failure.permanent || attempts >= MAX_ATTEMPTS) return { status: "failed", nextAttemptAt: null };
  return { status: "queued", nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) };
}

/**
 * SMTP replies: 4xx is temporary, 5xx is final (a bad mailbox, a policy
 * refusal). Anything without a code — a timeout, a reset — is retried.
 */
export function classifySmtpError(error: unknown): SendFailure {
  const e = error as { responseCode?: number; code?: string; message?: string } | null;
  const message = (e?.message ?? "Mail send failed").slice(0, 300);
  const code = e?.responseCode;
  if (typeof code === "number" && code >= 500) return { permanent: true, message };
  if (e?.code === "EENVELOPE") return { permanent: true, message };
  return { permanent: false, message };
}

export { isPermanentGraphFailure } from "../../whatsapp/meta-graph.js";

/** The claim predicate in plain code — the SQL in NotificationSweepService says the same thing. */
export function isClaimable(
  row: { status: string; nextAttemptAt: Date; updatedAt: Date },
  now = new Date(),
): boolean {
  if (row.status === "queued") return row.nextAttemptAt.getTime() <= now.getTime();
  if (row.status === "sending") return now.getTime() - row.updatedAt.getTime() > STUCK_SENDING_MS;
  return false;
}
