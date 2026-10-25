import type { HomeSection } from "@devsfleet/shared-types";
import type { HomeData, StoreInfo } from "@devsfleet/storefront-client";
import { BannerStrip } from "./banner-strip";
import { Brands } from "./brands";
import { Categories } from "./categories";
import { Faq } from "./faq";
import { Hero } from "./hero";
import { Products } from "./products";
import { PromoBanner } from "./promo-banner";
import { RichText } from "./rich-text";
import { TrustBadges } from "./trust-badges";

/**
 * The home page as the shop configured it: one component per section type, in
 * the shop's order. A section with nothing to show (no brands, an empty FAQ)
 * renders nothing, so a half-set-up shop never has an empty heading on its
 * front page. An unknown type, from a newer API, is skipped rather than crashing.
 */
export function HomeSections({ sections, home, store }: { sections: HomeSection[]; home: HomeData; store: StoreInfo }) {
  let productRows = 0;
  return (
    <>
      {sections
        .filter((s) => s.enabled)
        .map((section) => {
          switch (section.type) {
            case "hero":
              return <Hero key={section.id} settings={section.settings} home={home} store={store} />;
            case "trust_badges":
              return <TrustBadges key={section.id} settings={section.settings} />;
            case "categories":
              return <Categories key={section.id} settings={section.settings} home={home} />;
            case "products":
              return <Products key={section.id} id={section.id} settings={section.settings} home={home} priority={productRows++ === 0} />;
            case "promo_banner":
              return <PromoBanner key={section.id} settings={section.settings} home={home} />;
            case "brands":
              return <Brands key={section.id} settings={section.settings} home={home} />;
            case "banner_strip":
              return <BannerStrip key={section.id} home={home} />;
            case "rich_text":
              return <RichText key={section.id} id={section.id} settings={section.settings} />;
            case "faq":
              return <Faq key={section.id} id={section.id} settings={section.settings} />;
            default:
              return null;
          }
        })}
    </>
  );
}
