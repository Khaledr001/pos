import { describe, expect, it } from "vitest";
import {
  createStatementLinkToken,
  readStatementLinkToken,
  statementLinkKey,
  type StatementLinkClaims,
} from "./statement-link.js";

const key = statementLinkKey("x".repeat(48));

const claims: StatementLinkClaims = {
  tenantId: "8eaea0e0-b095-4189-9754-5fa63a11d2dc",
  customerId: "11111111-2222-4333-8444-555555555555",
  from: "2026-10-01",
  to: "2026-10-31",
  expiresAt: new Date("2026-11-15T00:00:00Z"),
  branchIds: null,
};

const before = new Date("2026-11-01T00:00:00Z");

describe("statement link tokens", () => {
  it("round-trips every claim", () => {
    const token = createStatementLinkToken(key, claims);
    expect(readStatementLinkToken(key, token, before)).toEqual({ ok: true, claims });
  });

  it("carries the sharer's branch scope", () => {
    const scoped = { ...claims, branchIds: ["1d593922-b510-43cf-8e57-09e5fe2275fb"] };
    const result = readStatementLinkToken(key, createStatementLinkToken(key, scoped), before);
    expect(result).toEqual({ ok: true, claims: scoped });
  });

  it("keeps an open-ended period open", () => {
    const allTime = { ...claims, from: null, to: null };
    const result = readStatementLinkToken(key, createStatementLinkToken(key, allTime), before);
    expect(result.ok && result.claims.from).toBeNull();
    expect(result.ok && result.claims.to).toBeNull();
  });

  it("is short enough to sit on one line of a chat", () => {
    expect(createStatementLinkToken(key, claims).length).toBeLessThan(90);
  });

  it("reports a genuine but expired link as expired", () => {
    const token = createStatementLinkToken(key, claims);
    expect(readStatementLinkToken(key, token, new Date("2026-12-01T00:00:00Z"))).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses a token with any character changed", () => {
    const token = createStatementLinkToken(key, claims);
    for (const i of [0, 5, 20, token.length - 1]) {
      const swapped = token[i] === "A" ? "B" : "A";
      const tampered = token.slice(0, i) + swapped + token.slice(i + 1);
      expect(readStatementLinkToken(key, tampered, before)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("refuses a payload re-pointed at another tenant without re-signing", () => {
    const raw = Buffer.from(createStatementLinkToken(key, claims), "base64url");
    raw[1] = raw[1]! ^ 0xff;
    expect(readStatementLinkToken(key, raw.toString("base64url"), before)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses a token signed with any other key", () => {
    const foreign = createStatementLinkToken(statementLinkKey("y".repeat(48)), claims);
    expect(readStatementLinkToken(key, foreign, before)).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses an expired token even if it is also forged — forged is all it learns", () => {
    const foreign = createStatementLinkToken(statementLinkKey("y".repeat(48)), claims);
    expect(readStatementLinkToken(key, foreign, new Date("2027-01-01T00:00:00Z"))).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("refuses junk", () => {
    for (const junk of ["", "abc", "not a token!", "A".repeat(200)]) {
      expect(readStatementLinkToken(key, junk, before)).toEqual({ ok: false, reason: "invalid" });
    }
  });
});
