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
