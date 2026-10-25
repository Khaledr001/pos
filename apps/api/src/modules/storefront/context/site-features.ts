import { resolveSiteFeatures, type SiteFeatures } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { RequestContext } from "../../../common/context/request-context.js";

export type SiteFeatureKey = keyof SiteFeatures;

/**
 * What this request's site can do. Derived from the storefront's `site`
 * settings by `resolveSiteFeatures` — the one place those flags are decided —
 * so the storefront's navigation and this check can never disagree.
 */
export function siteFeatures(): SiteFeatures {
  return resolveSiteFeatures(RequestContext.requireStorefront().settings.site);
}

/**
 * The control behind every hidden menu item: a catalogue site's cart route
 * refuses whatever the browser sends (rule 9). A neutral 404, so the response
 * does not describe which mode the shop runs.
 */
export function assertSiteFeature(...needed: SiteFeatureKey[]): void {
  const features = siteFeatures();
  if (needed.some((key) => !features[key])) {
    throw new AppError(ERROR_CODES.STORE_FEATURE_DISABLED, "That is not available on this site.");
  }
}
