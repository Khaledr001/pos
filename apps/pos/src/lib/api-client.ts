/**
 * Minimal fetch client for the POS browser/dev mode — AND for terminal
 * pairing (RegisterTerminal.tsx / adminLoginForRegistration,
 * fetchBranchesForRegistration, registerDeviceOnServer) even inside the
 * packaged Electron app.
 *
 * Everything else the Electron app does talks to the local SQLite mirror via
 * IPC instead. Pairing is the one exception, and necessarily so: it happens
 * before any device exists, so there is no `device_state.api_url` yet for the
 * main process to hand back — VITE_API_URL, baked in at build time by `vite
 * build`, is the only URL available at that point. See the "Build POS and
 * its workspace dependencies" step in .github/workflows/pos-release.yml,
 * which is what actually sets it for a real installer.
 *
 * Responsibilities:
 *  - Prefix every request with the configured API base URL
 *  - Attach the JWT access token as a Bearer header
 *  - On 401: try one silent refresh, retry, then throw AuthError
 *  - Store / clear tokens in localStorage (same key shape as the admin panel)
 */

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

const TOKEN_KEY = "devsfleet.pos.api_tokens";

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

function readTokens(): TokenPair | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as TokenPair) : null;
  } catch {
    return null;
  }
}

function saveTokens(pair: TokenPair): void {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(pair));
  } catch {
    // Storage full or disabled — not a reason to break.
  }
}

export function clearApiTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function storeApiTokens(pair: TokenPair): void {
  saveTokens(pair);
}

export function getAccessToken(): string | null {
  return readTokens()?.accessToken ?? null;
}

export function getRefreshToken(): string | null {
  return readTokens()?.refreshToken ?? null;
}

/** True while a refresh is in-flight — prevents duplicate 401 → refresh spirals. */
let refreshing: Promise<boolean> | null = null;

async function doRefresh(): Promise<boolean> {
  const pair = readTokens();
  if (!pair) return false;
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: pair.refreshToken }),
    });
    if (!res.ok) {
      clearApiTokens();
      return false;
    }
    const body = (await res.json()) as { accessToken: string; refreshToken: string };
    saveTokens({ accessToken: body.accessToken, refreshToken: body.refreshToken });
    return true;
  } catch {
    clearApiTokens();
    return false;
  }
}

/**
 * Core fetch wrapper.
 *
 * Attaches the Bearer token, handles 401 → refresh → retry once, and
 * throws a typed error for the caller to surface to the cashier.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const url = `${BASE_URL}${path}`;
  let res = await fetch(url, { ...init, headers });

  if (res.status === 401) {
    // Try refreshing once.
    refreshing ??= doRefresh().finally(() => { refreshing = null; });
    const ok = await refreshing;
    if (ok) {
      const newToken = getAccessToken();
      if (newToken) headers.set("Authorization", `Bearer ${newToken}`);
      res = await fetch(url, { ...init, headers });
    }
  }

  if (!res.ok) {
    let message = `API error ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string }; message?: string };
      if (body.error?.message) message = body.error.message;
      else if (body.message) message = body.message;
    } catch {
      // Body not JSON — keep the status message.
    }
    throw new Error(message);
  }

  // 204 No Content — nothing to parse.
  if (res.status === 204) return undefined as unknown as T;

  const json = (await res.json()) as { success?: boolean; data?: T } | T;
  if (json && typeof json === "object" && "data" in json && (json as { success?: boolean }).success === true) {
    return (json as { data: T }).data;
  }
  return json as T;
}

// Convenience helpers that mirror the shape the POS pages expect.

export const apiClient = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
  },
  delete<T = void>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },
};
