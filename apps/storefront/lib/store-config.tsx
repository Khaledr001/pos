"use client";

import type { StorefrontRegion } from "@devsfleet/shared-types";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { makeFormat, type StoreFormat, type StoreFormatter } from "./format";

const StoreConfigContext = createContext<StoreFormatter | null>(null);

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
  children,
}: StoreFormat & { region: StorefrontRegion; children: ReactNode }) {
  const value = useMemo(() => makeFormat({ currency, locale, timezone, region }), [currency, locale, timezone, region]);
  return <StoreConfigContext.Provider value={value}>{children}</StoreConfigContext.Provider>;
}

export function useStoreConfig(): StoreFormatter {
  const value = useContext(StoreConfigContext);
  if (!value) throw new Error("useStoreConfig must be used inside <StoreConfigProvider>");
  return value;
}
