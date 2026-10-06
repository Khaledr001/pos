import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BraveProvider } from "./brave.js";
import { CachedProvider } from "./cache.js";
import { getJson } from "./http.js";
import { SerpApiProvider } from "./serpapi.js";
import { SerperProvider } from "./serper.js";
import { ProviderConfigError, ProviderFatalError } from "./types.js";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe("BraveProvider", () => {
  it("fails with setup instructions when there is no key", () => {
    expect(() => new BraveProvider(undefined)).toThrow(ProviderConfigError);
    expect(() => new BraveProvider("")).toThrow(/api-dashboard\.search\.brave\.com/);
  });

  it("calls the images endpoint with the token header and maps a recorded-shape response", async () => {
    const fetchFn = vi.fn(async () =>
      json({
        type: "images",
        results: [
          { type: "image_result", title: "Modi shower", url: "https://shop.example/p", thumbnail: { src: "https://imgs.search.brave.com/t.jpg" }, properties: { url: "https://shop.example/i.jpg", width: 1200, height: 1200 } },
          { title: "no image url", url: "https://x.example" },
        ],
      }),
    );
    const hits = await new BraveProvider("KEY", { fetchFn: fetchFn as unknown as typeof fetch }).search("modi shower head");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://api.search.brave.com/res/v1/images/search?q=modi+shower+head");
    expect((init.headers as Record<string, string>)["x-subscription-token"]).toBe("KEY");
    expect(hits).toEqual([{ imageUrl: "https://shop.example/i.jpg", pageUrl: "https://shop.example/p", thumbnailUrl: "https://imgs.search.brave.com/t.jpg", title: "Modi shower", width: 1200, height: 1200 }]);
  });
});

describe("SerpApiProvider", () => {
  it("requires a key and maps images_results", async () => {
    expect(() => new SerpApiProvider(undefined)).toThrow(/serpapi\.com/);
    const fetchFn = vi.fn(async () =>
      json({ images_results: [{ original: "https://a.example/o.jpg", link: "https://a.example/page", thumbnail: "https://t/x", title: "T", original_width: 900, original_height: 800 }, { link: "https://no-original" }] }),
    );
    const hits = await new SerpApiProvider("K", { fetchFn: fetchFn as unknown as typeof fetch }).search("q");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ imageUrl: "https://a.example/o.jpg", pageUrl: "https://a.example/page", width: 900 });
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toContain("engine=google_images");
  });
});

describe("SerperProvider", () => {
  it("requires a key, POSTs the query with the key header and maps images", async () => {
    expect(() => new SerperProvider(undefined)).toThrow(/serper\.dev/);
    const fetchFn = vi.fn(async () =>
      json({ images: [{ title: "T", imageUrl: "https://a.example/o.jpg", imageWidth: 900, imageHeight: 800, thumbnailUrl: "https://t/x", link: "https://a.example/page" }, { imageUrl: "https://no-link" }] }),
    );
    const hits = await new SerperProvider("K", { fetchFn: fetchFn as unknown as typeof fetch }).search("modi shower head");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://google.serper.dev/images");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("K");
    expect(JSON.parse(init.body as string)).toMatchObject({ q: "modi shower head" });
    expect(hits).toEqual([{ imageUrl: "https://a.example/o.jpg", pageUrl: "https://a.example/page", thumbnailUrl: "https://t/x", title: "T", width: 900, height: 800 }]);
  });
});

describe("getJson back-off", () => {
  it("retries a 429 honouring Retry-After, then succeeds", async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchFn = vi.fn().mockResolvedValueOnce(json({}, 429, { "retry-after": "2" })).mockResolvedValueOnce(json({ ok: 1 }));
    await expect(getJson("https://x", {}, { fetchFn: fetchFn as unknown as typeof fetch, sleep })).resolves.toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("treats 401/402 as fatal without retrying", async () => {
    const fetchFn = vi.fn(async () => json({}, 402));
    await expect(getJson("https://x", {}, { fetchFn: fetchFn as unknown as typeof fetch, sleep: async () => undefined })).rejects.toThrow(ProviderFatalError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("CachedProvider", () => {
  it("spends one live call per distinct query", async () => {
    const inner = { name: "fake", search: vi.fn(async () => [{ imageUrl: "https://a/i.jpg", pageUrl: "https://a/p" }]) };
    const cached = new CachedProvider(inner, await mkdtemp(join(tmpdir(), "imgcache-")));
    await cached.search("q1");
    await cached.search("q1");
    await cached.search("q2");
    expect(inner.search).toHaveBeenCalledTimes(2);
    expect(cached.liveCalls).toBe(2);
  });
});
