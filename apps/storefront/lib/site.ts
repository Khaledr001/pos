import { headers } from "next/headers";

/**
 * This shop's public origin: NEXT_PUBLIC_SITE_URL for a single-shop
 * deployment, otherwise the origin the visitor actually used — one
 * deployment serves every tenant's domain, so canonical URLs, the sitemap
 * and structured data must name the shop being browsed.
 */
export async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3002";
  const proto = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
