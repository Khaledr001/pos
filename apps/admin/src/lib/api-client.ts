import type { ApiResponse, AuthSession, AuthTokens } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";

/**
 * Typed fetch wrapper for the NestJS API.
 *
 * Unwraps the ApiSuccess envelope so callers get `T` directly, and turns an
 * ApiError into a thrown `AppError` carrying the server's stable error code.
 */

const DEFAULT_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";
const TOKEN_KEY = "devsfleet_auth_tokens";
const USER_KEY = "devsfleet_auth_user";
const BASE_URL_OVERRIDE_KEY = "devsfleet_api_base_url";
/** Milliseconds before the access token expires at which we proactively refresh. */
const PROACTIVE_REFRESH_LEAD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Which API this admin build talks to — usually fixed at build time via
 * `NEXT_PUBLIC_API_URL`, but a self-hosted deploy needs to point one
 * already-built static bundle at a backend chosen after the fact (moving to
 * a VPS, a staging vs. production API). The settings page is the only writer
 * of the override; everything that calls the API reads through here so the
 * two can never disagree about which server "save" actually pointed at.
 */
function getBaseUrl(): string {
  if (typeof window === "undefined") return DEFAULT_BASE_URL;
  return localStorage.getItem(BASE_URL_OVERRIDE_KEY)?.trim() || DEFAULT_BASE_URL;
}

export function getApiBaseUrlOverride(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(BASE_URL_OVERRIDE_KEY) ?? "";
}

/** Empty or the default clears the override rather than storing it verbatim. */
export function setApiBaseUrlOverride(url: string): void {
  if (typeof window === "undefined") return;
  const trimmed = url.trim();
  if (!trimmed || trimmed === DEFAULT_BASE_URL) {
    localStorage.removeItem(BASE_URL_OVERRIDE_KEY);
  } else {
    localStorage.setItem(BASE_URL_OVERRIDE_KEY, trimmed);
  }
}

/**
 * One refresh at a time.
 *
 * A dashboard fires half a dozen requests on mount. If each of them noticed a
 * 401 and refreshed independently, the first rotation would revoke the token
 * the others are holding — and the server treats a reused rotated token as a
 * captured one and kills EVERY session for that user. Concurrent refreshes
 * would therefore log the admin out rather than keep them in.
 */
let refreshing: Promise<string | null> | null = null;

/**
 * Called once by AuthProvider so that when tokens are refreshed in the background,
 * React AuthContext state is updated in sync with localStorage.
 */
let onTokensUpdated: ((tokens: AuthTokens) => void) | null = null;

export function setTokensUpdatedCallback(fn: (tokens: AuthTokens) => void): void {
  onTokensUpdated = fn;
}

/**
 * Called once by AuthProvider so that when a refresh fails the React tree
 * is cleaned up BEFORE the browser navigates. Without this, the redirect
 * fires while `user` and `tokens` are still populated in context, producing
 * a "ghost" logged-in UI during navigation — which looks exactly like
 * "authentication failed without logout".
 */
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredCallback(fn: () => void): void {
  onSessionExpired = fn;
}

function readTokens(): AuthTokens | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(TOKEN_KEY);
    return stored ? (JSON.parse(stored) as AuthTokens) : null;
  } catch {
    return null;
  }
}

/**
 * The absolute UTC timestamp (ms) at which the current access token expires.
 *
 * When tokens are stored we record `expiresAt = Date.now() + expiresIn * 1000`
 * alongside the token pair. Auth-context reads this to schedule a proactive
 * refresh before the token actually expires, so components never see a 401.
 */
export function getTokenExpiresAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as AuthTokens & { expiresAt?: number };
    return stored.expiresAt ?? null;
  } catch {
    return null;
  }
}

/** How long (ms) before `expiresAt` to fire the proactive refresh. */
export const PROACTIVE_REFRESH_LEAD = PROACTIVE_REFRESH_LEAD_MS;

/** Wipes the session and clears all stored authentication data. */
export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/**
 * Exchanges the current refresh token for a new access & refresh token pair.
 * Updates localStorage, informs AuthContext via callback, and returns the new accessToken.
 */
