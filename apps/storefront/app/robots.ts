import type { MetadataRoute } from "next";
import { siteOrigin } from "@/lib/site";

/** Per shop, like the sitemap it points to. */
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/account", "/cart", "/checkout", "/api", "/login", "/register", "/track/", "/compare"],
    },
    sitemap: `${await siteOrigin()}/sitemap.xml`,
  };
}
