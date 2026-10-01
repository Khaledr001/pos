import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeEvent } from "./stripe.client.js";

/**
 * A webhook is the only way money is recorded as received. A forged one that
 * verified would mark an order paid that nobody paid for.
 */
describe("verifyStripeEvent", () => {
  const secret = "whsec_test_secret";
  const body = Buffer.from(JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1" } } }));
  const now = 1_790_000_000_000;
  const sign = (payload: Buffer, at = now / 1000, key = secret) =>
    `t=${at},v1=${createHmac("sha256", key).update(`${at}.`).update(payload).digest("hex")}`;

  it("accepts a correctly signed event", () => {
    expect(verifyStripeEvent(body, sign(body), secret, now)?.id).toBe("evt_1");
  });

  it("refuses a body altered after signing", () => {
    const tampered = Buffer.from(body.toString().replace("cs_1", "cs_2"));
    expect(verifyStripeEvent(tampered, sign(body), secret, now)).toBeNull();
  });

  it("refuses a signature made with another account's secret", () => {
    expect(verifyStripeEvent(body, sign(body, now / 1000, "whsec_someone_else"), secret, now)).toBeNull();
  });

  it("refuses a replay older than five minutes", () => {
    expect(verifyStripeEvent(body, sign(body, now / 1000 - 301), secret, now)).toBeNull();
  });

  it("refuses a missing header or body", () => {
    expect(verifyStripeEvent(body, undefined, secret, now)).toBeNull();
    expect(verifyStripeEvent(undefined, sign(body), secret, now)).toBeNull();
  });
});
