import "server-only";
import type { SiteFeatures } from "@devsfleet/storefront-client";
import { notFound } from "next/navigation";
import { getStore } from "./data";

/**
 * 404 a route this site does not use (a catalogue site has no cart, a company
 * site has no products). The navigation already hides the links; this keeps a
 * typed URL or an old bookmark from rendering a shop page on a site that is
 * not one. The API refuses the same calls — this is the matching page-level
 * answer, not the control.
 */
export async function requireFeature(feature: keyof SiteFeatures): Promise<void> {
  const { features } = await getStore();
  if (!features[feature]) notFound();
}
