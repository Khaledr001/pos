import {
  BANNER_PLACEMENTS,
  CUSTOMER_TYPES,
  EMIRATES,
  STOREFRONT_PAGE_KINDS,
  WEB_ORDER_STATUSES,
} from "@devsfleet/shared-types";
import { slugify } from "@devsfleet/shared-utils";
import { z } from "zod";
import { wireEnum } from "../wire.js";

const decimal = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d+(\.\d{1,4})?$/, "Use a plain amount like 25 or 25.50"));
const slug = z.string().trim().min(1).max(255).transform((v) => slugify(v)).pipe(z.string().min(1, "That slug is empty once cleaned up"));
const page = z.coerce.number().int().min(1).max(10_000).default(1);
const pageSize = z.coerce.number().int().min(1).max(100).default(25);

// -----------------------------------------------------------------------------
// Order desk
// -----------------------------------------------------------------------------

export const ListWebOrdersSchema = z.object({
  status: wireEnum(WEB_ORDER_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  page,
  pageSize,
});
export type ListWebOrdersDto = z.infer<typeof ListWebOrdersSchema>;

export const TransitionSchema = z.object({
  status: wireEnum(WEB_ORDER_STATUSES),
  note: z.string().trim().max(500).optional(),
  /**
   * How a cash-on-delivery order was settled, on delivery or collection. A
   * prepaid card order needs nothing here — it was paid online.
   */
  payment: z
    .object({
      method: z.enum(["cash", "card", "bank_transfer"]),
      cashSessionId: z.string().uuid().optional(),
      reference: z.string().trim().max(100).optional(),
    })
    .optional(),
});
export type TransitionDto = z.infer<typeof TransitionSchema>;

export const ShipmentSchema = z.object({
  courier: z.string().trim().min(1).max(100),
  trackingNumber: z.string().trim().max(100).optional(),
  trackingUrl: z.string().trim().url().max(500).optional(),
});
export type ShipmentDto = z.infer<typeof ShipmentSchema>;

// -----------------------------------------------------------------------------
// Listings
// -----------------------------------------------------------------------------

export const ListListingsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["all", "published", "unpublished", "unlisted"]).default("all"),
  page,
  pageSize,
});
export type ListListingsDto = z.infer<typeof ListListingsSchema>;

export const UpsertListingSchema = z.object({
  slug,
  isPublished: z.boolean(),
  isFeatured: z.boolean().default(false),
  pickupOnly: z.boolean().default(false),
  seoTitle: z.string().trim().max(255).nullable().optional(),
  seoDescription: z.string().trim().max(500).nullable().optional(),
  specs: z.array(z.object({ label: z.string().trim().min(1).max(100), value: z.string().trim().min(1).max(500) })).max(50).default([]),
  documents: z
    .array(z.object({ title: z.string().trim().min(1).max(200), url: z.string().trim().url().max(500), kind: z.string().trim().max(40).default("datasheet") }))
    .max(20)
    .default([]),
});
export type UpsertListingDto = z.infer<typeof UpsertListingSchema>;

const productIds = z.array(z.string().uuid()).max(24).default([]);
export const ProductLinksSchema = z.object({
  related: productIds,
  alternative: productIds,
  boughtTogether: productIds,
});
export type ProductLinksDto = z.infer<typeof ProductLinksSchema>;

// -----------------------------------------------------------------------------
// Content
// -----------------------------------------------------------------------------

export const PageSchema = z.object({
  slug,
  title: z.string().trim().min(1).max(255),
  body: z.string().max(100_000).default(""),
  kind: z.enum(STOREFRONT_PAGE_KINDS).default("page"),
  excerpt: z.string().trim().max(500).nullable().optional(),
  coverImageUrl: z.string().trim().url().max(500).nullable().optional(),
  isPublished: z.boolean().default(false),
  seoTitle: z.string().trim().max(255).nullable().optional(),
  seoDescription: z.string().trim().max(500).nullable().optional(),
});
export type PageDto = z.infer<typeof PageSchema>;
export const UpdatePageSchema = PageSchema.partial();
export type UpdatePageDto = z.infer<typeof UpdatePageSchema>;

export const BannerSchema = z.object({
  placement: z.enum(BANNER_PLACEMENTS).default("home_hero"),
  title: z.string().trim().min(1).max(255),
  subtitle: z.string().trim().max(500).nullable().optional(),
  imageUrl: z.string().trim().url().max(500).nullable().optional(),
  linkUrl: z.string().trim().max(500).nullable().optional(),
  ctaLabel: z.string().trim().max(50).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  isActive: z.boolean().default(true),
});
export type BannerDto = z.infer<typeof BannerSchema>;
export const UpdateBannerSchema = BannerSchema.partial();
export type UpdateBannerDto = z.infer<typeof UpdateBannerSchema>;

