import { randomInt } from "node:crypto";
import type { GraphProblem, TokenInfo } from "./meta-graph.js";

/**
 * EVERYTHING META-SPECIFIC ABOUT EMBEDDED SIGNUP AND COEXISTENCE LIVES HERE.
 *
 * These names are Meta's, not ours, and Meta changes them — new session-info
 * versions, renamed feature types, new webhook fields. When a signup stops
 * completing or echoes stop arriving, this file is the first thing to hold up
 * against Meta's current docs:
 *
 *   developers.facebook.com/docs/whatsapp/embedded-signup
 *   developers.facebook.com/docs/whatsapp/embedded-signup/onboarding-business-app-users
 *
 * Each constant notes what it was written against. The browser half (the
 * `extras` passed to FB.login and the message events it listens for) mirrors
 * these in apps/admin/src/app/whatsapp/embedded-signup.tsx — keep them in step.
 */

// ── Embedded Signup (browser side, mirrored in the admin app) ───────────────

/**
 * `extras.featureType` for a number that stays in the WhatsApp Business app.
 * Omitted entirely for an ordinary (new number) signup.
 */
export const COEXISTENCE_FEATURE_TYPE = "whatsapp_business_app_onboarding";

/** `extras.sessionInfoVersion` — which shape the session-info message events take. */
export const SESSION_INFO_VERSION = "3";

/**
 * The `type` of the postMessage events Meta's popup sends the opener, and the
 * `event` values this module understands. A FINISH* event carries
 * `data.phone_number_id` and `data.waba_id`; CANCEL carries `current_step`;
 * ERROR carries `error_message`.
 */
export const SESSION_EVENT_TYPE = "WA_EMBEDDED_SIGNUP";
export const SESSION_EVENTS = {
  finish: "FINISH",
  /** Finished without a phone number — a WABA only. Not enough to connect. */
  finishWabaOnly: "FINISH_ONLY_WABA",
  /** Finished the coexistence (Business app) flow. */
  finishCoexistence: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  cancel: "CANCEL",
  error: "ERROR",
} as const;

// ── Webhook fields ──────────────────────────────────────────────────────────

/**
 * The `changes[].field` values the webhook acts on. The first is every
 * number's; the other three exist only for coexistence numbers and must be
 * subscribed on the platform app (see the operator doc).
 */
export const WEBHOOK_FIELDS = {
  messages: "messages",
  /** A message staff sent from the WhatsApp Business app on their phone. */
  messageEchoes: "smb_message_echoes",
  /** Past chats from the phone app, in chunks, after a history sync request. */
  history: "history",
  /** Contacts from the phone app's address book, after a state sync request. */
  appStateSync: "smb_app_state_sync",
} as const;

// ── Graph endpoints and parameters ──────────────────────────────────────────

/** POST /{phone-number-id}/{SMB_APP_DATA} with `sync_type` — the coexistence sync request. */
export const SMB_APP_DATA_EDGE = "smb_app_data";
export const SMB_SYNC_TYPES = {
  /** Contacts. Answered on the `smb_app_state_sync` webhook field. */
  contacts: "smb_app_state_sync",
  /** Up to ~6 months of chats. Answered on the `history` webhook field. Allowed once, within 24h of onboarding. */
  history: "history",
} as const;

/** POST /{phone-number-id}/register — makes a NEW number live on the Cloud API. Never for coexistence. */
export const REGISTER_EDGE = "register";

// ── Pure helpers ────────────────────────────────────────────────────────────

export interface EmbeddedConfig {
  appId: string;
  appSecret: string;
  configId: string;
  webhookVerifyToken: string;
}

const REQUIRED_ENV = ["META_APP_ID", "META_APP_SECRET", "META_EMBEDDED_SIGNUP_CONFIG_ID", "META_WEBHOOK_VERIFY_TOKEN"] as const;
type RequiredEnv = (typeof REQUIRED_ENV)[number];

/** The platform app's config, or the names still missing. Blank counts as missing. */
export function readEmbeddedConfig(
  get: (key: RequiredEnv) => string | undefined,
): { ok: true; config: EmbeddedConfig } | { ok: false; missing: RequiredEnv[]; invalid?: string } {
  const value = (k: RequiredEnv) => get(k)?.trim() || undefined;
  const missing = REQUIRED_ENV.filter((k) => !value(k));
  if (missing.length > 0) return { ok: false, missing };
  const appId = value("META_APP_ID")!;
  if (!/^\d+$/.test(appId)) return { ok: false, missing: [], invalid: "META_APP_ID must be the numeric app id" };
  return {
    ok: true,
    config: {
      appId,
      appSecret: value("META_APP_SECRET")!,
      configId: value("META_EMBEDDED_SIGNUP_CONFIG_ID")!,
      webhookVerifyToken: value("META_WEBHOOK_VERIFY_TOKEN")!,
    },
  };
}

/** An app access token: what calls the app makes as itself (debug_token, subscriptions). */
export function appAccessToken(config: Pick<EmbeddedConfig, "appId" | "appSecret">): string {
  return `${config.appId}|${config.appSecret}`;
}

/**
 * The `waba_id` and `phone_number_id` arrive from the browser, so they are a
 * claim, not a fact. The token Meta issued for this signup says which
 * business accounts it was actually granted — anything else is refused, or a
 * tampered request could attach someone else's number to this tenant.
 */
export function checkWabaGrant(
  token: TokenInfo,
  expectedAppId: string,
  wabaId: string,
): { ok: true } | { ok: false; reason: string } {
  if (!token.isValid) return { ok: false, reason: "Meta says the token from this signup isn't valid. Start the connection again." };
  if (token.appId && token.appId !== expectedAppId) {
    return { ok: false, reason: "The signup token belongs to a different Meta app. Start the connection again." };
  }
  if (!token.wabaIds.includes(wabaId)) {
    return {
      ok: false,
      reason: "Meta didn't grant access to that WhatsApp account during sign-in. Start the connection again and keep the account selected.",
    };
  }
  return { ok: true };
}

/** The code exchange's own failures, which the generic mapping would call "not found". */
export function describeExchangeError(problem: GraphProblem): GraphProblem {
  if (problem.kind === "network" || problem.kind === "rate_limited" || problem.kind === "meta_unavailable") return problem;
  // The server's own app settings are wrong — retrying won't help the shop.
  if (
    problem.kind === "wrong_app_secret" ||
    /client secret|client_secret|client id|validating application|invalid application/i.test(problem.detail ?? "")
  ) {
    return {
      ...problem,
      kind: "unknown",
      message: "DevsFleet's Meta app isn't set up correctly on this server (app ID or secret), so the sign-in can't be completed. Contact support.",
    };
  }
  return {
    ...problem,
    kind: "token_invalid",
    message:
      "Meta didn't accept the sign-in code — it may have expired or been used already. Close this and start the connection again.",
  };
}

/** A two-step verification PIN for registering a new number. */
export function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Which secret signs this account's webhooks.
 *
 * Chosen by the account the payload names, then CHECKED against the
 * signature, so a forged routing claim gains nothing: the wrong secret simply
 * fails. An embedded account with no platform secret configured has no way
 * to be verified — null, and the caller drops the payload.
 */
export function webhookSecretFor(
  account: { connectionMethod: string; appSecret: string | null },
  platformSecret: string | undefined,
): string | null {
  if (account.connectionMethod === "embedded") return platformSecret?.trim() || null;
  return account.appSecret || null;
}
