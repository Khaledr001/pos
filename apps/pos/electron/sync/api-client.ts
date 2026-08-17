import { getState, setState } from "../db/repositories.js";

/**
 * The only place in the terminal that speaks HTTP.
 *
 * Keeping it in one file is what makes the offline-first rule enforceable:
 * anything else importing `fetch` is a bug that can be found by grep, and the
 * renderer cannot reach this module at all.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  /**
   * A refused request, as opposed to an unreachable server.
   *
   * The distinction decides whether an outbox item is retried or parked: a 4xx
   * will say the same thing on the thousandth attempt.
   */
  get isPermanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch millis. Refreshed slightly early rather than on the first 401. */
  expiresAt: number;
}

let tokens: Tokens | null = null;
let refreshing: Promise<void> | null = null;

export function apiUrl(): string | null {
  return getState("api_url") ?? process.env.VITE_API_URL ?? "http://localhost:3001/api/v1";
}

export function deviceId(): string | null {
  return getState("device_id");
}

export function branchId(): string | null {
  return getState("branch_id");
}

export function isAuthenticated(): boolean {
  return tokens !== null || getState("refresh_token") !== null;
}

export function forgetTokens(): void {
  tokens = null;
  setState("refresh_token", null);
}

/**
 * Sign in with a cashier PIN.
 *
 * The terminal, not the cashier, owns the session: the refresh token is stored
 * locally so a till that reboots mid-shift comes back without a login prompt,
 * which at a counter is the difference between a queue and a stoppage.
 */
export async function loginWithPin(pin: string): Promise<{ name: string; permissions: string[] }> {
  const base = requireApiUrl();
  const device = deviceId();
  const branch = branchId();
  if (!device || !branch) throw new Error("This terminal has not been activated yet");

  const response = await request<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: { name: string; permissions: string[] };
  }>(`${base}/auth/pin-login`, {
    method: "POST",
    body: JSON.stringify({ pin, deviceId: device, branchId: branch }),
  });

  storeTokens(response.accessToken, response.refreshToken, response.expiresIn);
  return response.user;
}

function storeTokens(accessToken: string, refreshToken: string, expiresIn: number): void {
  tokens = {
    accessToken,
    refreshToken,
    // Sixty seconds of slack: a token that expires mid-flight fails the push it
    // was carrying, and that push may be a day's takings.
    expiresAt: Date.now() + Math.max(0, expiresIn - 60) * 1000,
  };
  setState("refresh_token", refreshToken);
}

async function ensureAccessToken(): Promise<string> {
  if (tokens && Date.now() < tokens.expiresAt) return tokens.accessToken;

  // One refresh at a time. Two concurrent refreshes race, and the loser's
  // rotated token is already revoked by the time it is stored.
  refreshing ??= refreshTokens().finally(() => {
    refreshing = null;
  });
  await refreshing;

  if (!tokens) throw new Error("This terminal is signed out. Sign in with a PIN.");
  return tokens.accessToken;
}

async function refreshTokens(): Promise<void> {
  const stored = tokens?.refreshToken ?? getState("refresh_token");
  if (!stored) throw new Error("This terminal is signed out. Sign in with a PIN.");

  try {
    const response = await request<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }>(`${requireApiUrl()}/auth/refresh`, {
      method: "POST",
      body: JSON.stringify({ refreshToken: stored }),
    });
    storeTokens(response.accessToken, response.refreshToken, response.expiresIn);
  } catch (error) {
    // A rejected refresh token is final — clear it, or every subsequent cycle
    // burns a request re-proving the same thing.
    if (error instanceof ApiError && error.isPermanent) forgetTokens();
    throw error;
  }
}

export async function authorized<T>(path: string, body: unknown): Promise<T> {
  const accessToken = await ensureAccessToken();
  return request<T>(`${requireApiUrl()}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

/**
 * Liveness only. Deliberately unauthenticated, so it works while signed out.
 *
 * The probe lives at the ORIGIN, not under the configured base: the API keeps
 * `/health` outside its version prefix so a load balancer never has to know
 * the API version. Appending it to the prefixed base yields a 404, which reads
 * as "offline" — and a terminal that believes it is offline while the server
 * is up never syncs and never says why.
 */
export async function ping(): Promise<boolean> {
  const base = apiUrl();
  if (!base) return false;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(new URL("/health", base), { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}

function requireApiUrl(): string {
  const base = apiUrl();
  if (!base) throw new Error("No server address is configured on this terminal");
  return base.replace(/\/+$/, "");
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  /**
   * A hard timeout on every call.
   *
   * Without one, a captive-portal WiFi that accepts connections and never
   * answers leaves the sync cycle hanging forever, and the status bar keeps
   * claiming it is syncing while nothing moves.
   */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok || parsed.success === false) {
    const error = (parsed.error ?? {}) as { code?: string; message?: string };
    throw new ApiError(
      response.status,
      error.code ?? "UNKNOWN",
      error.message ?? `Request failed with ${response.status}`,
    );
  }

  // The API wraps every response in { success, data }.
  return (parsed.data ?? parsed) as T;
}
