import { createHmac, randomBytes } from "node:crypto";

/**
 * Talking to Meta's Graph API on behalf of the setup wizard, and turning
 * what it says back into something a shop owner can act on.
 *
 * Kept free of Nest and the database so the parts that decide what an
 * operator reads — the error mapping above all — are plain functions with
 * specs. A wizard that says "OAuthException 190/463" teaches nobody anything;
 * one that says "this token expired, make a permanent one" gets the shop live.
 */

/** Same pin as the send path — see `GRAPH_API_VERSION` in whatsapp.service.ts. */
export const GRAPH_API_VERSION = "v23.0";
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/** Meta answers in well under a second; ten is generous and still keeps the wizard responsive. */
const GRAPH_TIMEOUT_MS = 10_000;

/** The path our webhook is served on. A callback anywhere else would never be answered. */
export const WEBHOOK_PATH = "/api/v1/whatsapp/webhook";

/**
 * `appsecret_proof`: HMAC-SHA256 of the access token, keyed by the app secret.
 *
 * Sent on every wizard call so a wrong app secret fails NOW, with a message,
 * instead of later as a webhook that silently rejects every signature.
 */
export function appSecretProof(accessToken: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

/**
 * The token Meta echoes back on its subscription handshake. Generated rather
 * than asked for: an operator inventing one picks "test123", and they never
 * need to remember it — the wizard shows it when it has to be pasted.
 */
export function generateVerifyToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A callback Meta can call, on our webhook path, over HTTPS. */
export function isValidCallbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.pathname.replace(/\/+$/, "") === WEBHOOK_PATH && !parsed.search;
  } catch {
    return false;
  }
}

// ── Errors ──────────────────────────────────────────────────────────────────

export type GraphProblemKind =
  | "token_invalid"
  | "token_expired"
  | "wrong_app_secret"
  | "not_found"
  | "missing_permission"
  | "rate_limited"
  | "callback_unreachable"
  | "meta_unavailable"
  | "network"
  | "unknown";

export interface GraphProblem {
  kind: GraphProblemKind;
  /** What happened and what to do, in words a shop owner reads once and understands. */
  message: string;
  /** Meta's reference for this request — what their support asks for. */
  fbtraceId?: string;
  /** Meta's own text, for whoever ends up debugging it. Never shown as the headline. */
  detail?: string;
}

interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

/**
 * Meta's error → a sentence. `what` names the thing being looked up ("the
 * phone number ID 123…") so a not-found says which value was wrong.
 */
export function describeGraphError(error: GraphErrorBody | null | undefined, what = "that item"): GraphProblem {
  const code = error?.code;
  const sub = error?.error_subcode;
  const text = error?.message ?? "";
  const base = { fbtraceId: error?.fbtrace_id, detail: text || undefined };

  // Checked before 190 and 100: Meta reports a bad proof as either code.
  if (/appsecret_proof/i.test(text)) {
    return {
      ...base,
      kind: "wrong_app_secret",
      message:
        "The app secret doesn't match this access token. Copy the App secret again from your Meta app → App settings → Basic, and make sure the token was generated in the same app.",
    };
  }

  if (code === 190) {
    // 463 = expired; 460 = password changed; 467 = invalid/logged out.
    if (sub === 463 || /expired/i.test(text)) {
      return {
        ...base,
        kind: "token_expired",
        message:
          "This access token has expired. Temporary tokens from the API Setup page last only 24 hours — generate a permanent one under Business Settings → System users → Generate new token.",
      };
    }
    return {
      ...base,
      kind: "token_invalid",
      message:
        "Meta doesn't accept this access token. Check you copied all of it, or generate a permanent System User token under Business Settings → System users.",
    };
  }

  // 10 and the whole 200–299 block (200, 294, …) are Meta's permission errors.
  if (code === 10 || (code !== undefined && code >= 200 && code <= 299)) {
    return {
      ...base,
      kind: "missing_permission",
      message:
        "This token is missing a permission. When generating it, tick whatsapp_business_messaging and whatsapp_business_management, and assign the WhatsApp account to the system user.",
    };
  }

  if (code === 100 && (sub === 33 || /does not exist|cannot be loaded|Unknown path/i.test(text))) {
    return {
      ...base,
      kind: "not_found",
      message: `Meta can't find ${what}, or this token has no access to it. Copy the Phone number ID from WhatsApp → API Setup (it's a long number, not the phone number itself).`,
    };
  }

  // Meta calls the callback before saving a webhook subscription; 2200 is that call failing.
  if (code === 2200 || /callback verification failed/i.test(text)) {
    return {
      ...base,
      kind: "callback_unreachable",
      message:
        "Meta couldn't reach your server to confirm the webhook. The address must be public HTTPS that Meta can call — a local or private address won't work.",
    };
  }

  if (code === 4 || code === 17 || code === 32 || code === 613 || code === 80007) {
    return {
      ...base,
      kind: "rate_limited",
      message: "Meta is limiting requests right now. Wait a minute and try again.",
    };
  }

  if (code === 1 || code === 2) {
    return {
      ...base,
      kind: "meta_unavailable",
      message: "Meta had a temporary problem. Try again in a moment.",
    };
  }

  return {
    ...base,
    kind: "unknown",
    message: text
      ? `Meta refused the request: ${text}`
      : "Meta refused the request without saying why. Try again, and contact support with the reference below if it keeps happening.",
  };
}

