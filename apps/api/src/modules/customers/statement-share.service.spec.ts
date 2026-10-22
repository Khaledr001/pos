import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { describe, expect, it } from "vitest";
import { createStatementLinkToken, statementLinkKey } from "./statement-link.js";
import { StatementShareService } from "./statement-share.service.js";

/**
 * The public endpoint's refusals happen before any database work, so they
 * can be checked without one: an expired link is a 410 the customer can act
 * on ("ask for a new one"), anything forged is the same 404 as a missing
 * customer, and neither touches the database.
 */

const secret = "s".repeat(48);
const untouchable = new Proxy({}, { get: () => { throw new Error("the database was touched"); } });
const service = new StatementShareService(
  untouchable as never,
  untouchable as never,
  { get: () => secret } as never,
);

const claims = {
  tenantId: "8eaea0e0-b095-4189-9754-5fa63a11d2dc",
  customerId: "9e3704d0-d9b3-4d97-81cf-10e4b79d9091",
  from: null,
  to: null,
  branchIds: null,
};

const codeOf = async (token: string) => {
  try {
    await service.open(token);
    return null;
  } catch (error) {
    return error instanceof AppError ? error.code : String(error);
  }
};

describe("StatementShareService.open", () => {
  it("answers an expired link with LINK_EXPIRED (410)", async () => {
    const token = createStatementLinkToken(statementLinkKey(secret), {
      ...claims,
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(await codeOf(token)).toBe(ERROR_CODES.LINK_EXPIRED);
  });

  it("answers a link signed with any other secret with NOT_FOUND", async () => {
    const token = createStatementLinkToken(statementLinkKey("t".repeat(48)), {
      ...claims,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(await codeOf(token)).toBe(ERROR_CODES.NOT_FOUND);
  });

  it("answers junk with NOT_FOUND", async () => {
    expect(await codeOf("hello")).toBe(ERROR_CODES.NOT_FOUND);
  });
});
