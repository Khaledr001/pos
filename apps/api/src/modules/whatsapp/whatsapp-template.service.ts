import type { WhatsappAccount } from "@devsfleet/db";
import type { NotificationEvent, TemplateApprovalState, WhatsappTemplateDef } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { graphCall, isPermanentGraphFailure, type FetchLike } from "./meta-graph.js";
import { WhatsappService } from "./whatsapp.service.js";

export type TemplateSendResult =
  | { ok: true; waMessageId: string }
  | { ok: false; permanent: boolean; message: string; kind?: string };

export interface RemoteTemplate {
  name: string;
  language: string;
  state: TemplateApprovalState;
  reason: string | null;
}

/** Meta: no newlines or tabs in a variable, no run of 4+ spaces, at most 1024 characters. */
export function cleanVariable(value: string): string {
  const cleaned = value.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 1000);
  return cleaned || "-";
}

export function toApprovalState(status: string | undefined): TemplateApprovalState {
  switch ((status ?? "").toUpperCase()) {
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "PAUSED":
    case "DISABLED":
      return "paused";
    case "PENDING":
    case "IN_APPEAL":
    case "PENDING_DELETION":
      return "pending";
    default:
      return "pending";
  }
}

/** The Graph body for one template message. Exported so the shape is tested. */
export function templateMessageBody(to: string, name: string, language: string, variables: string[]) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to.replace(/^\+/, ""),
    type: "template",
    template: {
      name,
      language: { code: language },
      ...(variables.length > 0
        ? { components: [{ type: "body", parameters: variables.map((v) => ({ type: "text", text: cleanVariable(v) })) }] }
        : {}),
    },
  };
}

/** The Graph body that submits one of the platform's templates for approval. */
export function templateCreateBody(def: WhatsappTemplateDef) {
  return {
    name: def.name,
    language: def.language,
    category: def.category,
    components: [{ type: "BODY", text: def.body, example: { body_text: [[...def.examples]] } }],
  };
}

/**
 * Approved-template messages: the only thing Meta accepts outside the 24-hour
 * window, and so what shopper notifications go out as. Also lists and submits
 * the platform's default templates on the shop's own WhatsApp Business account.
 *
 * Failures come back as values with a `permanent` flag — the notification
 * sweep decides whether to retry, and an exception would lose that.
 */
@Injectable()
export class WhatsappTemplateService {
  private readonly logger = new Logger(WhatsappTemplateService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly whatsapp: WhatsappService,
    @Optional() private readonly config?: ConfigService<Env, true>,
  ) {}

  /** Swapped for a fake in tests. */
  fetchImpl: FetchLike | undefined;

  /** The signing secret for this account's calls — the same rule the setup wizard applies. */
  private secretFor(account: Pick<WhatsappAccount, "connectionMethod" | "appSecret">): string | undefined {
    const secret =
      account.connectionMethod === "embedded" ? this.config?.get("META_APP_SECRET", { infer: true })?.trim() : account.appSecret;
    return secret || undefined;
  }

  private activeAccount(tenantId: string): Promise<WhatsappAccount | undefined> {
    return this.db.runAs(tenantId, (tx) => tx.query.whatsappAccounts.findFirst({ where: (t, { eq: e }) => e(t.isActive, true) }));
  }

  /** Does the shop have a WhatsApp Business number it can send from? */
  async isConnected(tenantId: string): Promise<boolean> {
    return !!(await this.activeAccount(tenantId));
  }

  async sendTemplate(
    tenantId: string,
    input: { to: string; templateName: string; language: string; variables: string[] },
  ): Promise<TemplateSendResult> {
    const account = await this.activeAccount(tenantId);
    if (!account) return { ok: false, permanent: true, message: "No active WhatsApp number is connected." };

    const result = await graphCall<{ messages?: Array<{ id?: string }> }>(`${account.phoneNumberId}/messages`, {
      accessToken: account.accessToken,
      appSecret: this.secretFor(account),
      method: "POST",
      body: templateMessageBody(input.to, input.templateName, input.language, input.variables),
      what: "this WhatsApp number",
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
    });

    if (!result.ok) {
      const permanent = isPermanentGraphFailure(result.problem.kind, result.problem.detail);
      // Never the recipient or variables: this lands in a shared log.
      this.logger.warn(`WhatsApp template send failed (${result.problem.kind}, ${permanent ? "permanent" : "retryable"})`);
      return { ok: false, permanent, message: result.problem.message, kind: result.problem.kind };
    }
    const waMessageId = result.data.messages?.[0]?.id;
    if (!waMessageId) return { ok: false, permanent: false, message: "Meta accepted the call but returned no message id." };

    await this.whatsapp.recordTemplateSend(account, {
      to: input.to.replace(/^\+/, ""),
      templateName: input.templateName,
      variables: input.variables,
      waMessageId,
    });
    return { ok: true, waMessageId };
  }

  /** The shop's templates as Meta has them. Throws AppError with Meta's plain-language problem. */
  async listTemplates(tenantId: string): Promise<{ connected: boolean; templates: RemoteTemplate[] }> {
    const account = await this.activeAccount(tenantId);
    if (!account) return { connected: false, templates: [] };
    const wabaId = this.requireWaba(account);
    const result = await graphCall<{ data?: Array<{ name: string; language: string; status: string; rejected_reason?: string }> }>(
      `${wabaId}/message_templates`,
      {
        accessToken: account.accessToken,
        appSecret: this.secretFor(account),
        params: { fields: "name,language,status,rejected_reason", limit: "250" },
        what: "this WhatsApp Business account",
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      },
    );
    if (!result.ok) throw new AppError(ERROR_CODES.VALIDATION_FAILED, result.problem.message);
    return {
      connected: true,
      templates: (result.data.data ?? []).map((t) => ({
        name: t.name,
        language: t.language,
        state: toApprovalState(t.status),
        reason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : null,
      })),
    };
  }

  /**
   * Submit the defaults Meta does not have yet, for this language. Idempotent:
   * a name that already exists (in any state) is left alone. Returns the
   * events whose submission Meta refused, with its reason.
   */
  async createMissing(
    tenantId: string,
    defs: Array<{ event: NotificationEvent; def: WhatsappTemplateDef }>,
    existing: RemoteTemplate[],
  ): Promise<Array<{ event: NotificationEvent; message: string }>> {
    const account = await this.activeAccount(tenantId);
    if (!account) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "Connect a WhatsApp number first.");
    const wabaId = this.requireWaba(account);
    const have = new Set(existing.map((t) => `${t.name}|${t.language}`));

    const refused: Array<{ event: NotificationEvent; message: string }> = [];
    for (const { event, def } of defs) {
      if (have.has(`${def.name}|${def.language}`)) continue;
      const result = await graphCall(`${wabaId}/message_templates`, {
        accessToken: account.accessToken,
        appSecret: this.secretFor(account),
        method: "POST",
        body: templateCreateBody(def),
        what: "this WhatsApp Business account",
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      });
      if (!result.ok) refused.push({ event, message: result.problem.message });
    }
    return refused;
  }

  private requireWaba(account: WhatsappAccount): string {
    if (!account.businessAccountId) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        "This WhatsApp number has no business account id saved. Re-run the WhatsApp connection check to add it.",
      );
    }
    return account.businessAccountId;
  }
}
