import { COMMERCE_SECTION_TYPES, type HomeSection } from "@devsfleet/shared-types";
import type { HomeData, StoreInfo } from "@devsfleet/storefront-client";
import type { ReactNode } from "react";
import { getHome } from "@/lib/data";
import { orFallback } from "@/lib/fallback";
import { BannerStrip } from "./banner-strip";
import { Brands } from "./brands";
import { Cards } from "./cards";
import { Categories } from "./categories";
import { ContactInfo } from "./contact-info";
import { CtaBanner } from "./cta-banner";
import { Faq } from "./faq";
import { Features } from "./features";
import { FormSection } from "./form-section";
import { Gallery } from "./gallery";
import { Hero } from "./hero";
import { ImageText } from "./image-text";
import { Logos } from "./logos";
import { MapSection } from "./map";
import { Products } from "./products";
import { PromoBanner } from "./promo-banner";
import { RichText } from "./rich-text";
import { SectionBand } from "./section-band";
import { Spacer } from "./spacer";
import { Stats } from "./stats";
import { Steps } from "./steps";
import { TrustBadges } from "./trust-badges";
import { Testimonials } from "./testimonials";
import { Video } from "./video";

const EMPTY_HOME: HomeData = { hero: [], strip: [], categories: [], featuredBrands: [], bestSellers: [], newArrivals: [], sections: [] };

/** Sections whose data is the home payload (banners, departments, brands, product rows). */
function needsHome(section: HomeSection): boolean {
  switch (section.type) {
    case "hero":
    case "categories":
    case "promo_banner":
    case "brands":
    case "banner_strip":
      return true;
    case "products":
      return section.settings.source !== "category";
    default:
      return false;
  }
}

/**
 * A page as the shop configured it: one component per section type, in the
 * shop's order, each wrapped in its own look (background, spacing, anchor).
 * The same renderer draws the home page and every custom page.
 *
 * A section with nothing to show renders nothing, so a half-set-up shop never
 * has an empty heading on its front page. A type this build does not know,
 * from a newer API, is skipped rather than crashing. Sections that need the
 * product catalogue are dropped on a site that has none.
 */
export async function PageSections({ sections, store }: { sections: HomeSection[]; store: StoreInfo }) {
  const visible = sections.filter((s) => s.enabled && (store.features.products || !COMMERCE_SECTION_TYPES.includes(s.type)));
  // Deduped by React's cache: the home page has already asked for it.
  const home = visible.some(needsHome) ? await getHome().catch(orFallback(EMPTY_HOME)) : EMPTY_HOME;

  let productRows = 0;
  return (
    <>
      {visible.map((section) => {
        const align = section.style?.align;
        let body: ReactNode;
        switch (section.type) {
          case "hero":
            body = <Hero settings={section.settings} home={home} store={store} />;
            break;
          case "trust_badges":
            body = <TrustBadges settings={section.settings} />;
            break;
          case "categories":
            body = <Categories settings={section.settings} home={home} />;
            break;
          case "products":
            body = <Products id={section.id} settings={section.settings} home={home} store={store} priority={productRows++ === 0} />;
            break;
          case "promo_banner":
            body = <PromoBanner settings={section.settings} home={home} />;
            break;
          case "brands":
            body = <Brands settings={section.settings} home={home} />;
            break;
          case "banner_strip":
            body = <BannerStrip home={home} />;
            break;
          case "rich_text":
            body = <RichText id={section.id} settings={section.settings} />;
            break;
          case "faq":
            body = <Faq id={section.id} settings={section.settings} />;
            break;
          case "image_text":
            body = <ImageText id={section.id} settings={section.settings} align={align} />;
            break;
          case "features":
            body = <Features id={section.id} settings={section.settings} align={align} />;
            break;
          case "cards":
            body = <Cards id={section.id} settings={section.settings} align={align} />;
            break;
          case "stats":
            body = <Stats id={section.id} settings={section.settings} align={align} />;
            break;
          case "gallery":
            body = <Gallery id={section.id} settings={section.settings} align={align} />;
            break;
          case "testimonials":
            body = <Testimonials id={section.id} settings={section.settings} align={align} />;
            break;
          case "logos":
            body = <Logos id={section.id} settings={section.settings} align={align} />;
            break;
          case "steps":
            body = <Steps id={section.id} settings={section.settings} align={align} />;
            break;
          case "cta_banner":
            body = <CtaBanner id={section.id} settings={section.settings} store={store} align={align} />;
            break;
          case "video":
            body = <Video id={section.id} settings={section.settings} align={align} />;
            break;
          case "map":
            body = <MapSection id={section.id} settings={section.settings} align={align} />;
            break;
          case "contact_info":
            body = <ContactInfo id={section.id} settings={section.settings} store={store} align={align} />;
            break;
          case "form":
            body = <FormSection id={section.id} settings={section.settings} align={align} />;
            break;
          case "spacer":
            body = <Spacer settings={section.settings} />;
            break;
          default:
            return null;
        }
        return (
          <SectionBand key={section.id} style={section.style}>
            {body}
          </SectionBand>
        );
      })}
    </>
  );
}
