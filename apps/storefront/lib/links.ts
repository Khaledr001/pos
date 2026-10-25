import { NAV_HREF } from "@devsfleet/shared-types";

/**
 * Tenant-configured links (menus, banners, calls to action) may point at a
 * path on the shop or an https URL, and nothing else — never `javascript:`,
 * `data:` or a protocol-relative `//host`. The API validates on save; this is
 * the same check on the way out, so a bad row written any other way is inert.
 */
export function safeHref(href: string | null | undefined): string | null {
  const value = href?.trim();
  return value && NAV_HREF.test(value) ? value : null;
}

export const isExternal = (href: string) => href.startsWith("https://");

/**
 * An image address a tenant may use in a page section: an https URL or a path
 * under the platform's own /uploads (the only relative path the image
 * optimiser is configured for). Anything else renders nothing rather than a
 * broken image, or a next/image error that takes the page down.
 */
export function safeImageSrc(src: string | null | undefined): string | null {
  const value = src?.trim();
  if (!value) return null;
  if (/^https:\/\/[^\s]+$/.test(value)) return value;
  if (/^\/uploads\/[^\s]*$/.test(value)) return value;
  // The local API (STORAGE_DRIVER=local) serves uploads over http in development only.
  if (process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[^\s]*$/.test(value)) return value;
  return null;
}
