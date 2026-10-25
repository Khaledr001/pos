import { createHash, createHmac } from "node:crypto";
import { schema, sql } from "@devsfleet/db";
import type { PublicForm } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { RequestContext } from "../../../common/context/request-context.js";
import type { Env } from "../../../config/env.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { NotificationEnqueueService } from "../notifications/notification-enqueue.service.js";
import { validateAnswers } from "./answers.js";
import type { SubmitFormDto } from "./dto.js";

/** A submission younger than this is a script, not a person reading a form. */
const MIN_FILL_MS = 2_000;
/** The same answers from the same person inside this window are one submission, not two. */
const DEDUPE_WINDOW_MS = 5 * 60_000;
/** Past this many leads in ten minutes, staff are not mailed each one: the inbox has them. */
const MAIL_FLOOD_LIMIT = 30;

/** The same shape as the storefront client's `FormSubmitResult`; the contract check ties them together. */
export interface FormSubmitResult {
  ok: true;
  message: string;
}

/** The public face of the form builder: render a form, take a submission. */
@Injectable()
export class FormsService {
  private readonly ipSecret: string;

  constructor(
    private readonly db: TenantDatabase,
    private readonly enqueue: NotificationEnqueueService,
    config: ConfigService<Env, true>,
  ) {
    // Derived from an existing secret with a fixed label: still a different key from every other use of it.
    this.ipSecret = `${config.get("STOREFRONT_JWT_SECRET", { infer: true }) ?? config.get("JWT_ACCESS_SECRET", { infer: true })}:lead-ip`;
  }

  /** What a browser may know about a form. The staff addresses it notifies never leave here. */
  async get(slug: string): Promise<PublicForm> {
    const form = await this.db.run((tx) =>
      tx.query.storefrontForms.findFirst({ where: (t, { and: a, eq: e }) => a(e(t.slug, slug), e(t.isActive, true)) }),
    );
    if (!form) throw new AppError(ERROR_CODES.NOT_FOUND, "That form does not exist.");
    return { slug: form.slug, name: form.name, fields: form.fields, submitLabel: form.submitLabel, successMessage: form.successMessage };
  }

  /**
   * Always answers the same `{ ok: true }` for a submission that is dropped
   * (honeypot, instant submit, a repeat): a bot learns nothing about which of
   * its tricks was caught. A submission that is simply wrong gets field-level
   * errors, like any other form.
   */
  async submit(slug: string, dto: SubmitFormDto, ip: string | null): Promise<FormSubmitResult> {
    return this.db.run(async (tx) => {
      const form = await tx.query.storefrontForms.findFirst({ where: (t, { and: a, eq: e }) => a(e(t.slug, slug), e(t.isActive, true)) });
      if (!form) throw new AppError(ERROR_CODES.NOT_FOUND, "That form does not exist.");
      const done: FormSubmitResult = { ok: true, message: form.successMessage };

      if (dto.website && dto.website.trim() !== "") return done;
      if (dto.startedAt !== undefined) {
        const age = Date.now() - dto.startedAt;
        // A clock ahead of the server gives a negative age; that is a skewed clock, not a bot.
        if (age >= 0 && age < MIN_FILL_MS) return done;
      }

      const checked = validateAnswers(form.fields, dto.values);
      if (!checked.ok) {
        throw new z.ZodError(
          Object.entries(checked.errors).flatMap(([key, messages]) => messages.map((message) => ({ code: "custom" as const, path: [key], message }))),
        );
      }
      const { answers, name, email, phone } = checked.value;

      // The product is looked up here, never taken on trust: a name and SKU a visitor typed would be a forgery.
      const product = dto.source?.productId
        ? await tx.query.products.findFirst({
            where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, dto.source!.productId!), n(t.deletedAt)),
            columns: { id: true, name: true, sku: true },
          })
        : undefined;

      const contentHash = createHash("sha256")
        .update(JSON.stringify([form.slug, email ?? phone ?? "", answers.map((a) => [a.key, a.value]), product?.id ?? ""]))
        .digest("hex");
      const [duplicate] = await tx
        .select({ id: schema.storefrontLeads.id })
        .from(schema.storefrontLeads)
        .where(sql`${schema.storefrontLeads.contentHash} = ${contentHash} AND ${schema.storefrontLeads.createdAt} > now() - make_interval(secs => ${DEDUPE_WINDOW_MS / 1000})`)
        .limit(1);
      if (duplicate) return done;

      const [recent] = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM storefront_leads WHERE created_at > now() - interval '10 minutes'`,
      );

      const [lead] = await tx
        .insert(schema.storefrontLeads)
        .values({
          tenantId: RequestContext.requireTenantId(),
          formId: form.id,
          formSlug: form.slug,
          formName: form.name,
          name,
          email,
          phone,
          answers: answers.map(({ label, value }) => ({ label, value })),
          sourcePath: dto.source?.path ?? null,
          productId: product?.id ?? null,
          productName: product?.name ?? null,
          productSku: product?.sku ?? null,
          contentHash,
          ipHash: ip ? createHmac("sha256", this.ipSecret).update(ip).digest("hex") : null,
        })
        .returning({ id: schema.storefrontLeads.id });

      // In the same transaction as the lead: the mail exists if and only if the lead does.
      await this.enqueue.enqueueLead(tx, lead!.id, { notifyStaff: Number(recent?.n ?? 0) < MAIL_FLOOD_LIMIT });
      return done;
    });
  }
}
