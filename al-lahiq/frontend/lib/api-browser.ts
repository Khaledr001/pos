import { ApiError, createApiClient } from "@al-lahiq/api-client";

/**
 * Browser API client. Requests go to this origin (/api/v1 is rewritten to the
 * NestJS API), so auth cookies are first-party. On a 401 it renews the
 * session once and retries.
 */
function makeClient(refreshPath: string) {
  let refreshing: Promise<boolean> | null = null;

  const refresh = () => {
    refreshing ??= fetch(`/api/v1${refreshPath}`, { method: "POST", credentials: "include" })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => (refreshing = null), 0);
      });
    return refreshing;
  };

  const refreshingFetch: typeof fetch = async (input, init) => {
    const res = await fetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (res.status !== 401 || url.includes("/auth/")) return res;
    return (await refresh()) ? fetch(input, init) : res;
  };

  return createApiClient({ baseUrl: "/api/v1", fetch: refreshingFetch });
}

export const api = makeClient("/auth/refresh");
export const adminApi = makeClient("/auth/staff/refresh");

/** A message to show the user for any thrown error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "VALIDATION_FAILED" && Array.isArray(err.details)) {
      return (err.details as string[]).map(humanizeValidation).join(". ");
    }
    return err.message;
  }
  return "Something went wrong. Check your connection and try again.";
}

function humanizeValidation(msg: string) {
  // "address.street must be longer than..." → "Street must be longer than..."
  const cleaned = msg.replace(/^[\w.]*\.(\w+)/, "$1").replace(/^(\w)/, (c) => c.toUpperCase());
  return cleaned.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export { ApiError };
