"use client";

import type { SiteFeatures, SiteSettings, StorefrontRegion } from "@devsfleet/shared-types";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeFormat, type StoreFormat, type StoreFormatter } from "./format";

const StoreConfigContext = createContext<StoreFormatter | null>(null);
const SiteContext = createContext<{ site: SiteSettings; features: SiteFeatures } | null>(null);

/**
 * The shop's currency, locale, timezone and delivery zones for client
 * components. Fed by the root layout from the API, so one build serves every
 * tenant without any of it being baked in.
 */
export function StoreConfigProvider({
  currency,
  locale,
  timezone,
  region,
  site,
  features,
  children,
}: StoreFormat & { region: StorefrontRegion; site: SiteSettings; features: SiteFeatures; children: ReactNode }) {
  const value = useMemo(() => makeFormat({ currency, locale, timezone, region }), [currency, locale, timezone, region]);
  const siteValue = useMemo(() => ({ site, features }), [site, features]);
  return (
    <StoreConfigContext.Provider value={value}>
      <SiteContext.Provider value={siteValue}>{children}</SiteContext.Provider>
    </StoreConfigContext.Provider>
  );
}

/** What this site is (shop, catalogue, showcase) and can do, for client components. */
export function useSite() {
  const value = useContext(SiteContext);
  if (!value) throw new Error("useSite must be used inside <StoreConfigProvider>");
  return value;
}

export function useStoreConfig(): StoreFormatter {
  const value = useContext(StoreConfigContext);
  if (!value) throw new Error("useStoreConfig must be used inside <StoreConfigProvider>");
  return value;
}
