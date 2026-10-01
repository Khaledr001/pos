import { describe, expect, it, vi } from "vitest";

/**
 * The secret is read when the module loads, so each case imports a fresh copy
 * with its own environment.
 */
async function guardWith(secret: string | undefined) {
  vi.resetModules();
  if (secret) process.env.STOREFRONT_PROXY_SECRET = secret;
  else delete process.env.STOREFRONT_PROXY_SECRET;
  const { StorefrontAwareThrottlerGuard } = await import("./storefront-aware-throttler.guard.js");
  const guard = Object.create(StorefrontAwareThrottlerGuard.prototype) as { getTracker(req: unknown): Promise<string> };
  return (req: Record<string, unknown>) => guard.getTracker(req);
}

const SECRET = "a-storefront-proxy-secret-that-is-long-enough";

describe("StorefrontAwareThrottlerGuard", () => {
  it("counts the shopper when the storefront proves who it is", async () => {
    const track = await guardWith(SECRET);
    expect(await track({ ip: "10.0.0.5", headers: { "x-storefront-proxy": SECRET, "x-storefront-client-ip": "203.0.113.7" } })).toBe(
      "shopper:203.0.113.7",
    );
  });

  it("ignores a claimed client IP without the secret — no choosing your own bucket", async () => {
    const track = await guardWith(SECRET);
    expect(await track({ ip: "198.51.100.9", headers: { "x-storefront-proxy": "guess", "x-storefront-client-ip": "203.0.113.7" } })).toBe(
      "198.51.100.9",
    );
    expect(await track({ ip: "198.51.100.9", headers: { "x-storefront-client-ip": "203.0.113.7" } })).toBe("198.51.100.9");
  });

  it("falls back to the connection IP when no secret is configured", async () => {
    const track = await guardWith(undefined);
    expect(await track({ ip: "198.51.100.9", headers: { "x-storefront-proxy": "", "x-storefront-client-ip": "203.0.113.7" } })).toBe(
      "198.51.100.9",
    );
  });
});
