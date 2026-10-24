import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import {
  graphCall,
  isValidCallbackUrl,
  missingScopes,
  parseDebugToken,
  WEBHOOK_PATH,
  type FetchLike,
  type GraphProblem,
  type TokenInfo,
} from "./meta-graph.js";

/**
 * The guided connection: check pasted credentials against Meta before they
 * are saved, then wire Meta's webhook to us without the operator touching
 * Meta's App Dashboard.
 *
 * A failed check is an ANSWER, not an error — it comes back as `ok: false`
 * with a plain-language problem, because "your token expired" is exactly what
 * the wizard exists to tell someone. AppError is kept for requests that are
 * wrong in themselves (a bad callback URL, an account that does not exist).
 */

export type CheckStep = "token" | "phone_number" | "business_account";

export interface ConnectionCheck {
  ok: boolean;
  problem?: GraphProblem & { step: CheckStep };
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  businessAccountId: string | null;
  appId: string | null;
  qualityRating: string | null;
  codeVerificationStatus: string | null;
  nameStatus: string | null;
  platformType: string | null;
  /** ISO time, or null when the token never expires (or Meta wouldn't say). */
  tokenExpiresAt: string | null;
  /** True only when Meta confirmed the token never expires. */
  tokenNeverExpires: boolean;
  missingPermissions: string[];
  /** Null when it couldn't be checked (no business account id, or no permission). */
  webhookSubscribed: boolean | null;
  /** The business account couldn't be worked out; the wizard asks for it. */
  needsBusinessAccountId: boolean;
  warnings: string[];
}

export interface CredentialsInput {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  businessAccountId?: string | undefined;
}

interface PhoneNumberNode {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  platform_type?: string;
}

export type HealthState = "connected" | "token_expiring" | "token_invalid" | "webhook_not_subscribed" | "error";

