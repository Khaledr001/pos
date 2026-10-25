import { describe, expect, it, vi } from "vitest";
import { createCorsDelegate } from "./headless-cors.js";

const STATIC = ["https://pos.example.com"];

const setup = (answers: { host?: boolean; anywhere?: boolean; throws?: boolean } = {}) => {
  const resolver = {
    headlessAllows: vi.fn(async (_host: string | undefined | null, _origin: string) => {
      if (answers.throws) throw new Error("db down");
      return answers.host ?? false;
    }),
    originAllowedAnywhere: vi.fn(async (_origin: string) => {
      if (answers.throws) throw new Error("db down");
      return answers.anywhere ?? false;
    }),
  };
  const delegate = createCorsDelegate({ staticOrigins: STATIC, prefix: "api/v1", resolver });
  const run = (request: { method?: string; url: string; headers: Record<string, string> }) =>
    new Promise<Record<string, unknown>>((resolve) => delegate(request, (_e, options) => resolve(options as Record<string, unknown>)));
  return { resolver, run };
};

const STORE = "/api/v1/storefront/catalog/categories";

describe("createCorsDelegate", () => {
  it("leaves the static list, with credentials, for everyone not on the storefront", async () => {
    const { run, resolver } = setup({ host: true, anywhere: true });
    const options = await run({ method: "GET", url: "/api/v1/products", headers: { origin: "https://shop.example.com" } });
    expect(options).toMatchObject({ origin: STATIC, credentials: true });
    expect(resolver.headlessAllows).not.toHaveBeenCalled();
  });

  it("does not consult the resolver for the hosted shop's own origin or for non-browser calls", async () => {
    const { run, resolver } = setup({ host: true });
    expect(await run({ method: "GET", url: STORE, headers: { origin: STATIC[0]! } })).toMatchObject({ credentials: true });
    expect(await run({ method: "GET", url: STORE, headers: {} })).toMatchObject({ credentials: true });
    expect(resolver.headlessAllows).not.toHaveBeenCalled();
  });

  it("allows an opted-in origin on a storefront route, without credentials", async () => {
    const { run, resolver } = setup({ host: true });
    const options = await run({
      method: "GET",
      url: STORE,
      headers: { origin: "https://shop.example.com", "x-storefront-host": "shop.example.ae" },
    });
    expect(resolver.headlessAllows).toHaveBeenCalledWith("shop.example.ae", "https://shop.example.com");
    expect(options).toMatchObject({ origin: ["https://shop.example.com"], credentials: false });
    expect(options.allowedHeaders).toContain("x-storefront-host");
  });

  it("refuses the origin when the shop did not list it", async () => {
    const { run } = setup({ host: false });
    const options = await run({ method: "GET", url: STORE, headers: { origin: "https://evil.com", "x-storefront-host": "shop.example.ae" } });
    expect(options).toMatchObject({ origin: STATIC, credentials: true });
  });

  it("ignores Host and X-Forwarded-Host: only x-storefront-host names the shop", async () => {
    const { run, resolver } = setup({ host: true });
    await run({ method: "GET", url: STORE, headers: { origin: "https://shop.example.com", host: "api.example.com", "x-forwarded-host": "other.example" } });
    expect(resolver.headlessAllows).toHaveBeenCalledWith(undefined, "https://shop.example.com");
  });

  it("answers a preflight from whether any shop lists the origin", async () => {
    const yes = setup({ anywhere: true });
    expect(await yes.run({ method: "OPTIONS", url: STORE, headers: { origin: "https://shop.example.com" } })).toMatchObject({ credentials: false });
    expect(yes.resolver.headlessAllows).not.toHaveBeenCalled();

    const no = setup({ anywhere: false });
    expect(await no.run({ method: "OPTIONS", url: STORE, headers: { origin: "https://shop.example.com" } })).toMatchObject({ credentials: true });
  });

  it("fails closed when the lookup throws", async () => {
    const { run } = setup({ throws: true });
    expect(await run({ method: "GET", url: STORE, headers: { origin: "https://shop.example.com", "x-storefront-host": "a" } })).toMatchObject({
      origin: STATIC,
      credentials: true,
    });
  });
});
