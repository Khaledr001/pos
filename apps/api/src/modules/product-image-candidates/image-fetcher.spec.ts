import { ERROR_CODES } from "@devsfleet/shared-utils";
import { describe, expect, it, vi } from "vitest";
import { SafeImageFetcher, sniffImageType, type HttpGetResult, type PinnedGet, type Resolver } from "./image-fetcher.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(16)]);

async function* chunks(...parts: Buffer[]): AsyncIterable<Buffer> {
  for (const p of parts) yield p;
}

function reply(
  status: number,
  headers: HttpGetResult["headers"],
  ...body: Buffer[]
): HttpGetResult {
  return { status, headers, body: chunks(...body), destroy: vi.fn() };
}

const publicResolver: Resolver = async () => [{ address: "93.184.216.34", family: 4 }];

function fetcherWith(get: PinnedGet, resolve: Resolver = publicResolver) {
  return new SafeImageFetcher({ get, resolve, maxRedirects: 2, timeoutMs: 1000 });
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("sniffImageType", () => {
  it("recognises JPEG, PNG and WebP by magic bytes only", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");
    expect(sniffImageType(Buffer.from("<html><script>"))).toBeNull();
    expect(sniffImageType(Buffer.from("GIF89a......"))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe("SafeImageFetcher", () => {
  it("returns the bytes and the SNIFFED type", async () => {
    const get = vi.fn<PinnedGet>(async () => reply(200, { "content-type": "image/jpeg" }, JPEG.subarray(0, 10), JPEG.subarray(10)));
    const result = await fetcherWith(get).fetch("https://cdn.example.com/a.jpg", 1024);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.buffer.equals(JPEG)).toBe(true);
    // Pinned to the address we validated.
    expect(get.mock.calls[0]?.[1]).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("refuses a non-https URL without touching the network", async () => {
    const get = vi.fn<PinnedGet>();
    expect(await codeOf(fetcherWith(get).fetch("http://cdn.example.com/a.jpg", 1024))).toBe(ERROR_CODES.IMAGE_URL_BLOCKED);
    expect(get).not.toHaveBeenCalled();
  });

  it("refuses when DNS answers with a private address (rebinding) and never connects", async () => {
    const get = vi.fn<PinnedGet>();
    const rebinding: Resolver = async () => [{ address: "127.0.0.1", family: 4 }];
    expect(await codeOf(fetcherWith(get, rebinding).fetch("https://evil.example.com/a.jpg", 1024))).toBe(
      ERROR_CODES.IMAGE_URL_BLOCKED,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("re-checks DNS after a redirect: a public host redirecting to a host that resolves privately is refused", async () => {
    const resolve: Resolver = async (host) =>
      host === "internal.example.com" ? [{ address: "10.0.0.9", family: 4 }] : [{ address: "93.184.216.34", family: 4 }];
    const get = vi.fn<PinnedGet>(async () =>
      reply(302, { location: "https://internal.example.com/secret.jpg" }),
    );
    expect(await codeOf(fetcherWith(get, resolve).fetch("https://cdn.example.com/a.jpg", 1024))).toBe(
      ERROR_CODES.IMAGE_URL_BLOCKED,
    );
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect to a literal metadata address or to http", async () => {
    for (const location of ["https://169.254.169.254/latest/meta-data/", "http://cdn.example.com/b.jpg", "https://[::1]/x.jpg"]) {
      const get = vi.fn<PinnedGet>(async () => reply(301, { location }));
      expect(await codeOf(fetcherWith(get).fetch("https://cdn.example.com/a.jpg", 1024))).toBe(ERROR_CODES.IMAGE_URL_BLOCKED);
    }
  });

  it("follows a safe redirect, including a relative one", async () => {
    const get = vi
      .fn<PinnedGet>()
      .mockResolvedValueOnce(reply(302, { location: "/final.png" }))
      .mockResolvedValueOnce(reply(200, { "content-type": "image/png" }, PNG));
    const result = await fetcherWith(get).fetch("https://cdn.example.com/a.png", 1024);
    expect(result.mimeType).toBe("image/png");
    expect(get.mock.calls[1]?.[0].toString()).toBe("https://cdn.example.com/final.png");
  });

  it("stops after the redirect limit", async () => {
    const get = vi.fn<PinnedGet>(async () => reply(302, { location: "https://cdn.example.com/loop" }));
    expect(await codeOf(fetcherWith(get).fetch("https://cdn.example.com/a.jpg", 1024))).toBe(ERROR_CODES.IMAGE_FETCH_FAILED);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it("rejects a declared content-type that is not an accepted image", async () => {
    const get = vi.fn<PinnedGet>(async () => reply(200, { "content-type": "text/html" }, Buffer.from("<html>")));
    expect(await codeOf(fetcherWith(get).fetch("https://cdn.example.com/a.jpg", 1024))).toBe(ERROR_CODES.IMAGE_TYPE_UNSUPPORTED);
  });

  it("rejects a lying content-type (header says jpeg, bytes are HTML)", async () => {
    const get = vi.fn<PinnedGet>(async () => reply(200, { "content-type": "image/jpeg" }, Buffer.from("<html>nope</html>")));
    expect(await codeOf(fetcherWith(get).fetch("https://cdn.example.com/a.jpg", 1024))).toBe(ERROR_CODES.IMAGE_TYPE_UNSUPPORTED);
  });

  it("rejects by Content-Length before reading, and by running total when the header lies", async () => {
    const declared = vi.fn<PinnedGet>(async () => reply(200, { "content-type": "image/jpeg", "content-length": "5000" }, JPEG));
    expect(await codeOf(fetcherWith(declared).fetch("https://cdn.example.com/a.jpg", 1000))).toBe(ERROR_CODES.IMAGE_TOO_LARGE);

    const streamed = vi.fn<PinnedGet>(async () =>
      reply(200, { "content-type": "image/jpeg" }, JPEG, Buffer.alloc(2000, 1)),
    );
    expect(await codeOf(fetcherWith(streamed).fetch("https://cdn.example.com/a.jpg", 1000))).toBe(ERROR_CODES.IMAGE_TOO_LARGE);
  });

  it("maps non-200 and connection failures to IMAGE_FETCH_FAILED", async () => {
    const notFound = vi.fn<PinnedGet>(async () => reply(404, {}));
    expect(await codeOf(fetcherWith(notFound).fetch("https://cdn.example.com/a.jpg", 1024))).toBe(ERROR_CODES.IMAGE_FETCH_FAILED);
    const down = vi.fn<PinnedGet>(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await codeOf(fetcherWith(down).fetch("https://cdn.example.com/a.jpg", 1024))).toBe(ERROR_CODES.IMAGE_FETCH_FAILED);
    const noDns: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await codeOf(fetcherWith(vi.fn<PinnedGet>(), noDns).fetch("https://cdn.example.com/a.jpg", 1024))).toBe(
      ERROR_CODES.IMAGE_FETCH_FAILED,
    );
  });
});
