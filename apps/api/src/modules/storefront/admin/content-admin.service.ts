import { desc, eq, schema } from "@devsfleet/db";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../../common/context/request-context.js";
import { TenantDatabase } from "../../../database/tenant-database.service.js";
import type { BannerDto, CouponDto, PageDto, UpdateBannerDto, UpdateCouponDto, UpdatePageDto } from "./dto.js";

const toDate = (value: string | null | undefined) => (value === undefined ? undefined : value === null ? null : new Date(value));

/** Pages, banners and promo codes. */
@Injectable()
export class ContentAdminService {
  constructor(private readonly db: TenantDatabase) {}

  // ---------------------------------------------------------------------------
  // Pages
  // ---------------------------------------------------------------------------

  pages() {
    return this.db.run((tx) =>
      tx.query.storefrontPages.findMany({
        columns: { body: false },
        orderBy: (t, { asc, desc: d }) => [asc(t.kind), d(t.updatedAt)],
      }),
    );
  }

  async page(id: string) {
    const page = await this.db.run((tx) => tx.query.storefrontPages.findFirst({ where: (t, { eq: e }) => e(t.id, id) }));
    if (!page) throw new AppError(ERROR_CODES.NOT_FOUND, "That page does not exist.");
    return page;
  }

  createPage(dto: PageDto) {
    return this.db.run(async (tx) => {
      const [page] = await tx
        .insert(schema.storefrontPages)
        .values({ tenantId: RequestContext.requireTenantId(), ...dto, publishedAt: dto.isPublished ? new Date() : null })
        .returning();
      return page;
    });
  }

  updatePage(id: string, dto: UpdatePageDto) {
    return this.db.run(async (tx) => {
      const existing = await tx.query.storefrontPages.findFirst({ where: (t, { eq: e }) => e(t.id, id) });
      if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, "That page does not exist.");
      const [page] = await tx
        .update(schema.storefrontPages)
        .set({
          ...dto,
          ...(dto.isPublished && !existing.publishedAt ? { publishedAt: new Date() } : {}),
        })
        .where(eq(schema.storefrontPages.id, id))
        .returning();
      return page;
    });
  }

  async deletePage(id: string) {
    await this.db.run((tx) => tx.delete(schema.storefrontPages).where(eq(schema.storefrontPages.id, id)));
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Banners
  // ---------------------------------------------------------------------------

  banners() {
    return this.db.run((tx) =>
      tx.query.storefrontBanners.findMany({ orderBy: (t, { asc }) => [asc(t.placement), asc(t.sortOrder)] }),
    );
  }

  createBanner(dto: BannerDto) {
    return this.db.run(async (tx) => {
      const [banner] = await tx
        .insert(schema.storefrontBanners)
        .values({
          tenantId: RequestContext.requireTenantId(),
          ...dto,
          startsAt: toDate(dto.startsAt) ?? null,
          endsAt: toDate(dto.endsAt) ?? null,
        })
        .returning();
      return banner;
    });
  }

  updateBanner(id: string, dto: UpdateBannerDto) {
    return this.db.run(async (tx) => {
      const [banner] = await tx
        .update(schema.storefrontBanners)
        .set({ ...dto, startsAt: toDate(dto.startsAt), endsAt: toDate(dto.endsAt) })
        .where(eq(schema.storefrontBanners.id, id))
        .returning();
      if (!banner) throw new AppError(ERROR_CODES.NOT_FOUND, "That banner does not exist.");
      return banner;
    });
  }

  async deleteBanner(id: string) {
    await this.db.run((tx) => tx.delete(schema.storefrontBanners).where(eq(schema.storefrontBanners.id, id)));
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Coupons
  // ---------------------------------------------------------------------------

  coupons() {
    return this.db.run((tx) => tx.select().from(schema.coupons).orderBy(desc(schema.coupons.createdAt)));
  }

  /**
   * Nobody grants what they do not hold. A percentage code is a discount the
   * shop gives without anyone at the counter approving it, so its creator
   * must be allowed to give that discount themselves — and the order it lands
   * on is later handed over through SalesService, which checks the same
   * ceiling against whoever hands it over.
   */
  createCoupon(dto: CouponDto) {
    const user = RequestContext.requireUser();
    if (dto.type === "percent" && Money.toMinor(dto.value) > Money.toMinor(user.abac.maxDiscountPercent)) {
      throw new AppError(
        ERROR_CODES.DISCOUNT_EXCEEDS_LIMIT,
        `You may create codes up to ${user.abac.maxDiscountPercent}% off.`,
      );
    }
    return this.db.run(async (tx) => {
      const [coupon] = await tx
        .insert(schema.coupons)
        .values({
          tenantId: RequestContext.requireTenantId(),
          code: dto.code,
          type: dto.type,
          value: dto.type === "percent" ? dto.value : "0",
          minSubtotal: dto.minSubtotal,
          maxUses: dto.maxUses ?? null,
          validFrom: toDate(dto.validFrom) ?? null,
          validTo: toDate(dto.validTo) ?? null,
          isActive: dto.isActive,
        })
        .returning();
      return coupon;
    });
  }

  updateCoupon(id: string, dto: UpdateCouponDto) {
    return this.db.run(async (tx) => {
      const [coupon] = await tx
        .update(schema.coupons)
        .set({ ...dto, validTo: toDate(dto.validTo) })
        .where(eq(schema.coupons.id, id))
        .returning();
      if (!coupon) throw new AppError(ERROR_CODES.NOT_FOUND, "That code does not exist.");
      return coupon;
    });
  }
}
