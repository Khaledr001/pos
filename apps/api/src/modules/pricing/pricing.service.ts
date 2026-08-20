import { and, eq, schema, sql, type Transaction } from "@devsfleet/db";
import type { PriceList, ProductPrice } from "@devsfleet/db";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type {
  BulkSetProductPricesDto,
  CreatePriceListDto,
  ListPriceHistoryDto,
  ListPriceListsDto,
  SetCustomerPriceDto,
  SetProductPriceDto,
  UpdatePriceListDto,
} from "./dto.js";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * "10.00" vs "10" are the same amount but different strings — comparing them
 * directly would call every price "changed" even when it is not, spamming
 * price_history with rows that record no real change.
 */
function sameAmount(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Money.toMinor(a) === Money.toMinor(b);
}

/**
 * Price lists, and the writes that were missing from Stage 5.1: setting a
 * price after a product already exists, and doing it to many variants at
 * once. `product_prices`/`customer_prices` rows are never edited or deleted —
 * see packages/db/src/schema/pricing.ts's header comment for the resolution
 * order this preserves.
 */
@Injectable()
export class PricingService {
  constructor(private readonly db: TenantDatabase) {}

  // ---------------------------------------------------------------------------
  // Price lists
  // ---------------------------------------------------------------------------

  async listPriceLists(query: ListPriceListsDto): Promise<PriceList[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(schema.priceLists)
        .where(query.includeInactive ? undefined : eq(schema.priceLists.isActive, true))
        .orderBy(schema.priceLists.name),
    );
  }

  async findPriceListById(id: string): Promise<PriceList> {
    const list = await this.db.run((tx) => tx.query.priceLists.findFirst({ where: (t, { eq: e }) => e(t.id, id) }));
    if (!list) throw new AppError(ERROR_CODES.NOT_FOUND, `Price list ${id} not found`);
    return list;
  }

  /**
   * `isDefault` is exclusive — the partial unique index only allows one true
   * row per tenant. Promoting this one first clears whichever list held it.
   */
  async createPriceList(dto: CreatePriceListDto): Promise<PriceList> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const [existing] = await tx.select({ value: sql<number>`count(*)::int` }).from(schema.priceLists);
      // A tenant's very first price list must be the default — resolveMany's
      // fallback tier has nothing to land on otherwise.
      const isDefault = dto.isDefault || (existing?.value ?? 0) === 0;

      if (isDefault) await this.clearDefault(tx);

      const [list] = await tx
        .insert(schema.priceLists)
        .values({ tenantId, ...dto, isDefault })
        .returning();

      if (!list) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the price list");
      return list;
    });
  }

  async updatePriceList(id: string, dto: UpdatePriceListDto): Promise<PriceList> {
    return this.db.run(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, id);

      if (dto.isActive === false) {
        const current = await tx.query.priceLists.findFirst({
          where: (t, { eq: e }) => e(t.id, id),
          columns: { isDefault: true },
        });
        if (current?.isDefault) {
          throw new AppError(
            ERROR_CODES.CONFLICT,
            "Cannot deactivate the default price list — make another list the default first.",
          );
        }
      }

      const [list] = await tx.update(schema.priceLists).set(dto).where(eq(schema.priceLists.id, id)).returning();
      if (!list) throw new AppError(ERROR_CODES.NOT_FOUND, `Price list ${id} not found`);
      return list;
    });
  }

  /** No `deletedAt` on this table — "remove" is always deactivation, refused on the default list by `updatePriceList`. */
  async removePriceList(id: string): Promise<void> {
    await this.updatePriceList(id, { isActive: false });
  }

  private async clearDefault(tx: Transaction, exceptId?: string): Promise<void> {
    await tx
      .update(schema.priceLists)
      .set({ isDefault: false })
      .where(
        exceptId
          ? and(eq(schema.priceLists.isDefault, true), sql`${schema.priceLists.id} != ${exceptId}`)
          : eq(schema.priceLists.isDefault, true),
      );
  }

  // ---------------------------------------------------------------------------
  // Product prices
  // ---------------------------------------------------------------------------

  async setProductPrice(dto: SetProductPriceDto): Promise<ProductPrice> {
    const tenantId = RequestContext.requireTenantId();
    const userId = RequestContext.requireUser().id;

    return this.db.run((tx) => this.applyProductPrice(tx, tenantId, dto, userId));
  }

  /**
   * One transaction for the whole batch — a partial re-price would leave the
   * catalogue in a state nobody asked for, price A changed but price B not,
   * with no way to tell from the response alone which failed.
   */
  async bulkSetProductPrices(dto: BulkSetProductPricesDto): Promise<ProductPrice[]> {
    const tenantId = RequestContext.requireTenantId();
    const userId = RequestContext.requireUser().id;

    return this.db.run(async (tx) => {
      const results: ProductPrice[] = [];
      for (const item of dto.items) {
        results.push(await this.applyProductPrice(tx, tenantId, item, userId));
      }
      return results;
    });
  }

  /**
   * Close the current row (if the new one starts later) or correct it in
   * place (if it starts the same day — a same-day re-price is not a new
   * tier, it is a fix), then log the change. Shared by the single and bulk
   * entry points.
   */
  private async applyProductPrice(
    tx: Transaction,
    tenantId: string,
    dto: SetProductPriceDto,
    changedBy: string,
  ): Promise<ProductPrice> {
    const effectiveFrom = dto.effectiveFrom ?? today();
    const sellingPrice = String(dto.sellingPrice);
    const purchasePrice = dto.purchasePrice !== undefined ? String(dto.purchasePrice) : null;
    const minSellingPrice = dto.minSellingPrice !== undefined ? String(dto.minSellingPrice) : null;
    const minQuantity = String(dto.minQuantity);

    // Each quantity tier is its own independent effective-dating timeline —
    // "the current 10+ price" and "the current 1+ price" never touch or
    // close each other.
    const current = await tx.query.productPrices.findFirst({
      where: (t, { and: a, eq: e, isNull: n }) =>
        a(
          e(t.variantId, dto.variantId),
          e(t.priceListId, dto.priceListId),
          e(t.minQuantity, minQuantity),
          n(t.effectiveTo),
        ),
    });

    if (current && effectiveFrom < current.effectiveFrom) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `A price already takes effect ${current.effectiveFrom} — effectiveFrom cannot be earlier than that.`,
      );
    }

    const changed =
      !current ||
      !sameAmount(current.sellingPrice, sellingPrice) ||
      !sameAmount(current.purchasePrice ?? null, purchasePrice) ||
      !sameAmount(current.minSellingPrice ?? null, minSellingPrice);

    if (!changed) return current;

    if (current) {
      await tx.insert(schema.priceHistory).values({
        tenantId,
        variantId: dto.variantId,
        priceListId: dto.priceListId,
        minQuantity,
        oldPurchasePrice: current.purchasePrice,
        newPurchasePrice: purchasePrice,
        oldSellingPrice: current.sellingPrice,
        newSellingPrice: sellingPrice,
        oldMinSellingPrice: current.minSellingPrice,
        newMinSellingPrice: minSellingPrice,
        changedBy,
        reason: dto.reason ?? null,
      });
    } else {
      // A first price is still worth a history row — "how did we arrive at
      // today's price" should be answerable from one table without a
      // special case for "there was no `old` row".
      await tx.insert(schema.priceHistory).values({
        tenantId,
        variantId: dto.variantId,
        priceListId: dto.priceListId,
        minQuantity,
        newPurchasePrice: purchasePrice,
        newSellingPrice: sellingPrice,
        newMinSellingPrice: minSellingPrice,
        changedBy,
        reason: dto.reason ?? null,
      });
    }

    if (current && current.effectiveFrom === effectiveFrom) {
      // Same-day correction: there is no room for two rows sharing this key,
      // so the existing one is amended rather than superseded.
      const [updated] = await tx
        .update(schema.productPrices)
        .set({ sellingPrice, purchasePrice, minSellingPrice })
        .where(eq(schema.productPrices.id, current.id))
        .returning();
      if (!updated) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not update the price");
      return updated;
    }

    if (current) {
      await tx
        .update(schema.productPrices)
        .set({ effectiveTo: sql`(${effectiveFrom}::date - interval '1 day')::date` })
        .where(eq(schema.productPrices.id, current.id));
    }

    const [created] = await tx
      .insert(schema.productPrices)
      .values({
        tenantId,
        variantId: dto.variantId,
        priceListId: dto.priceListId,
        minQuantity,
        sellingPrice,
        purchasePrice,
        minSellingPrice,
        effectiveFrom,
      })
      .returning();

    if (!created) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the price");
    return created;
  }

  async listPriceHistory(query: ListPriceHistoryDto): Promise<{ items: unknown[]; total: number }> {
    return this.db.run(async (tx) => {
      const where = eq(schema.priceHistory.variantId, query.variantId);

      const [total] = await tx.select({ value: sql<number>`count(*)::int` }).from(schema.priceHistory).where(where);
      const items = await tx
        .select()
        .from(schema.priceHistory)
        .where(where)
        .orderBy(sql`${schema.priceHistory.createdAt} desc`)
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);

      return { items, total: total?.value ?? 0 };
    });
  }

  // ---------------------------------------------------------------------------
  // Customer prices
  // ---------------------------------------------------------------------------

  /**
   * Negotiated prices need no separate history table — the row itself is
   * never edited or deleted, only superseded, so the full history is every
   * row `customer_prices` has ever held for this customer and variant.
   */
  async setCustomerPrice(dto: SetCustomerPriceDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const userId = RequestContext.requireUser().id;
    const effectiveFrom = dto.effectiveFrom ?? today();
    const specialPrice = String(dto.specialPrice);

    return this.db.run(async (tx) => {
      const current = await tx.query.customerPrices.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) =>
          a(e(t.customerId, dto.customerId), e(t.variantId, dto.variantId), n(t.effectiveTo)),
      });

      if (current && effectiveFrom < current.effectiveFrom) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `A negotiated price already takes effect ${current.effectiveFrom} — effectiveFrom cannot be earlier than that.`,
        );
      }

      if (current && sameAmount(current.specialPrice, specialPrice) && current.effectiveFrom === effectiveFrom) {
        return current;
      }

      if (current && current.effectiveFrom === effectiveFrom) {
        const [updated] = await tx
          .update(schema.customerPrices)
          .set({ specialPrice, notes: dto.notes ?? current.notes })
          .where(eq(schema.customerPrices.id, current.id))
          .returning();
        return updated;
      }

      if (current) {
        await tx
          .update(schema.customerPrices)
          .set({ effectiveTo: sql`(${effectiveFrom}::date - interval '1 day')::date` })
          .where(eq(schema.customerPrices.id, current.id));
      }

      const [created] = await tx
        .insert(schema.customerPrices)
        .values({
          tenantId,
          customerId: dto.customerId,
          variantId: dto.variantId,
          specialPrice,
          notes: dto.notes,
          effectiveFrom,
          createdBy: userId,
        })
        .returning();

      if (!created) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the negotiated price");
      return created;
    });
  }

  async listCustomerPrices(customerId: string): Promise<unknown[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(schema.customerPrices)
        .where(eq(schema.customerPrices.customerId, customerId))
        .orderBy(sql`${schema.customerPrices.effectiveFrom} desc`),
    );
  }
}
