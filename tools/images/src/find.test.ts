import { describe, expect, it, vi } from "vitest";
import { findForProduct } from "./find.js";

const hit = (n: number, domain = "shop.example") => ({
  imageUrl: `https://${domain}/${n}.jpg`, pageUrl: `https://${domain}/p${n}`, title: "modi shower head", width: 900, height: 900,
});

describe("findForProduct", () => {
  it("stops at the first query that yields enough usable results", async () => {
    const search = vi.fn(async () => [hit(1, "a.com"), hit(2, "b.com"), hit(3, "c.com")]);
    const top = await findForProduct({ name: "shower haed", brand: "modi" }, { provider: { name: "f", search }, minUsable: 3, perProduct: 5, sleep: async () => undefined, minIntervalMs: 0 });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("modi shower head");
    expect(top).toHaveLength(3);
  });

  it("falls back to the bare name when the branded query finds too little", async () => {
    const search = vi.fn(async (q: string) => (q.startsWith("modi") ? [] : [hit(1, "a.com"), hit(2, "b.com"), hit(3, "c.com")]));
    const top = await findForProduct({ name: "shower haed", brand: "modi" }, { provider: { name: "f", search }, minUsable: 3, perProduct: 5, sleep: async () => undefined, minIntervalMs: 0 });
    expect(search.mock.calls.map((c) => c[0])).toEqual(["modi shower head", "shower head"]);
    expect(top).toHaveLength(3);
  });
});
