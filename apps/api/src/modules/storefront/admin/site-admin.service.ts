import { eq, schema, type Transaction } from "@devsfleet/db";
import {
  resolveSite,
  resolveStorefrontSettings,
  resolveTenantSettings,
  SITE_TEMPLATES,
  THEME_PRESETS,
  type SiteTemplate,
  type StorefrontSettings,
} from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import { StorefrontResolver } from "../context/storefront-resolver.service.js";
import { isMailbox } from "../notifications/channel-rules.js";
import type { ApplyTemplateDto } from "./site.dto.js";
import { SettingsAdminService, assertSiteConsistent } from "./settings-admin.service.js";

/** What an apply did, so the admin can say "created 4 pages, kept 1" instead of a bare "done". */
export interface ApplyTemplateResult {
  formsCreated: string[];
  pagesCreated: string[];
  pagesOverwritten: string[];
  /** Same address as a template page, left alone because overwriting was not asked for (or it is a blog post). */
  pagesSkipped: string[];
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Starting a site from a template.
 *
 * A template is data (shared-types/site-templates.ts), not a live link: applying
 * one copies its mode, layout, navigation, home page, pages and forms into this
 * tenant's own rows, after which the tenant owns and reconfigures them freely.
 * Nothing the tenant already built is overwritten unless they say so, and a
 * page or form with the same address is kept by default.
 */
@Injectable()
export class SiteAdminService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly resolver: StorefrontResolver,
    private readonly settings: SettingsAdminService,
  ) {}

  async applyTemplate(dto: ApplyTemplateDto) {
    const tenantId = RequestContext.requireTenantId();
    const template = SITE_TEMPLATES[dto.template];
    const applied = await this.db.run(async (tx) => {
      const storefront = await tx.query.storefronts.findFirst();
      if (!storefront) throw new AppError(ERROR_CODES.STOREFRONT_NOT_FOUND, "Set up the online store first.");
      const current = resolveStorefrontSettings(storefront.settings);
      const tenant = await tx.query.tenants.findFirst({ columns: { settings: true } });
      const businessEmail = resolveTenantSettings(tenant?.settings).email;

      const result: ApplyTemplateResult = { formsCreated: [], pagesCreated: [], pagesOverwritten: [], pagesSkipped: [] };
      // Forms first: a catalogue's settings name its enquiry form, and saving them checks it exists.
      if (dto.createForms) await this.createForms(tx, tenantId, template, businessEmail, result);
      if (dto.createPages) await this.createPages(tx, tenantId, template, dto.overwritePages, result);

      if (dto.applyContent || dto.applyTheme) {
        const next = this.nextSettings(current, template, dto);
        if (dto.applyContent) await assertSiteConsistent(tx, next.site);
        await tx.update(schema.storefronts).set({ settings: next }).where(eq(schema.storefronts.id, storefront.id));
      }
      return result;
    });
    this.resolver.invalidateTenant(tenantId);
    return { ...(await this.settings.get()), applied };
  }

  private nextSettings(current: StorefrontSettings, template: SiteTemplate, dto: ApplyTemplateDto): StorefrontSettings {
    const next: StorefrontSettings = { ...current };
    if (dto.applyTheme) {
      const preset = THEME_PRESETS[template.themePreset];
      // Colours, type and shape only: the logo, favicon, share image, announcement and social links are the tenant's own.
      next.theme = {
        ...next.theme,
        preset: template.themePreset,
        colors: { ...preset.colors },
        font: preset.font,
        radius: preset.radius,
        layout: { ...next.theme.layout, ...preset.layout },
      };
    }
    if (dto.applyContent) {
      next.site = resolveSite({ ...template.site, template: template.id, mode: template.mode });
      next.theme = { ...next.theme, layout: { ...next.theme.layout, ...template.layout } };
      next.navigation = clone(template.navigation);
      next.homeSections = clone(template.homeSections);
    }
    return next;
  }

  private async createForms(tx: Transaction, tenantId: string, template: SiteTemplate, businessEmail: string | undefined, result: ApplyTemplateResult) {
    const existing = new Set((await tx.query.storefrontForms.findMany({ columns: { slug: true } })).map((f) => f.slug));
    for (const form of template.forms) {
      if (existing.has(form.slug)) continue;
      await tx.insert(schema.storefrontForms).values({
        tenantId,
        slug: form.slug,
        name: form.name,
        fields: clone(form.fields),
        submitLabel: form.submitLabel,
        successMessage: form.successMessage,
        // Someone has to hear about the first enquiry: the business email, if there is one, until the tenant picks.
        notifyEmails: form.notifyEmails.length > 0 ? form.notifyEmails : isMailbox(businessEmail) ? [businessEmail.toLowerCase()] : [],
        acknowledge: form.acknowledge,
        isActive: form.isActive,
      });
      result.formsCreated.push(form.slug);
    }
  }

  private async createPages(tx: Transaction, tenantId: string, template: SiteTemplate, overwrite: boolean, result: ApplyTemplateResult) {
    for (const page of template.pages) {
      const existing = await tx.query.storefrontPages.findFirst({ where: (t, { eq: e }) => e(t.slug, page.slug) });
      const values = {
        title: page.title,
        body: "",
        kind: "page" as const,
        seoDescription: page.seoDescription ?? null,
        sections: clone(page.sections),
        layout: page.layout,
        isPublished: true,
      };
      if (!existing) {
        await tx.insert(schema.storefrontPages).values({ tenantId, slug: page.slug, publishedAt: new Date(), ...values });
        result.pagesCreated.push(page.slug);
      } else if (overwrite && existing.kind === "page") {
        await tx
          .update(schema.storefrontPages)
          .set({ ...values, publishedAt: existing.publishedAt ?? new Date() })
          .where(eq(schema.storefrontPages.id, existing.id));
        result.pagesOverwritten.push(page.slug);
      } else {
        result.pagesSkipped.push(page.slug);
      }
    }
  }
}
