import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { isIP } from "node:net";

/**
 * SSRF guard for fetching a URL that a third party chose.
 *
 * A candidate's `imageUrl` came from a web search, so it is attacker-
 * influenced: anyone who can get a page into search results can point us at
 * `https://169.254.169.254/...` (cloud metadata), an internal admin panel or
 * the MinIO console. Everything here is pure so it can be tested exhaustively
 * and so the fetcher has exactly one place to ask "may I connect to this?".
 *
 * The rule is checked on the RESOLVED address, never on the hostname alone —
 * `evil.example` can resolve to 127.0.0.1 — and again on every redirect hop.
 */

const blocked = (message: string): AppError => new AppError(ERROR_CODES.IMAGE_URL_BLOCKED, message);

/** [network, prefix length] for every IPv4 range a public server must never contact. */
const FORBIDDEN_V4: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // "this network"
  [0x0a000000, 8], // 10/8 private
  [0x64400000, 10], // 100.64/10 carrier-grade NAT
  [0x7f000000, 8], // loopback
  [0xa9fe0000, 16], // 169.254/16 link-local, incl. the 169.254.169.254 metadata service
  [0xac100000, 12], // 172.16/12 private
  [0xc0000000, 24], // 192.0.0/24 IETF protocol assignments
  [0xc0000200, 24], // TEST-NET-1
  [0xc0586300, 24], // 6to4 relay anycast
  [0xc0a80000, 16], // 192.168/16 private
  [0xc6120000, 15], // 198.18/15 benchmarking
  [0xc6336400, 24], // TEST-NET-2
  [0xcb007100, 24], // TEST-NET-3
  [0xe0000000, 4], // multicast
  [0xf0000000, 4], // reserved + broadcast
];

function parseIPv4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function isForbiddenIPv4Number(value: number): boolean {
  return FORBIDDEN_V4.some(([network, prefix]) => {
    const size = 2 ** (32 - prefix);
    return Math.floor(value / size) === Math.floor(network / size);
  });
}

/** Expand any textual IPv6 form (compressed, embedded dotted quad, zone id) into a 128-bit integer. */
function parseIPv6(input: string): bigint | null {
  let text = input;
  const zone = text.indexOf("%");
  if (zone >= 0) text = text.slice(0, zone);

  // A trailing dotted quad (::ffff:1.2.3.4) is two hextets.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const v4 = parseIPv4(tail);
    if (v4 === null) return null;
    text = `${text.slice(0, lastColon + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8) return null;

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(`0x${group}`);
  }
  return value;
}

const inV6 = (value: bigint, network: bigint, prefix: number): boolean =>
  value >> BigInt(128 - prefix) === network >> BigInt(128 - prefix);

function isForbiddenIPv6(value: bigint): boolean {
  if (value === 0n || value === 1n) return true; // :: and ::1
  const low32 = Number(value & 0xffffffffn);

  // Wrappers around an IPv4 address inherit that address's verdict.
  if (inV6(value, 0xffffn << 32n, 96)) return isForbiddenIPv4Number(low32); // ::ffff:a.b.c.d
  if (inV6(value, 0x64ff9bn << 96n, 96)) return isForbiddenIPv4Number(low32); // 64:ff9b::/96 NAT64
  if (inV6(value, 0n, 96)) return true; // ::a.b.c.d deprecated IPv4-compatible
  if (inV6(value, 0x2002n << 112n, 16)) {
    return isForbiddenIPv4Number(Number((value >> 80n) & 0xffffffffn)); // 6to4 embeds the v4 in bits 16-47
  }

  return (
    inV6(value, 0xfc00n << 112n, 7) || // unique local
    inV6(value, 0xfe80n << 112n, 10) || // link-local
    inV6(value, 0xfec0n << 112n, 10) || // deprecated site-local
    inV6(value, 0xff00n << 112n, 8) || // multicast
    inV6(value, 0x0100n << 112n, 64) || // discard-only
    inV6(value, 0x20010db8n << 96n, 32) || // documentation
    inV6(value, 0x20010000n << 96n, 32) // Teredo
  );
}

/** True for any address a server-side fetch must refuse. Unparseable input counts as forbidden. */
export function isForbiddenIp(ip: string): boolean {
  const family = isIP(ip.includes("%") ? ip.slice(0, ip.indexOf("%")) : ip);
  if (family === 4) {
    const value = parseIPv4(ip);
    return value === null || isForbiddenIPv4Number(value);
  }
  if (family === 6) {
    const value = parseIPv6(ip);
    return value === null || isForbiddenIPv6(value);
  }
  return true;
}

const FORBIDDEN_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];

/**
 * Syntactic checks, before any network traffic: https only, no credentials, no
 * odd ports, no obviously local names. Returns the parsed URL.
 */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw blocked("The image URL is not a valid URL.");
  }
  if (url.protocol !== "https:") throw blocked("Only https:// image URLs may be fetched.");
  if (url.username || url.password) throw blocked("Image URLs with embedded credentials are refused.");
  if (url.port && url.port !== "443") throw blocked("Image URLs on a non-standard port are refused.");

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
  if (!host) throw blocked("The image URL has no host.");
  if (host === "localhost" || FORBIDDEN_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw blocked("Local host names may not be fetched.");
  }
  if (isIP(host) !== 0 && isForbiddenIp(host)) {
    throw blocked("That address is on a private or reserved network.");
  }
  return url;
}

/**
 * Called with whatever DNS returned. EVERY address must be public: a name with
 * one public and one private record would otherwise be a coin flip for an
 * attacker, who can retry until the private one is picked.
 */
export function assertPublicAddresses(addresses: ReadonlyArray<string>): void {
  if (addresses.length === 0) throw blocked("The host did not resolve to any address.");
  const bad = addresses.find(isForbiddenIp);
  if (bad !== undefined) throw blocked("The host resolves to a private or reserved network address.");
}