export const CouponSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/, "3–40 letters, digits, - or _"),
    /** `fixed` codes cannot be used online yet — see CouponsService. */
    type: z.enum(["percent", "free_shipping"]),
    value: decimal.default("0"),
    minSubtotal: decimal.default("0"),
    maxUses: z.coerce.number().int().min(1).nullable().optional(),
    validFrom: z.string().datetime().nullable().optional(),
    validTo: z.string().datetime().nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((c) => c.type !== "percent" || (Number(c.value) > 0 && Number(c.value) <= 100), {
    message: "A percentage is between 0 and 100",
    path: ["value"],
  });
export type CouponDto = z.infer<typeof CouponSchema>;
export const UpdateCouponSchema = z.object({
  isActive: z.boolean().optional(),
  maxUses: z.coerce.number().int().min(1).nullable().optional(),
  validTo: z.string().datetime().nullable().optional(),
});
export type UpdateCouponDto = z.infer<typeof UpdateCouponSchema>;

// -----------------------------------------------------------------------------
// Trade
// -----------------------------------------------------------------------------

export const ApproveTradeSchema = z.object({
  priceListId: z.string().uuid(),
  customerType: z.enum(CUSTOMER_TYPES as unknown as [string, ...string[]]).refine((t) => t !== "retail", "A trade customer is wholesale or VIP"),
});
export type ApproveTradeDto = z.infer<typeof ApproveTradeSchema>;

export const RejectTradeSchema = z.object({ note: z.string().trim().max(500).optional() });
export type RejectTradeDto = z.infer<typeof RejectTradeSchema>;

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

const domain = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^https?:\/\//, "").replace(/[/:].*$/, ""))
  .pipe(z.string().regex(/^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+|\d{1,3}(\.\d{1,3}){3})$/, "Enter a hostname like shop.example.ae"));

export const SetupStorefrontSchema = z.object({
  name: z.string().trim().min(1).max(255),
  domain,
});
export type SetupStorefrontDto = z.infer<typeof SetupStorefrontSchema>;

export const DomainSchema = z.object({ domain, isPrimary: z.boolean().default(false) });
export type DomainDto = z.infer<typeof DomainSchema>;

const ShippingRateSchema = z.object({
  emirate: z.enum(EMIRATES),
  baseFee: decimal,
  baseWeightKg: z.coerce.number().int().min(0).max(1000),
  perKgFee: decimal,
  freeOver: decimal.nullable(),
  maxWeightKg: z.coerce.number().int().min(1).max(10_000),
  etaDays: z.coerce.number().int().min(0).max(60),
  active: z.boolean(),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

/** Every field optional: a PATCH names only what changes, merged over what is stored. */
export const UpdateSettingsSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
  displayName: z.string().trim().max(255).optional(),
  whatsapp: z.string().trim().max(30).optional(),
  siteUrl: z.string().trim().url().max(255).optional(),
  revalidateUrl: z.string().trim().url().max(500).optional(),
  checkout: z
    .object({
      cod: z.object({ enabled: z.boolean(), maxTotal: decimal }).optional(),
      card: z.object({ enabled: z.boolean() }).optional(),
      stockSafetyBuffer: z.coerce.number().int().min(0).max(100_000).optional(),
      fulfilmentBranchId: z.string().uuid().nullable().optional(),
    })
    .optional(),
  shipping: z.object({ rates: z.array(ShippingRateSchema).max(EMIRATES.length) }).optional(),
  pickup: z
    .object({
      slotMinutes: z.coerce.number().int().min(15).max(24 * 60),
      leadTimeHours: z.coerce.number().int().min(0).max(14 * 24),
      daysAhead: z.coerce.number().int().min(1).max(30),
      opensAt: hhmm,
      closesAt: hhmm,
    })
    .optional(),
  branches: z
    .array(
      z.object({
        branchId: z.string().uuid(),
        emirate: z.enum(EMIRATES),
        lat: z.number().min(-90).max(90).nullable(),
        lng: z.number().min(-180).max(180).nullable(),
        openingHours: z.record(z.string().max(40), z.string().max(40)).nullable(),
        pickupEnabled: z.boolean(),
      }),
    )
    .max(200)
    .optional(),
  search: z.object({ synonyms: z.array(z.array(z.string().trim().min(1).max(40)).min(2).max(10)).max(200) }).optional(),
});
export type UpdateSettingsDto = z.infer<typeof UpdateSettingsSchema>;

export const PaymentAccountSchema = z.object({
  secretKey: z.string().trim().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/, "A Stripe secret key starts sk_live_ or sk_test_"),
  webhookSecret: z.string().trim().regex(/^whsec_[A-Za-z0-9]{10,}$/, "A Stripe webhook secret starts whsec_"),
});
export type PaymentAccountDto = z.infer<typeof PaymentAccountSchema>;
