"use client";

import { qs } from "@al-lahiq/api-client";
import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { adminApi } from "@/lib/api-browser";

/**
 * GET an admin endpoint through React Query. The cache key is
 * ["admin", path, params], so `useInvalidate()(path)` refreshes every
 * query of that endpoint whatever its filters.
 */
export function useAdminQuery<T>(
  path: string,
  params?: Record<string, unknown>,
  options?: Omit<UseQueryOptions<T>, "queryKey" | "queryFn">,
) {
  return useQuery<T>({
    queryKey: ["admin", path, params ?? {}],
    queryFn: () => adminApi.get<T>(`${path}${params ? qs(params) : ""}`),
    ...options,
  });
}

export function useInvalidate() {
  const qc = useQueryClient();
  return (...paths: string[]) => Promise.all(paths.map((p) => qc.invalidateQueries({ queryKey: ["admin", p] })));
}

/** Seed the cache for an endpoint with a mutation's response (e.g. the updated product). */
export function useSetAdminData() {
  const qc = useQueryClient();
  return <T,>(path: string, data: T) => qc.setQueryData(["admin", path, {}], data);
}
