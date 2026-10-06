import { WEB_QUOTE_STATUSES } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { z } from "zod";
import { uaePhone, wireEnum } from "../wire.js";

export const CreateQuoteSchema = z.object({
  /**
   * Minted by the browser per submission and resent on every retry: a double
   * click or a retry after a timeout returns the quote already created.
   */
  clientId: z.string().uuid(),
  contact: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
    phone: uaePhone,
  }),
  companyName: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  /** Omit to quote the current cart. Prices are never accepted from the client. */
  lines: z
    .array(
      z.object({
        variantId: z.string().uuid(),
        uom: z.string().trim().max(20).optional(),
        quantity: z.coerce.number().positive().max(100_000),
      }),
    )
    .min(1)
    .max(100)
    .optional(),
});
export type CreateQuoteDto = z.infer<typeof CreateQuoteSchema>;

export const QuotePageSchema = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1) });

const decimal = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,4})?$/, "Use a plain amount like 25 or 25.50"));

export const ListQuotesSchema = z.object({
  status: wireEnum(WEB_QUOTE_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListQuotesDto = z.infer<typeof ListQuotesSchema>;

export const PriceQuoteSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        unitPrice: decimal.refine((v) => Money.toMinor(v) > 0n, "A price must be above zero"),
      }),
    )
    .min(1)
    .max(200),
  /** One percentage off the whole quote. Needs the same discount authority as the till. */
  discountPercent: decimal.refine((v) => Money.toMinor(v) <= Money.toMinor("100"), "At most 100%").default("0"),
  validUntil: z.string().datetime(),
  staffNotes: z.string().trim().max(2000).optional(),
});
export type PriceQuoteDto = z.infer<typeof PriceQuoteSchema>;

export const CloseQuoteSchema = z.object({
  status: z.enum(["declined", "expired"]),
  note: z.string().trim().max(1000).optional(),
});
export type CloseQuoteDto = z.infer<typeof CloseQuoteSchema>;
