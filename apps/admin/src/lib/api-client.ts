import type { ApiResponse, AuthTokens } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";

/**
 * Typed fetch wrapper for the NestJS API.
 *
 * Unwraps the ApiSuccess envelope so callers get `T` directly, and turns an
 * ApiError into a thrown `AppError` carrying the server's stable error code.
 * That means a component can `catch (e) { if (e.code === "CREDIT_LIMIT_EXCEEDED") }`
 * instead of parsing an error message string that may be reworded next week.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Bearer token. Server components pass it explicitly; the browser uses the store. */
  accessToken?: string;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, accessToken, query, headers, ...rest } = options;

  const url = new URL(`${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
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

export const login = (email: string, password: string) =>
  api.post<AuthTokens>("/auth/login", { email, password });
