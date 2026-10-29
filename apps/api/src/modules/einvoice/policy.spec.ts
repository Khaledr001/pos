import { DEFAULT_EINVOICE_SETTINGS, EINVOICE_STATUSES, type EinvoiceSettings } from "@devsfleet/shared-types";
import { describe, expect, it } from "vitest";
import { afterTransientFailure, backoffMs, BACKOFF_MS, MAX_ATTEMPTS, transitionForCallback } from "./delivery-policy.js";
import { decideEligibility, type EligibilityInput } from "./eligibility.js";
import { HELD_UNTIL, isHeld } from "./events.js";
import { summary } from "./einvoice-sweep.service.js";

const on: EinvoiceSettings = { ...DEFAULT_EINVOICE_SETTINGS, enabled: true };

const input = (over: Partial<EligibilityInput> = {}): EligibilityInput => ({
  settings: on,
  issueDate: "2027-01-15",
  voided: false,
  isCredit: false,
  originalHasDocument: false,
  buyerTrn: "100987654300003",
  hasCustomer: true,
  ...over,
});

describe("eligibility", () => {
  it("queues a B2B invoice", () => {
    expect(decideEligibility(input())).toEqual({ eligible: true });
  });

  it("does nothing while e-invoicing is off", () => {
    expect(decideEligibility(input({ settings: { ...on, enabled: false } }))).toMatchObject({ eligible: false });
  });

  it("never touches a retail sale: no customer, or a customer with no TRN (B2C is outside the mandate)", () => {
    expect(decideEligibility(input({ hasCustomer: false, buyerTrn: null }))).toMatchObject({ eligible: false });
    expect(decideEligibility(input({ buyerTrn: null }))).toMatchObject({ eligible: false });
    expect(decideEligibility(input({ buyerTrn: "   " }))).toMatchObject({ eligible: false });
  });

  it("queues a business customer whose TRN is present but malformed, so the problem is visible, not silent", () => {
    expect(decideEligibility(input({ buyerTrn: "12345" }))).toEqual({ eligible: true });
  });

  it("respects the start date, on the business's own calendar day", () => {
    const s = { ...on, startDate: "2027-01-01" };
    expect(decideEligibility(input({ settings: s, issueDate: "2026-12-31" }))).toMatchObject({ eligible: false });
    expect(decideEligibility(input({ settings: s, issueDate: "2027-01-01" }))).toEqual({ eligible: true });
  });

  it("never queues a voided sale", () => {
    expect(decideEligibility(input({ voided: true }))).toMatchObject({ eligible: false });
  });

  it("queues a credit note exactly when the invoice it corrects was e-invoiced — whoever the customer is now", () => {
    expect(decideEligibility(input({ isCredit: true, originalHasDocument: true, hasCustomer: false, buyerTrn: null }))).toEqual({ eligible: true });
    expect(decideEligibility(input({ isCredit: true, originalHasDocument: false }))).toMatchObject({ eligible: false });
  });
});

describe("delivery policy", () => {
  it("backs off 1 min, 5 min, 15 min, 1 h, 6 h", () => {
    expect(BACKOFF_MS).toEqual([60_000, 300_000, 900_000, 3_600_000, 21_600_000]);
    expect([1, 2, 3, 4, 5].map(backoffMs)).toEqual([...BACKOFF_MS]);
    expect(backoffMs(99)).toBe(21_600_000);
  });

  it("retries a transient failure until the sixth attempt, then gives up", () => {
    const now = new Date("2027-01-15T10:00:00Z");
    expect(afterTransientFailure(1, now)).toEqual({ status: "queued", nextAttemptAt: new Date("2027-01-15T10:01:00Z") });
    expect(afterTransientFailure(5, now)).toMatchObject({ status: "queued" });
    expect(afterTransientFailure(MAX_ATTEMPTS, now)).toEqual({ status: "failed" });
    expect(MAX_ATTEMPTS).toBe(6);
  });
});

describe("provider callbacks never move a document backwards", () => {
  it.each([
    ["submitting", "accepted", "submitted"],
    ["submitted", "accepted", null],
    ["delivered", "accepted", null],
    ["queued", "accepted", null],
    ["submitted", "delivered", "delivered"],
    ["submitting", "delivered", "delivered"],
    ["failed", "delivered", "delivered"], // we timed out; the provider evidently has it
    ["queued", "delivered", "delivered"],
    ["delivered", "delivered", null], // a repeat
    ["cancelled", "delivered", null],
    ["submitted", "rejected", "rejected"],
    ["submitting", "rejected", "rejected"],
    ["delivered", "rejected", null], // contradicts delivery
    ["queued", "rejected", null],
    ["cancelled", "rejected", null],
  ] as const)("%s + %s → %s", (current, reported, expected) => {
    expect(transitionForCallback(current, reported)).toBe(expected);
  });

  it("covers every status", () => {
    for (const s of EINVOICE_STATUSES) {
      for (const r of ["accepted", "delivered", "rejected"] as const) expect(() => transitionForCallback(s, r)).not.toThrow();
    }
  });
});

describe("held documents and summaries", () => {
  it("recognises the hold sentinel and nothing sooner", () => {
    expect(isHeld(HELD_UNTIL)).toBe(true);
    expect(isHeld(new Date("2099-01-01T00:00:00Z"))).toBe(false);
    expect(isHeld(new Date())).toBe(false);
  });

  it("summarises the first problems and counts the rest", () => {
    expect(summary([{ message: "A." }, { message: "B." }])).toBe("A. B.");
    expect(summary([{ message: "A." }, { message: "B." }, { message: "C." }, { message: "D." }, { message: "E." }])).toBe("A. B. C. (and 2 more)");
    expect(summary([{ message: "x".repeat(900) }]).length).toBeLessThanOrEqual(480);
  });
});
