import "server-only";
import { createApiClient } from "@devsfleet/storefront-client";
import { cookies, headers } from "next/headers";

const API_BASE = `${process.env.API_ORIGIN ?? "http://localhost:3001"}/api/v1/storefront`;

/**
 * The platform API serves every tenant's shop and picks the tenant from the
 * shop's hostname. A server-side call names its own Host (the API's), so the
 * shop's hostname travels in `x-storefront-host` instead.
 *
 * One deployment serves every tenant: the hostname is the visitor's own,
 * read per request. `STOREFRONT_HOST` pins it instead — for a deployment
 * dedicated to one shop, or local development where the browser's host is
 * not the one registered.
 */
async function storefrontHost(): Promise<string> {
  if (process.env.STOREFRONT_HOST) return process.env.STOREFRONT_HOST;
  // Deliberately not caught: at build time this throws Next's request-time
  // signal, which is what marks the page per-request (see lib/fallback.ts).
  return (await headers()).get("host") ?? "localhost";
}

/**
 * Public data (catalog, content). No cookies are sent, so responses are safe
 * to cache and share between visitors. Always pass cache tags via `cached()`.
 */
/**
 * Proves to the API that a call comes from this storefront, so it may name
 * the shopper's IP for rate limiting (StorefrontAwareThrottlerGuard).
 */
const PROXY_HEADERS: Record<string, string> = process.env.STOREFRONT_PROXY_SECRET
  ? { "x-storefront-proxy": process.env.STOREFRONT_PROXY_SECRET }
  : {};

export const publicApi = createApiClient({
  baseUrl: API_BASE,
  // Headers are part of Next's fetch cache key: the host keeps two shops'
  // catalogues apart, and nothing per-visitor may go here.
  headers: async () => ({ "x-storefront-host": await storefrontHost(), ...PROXY_HEADERS }),
});

/** Per-visitor data (cart, account, trade prices). Forwards the visitor's cookies; never cached. */
export async function visitorApi() {
  const [jar, incoming, host] = await Promise.all([cookies(), headers(), storefrontHost()]);
  // Pass the visitor's IP on, so the API's rate limits apply per visitor
  // rather than to this server as a whole.
  const forwarded = incoming.get("x-forwarded-for") ?? incoming.get("x-real-ip");
  return createApiClient({
    baseUrl: API_BASE,
    headers: () => ({
      cookie: jar.toString(),
      "x-storefront-host": host,
      ...PROXY_HEADERS,
      ...(forwarded ? { "x-forwarded-for": forwarded, "x-storefront-client-ip": forwarded.split(",")[0]!.trim() } : {}),
    }),
  });
}

/**
 * Cache tags. They mirror backend RevalidationService.tags: the backend calls
 * /api/revalidate with these names when the POS or an admin changes something.
 */
export const tags = {
  catalog: "catalog",
  home: "home",
  content: "content",
  product: (slug: string) => `product:${slug}`,
  category: (slug: string) => `category:${slug}`,
  brand: (slug: string) => `brand:${slug}`,
  page: (slug: string) => `page:${slug}`,
};

/** fetch() options for cached public data. */
export function cached(tagList: string[], revalidate = 3600) {
  return { cache: "force-cache" as const, next: { tags: tagList, revalidate } };
}
