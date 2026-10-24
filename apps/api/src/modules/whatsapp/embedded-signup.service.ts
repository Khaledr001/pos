import { schema } from "@devsfleet/db";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { assertBranchInScope } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import type { Env } from "../../config/env.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CompleteEmbeddedSignupDto } from "./dto.js";
import {
  appAccessToken,
  checkWabaGrant,
  describeExchangeError,
  generatePin,
  readEmbeddedConfig,
  REGISTER_EDGE,
  SMB_APP_DATA_EDGE,
  SMB_SYNC_TYPES,
  type EmbeddedConfig,
} from "./meta-embedded.js";
import { GRAPH_API_VERSION, graphCall, parseDebugToken, type FetchLike, type GraphProblem } from "./meta-graph.js";

export type SignupStep = "exchange" | "grant" | "phone_number" | "duplicate" | "subscribe" | "register" | "sync" | "save";

export interface SignupStepResult {
  key: SignupStep;
  ok: boolean;
  message: string;
  fbtraceId?: string;
}

export interface EmbeddedSignupResult {
  ok: boolean;
  accountId?: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  coexistence: boolean;
  historySyncRequested: boolean;
  steps: SignupStepResult[];
  /** The step that stopped the connection, when it did not complete. */
  problem?: { step: SignupStep; message: string; fbtraceId?: string };
}

interface PhoneNumberRow {
  id?: string;
  display_phone_number?: string;
  verified_name?: string;
}

/**
 * Embedded Signup: a business connects its WhatsApp number by logging into
 * Meta in a popup, through DevsFleet's own Meta app — nothing to paste.
 *
 * The browser's half ends with a one-time `code` and the ids Meta's popup
 * reported. Everything that matters happens here, server-side: the code is
 * exchanged for a token with the app secret (which never reaches a browser),
 * the token is asked which business account it was really granted, and only
 * then is anything subscribed, registered or saved.
 *
 * Like the manual check, a failed step is an ANSWER (`ok: false` with a
 * plain-language reason); AppError is kept for "this server isn't set up".
 */
@Injectable()
export class EmbeddedSignupService {
  private readonly logger = new Logger(EmbeddedSignupService.name);
  /** Swappable in specs; the real `fetch` everywhere else. */
  fetchImpl: FetchLike | undefined;

  constructor(
    private readonly db: TenantDatabase,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private platform() {
    return readEmbeddedConfig((key) => this.config.get(key, { infer: true }));
  }

  /** What the browser needs to open Meta's popup. Never the secret. */
  getConfig():
    | { enabled: true; appId: string; configId: string; graphVersion: string }
    | { enabled: false; missing: string[]; invalid?: string } {
    const platform = this.platform();
    if (!platform.ok) return { enabled: false, missing: platform.missing, ...(platform.invalid ? { invalid: platform.invalid } : {}) };
    return {
      enabled: true,
      appId: platform.config.appId,
      configId: platform.config.configId,
      graphVersion: GRAPH_API_VERSION,
    };
  }

  async complete(dto: CompleteEmbeddedSignupDto): Promise<EmbeddedSignupResult> {
    const platform = this.platform();
    if (!platform.ok) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        "Connecting through Meta isn't set up on this server yet. Use the manual setup instead.",
      );
    }
    if (dto.defaultBranchId) assertBranchInScope(dto.defaultBranchId);
    const cfg = platform.config;
    const result: EmbeddedSignupResult = {
      ok: false,
      displayPhoneNumber: null,
      verifiedName: null,
      coexistence: dto.coexistence,
      historySyncRequested: false,
      steps: [],
    };
    const fail = (step: SignupStep, problem: Pick<GraphProblem, "message" | "fbtraceId">): EmbeddedSignupResult => {
      result.steps.push({ key: step, ok: false, message: problem.message, ...(problem.fbtraceId ? { fbtraceId: problem.fbtraceId } : {}) });
      result.problem = { step, message: problem.message, ...(problem.fbtraceId ? { fbtraceId: problem.fbtraceId } : {}) };
      return result;
    };

    // 1. The one-time code → a business token for this number.
    const exchange = await graphCall<{ access_token?: string }>("oauth/access_token", {
      accessToken: appAccessToken(cfg),
      params: { client_id: cfg.appId, client_secret: cfg.appSecret, code: dto.code },
      fetchImpl: this.fetchImpl,
    });
    const businessToken = exchange.ok ? exchange.data.access_token : undefined;
    if (!exchange.ok) return fail("exchange", describeExchangeError(exchange.problem));
    if (!businessToken) {
      return fail("exchange", { message: "Meta finished the sign-in but sent no access token. Start the connection again." });
    }
    result.steps.push({ key: "exchange", ok: true, message: "Signed in with Meta." });

    // 2. What that token was actually granted. The ids came via the browser.
    const debug = await graphCall<Parameters<typeof parseDebugToken>[0]>("debug_token", {
      accessToken: appAccessToken(cfg),
      params: { input_token: businessToken },
      fetchImpl: this.fetchImpl,
    });
    if (!debug.ok) return fail("grant", debug.problem);
    const grant = checkWabaGrant(parseDebugToken(debug.data), cfg.appId, dto.wabaId);
    if (!grant.ok) return fail("grant", { message: grant.reason });

