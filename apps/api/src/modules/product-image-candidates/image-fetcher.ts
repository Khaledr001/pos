import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { assertFetchableUrl, assertPublicAddresses } from "./ssrf-guard.js";

export type SniffedImageType = "image/jpeg" | "image/png" | "image/webp";

export interface FetchedImage {
  buffer: Buffer;
  mimeType: SniffedImageType;
}

/** The seam the service depends on, so approval can be tested without a network. */
export abstract class ImageFetcher {
  abstract fetch(url: string, maxBytes: number): Promise<FetchedImage>;
}

/** What actually touches the network — injectable so the redirect/size logic is testable. */
export interface HttpGetResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Buffer>;
  destroy(): void;
}
export interface PinnedGet {
  (url: URL, address: { address: string; family: 4 | 6 }, timeoutMs: number): Promise<HttpGetResult>;
}
export type Resolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const ACCEPTED_TYPES = new Set<string>(["image/jpeg", "image/png", "image/webp"]);

/** Identify an image by its first bytes. The Content-Type header is a claim; this is the evidence. */
export function sniffImageType(buffer: Buffer): SniffedImageType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

const defaultResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/**
 * Connect to the address WE validated, not whatever DNS says the second time.
 * Passing `lookup` pins the socket to that address while TLS still verifies
 * the certificate against the original hostname — closing the window in which
 * a rebinding DNS server answers "public" for the check and "127.0.0.1" for
 * the connection.
 */
const defaultGet: PinnedGet = (url, address, timeoutMs) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        protocol: "https:",
        hostname: url.hostname.replace(/^\[|\]$/g, ""),
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        timeout: timeoutMs,
        // No cookies, no auth, no referer: we are an anonymous, one-off client.
        headers: {
          accept: "image/jpeg,image/png,image/webp",
          "user-agent": "DevsFleetImageFetcher/1.0 (+product image review)",
          "accept-encoding": "identity",
        },
        lookup: (_host, lookupOptions, callback) => {
          // Node 20+ may ask for every address (`all: true`); answer in the shape asked for.
          if (lookupOptions.all) {
            (callback as unknown as (err: null, list: Array<{ address: string; family: number }>) => void)(null, [
              { address: address.address, family: address.family },
            ]);
          } else {
            callback(null, address.address, address.family);
          }
        },
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: res as unknown as AsyncIterable<Buffer>,
          destroy: () => res.destroy(),
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });

export interface SafeFetchOptions {
  maxRedirects: number;
  timeoutMs: number;
  resolve: Resolver;
  get: PinnedGet;
}

const DEFAULTS: SafeFetchOptions = { maxRedirects: 3, timeoutMs: 15_000, resolve: defaultResolver, get: defaultGet };

/** Built by a factory in the module: the options argument is not an injectable. */
export class SafeImageFetcher extends ImageFetcher {
  private readonly options: SafeFetchOptions;

  constructor(options: Partial<SafeFetchOptions> = {}) {
    super();
    this.options = { ...DEFAULTS, ...options };
  }

  async fetch(rawUrl: string, maxBytes: number): Promise<FetchedImage> {
    const deadline = Date.now() + this.options.timeoutMs * 2;
    let current = rawUrl;

    for (let hop = 0; hop <= this.options.maxRedirects; hop += 1) {
      if (Date.now() > deadline) throw this.failed("Timed out while downloading the image.");

      const url = assertFetchableUrl(current);
      const address = await this.resolvePublic(url);

      let response: HttpGetResult;
      try {
        response = await this.options.get(url, address, this.options.timeoutMs);
      } catch {
        throw this.failed("Could not connect to the image host.");
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        response.destroy();
        const location = headerValue(response.headers["location"]);
        if (!location) throw this.failed("Redirect without a Location header.");
        // Resolved against the current URL; re-validated at the top of the loop.
        try {
          current = new URL(location, url).toString();
        } catch {
          throw this.failed("Redirect to an invalid URL.");
        }
        continue;
      }

      if (response.status !== 200) {
        response.destroy();
        throw this.failed(`The image host answered HTTP ${response.status}.`);
      }

      const declared = headerValue(response.headers["content-type"])?.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!ACCEPTED_TYPES.has(declared)) {
        response.destroy();
        throw new AppError(
          ERROR_CODES.IMAGE_TYPE_UNSUPPORTED,
          `The remote file is "${declared || "unknown"}", not a JPEG, PNG or WebP image.`,
        );
      }
      const length = Number(headerValue(response.headers["content-length"]) ?? "0");
      if (length > maxBytes) {
        response.destroy();
        throw this.tooLarge(maxBytes);
      }

      const chunks: Buffer[] = [];
      let received = 0;
      try {
        for await (const chunk of response.body) {
          received += chunk.length;
          if (received > maxBytes) {
            response.destroy();
            throw this.tooLarge(maxBytes);
          }
          chunks.push(chunk);
          if (Date.now() > deadline) {
            response.destroy();
            throw this.failed("Timed out while downloading the image.");
          }
        }
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw this.failed("The download was interrupted.");
      }

      const buffer = Buffer.concat(chunks);
      const sniffed = sniffImageType(buffer);
      if (!sniffed) {
        throw new AppError(ERROR_CODES.IMAGE_TYPE_UNSUPPORTED, "The downloaded file is not a valid JPEG, PNG or WebP image.");
      }
      return { buffer, mimeType: sniffed };
    }

    throw this.failed("Too many redirects.");
  }

  private async resolvePublic(url: URL): Promise<{ address: string; family: 4 | 6 }> {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const literal = isIP(host);
    if (literal !== 0) {
      assertPublicAddresses([host]);
      return { address: host, family: literal === 6 ? 6 : 4 };
    }

    let records: Array<{ address: string; family: number }>;
    try {
      records = await this.options.resolve(host);
    } catch {
      throw this.failed("The image host could not be resolved.");
    }
    assertPublicAddresses(records.map((r) => r.address));
    const first = records[0];
    if (!first) throw this.failed("The image host could not be resolved.");
    return { address: first.address, family: first.family === 6 ? 6 : 4 };
  }

  private failed(message: string): AppError {
    return new AppError(ERROR_CODES.IMAGE_FETCH_FAILED, message);
  }

  private tooLarge(maxBytes: number): AppError {
    return new AppError(
      ERROR_CODES.IMAGE_TOO_LARGE,
      `The remote image is larger than ${Math.round(maxBytes / (1024 * 1024))}MB.`,
    );
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
