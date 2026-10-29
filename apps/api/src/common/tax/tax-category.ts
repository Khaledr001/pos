import { TAX_CATEGORIES, TAX_EXEMPTION_CODES } from "@devsfleet/shared-types";
import { z } from "zod";

/**
 * Request-side shapes for a product's VAT treatment. The rules that relate
 * them (a category must agree with a rate) live in shared-utils'
 * `resolveProductTax`, so the API and the spreadsheet importer apply one set.
 */
export const TaxCategorySchema = z.enum(TAX_CATEGORIES);
export const TaxExemptionCodeSchema = z.enum(TAX_EXEMPTION_CODES);
