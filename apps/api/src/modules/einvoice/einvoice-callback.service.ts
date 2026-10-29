import { schema, sql } from "@devsfleet/db";
import type { EinvoiceIssue } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { SecretBoxService } from "../../common/crypto/secret-box.service.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { CallbackBodySchema } from "./dto.js";
import { transitionForCallback } from "./delivery-policy.js";
import { recordEvent } from "./events.js";
import { verifySignature } from "./providers/signature.js";
import { summary } from "./einvoice-sweep.service.js";

/**
 * A provider reporting what happened to a document after it was accepted:
 * delivered to the buyer's side, or rejected by the network later.
 *
 * Public route, so authenticated twice: the unguessable per-tenant token in the
 * URL selects the tenant, and an HMAC of the RAW body, keyed with the
 * provider credential only that tenant and its provider hold, proves the body
 * is the provider's. The token alone is never enough.
 */
@Injectable()
export class EinvoiceCallbackService {
  private readonly logger = new Logger(EinvoiceCallbackService.name);

  constructor(
    private readonly db: TenantDatabase,
    private readonly secrets: SecretBoxService,
  ) {}

  async handle(token: string, rawBody: Buffer | undefined, signature: string | undefined): Promise<{ ok: true; applied: boolean }> {
    // Same answer for an unknown token and a bad signature: nothing about which tokens exist is leaked.
    const refuse = () => new AppError(ERROR_CODES.INVALID_CREDENTIALS, "The callback could not be verified.");

    if (!rawBody || rawBody.length === 0 || rawBody.length > 200_000) throw refuse();
    const account = await this.db.runAsPlatformAdmin((tx) =>
      tx.query.einvoiceAccounts.findFirst({ where: (t, { and: a, eq: e }) => a(e(t.callbackToken, token), e(t.isActive, true)) }),
    );
    if (!account?.credentialsEnc) throw refuse();

    let credential: string;
    try {
      credential = this.secrets.decrypt(account.credentialsEnc);
    } catch {
      this.logger.error({ tenantId: account.tenantId }, "Callback received but the stored credential cannot be decrypted");
      throw refuse();
    }
    if (!verifySignature(rawBody, signature, credential)) throw refuse();

    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "The callback body is not valid JSON.");
    }
    const parsed = CallbackBodySchema.safeParse(json);
    if (!parsed.success) throw new AppError(ERROR_CODES.VALIDATION_FAILED, "The callback body is not in the documented shape.");
    const { id, status, errors } = parsed.data;

    return this.db.runAs(account.tenantId, async (tx) => {
      const doc = await tx.query.einvoiceDocuments.findFirst({ where: (t, { eq: e }) => e(t.providerRef, id) });
      if (!doc) throw new AppError(ERROR_CODES.NOT_FOUND, "No document was accepted under that reference.");

      const next = transitionForCallback(doc.status, status);
      if (!next) return { ok: true as const, applied: false };

      const table = schema.einvoiceDocuments;
      const issues: EinvoiceIssue[] = (errors ?? []).map((e) => ({ code: String(e.code ?? "PROVIDER_ERROR").slice(0, 60), message: String(e.message ?? "The network reported a problem.").slice(0, 500), severity: "error" }));
      const now = new Date();
      const updated = await tx
        .update(table)
        .set({
          status: next,
          ...(next === "delivered" ? { deliveredAt: now, lastError: null, issues: [] } : {}),
          ...(next === "submitted" ? { submittedAt: doc.submittedAt ?? now } : {}),
          ...(next === "rejected" ? { issues, lastError: summary(issues.length ? issues : [{ message: "Rejected by the network." }]) } : {}),
        })
        // Guarded on the status we decided from, so two callbacks racing cannot both apply.
        .where(sql`${table.id} = ${doc.id} AND ${table.status} = ${doc.status}`)
        .returning({ id: table.id });
      if (updated.length === 0) return { ok: true as const, applied: false };

      await recordEvent(tx, {
        tenantId: account.tenantId,
        documentId: doc.id,
        status: next,
        message: next === "delivered" ? "Delivery confirmed by the provider." : next === "rejected" ? `Rejected by the network: ${summary(issues.length ? issues : [{ message: "no reason given" }])}` : "Accepted by the provider.",
        detail: { reported: status },
      });
      return { ok: true as const, applied: true };
    });
  }
}
