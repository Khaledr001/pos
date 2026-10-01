import "server-only";
import { ApiError, type Page } from "@devsfleet/storefront-client";
import { notFound } from "next/navigation";
import { cache } from "react";
import { cached, publicApi, tags } from "./api-server";

/** A published content page or guide; 404s become notFound(). Deduped between metadata and page. */
export const getPage = cache(async (slug: string) => {
  try {
    return await publicApi.get<Page>(`/content/pages/${encodeURIComponent(slug)}`, cached([tags.content, tags.page(slug)]));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
});