    // 3. The number really is in that account.
    const numbers = await this.call<{ data?: PhoneNumberRow[] }>(cfg, businessToken, `${dto.wabaId}/phone_numbers`, {
      params: { fields: "id,display_phone_number,verified_name", limit: "100" },
      what: `the business account ${dto.wabaId}`,
    });
    if (!numbers.ok) return fail("phone_number", numbers.problem);
    const phone = (numbers.data.data ?? []).find((n) => n.id === dto.phoneNumberId);
    if (!phone) {
      return fail("phone_number", {
        message: "That number isn't in the WhatsApp account you signed in with. Start again and pick the shop's number.",
      });
    }
    result.displayPhoneNumber = phone.display_phone_number ?? null;
    result.verifiedName = phone.verified_name ?? null;
    result.steps.push({ key: "grant", ok: true, message: `Found ${phone.display_phone_number ?? "the number"} in your WhatsApp account.` });

    // 4. One number, one business — across every tenant, not just this one.
    const owner = await this.db.runAsPlatformAdmin((tx) =>
      tx.query.whatsappAccounts.findFirst({
        where: (t, { eq: e }) => e(t.phoneNumberId, dto.phoneNumberId),
        columns: { tenantId: true },
      }),
    );
    if (owner) {
      return fail("duplicate", {
        message:
          owner.tenantId === RequestContext.requireTenantId()
            ? "This number is already connected to your business."
            : "This number is already connected to another business on DevsFleet. Disconnect it there first.",
      });
    }

    // 5. Our app hears this account's webhooks.
    const subscribe = await this.call<{ success?: boolean }>(cfg, businessToken, `${dto.wabaId}/subscribed_apps`, { method: "POST" });
    result.steps.push(
      subscribe.ok
        ? { key: "subscribe", ok: true, message: "Messages to this number will arrive here." }
        : { key: "subscribe", ok: false, message: subscribe.problem.message, ...(subscribe.problem.fbtraceId ? { fbtraceId: subscribe.problem.fbtraceId } : {}) },
    );

    // 6a. A new number goes live on the Cloud API. Never a coexistence one:
    //     registering it would sign the owner's phone app out.
    let registrationPin: string | null = null;
    let historySyncRequestedAt: Date | null = null;
    if (!dto.coexistence) {
      const pin = generatePin();
      const register = await this.call<{ success?: boolean }>(cfg, businessToken, `${dto.phoneNumberId}/${REGISTER_EDGE}`, {
        method: "POST",
        params: { messaging_product: "whatsapp", pin },
      });
      if (register.ok) registrationPin = pin;
      result.steps.push(
        register.ok
          ? { key: "register", ok: true, message: "The number is live on WhatsApp's Cloud API." }
          : {
              key: "register",
              ok: false,
              message: `Meta didn't register the number: ${register.problem.message}`,
              ...(register.problem.fbtraceId ? { fbtraceId: register.problem.fbtraceId } : {}),
            },
      );
    } else {
      // 6b. Coexistence: ask the phone app for its contacts and past chats.
      //     They arrive later, on the webhook. Meta allows the history request
      //     once and only soon after onboarding, so the time is recorded.
      const contacts = await this.call(cfg, businessToken, `${dto.phoneNumberId}/${SMB_APP_DATA_EDGE}`, {
        method: "POST",
        params: { messaging_product: "whatsapp", sync_type: SMB_SYNC_TYPES.contacts },
      });
      const history = await this.call(cfg, businessToken, `${dto.phoneNumberId}/${SMB_APP_DATA_EDGE}`, {
        method: "POST",
        params: { messaging_product: "whatsapp", sync_type: SMB_SYNC_TYPES.history },
      });
      if (history.ok) {
        historySyncRequestedAt = new Date();
        result.historySyncRequested = true;
      }
      result.steps.push(
        history.ok
          ? { key: "sync", ok: true, message: "Importing your recent chats from the WhatsApp Business app." }
          : {
              key: "sync",
              ok: false,
              message: `Couldn't request your chat history: ${history.problem.message} New messages will still arrive.`,
              ...(history.problem.fbtraceId ? { fbtraceId: history.problem.fbtraceId } : {}),
            },
      );
      if (!contacts.ok) this.logger.warn({ phoneNumberId: dto.phoneNumberId }, "Coexistence contact sync request failed");
    }

    // 7. Saved last, so nothing is stored for a signup that never got this far.
    try {
      const tenantId = RequestContext.requireTenantId();
      const account = await this.db.run(async (tx) => {
        const [row] = await tx
          .insert(schema.whatsappAccounts)
          .values({
            tenantId,
            phoneNumberId: dto.phoneNumberId,
            displayPhoneNumber: phone.display_phone_number?.slice(0, 20) ?? null,
            businessAccountId: dto.wabaId,
            accessToken: businessToken,
            // Platform-level for embedded rows: Meta signs with DevsFleet's app.
            appSecret: null,
            verifyToken: null,
            connectionMethod: "embedded",
            coexistence: dto.coexistence,
            historySyncRequestedAt,
            registrationPin,
            defaultBranchId: dto.defaultBranchId ?? null,
          })
          .returning({ id: schema.whatsappAccounts.id });
        return row;
      });
      result.accountId = account?.id;
    } catch (error) {
      // Lost a race with another signup of the same number: the unique index decided.
      if (isUniqueViolation(error)) {
        return fail("save", { message: "This number was just connected to another business. Disconnect it there first." });
      }
      throw error;
    }

    result.steps.push({ key: "save", ok: true, message: "Connected." });
    result.ok = true;
    return result;
  }

  private call<T>(
    cfg: EmbeddedConfig,
    token: string,
    path: string,
    options: { method?: "GET" | "POST"; params?: Record<string, string>; what?: string } = {},
  ) {
    return graphCall<T>(path, { accessToken: token, appSecret: cfg.appSecret, fetchImpl: this.fetchImpl, ...options });
  }
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string; cause?: { code?: string } })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}
