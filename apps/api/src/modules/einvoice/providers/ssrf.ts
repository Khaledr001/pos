import dns from "node:dns";
import https from "node:https";
import net from "node:net";

/**
 * Outbound calls to a tenant-supplied URL are the classic way to turn "type a
 * webhook address" into "read the cloud metadata service". This module is the
 * whole defence: https only, no credentials in the URL, every resolved address
 * checked, the CHECKED address is the one connected to (so DNS cannot change
 * its answer between the check and the connection), no redirects, a time limit
 * and a size limit.
 */

const V4_BLOCKS: [number, number][] = [
  [0x00000000, 8], // "this" network
  [0x0a000000, 8], // private
  [0x64400000, 10], // carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // link-local, incl. cloud metadata 169.254.169.254
  [0xac100000, 12], // private
  [0xc0000000, 24], // IETF protocol assignments
  [0xc0000200, 24], // documentation
  [0xc0a80000, 16], // private
  [0xc6120000, 15], // benchmarking
  [0xc6336400, 24], // documentation
  [0xcb007100, 24], // documentation
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved + broadcast
];

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function expandV6(ip: string): bigint | null {
  let text = ip.split("%")[0]!;
  const mapped = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (mapped) {
    const n = v4ToInt(mapped[2]!);
    text = `${mapped[1]}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    value = (value << 16n) + BigInt(`0x${g}`);
  }
  return value;
}

/** True when an address must never be reached from a tenant-supplied URL. Unparseable counts as private. */
export function isPrivateAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) {
    const n = v4ToInt(ip);
    return V4_BLOCKS.some(([base, bits]) => bits === 0 || n >>> (32 - bits) === base >>> (32 - bits));
  }
  if (family === 6) {
    const v = expandV6(ip);
    if (v === null) return true;
    if (v === 0n || v === 1n) return true; // :: and ::1
    const top16 = Number(v >> 112n);
    if ((top16 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((top16 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((top16 & 0xff00) === 0xff00) return true; // multicast
    const embeddedV4 = (n: bigint) => `${Number((n >> 24n) & 0xffn)}.${Number((n >> 16n) & 0xffn)}.${Number((n >> 8n) & 0xffn)}.${Number(n & 0xffn)}`;
    const upper96 = v >> 32n;
    // ::a.b.c.d (IPv4-compatible), ::ffff:a.b.c.d (IPv4-mapped) and 64:ff9b::/96 (NAT64): judged by the IPv4 address inside.
    if (upper96 === 0n || upper96 === 0xffffn || upper96 === 0x0064ff9b0000000000000000n) return isPrivateAddress(embeddedV4(v & 0xffffffffn));
    if (v >> 96n === 0x20010db8n) return true; // 2001:db8::/32 documentation
    return false;
  }
  return true;
}

export class UnsafeUrlError extends Error {}

/** https, a real host, no embedded credentials. `allowPrivate` is for local development only. */
export function assertSafeUrl(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("The address is not a valid URL");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("The address must start with https://");
  if (url.username || url.password) throw new UnsafeUrlError("The address must not contain a username or password");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new UnsafeUrlError("The address has no host");
  if (!allowPrivate) {
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new UnsafeUrlError("The address points at a private network");
    if (net.isIP(host) && isPrivateAddress(host)) throw new UnsafeUrlError("The address points at a private network");
  }
  return url;
}

type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true });

/** A `lookup` for https.request that refuses private answers, so the connection can only go to a checked address. */
export function guardedLookup(allowPrivate: boolean, resolve: Resolver = systemResolver): https.RequestOptions["lookup"] {
  return ((hostname: string, options: dns.LookupOptions, callback: (err: Error | null, address?: unknown, family?: number) => void) => {
    resolve(hostname)
      .then((answers) => {
        const usable = answers.filter((a) => allowPrivate || !isPrivateAddress(a.address));
        if (usable.length === 0) return callback(new UnsafeUrlError("The address resolves to a private network"));
        if (options && (options as { all?: boolean }).all) return callback(null, usable);
        return callback(null, usable[0]!.address, usable[0]!.family);
      })
      .catch((error: Error) => callback(error));
  }) as https.RequestOptions["lookup"];
}

export interface GuardedRequest {
  url: string;
  method: "POST" | "GET";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  allowPrivate?: boolean;
}

export interface GuardedResponse {
  status: number;
  body: string;
}

export type HttpsSender = (request: GuardedRequest) => Promise<GuardedResponse>;

/** The real sender. Rejects with UnsafeUrlError for a blocked target, or with the transport's error for a network failure. */
export const sendGuarded: HttpsSender = (request) =>
  new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = assertSafeUrl(request.url, request.allowPrivate ?? false);
    } catch (error) {
      return reject(error);
    }
    const limit = request.maxResponseBytes ?? 1_000_000;
    const req = https.request(
      url,
      {
        method: request.method,
        headers: { ...(request.headers ?? {}), ...(request.body !== undefined ? { "content-length": String(Buffer.byteLength(request.body)) } : {}) },
        lookup: guardedLookup(request.allowPrivate ?? false),
        timeout: request.timeoutMs ?? 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limit) {
            res.destroy();
            reject(new Error("The response was larger than the limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("The request timed out")));
    req.on("error", reject);
    if (request.body !== undefined) req.write(request.body);
    req.end();
  });
