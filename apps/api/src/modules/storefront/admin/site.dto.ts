import { FORM_SLUG, SITE_MODES, SITE_TEMPLATE_IDS } from "@devsfleet/shared-types";
import { z } from "zod";
import { href, label } from "./field-rules.js";

/**
 * The `site` block of the storefront settings: which kind of website this is.
 * The cross-field rules (a catalogue needs a way to enquire; the enquiry form
 * must exist) need the stored forms, so SettingsAdminService applies them.
 */
export const SiteSchema = z
  .object({
    template: z.enum([...SITE_TEMPLATE_IDS, "custom"]),
    mode: z.enum(SITE_MODES),
    showPrices: z.boolean(),
    enquiry: z
      .object({
        form: z.boolean(),
        whatsapp: z.boolean(),
        call: z.boolean(),
        formSlug: z.string().trim().regex(FORM_SLUG, "Use a form's address, like product-enquiry"),
      })
      .partial(),
    features: z.object({ search: z.boolean(), account: z.boolean() }).partial(),
    /** null removes the button. */
    headerCta: z.object({ label: label(30), href }).nullable(),
  })
  .partial();
export type SiteDto = z.infer<typeof SiteSchema>;

export const ApplyTemplateSchema = z.object({
  template: z.enum(SITE_TEMPLATE_IDS),
  /** Also take the template's colours, font and corner style (never the logo, favicon or social links). */
  applyTheme: z.boolean().default(false),
  /** The template's site mode, layout, navigation and home page. */
  applyContent: z.boolean().default(true),
  /** Create the template's pages that do not exist yet. */
  createPages: z.boolean().default(true),
  /** Create the template's forms that do not exist yet. */
  createForms: z.boolean().default(true),
  /** Replace an existing page that has the same address as one of the template's. */
  overwritePages: z.boolean().default(false),
});
export type ApplyTemplateDto = z.infer<typeof ApplyTemplateSchema>;
