"use client";

import { useCallback, useEffect, useState } from "react";
import type { StorefrontSettings } from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import type { PlatformDomain } from "./shop-address";
import { errorText } from "./shared";

export interface StoreOverview {
  planAllows: boolean;
  platform?: PlatformDomain;
  storefront: { id: string; name: string; isActive: boolean } | null;
  settings?: StorefrontSettings;
  domains?: { id: string; domain: string; isPrimary: boolean }[];
}

/**
 * The storefront's settings document for the screens that edit one block of
 * it (appearance, home page, navigation). Each saves only the block it owns,
 * so two tabs open at once cannot overwrite each other's changes.
 */
export function useStoreSettings() {
  const { tokens } = useAuth();
  const [overview, setOverview] = useState<StoreOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await api.get<StoreOverview>("/storefront-admin/settings", { accessToken: tokens?.accessToken }));
    } catch (err) {
      setError(errorText(err, "Failed to load the online store."));
    } finally {
      setLoading(false);
    }
  }, [tokens]);

  useEffect(() => {
    void load();
  }, [load]);

  /** True when the server accepted the change, so a caller only resets its draft on success. */
  const patch = useCallback(
    async (body: Partial<StorefrontSettings>, done: string): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        setOverview(await api.patch<StoreOverview>("/storefront-admin/settings", body, { accessToken: tokens?.accessToken }));
        setSuccess(done);
        return true;
      } catch (err) {
        setError(errorText(err, "That change was refused."));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [tokens],
  );

  return { overview, settings: overview?.settings ?? null, loading, saving, error, success, setError, setSuccess, patch, reload: load };
}
