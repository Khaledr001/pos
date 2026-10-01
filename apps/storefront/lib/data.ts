import "server-only";
import { ApiError, type BrandSummary, type CategoryNode, type StoreInfo } from "@devsfleet/storefront-client";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { cached, publicApi, tags } from "./api-server";
import { orFallback } from "./fallback";

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
  address: "Dubai, UAE",
  phone: "",
  email: "",
  whatsapp: "",
  currency: "AED",
  cod: { enabled: true, max: "2000.00", maxFils: 200_000 },
};

export const getStore = cache(() =>
  publicApi.get<StoreInfo>("/content/store", cached([tags.content])).catch(orFallback(FALLBACK_STORE)),
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
