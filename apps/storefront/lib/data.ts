import "server-only";
import {
  DEFAULT_HOME_SECTIONS,
  resolveNavigation,
  resolveRegion,
  resolveSite,
  resolveSiteFeatures,
  resolveTheme,
} from "@devsfleet/shared-types";
import { ApiError, type Branch, type BrandSummary, type CategoryNode, type HomeData, type PublicForm, type StoreInfo } from "@devsfleet/storefront-client";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { cached, publicApi, tags } from "./api-server";
import { orFallback } from "./fallback";
import { makeFormat } from "./format";

/** Shared, cached lookups used across many pages (deduped per request). */
export const getCategories = cache(() =>
  publicApi.get<CategoryNode[]>("/catalog/categories", cached([tags.catalog])).catch(orFallback([] as CategoryNode[])),
);

export const getBrands = cache(() =>
  publicApi.get<BrandSummary[]>("/catalog/brands", cached([tags.catalog])).catch(orFallback([] as BrandSummary[])),
);

/** Shown only if the API is unreachable at render time; the next request replaces it. */
const FALLBACK_STORE: StoreInfo = {
  name: "Online store",
  tagline: null,
  logoUrl: null,
  legalName: "",
  trn: "",
  address: "",
  phone: "",
  email: "",
  whatsapp: "",
  currency: "AED",
  cod: { enabled: true, max: "2000.00", maxFils: 200_000 },
  theme: resolveTheme(undefined),
  navigation: resolveNavigation(undefined),
  region: resolveRegion(undefined),
  timezone: "UTC",
  site: resolveSite(undefined),
  features: resolveSiteFeatures(resolveSite(undefined)),
};

/**
 * Fills whatever an older API deployment does not send yet, so the storefront
 * can be rolled out before or after the API without a window of crashes.
 */
function withDefaults(raw: Partial<StoreInfo> & Pick<StoreInfo, "name">): StoreInfo {
  const site = resolveSite(raw.site);
  return {
    ...FALLBACK_STORE,
    ...raw,
    theme: resolveTheme(raw.theme),
    navigation: resolveNavigation(raw.navigation),
    region: resolveRegion(raw.region),
    timezone: raw.timezone ?? FALLBACK_STORE.timezone,
    site,
    // The API decides what the site can do; deriving it here is only for an API that predates site modes.
    features: raw.features ?? resolveSiteFeatures(site),
  };
}

export const getStore = cache(() =>
  publicApi
    .get<StoreInfo>("/content/store", cached([tags.content]))
    .then(withDefaults)
    .catch(orFallback(FALLBACK_STORE)),
);

/** Formatters for this shop's currency, locale, timezone and delivery zones. */
export const getFormat = cache(async () => {
  const store = await getStore();
  return makeFormat({ currency: store.currency, locale: store.region.formatLocale, timezone: store.timezone, region: store.region });
});

/** The home page's data; `sections` falls back to the classic layout if the API predates configurable sections. */
export const getHome = cache(async () => {
  const home = await publicApi.get<HomeData>("/content/home", cached([tags.home, tags.catalog], 600));
  return { ...home, sections: home.sections ?? DEFAULT_HOME_SECTIONS.filter((section) => section.enabled) };
});

/** Branches shown online; deduped between sections on one page. */
export const getBranches = cache(() =>
  publicApi.get<Branch[]>("/content/branches", cached([tags.content])).catch(orFallback([] as Branch[])),
);

/** A form from the form builder, or null when it does not exist or is switched off. */
export const getForm = cache((slug: string) =>
  publicApi.get<PublicForm>(`/forms/${encodeURIComponent(slug)}`, cached([tags.content])).catch((error: unknown) => {
    unstable_rethrow(error);
    return null;
  }),
);

/**
 * Does any shop answer on this hostname? One storefront deployment serves
 * every tenant, so a request for a hostname nobody registered is a 404 —
 * not a page of fallbacks. Any other failure is treated as "yes" and left to
 * the page, which degrades as it always has.
 */
export const storefrontExists = cache(() =>
  publicApi
    .get<StoreInfo>("/content/store", cached([tags.content]))
    .then(() => true)
    .catch((error: unknown) => {
      unstable_rethrow(error);
      return !(error instanceof ApiError && error.code === "STOREFRONT_NOT_FOUND");
    }),
);
