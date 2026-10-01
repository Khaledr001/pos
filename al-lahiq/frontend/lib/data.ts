import "server-only";
import type { BrandSummary, CategoryNode, StoreInfo } from "@al-lahiq/api-client";
import { cache } from "react";
import { cached, publicApi, tags } from "./api-server";

/** Shared, cached lookups used across many pages (deduped per request). */
export const getCategories = cache(() =>
  publicApi.get<CategoryNode[]>("/catalog/categories", cached([tags.catalog])).catch(() => [] as CategoryNode[]),
);

export const getBrands = cache(() =>
  publicApi.get<BrandSummary[]>("/catalog/brands", cached([tags.catalog])).catch(() => [] as BrandSummary[]),
);

const FALLBACK_STORE: StoreInfo = {
  name: "Al-Lahiq Building Materials",
  legalName: "Al-Lahiq Building Materials Trading LLC",
  trn: "",
  address: "Dubai, UAE",
  phone: "",
  email: "",
  whatsapp: "",
  cod: { enabled: true, maxFils: 200_000 },
};

export const getStore = cache(() =>
  publicApi.get<StoreInfo>("/content/store", cached([tags.content])).catch(() => FALLBACK_STORE),
);