/** Inside this window an expiring token is flagged, so it is replaced before replies stop. */
const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class WhatsappSetupService {
  /** Swappable in specs; the real `fetch` everywhere else. */
  fetchImpl: FetchLike | undefined;

  constructor(
    private readonly db: TenantDatabase,
    @Optional() private readonly config?: ConfigService<Env, true>,
  ) {}

  /**
   * The secret Meta signs this account's calls with: its own for a manual
   * number, DevsFleet's app secret for one connected by Embedded Signup.
   */
  private secretFor(account: { connectionMethod: string; appSecret: string | null }): string {
    const secret =
      account.connectionMethod === "embedded"
        ? this.config?.get("META_APP_SECRET", { infer: true })?.trim()
        : account.appSecret;
    if (!secret) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        account.connectionMethod === "embedded"
          ? "This number was connected through Meta sign-in, but META_APP_SECRET isn't set on this server."
          : "This number has no app secret saved. Update its token to add one.",
      );
    }
    return secret;
  }

  private refuseEmbedded(account: { connectionMethod: string }, action: string): void {
    if (account.connectionMethod === "embedded") {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `This number was connected through Meta sign-in, so ${action} is handled by Meta. Reconnect it from "Connect WhatsApp" if it stops working.`,
      );
    }
  }

  async testConnection(input: CredentialsInput): Promise<ConnectionCheck> {
    const { accessToken, appSecret } = input;
    const phoneNumberId = input.phoneNumberId.trim();
    const result: ConnectionCheck = {
      ok: false,
      displayPhoneNumber: null,
      verifiedName: null,
      businessAccountId: input.businessAccountId?.trim() || null,
      appId: null,
      qualityRating: null,
      codeVerificationStatus: null,
      nameStatus: null,
      platformType: null,
      tokenExpiresAt: null,
      tokenNeverExpires: false,
      missingPermissions: [],
      webhookSubscribed: null,
      needsBusinessAccountId: false,
      warnings: [],
    };
    const call = <T>(path: string, opts: { params?: Record<string, string>; what?: string } = {}) =>
      graphCall<T>(path, { accessToken, appSecret, fetchImpl: this.fetchImpl, ...opts });

    // 1. The token itself. A token may debug itself; if Meta refuses that for
    //    this token type, carry on — the phone lookup will still judge it.
    let token: TokenInfo | null = null;
    const debug = await call<Parameters<typeof parseDebugToken>[0]>("debug_token", {
      params: { input_token: accessToken },
    });
    if (debug.ok) {
      token = parseDebugToken(debug.data);
      if (!token.isValid) {
        result.problem = {
          step: "token",
          kind: "token_invalid",
          message:
            "Meta says this access token is no longer valid. Generate a permanent one under Business Settings → System users → Generate new token.",
        };
        return result;
      }
      result.appId = token.appId;
      result.tokenExpiresAt = token.expiresAt?.toISOString() ?? null;
      result.tokenNeverExpires = token.expiresAt === null;
      result.missingPermissions = token.scopes.length ? missingScopes(token.scopes) : [];
    } else if (["token_invalid", "token_expired", "wrong_app_secret", "network"].includes(debug.problem.kind)) {
      result.problem = { ...debug.problem, step: "token" };
      return result;
    } else {
      result.warnings.push("Couldn't read this token's details from Meta, so its expiry and permissions weren't checked.");
    }

    if (result.missingPermissions.includes("whatsapp_business_messaging")) {
      result.problem = {
        step: "token",
        kind: "missing_permission",
        message:
          "This token can't send messages. Generate it again with the whatsapp_business_messaging permission ticked, and assign the WhatsApp account to the system user.",
      };
      return result;
    }
    if (result.missingPermissions.includes("whatsapp_business_management")) {
      result.warnings.push(
        "This token lacks whatsapp_business_management, so the webhook can't be connected automatically. Add it when you next generate the token, or connect the webhook by hand.",
      );
    }
    if (result.tokenExpiresAt) {
      result.warnings.push(
        `This token expires on ${new Date(result.tokenExpiresAt).toUTCString()}. Replies will stop then — use a permanent System User token instead.`,
      );
    }

    // 2. The phone number.
    const phone = await call<PhoneNumberNode>(phoneNumberId, {
      params: {
        fields: "display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type",
      },
      what: `the phone number ID ${phoneNumberId}`,
    });
    if (!phone.ok) {
      result.problem = { ...phone.problem, step: "phone_number" };
      return result;
    }
    result.displayPhoneNumber = phone.data.display_phone_number ?? null;
    result.verifiedName = phone.data.verified_name ?? null;
    result.qualityRating = phone.data.quality_rating ?? null;
    result.codeVerificationStatus = phone.data.code_verification_status ?? null;
    result.nameStatus = phone.data.name_status ?? null;
    result.platformType = phone.data.platform_type ?? null;
    if (result.platformType && result.platformType !== "CLOUD_API") {
      result.warnings.push(
        "This number isn't registered on the Cloud API yet. Register it in WhatsApp → API Setup before customers can message it.",
      );
    }

    // 3. Which WhatsApp Business Account owns it.
    const ownsNumber = async (waba: string): Promise<boolean | GraphProblem> => {
      const numbers = await call<{ data?: Array<{ id?: string }> }>(`${waba}/phone_numbers`, {
        params: { fields: "id", limit: "100" },
        what: `the business account ${waba}`,
      });
      if (!numbers.ok) return numbers.problem;
      return (numbers.data.data ?? []).some((n) => n.id === phoneNumberId);
    };

    if (result.businessAccountId) {
      const owns = await ownsNumber(result.businessAccountId);
      if (owns !== true) {
        result.problem = {
          step: "business_account",
          ...(owns === false
            ? {
                kind: "not_found" as const,
                message: `The business account ${result.businessAccountId} doesn't own this phone number. Copy the WhatsApp Business Account ID shown above the phone number in WhatsApp → API Setup.`,
              }
            : owns),
        };
        return result;
      }
    } else {
      for (const waba of (token?.wabaIds ?? []).slice(0, 5)) {
        if ((await ownsNumber(waba)) === true) {
          result.businessAccountId = waba;
          break;
        }
      }
      if (!result.businessAccountId) {
        result.needsBusinessAccountId = true;
        result.warnings.push(
          "Couldn't work out which WhatsApp Business Account owns this number. Paste its ID (WhatsApp → API Setup, above the phone number) so the webhook can be connected.",
        );
      }
    }

    // 4. Is our app subscribed to that account's webhooks?
    if (result.businessAccountId) {
      result.webhookSubscribed = await this.isAppSubscribed(result.businessAccountId, result.appId, accessToken, appSecret);
    }

    result.ok = true;
    return result;
  }

  private async isAppSubscribed(
    waba: string,
    appId: string | null,
    accessToken: string,
    appSecret: string,
  ): Promise<boolean | null> {
    const subs = await graphCall<{ data?: Array<{ whatsapp_business_api_data?: { id?: string } }> }>(
      `${waba}/subscribed_apps`,
      { accessToken, appSecret, fetchImpl: this.fetchImpl },
    );
    if (!subs.ok) return null;
    const apps = subs.data.data ?? [];
    return appId ? apps.some((a) => a.whatsapp_business_api_data?.id === appId) : apps.length > 0;
  }

  /**
   * Point the app's webhook at us and subscribe the business account to it.
   *
   * Meta verifies the callback synchronously — it calls our GET webhook with
   * this account's verify token before answering — so a successful first step
   * proves the handshake end to end.
   */
  async connectWebhook(id: string, callbackUrl: string) {
    if (!isValidCallbackUrl(callbackUrl)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `The callback URL must be public HTTPS and end with ${WEBHOOK_PATH}.`,
      );
    }
    const account = await this.requireAccount(id);
    this.refuseEmbedded(account, "its webhook");
    const appSecret = this.secretFor(account);
    const manual = { callbackUrl, verifyToken: account.verifyToken ?? "" };
    const steps: Array<{ key: "app_webhook" | "account_subscription"; ok: boolean; message: string; problem?: GraphProblem }> = [];

    const debug = await graphCall<Parameters<typeof parseDebugToken>[0]>("debug_token", {
      accessToken: account.accessToken,
      appSecret,
      params: { input_token: account.accessToken },
      fetchImpl: this.fetchImpl,
    });
    const appId = debug.ok ? parseDebugToken(debug.data).appId : null;

    if (!appId) {
      steps.push({
        key: "app_webhook",
        ok: false,
        message: "Couldn't identify the Meta app this token belongs to, so its webhook can't be set automatically.",
        ...(debug.ok ? {} : { problem: debug.problem }),
      });
    } else {
      // The app's own token: subscriptions are an app setting, not a business one.
      const sub = await graphCall<{ success?: boolean }>(`${appId}/subscriptions`, {
        method: "POST",
        accessToken: `${appId}|${appSecret}`,
        params: {
          object: "whatsapp_business_account",
          callback_url: callbackUrl,
          verify_token: account.verifyToken ?? "",
          fields: "messages",
          include_values: "true",
        },
        fetchImpl: this.fetchImpl,
      });
      steps.push(
        sub.ok
          ? { key: "app_webhook", ok: true, message: "Meta reached your server and accepted the webhook." }
          : {
              key: "app_webhook",
              ok: false,
              message:
                sub.problem.kind === "callback_unreachable"
                  ? `Meta couldn't reach your server at ${callbackUrl}. It must be public HTTPS that Meta can call — a local or private address won't work.`
                  : sub.problem.message,
              problem: sub.problem,
            },
      );
    }

    if (!account.businessAccountId) {
      steps.push({
        key: "account_subscription",
        ok: false,
        message: "No WhatsApp Business Account ID is saved for this number, so it can't be subscribed. Add it and try again.",
      });
    } else {
      const subscribe = await graphCall<{ success?: boolean }>(`${account.businessAccountId}/subscribed_apps`, {
        method: "POST",
        accessToken: account.accessToken,
        appSecret,
        what: `the business account ${account.businessAccountId}`,
        fetchImpl: this.fetchImpl,
      });
      steps.push(
        subscribe.ok
          ? { key: "account_subscription", ok: true, message: "Your WhatsApp account now sends its messages to this app." }
          : { key: "account_subscription", ok: false, message: subscribe.problem.message, problem: subscribe.problem },
      );
    }

    return { ok: steps.every((s) => s.ok), steps, manual };
  }

  /** A saved account re-checked, summed up as one health state for its badge. */
  async status(id: string): Promise<{ health: HealthState; check: ConnectionCheck }> {
    const account = await this.requireAccount(id);
    const check = await this.testConnection({
      accessToken: account.accessToken,
      appSecret: this.secretFor(account),
      phoneNumberId: account.phoneNumberId,
      businessAccountId: account.businessAccountId ?? undefined,
    });
    return { health: healthOf(check), check };
  }

  /** The wizard's check for a saved number, with stored values filling any gap. */
  async retest(
    id: string,
    input: { accessToken?: string | undefined; appSecret?: string | undefined; businessAccountId?: string | undefined },
  ): Promise<ConnectionCheck> {
    const account = await this.requireAccount(id);
    this.refuseEmbedded(account, "its token");
    return this.testConnection({
      accessToken: input.accessToken ?? account.accessToken,
      appSecret: input.appSecret ?? this.secretFor(account),
      phoneNumberId: account.phoneNumberId,
      businessAccountId: input.businessAccountId ?? account.businessAccountId ?? undefined,
    });
  }

  /** Meta's view of a number, for filling the display number and account on save. */
  async enrich(input: CredentialsInput): Promise<{ displayPhoneNumber?: string; businessAccountId?: string }> {
    const check = await this.testConnection(input);
    return {
      ...(check.displayPhoneNumber ? { displayPhoneNumber: check.displayPhoneNumber.slice(0, 20) } : {}),
      ...(check.businessAccountId ? { businessAccountId: check.businessAccountId } : {}),
    };
  }

  private async requireAccount(id: string) {
    const account = await this.db.run((tx) =>
      tx.query.whatsappAccounts.findFirst({ where: (t, { eq: e }) => e(t.id, id) }),
    );
    if (!account) throw new AppError(ERROR_CODES.NOT_FOUND, "No such WhatsApp account.");
    return account;
  }
}

export function healthOf(check: ConnectionCheck, now = Date.now()): HealthState {
  if (!check.ok) {
    return check.problem?.kind === "token_invalid" || check.problem?.kind === "token_expired" || check.problem?.kind === "wrong_app_secret"
      ? "token_invalid"
      : "error";
  }
  if (check.tokenExpiresAt && new Date(check.tokenExpiresAt).getTime() - now < EXPIRY_WARNING_MS) return "token_expiring";
  if (check.webhookSubscribed === false) return "webhook_not_subscribed";
  return "connected";
}
