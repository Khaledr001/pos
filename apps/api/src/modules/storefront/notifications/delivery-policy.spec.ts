import { describe, expect, it } from "vitest";
import { isPermanentGraphFailure } from "../../whatsapp/meta-graph.js";
import { afterFailure, backoffMs, classifySmtpError, isClaimable, MAX_ATTEMPTS, STUCK_SENDING_MS } from "./delivery-policy.js";

describe("backoffMs", () => {
  it("doubles from a minute and is capped", () => {
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([60_000, 120_000, 240_000, 480_000, 960_000]);
    expect(backoffMs(30)).toBe(6 * 60 * 60_000);
    expect(backoffMs(0)).toBe(60_000);
  });
});

describe("afterFailure", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("requeues a retryable failure after the backoff", () => {
    const out = afterFailure({ permanent: false, message: "timeout" }, 1, now);
    expect(out).toEqual({ status: "queued", nextAttemptAt: new Date(now.getTime() + 60_000) });
  });

  it("fails a permanent error at once, whatever the attempt count", () => {
    expect(afterFailure({ permanent: true, message: "bad address" }, 1, now)).toEqual({ status: "failed", nextAttemptAt: null });
  });

  it("gives up after MAX_ATTEMPTS", () => {
    expect(afterFailure({ permanent: false, message: "x" }, MAX_ATTEMPTS - 1, now).status).toBe("queued");
    expect(afterFailure({ permanent: false, message: "x" }, MAX_ATTEMPTS, now).status).toBe("failed");
  });
});

describe("classifySmtpError", () => {
  it("treats 5xx replies and bad envelopes as permanent, 4xx and network errors as retryable", () => {
    expect(classifySmtpError({ responseCode: 550, message: "mailbox unavailable" }).permanent).toBe(true);
    expect(classifySmtpError({ code: "EENVELOPE", message: "no recipients" }).permanent).toBe(true);
    expect(classifySmtpError({ responseCode: 451, message: "try later" }).permanent).toBe(false);
    expect(classifySmtpError({ code: "ETIMEDOUT", message: "timeout" }).permanent).toBe(false);
    expect(classifySmtpError(null).permanent).toBe(false);
  });

  it("bounds the stored message", () => {
    expect(classifySmtpError({ message: "x".repeat(2000) }).message.length).toBeLessThanOrEqual(300);
  });
});

describe("isPermanentGraphFailure", () => {
  it("retries rate limits, outages and the network", () => {
    for (const kind of ["rate_limited", "meta_unavailable", "network"]) expect(isPermanentGraphFailure(kind)).toBe(false);
  });

  it("does not retry template problems or credentials", () => {
    expect(isPermanentGraphFailure("unknown", "Meta refused the request: (#132001) Template name does not exist")).toBe(true);
    expect(isPermanentGraphFailure("unknown", "(#131026) Message undeliverable")).toBe(true);
    for (const kind of ["token_invalid", "token_expired", "missing_permission", "not_found", "wrong_app_secret"]) {
      expect(isPermanentGraphFailure(kind)).toBe(true);
    }
  });

  it("retries an unrecognised error (bounded by MAX_ATTEMPTS)", () => {
    expect(isPermanentGraphFailure("unknown", "Something odd happened")).toBe(false);
  });
});

describe("isClaimable", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  const at = (ms: number) => new Date(now.getTime() + ms);

  it("claims queued rows that are due, not future ones", () => {
    expect(isClaimable({ status: "queued", nextAttemptAt: at(-1), updatedAt: at(-1) }, now)).toBe(true);
    expect(isClaimable({ status: "queued", nextAttemptAt: at(60_000), updatedAt: at(-1) }, now)).toBe(false);
  });

  it("reclaims a sending row only once it is stuck", () => {
    expect(isClaimable({ status: "sending", nextAttemptAt: at(-1), updatedAt: at(-1_000) }, now)).toBe(false);
    expect(isClaimable({ status: "sending", nextAttemptAt: at(-1), updatedAt: at(-STUCK_SENDING_MS - 1) }, now)).toBe(true);
  });

  it("never touches finished rows", () => {
    for (const status of ["sent", "failed", "skipped"]) expect(isClaimable({ status, nextAttemptAt: at(-1), updatedAt: at(-STUCK_SENDING_MS * 2) }, now)).toBe(false);
  });
});