export async function refreshAccessToken(): Promise<string | null> {
  const current = readTokens();
  if (!current?.refreshToken) return null;

  try {
    const response = await fetch(`${getBaseUrl()}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as ApiResponse<AuthTokens>;
    if (!payload.success || !payload.data) return null;

    // Persist the new pair with an absolute expiry timestamp so the proactive
    // refresh timer in auth-context can know exactly when to fire next time.
    const withExpiry = {
      ...payload.data,
      expiresAt: Date.now() + (payload.data.expiresIn ?? 900) * 1000,
    };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(withExpiry));
    onTokensUpdated?.(payload.data);
    return payload.data.accessToken;
  } catch {
    return null;
  }
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  /** A FormData body (file upload) is sent as-is — see the `send()` closure below. */
  body?: unknown;
  /** Bearer token. Server components pass it explicitly; browser resolves from localStorage. */
  accessToken?: string;
  query?: Record<string, string | number | boolean | undefined>;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, accessToken: explicitToken, query, headers, ...rest } = options;

  let token = explicitToken ?? readTokens()?.accessToken;

  const url = new URL(`${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  // A FormData body (file upload) must never be JSON-stringified, and must
  // never carry an explicit content-type — fetch sets the multipart boundary
  // itself, and a caller-set header here would be missing it.
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const send = (bearer: string | undefined) =>
    fetch(url, {
      ...rest,
      headers: {
        ...(isFormData ? {} : { "content-type": "application/json" }),
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: isFormData ? (body as FormData) : JSON.stringify(body) }),
    });

  let response = await send(token);

  /**
   * One silent refresh, then one retry.
   *
   * An access token lives fifteen minutes. Without this the admin panel breaks
   * every quarter of an hour — requests failing with "unauthorised" while a
   * valid refresh token sits in storage.
   *
   * We intercept 401 in all client-side browser fetches (excluding auth endpoints).
   */
  const isAuthRoute = path.includes("/auth/login") || path.includes("/auth/refresh");
  if (response.status === 401 && !isAuthRoute && typeof window !== "undefined") {
    refreshing ??= refreshAccessToken().finally(() => {
      refreshing = null;
    });
    const fresh = await refreshing;

    if (fresh) {
      token = fresh;
      response = await send(fresh);

      // If the retried request with a brand-new token is STILL rejected, the
      // session is unrecoverable (e.g. token claims invalid, account deactivated).
      if (response.status === 401) {
        onSessionExpired?.();
        clearSession();
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
        throw new AppError(ERROR_CODES.TOKEN_EXPIRED, "Your session has expired. Sign in again.");
      }
    } else {
      // The refresh token is dead or revoked. Clear React state and redirect.
      onSessionExpired?.();
      clearSession();
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, "Your session has expired. Sign in again.");
    }
  }

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

/**
 * Fetch a binary body (a PDF invoice) rather than the JSON envelope.
 *
 * `apiFetch` cannot serve this: it parses every response as JSON and unwraps
 * `.data`, which turns a PDF into a parse error. This shares the same token
 * and the same single-refresh rule.
 */
export async function apiDownload(
  path: string,
  options: { accessToken?: string } = {},
): Promise<{ blob: Blob; filename: string | null }> {
  let token = options.accessToken ?? readTokens()?.accessToken;
  const url = `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;

  const send = (bearer: string | undefined) =>
    fetch(url, { headers: bearer ? { authorization: `Bearer ${bearer}` } : {} });

  let response = await send(token);

  if (response.status === 401 && typeof window !== "undefined") {
    refreshing ??= refreshAccessToken().finally(() => {
      refreshing = null;
    });
    const fresh = await refreshing;
    if (fresh) {
      token = fresh;
      response = await send(fresh);
      if (response.status === 401) {
        onSessionExpired?.();
        clearSession();
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
        throw new AppError(ERROR_CODES.TOKEN_EXPIRED, "Your session has expired. Sign in again.");
      }
    } else {
      onSessionExpired?.();
      clearSession();
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, "Your session has expired. Sign in again.");
    }
  }

  if (!response.ok) {
    let message = `Download failed (${response.status})`;
    let code: string = ERROR_CODES.INTERNAL_ERROR;
    try {
      const payload = (await response.json()) as ApiResponse<never>;
      if (!payload.success) {
        message = payload.error.message;
        code = payload.error.code;
      }
    } catch {
      // Not JSON — keep the status message.
    }
    throw new AppError(code, message);
  }

  // `filename="INV-...pdf"` out of the Content-Disposition the server set.
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^"]+)"?/.exec(disposition);

  return { blob: await response.blob(), filename: match?.[1] ?? null };
}

/** Hand a fetched blob to the browser as a download, then release the object URL. */
export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick — revoking synchronously can cancel the download
  // in some browsers before it has started reading the blob.
  setTimeout(() => URL.revokeObjectURL(href), 0);
}

/**
 * Opens a PDF Blob directly in the browser's native print preview dialog
 * without forcing the user to save/download the file first.
 */
export function printBlob(blob: Blob, title = "Print Document"): void {
  if (typeof window === "undefined") return;

  const pdfBlob =
    blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
  const blobUrl = URL.createObjectURL(pdfBlob);

  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.setAttribute("title", title);
  iframe.src = blobUrl;

  const cleanup = () => {
    setTimeout(() => {
      iframe.remove();
      URL.revokeObjectURL(blobUrl);
    }, 60000);
  };

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      cleanup();
    } catch {
      // If direct iframe printing is blocked by browser policy, open in a print window
      const printWin = window.open(blobUrl, "_blank");
      if (printWin) {
        printWin.focus();
      }
      cleanup();
    }
  };

  document.body.appendChild(iframe);
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "POST", body }),
  /** File upload — pass a FormData body, e.g. one built with `.append("file", file)`. */
  postForm: <T>(path: string, formData: FormData, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "POST", body: formData }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    apiFetch<T>(path, { ...options, method: "DELETE" }),
};

export const login = (email: string, password: string, tenantSlug?: string) =>
  api.post<AuthSession>("/auth/login", { email, password, tenantSlug });

/**
 * Bare connectivity ping — does NOT use apiFetch.
 *
 * /health is @Public() and needs no auth. Using api.get() here would attach
 * an Authorization header, run the JSON-envelope unwrap, and — crucially —
 * trigger the 401-refresh logic on any network hiccup, burning a refresh
 * attempt on a route that never checks credentials. A plain fetch avoids all
 * of that and keeps health checks free of auth side-effects.
 *
 * Returns true when the server responds with any 2xx, false otherwise.
 */
export async function healthCheck(): Promise<boolean> {
  if (typeof window === "undefined") return true;
  try {
    const res = await fetch(`${getBaseUrl()}/health`, { method: "GET" });
    return res.ok;
  } catch {
    return false;
  }
}
