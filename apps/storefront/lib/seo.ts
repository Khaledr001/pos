import type { Metadata } from "next";

/** Site-relative or absolute image URL → absolute, for schema.org (which has no base URL). */
export function absoluteUrl(site: string, url: string) {
  return /^https?:\/\//.test(url) ? url : `${site}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** schema.org BreadcrumbList; `Home` leads, as in the visible breadcrumbs. */
export function breadcrumbLd(site: string, items: { href: string; label: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [{ href: "/", label: "Home" }, ...items].map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      item: absoluteUrl(site, c.href),
    })),
  };
}

/**
 * Open Graph + Twitter card fields shared by every indexable page. Title and
 * description fall back to the page's own, so the card never disagrees with
 * the search snippet. `path` is the canonical, relative to metadataBase.
 */
export function socialMeta(input: {
  title: string;
  description?: string | null;
  path: string;
  image?: string | null;
  type?: "website" | "article";
  siteName?: string;
}): Pick<Metadata, "alternates" | "openGraph" | "twitter"> {
  const images = input.image ? [input.image] : undefined;
  const description = input.description ?? undefined;
  return {
    alternates: { canonical: input.path },
    openGraph: { type: input.type ?? "website", title: input.title, description, url: input.path, siteName: input.siteName, images },
    twitter: { card: images ? "summary_large_image" : "summary", title: input.title, description, images },
  };
}
