"use client";

import { useEffect, useState } from "react";
import { DEFAULT_TENANT_SETTINGS, type TenantSettings } from "@devsfleet/shared-types";
import { api } from "@/lib/api-client";

let cached: TenantSettings | null = null;
let inflight: Promise<TenantSettings> | null = null;

/**
 * The signed-in business's settings, fetched once per page load.
 *
 * Table headers need the currency and the tax label; hardcoding "VAT (5%)"
 * and "AED" printed the wrong thing for any business that is not a UAE one
 * at 5%. Every user may read `/tenant` — see the controller.
 *
 * Until it answers, the defaults stand in rather than nothing, so a header
 * never renders blank.
 */
export function useTenantSettings(): TenantSettings {
  const [settings, setSettings] = useState<TenantSettings>(cached ?? DEFAULT_TENANT_SETTINGS);

  useEffect(() => {
    if (cached) return;
    inflight ??= api
      .get<{ settings: TenantSettings }>("/tenant")
      .then((tenant) => (cached = tenant.settings))
      .catch(() => {
        // Not worth an error banner on every list page; try again on the next mount.
        inflight = null;
        return DEFAULT_TENANT_SETTINGS;
      });
    let live = true;
    void inflight.then((s) => live && setSettings(s));
    return () => {
      live = false;
    };
  }, []);

  return settings;
}

/** Forget the cached copy — after the settings page saves, or on sign-out. */
export function invalidateTenantSettings(): void {
  cached = null;
  inflight = null;
}
