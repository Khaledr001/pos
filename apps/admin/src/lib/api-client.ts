import type { ApiResponse, AuthSession, AuthTokens } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";

/**
 * Typed fetch wrapper for the NestJS API.
 *
 * Unwraps the ApiSuccess envelope so callers get `T` directly, and turns an
 * ApiError into a thrown `AppError` carrying the server's stable error code.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
const TOKEN_KEY = "devsfleet_auth_tokens";

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Bearer token. Server components pass it explicitly; browser resolves from localStorage. */
  accessToken?: string;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, accessToken: explicitToken, query, headers, ...rest } = options;

  let token = explicitToken;
  if (!token && typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem(TOKEN_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as AuthTokens;
        token = parsed.accessToken;
      }
    } catch {
      // Ignore parse errors
    }
  }

  const url = new URL(`${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response = await fetch(url, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  // 204 has no body to parse.
  if (response.status === 204) return undefined as T;

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      `Server returned ${response.status} with an unreadable body`,
    );
  }

  if (!payload.success) {
    throw new AppError(payload.error.code, payload.error.message, {
      ...payload.error.details,
      requestId: payload.requestId,
    });
  }

  return payload.data;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "DELETE" }),
};

export const login = (email: string, password: string, tenantSlug?: string) =>
  api.post<AuthSession>("/auth/login", { email, password, tenantSlug });
