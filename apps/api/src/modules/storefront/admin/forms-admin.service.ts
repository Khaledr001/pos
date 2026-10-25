import { eq, schema, sql, type Transaction } from "@devsfleet/db";
import { MAX_FORMS, resolveStorefrontSettings } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { FormDto, UpdateFormDto } from "./forms.dto.js";

/** What the admin sees of a form: the whole definition, who is told, and how many leads it has taken. */
function view(form: typeof schema.storefrontForms.$inferSelect, leadCount: number) {
  return {
    id: form.id,
    slug: form.slug,
    name: form.name,
    fields: form.fields,
    submitLabel: form.submitLabel,
    successMessage: form.successMessage,
    notifyEmails: form.notifyEmails,
    acknowledge: form.acknowledge,
    isActive: form.isActive,
    leadCount,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
  };
}

/** The form builder: contact, enquiry and quote-request forms a site can embed. */
@Injectable()
export class FormsAdminService {
  constructor(private readonly db: TenantDatabase) {}

  list() {
    return this.db.run(async (tx) => {
      const [forms, counts] = await Promise.all([
        tx.query.storefrontForms.findMany({ orderBy: (t, { asc }) => asc(t.name) }),
        tx.execute<{ form_slug: string; n: number }>(sql`SELECT form_slug, count(*)::int AS n FROM storefront_leads GROUP BY form_slug`),
      ]);
      const byForm = new Map(counts.map((c) => [c.form_slug, Number(c.n)]));
      return forms.map((f) => view(f, byForm.get(f.slug) ?? 0));
    });
  }

  get(slug: string) {
    return this.db.run(async (tx) => {
      const form = await this.require(tx, slug);
      return view(form, await this.leadCount(tx, slug));
    });
  }

  create(dto: FormDto) {
    return this.db.run(async (tx) => {
      const existing = await tx.query.storefrontForms.findMany({ columns: { slug: true } });
      if (existing.length >= MAX_FORMS) {
        throw new AppError(ERROR_CODES.PLAN_LIMIT_EXCEEDED, `A site can have up to ${MAX_FORMS} forms.`);
      }
      if (existing.some((f) => f.slug === dto.slug)) {
        throw new AppError(ERROR_CODES.CONFLICT, "A form with that address already exists.");
      }
      const [form] = await tx
        .insert(schema.storefrontForms)
        .values({ tenantId: RequestContext.requireTenantId(), ...dto })
        .returning();
      return view(form!, 0);
    });
  }

  update(slug: string, dto: UpdateFormDto) {
    return this.db.run(async (tx) => {
      const form = await this.require(tx, slug);
      if (dto.isActive === false) await this.assertNotTheEnquiryForm(tx, slug, "switch off");
      const [updated] = await tx.update(schema.storefrontForms).set(dto).where(eq(schema.storefrontForms.id, form.id)).returning();
      return view(updated!, await this.leadCount(tx, slug));
    });
  }

  /** The leads stay: they carry their own snapshot of the form's name and questions. */
  remove(slug: string) {
    return this.db.run(async (tx) => {
      const form = await this.require(tx, slug);
      await this.assertNotTheEnquiryForm(tx, slug, "delete");
      await tx.delete(schema.storefrontForms).where(eq(schema.storefrontForms.id, form.id));
      return { deleted: true };
    });
  }

  private async require(tx: Transaction, slug: string) {
    const form = await tx.query.storefrontForms.findFirst({ where: (t, { eq: e }) => e(t.slug, slug) });
    if (!form) throw new AppError(ERROR_CODES.NOT_FOUND, "That form does not exist.");
    return form;
  }

  private async leadCount(tx: Transaction, slug: string): Promise<number> {
    const [row] = await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM storefront_leads WHERE form_slug = ${slug}`);
    return Number(row?.n ?? 0);
  }

  /** A catalogue site's "Enquire" button posts to this form; taking it away would make the button swallow visitors. */
  private async assertNotTheEnquiryForm(tx: Transaction, slug: string, verb: string): Promise<void> {
    const storefront = await tx.query.storefronts.findFirst({ columns: { settings: true } });
    const { site } = resolveStorefrontSettings(storefront?.settings);
    if (site.mode === "catalogue" && site.enquiry.form && site.enquiry.formSlug === slug) {
      throw new AppError(
        ERROR_CODES.CONFLICT,
        `This is the form behind your product "Enquire" button. Choose another form (or turn the form off) in your site settings before you ${verb} it.`,
      );
    }
  }
}
