import "server-only";
import { createApiClient } from "@al-lahiq/api-client";
import { cookies, headers } from "next/headers";

const API_BASE = `${process.env.API_ORIGIN ?? "http://localhost:4000"}/api/v1`;

/**
 * Public data (catalog, content). No cookies are sent, so responses are safe
 * to cache and share between visitors. Always pass cache tags via `cached()`.
 */
export const publicApi = createApiClient({ baseUrl: API_BASE });

/** Per-visitor data (cart, account, trade prices). Forwards the visitor's cookies; never cached. */
export async function visitorApi() {
  const [jar, incoming] = await Promise.all([cookies(), headers()]);
  // Pass the visitor's IP on, so the API's rate limits apply per visitor
  // rather than to this server as a whole.
  const forwarded = incoming.get("x-forwarded-for") ?? incoming.get("x-real-ip");
  return createApiClient({
    baseUrl: API_BASE,
    headers: () => ({ cookie: jar.toString(), ...(forwarded ? { "x-forwarded-for": forwarded } : {}) }),
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