export function networkProblem(error: unknown): GraphProblem {
  const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
  return {
    kind: "network",
    message: timedOut
      ? "Meta didn't answer within 10 seconds. Check this server's internet connection and try again."
      : "This server couldn't reach Meta. Check its internet connection and try again.",
    detail: error instanceof Error ? error.message : undefined,
  };
}

// ── Calls ───────────────────────────────────────────────────────────────────

export type GraphResult<T> = { ok: true; data: T } | { ok: false; problem: GraphProblem; status?: number };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * One Graph call. Never throws — the wizard reports each step's outcome, and
 * an exception would lose which step failed. Tokens travel in the
 * Authorization header, not the URL, so they stay out of any proxy log.
 */
export async function graphCall<T>(
  path: string,
  options: {
    accessToken: string;
    appSecret?: string;
    method?: "GET" | "POST";
    params?: Record<string, string>;
    what?: string;
    fetchImpl?: FetchLike;
  },
): Promise<GraphResult<T>> {
  const url = new URL(`${GRAPH_BASE}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(options.params ?? {})) url.searchParams.set(k, v);
  if (options.appSecret) url.searchParams.set("appsecret_proof", appSecretProof(options.accessToken, options.appSecret));

  try {
    const response = await (options.fetchImpl ?? fetch)(url.toString(), {
      method: options.method ?? "GET",
      headers: { authorization: `Bearer ${options.accessToken}` },
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as (T & { error?: GraphErrorBody }) | null;
    if (!response.ok || body?.error) {
      return { ok: false, status: response.status, problem: describeGraphError(body?.error, options.what) };
    }
    return { ok: true, data: body as T };
  } catch (error) {
    return { ok: false, problem: networkProblem(error) };
  }
}

// ── Token introspection ─────────────────────────────────────────────────────

export interface TokenInfo {
  appId: string | null;
  isValid: boolean;
  /** Null when the token never expires (Meta reports 0). */
  expiresAt: Date | null;
  scopes: string[];
  /** WhatsApp Business Account ids this token was granted on. */
  wabaIds: string[];
}

interface DebugTokenData {
  data?: {
    app_id?: string;
    is_valid?: boolean;
    expires_at?: number;
    scopes?: string[];
    granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>;
  };
}

export function parseDebugToken(body: DebugTokenData): TokenInfo {
  const d = body.data ?? {};
  const wabaIds = new Set<string>();
  for (const g of d.granular_scopes ?? []) {
    if (g.scope === "whatsapp_business_management" || g.scope === "whatsapp_business_messaging") {
      for (const id of g.target_ids ?? []) wabaIds.add(id);
    }
  }
  return {
    appId: d.app_id ?? null,
    isValid: d.is_valid ?? false,
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000) : null,
    scopes: d.scopes ?? [],
    wabaIds: [...wabaIds],
  };
}

/** The two permissions a token needs for everything this module does. */
export const REQUIRED_SCOPES = ["whatsapp_business_messaging", "whatsapp_business_management"] as const;

export function missingScopes(scopes: string[]): string[] {
  return REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
}
