import { Suspense } from "react";
import { JsonLd } from "@/components/store/json-ld";
import { RecentlyViewed } from "@/components/store/recently-viewed";
import { PageSections } from "@/components/store/sections/page-sections";
import { HomeSkeleton } from "@/components/store/skeletons";
import { getHome, getStore } from "@/lib/data";
import { absoluteUrl } from "@/lib/seo";
import { siteOrigin } from "@/lib/site";

/** The page's own fetches stream behind this boundary, so the skeleton shows only for the home route. */
export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const [home, store, site] = await Promise.all([getHome(), getStore(), siteOrigin()]);

  return (
    <>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: store.name,
            legalName: store.legalName || undefined,
            url: site,
            logo: store.logoUrl ? absoluteUrl(site, store.logoUrl) : undefined,
            email: store.email || undefined,
            telephone: store.phone || undefined,
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: store.name,
            url: site,
            // Only a site with a search page can offer a search action.
            ...(store.features.search
              ? {
                  potentialAction: {
                    "@type": "SearchAction",
                    target: { "@type": "EntryPoint", urlTemplate: `${site}/search?q={search_term_string}` },
                    "query-input": "required name=search_term_string",
                  },
                }
              : {}),
          },
        ]}
      />
      <PageSections sections={home.sections} store={store} />
      {store.features.products && (
        <div className="mx-auto max-w-7xl px-4">
          <RecentlyViewed className="mt-14" />
        </div>
      )}
    </>
  );
}
