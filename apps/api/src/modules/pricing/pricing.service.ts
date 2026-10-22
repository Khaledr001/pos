import { and, asc, eq, ilike, isNull, or, schema, sql, type Transaction } from "@devsfleet/db";
import type { PriceList, ProductPrice } from "@devsfleet/db";
import { hasPermission } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RequestContext } from "../../common/context/request-context.js";
import { containsPattern } from "../../common/db/list-query.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import {
  bulkPriceFingerprint,
  evaluateBulkPrice,
  type BulkPriceOutcome,
  type BulkPriceSkip,
  type CurrentPrices,
} from "./bulk-price.js";
import type {
  BulkPriceApplyDto,
  BulkPricePreviewDto,
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
 * The most rows one bulk re-price may touch. It is one transaction, and every
 * row is a read, a history insert and a price write — past this the lock is
 * held long enough to stall the tills.
 */
const BULK_PRICE_CAP = 10_000;

interface BulkPriceRow {
  priceId: string;
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  effectiveFrom: string;
  current: CurrentPrices;
}

type EvaluatedRow = BulkPriceRow & { outcome: BulkPriceOutcome };

type BulkPriceFilter = Pick<
  BulkPricePreviewDto,
  "priceListId" | "categoryId" | "brandId" | "supplierId" | "q" | "field" | "mode" | "direction" | "value" | "rounding" | "allowBelowFloor"
>;

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
    /** Ties every history row of one bulk re-price together. */
    batchId: string | null = null,
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
        importBatchId: batchId,
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
        importBatchId: batchId,
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

  // ---------------------------------------------------------------------------
  // Bulk re-price
  // ---------------------------------------------------------------------------

  /**
   * What a bulk re-price would do, without doing it. Counts cover every
   * matching row; only `items` is paged.
   */
  async previewBulkPrice(dto: BulkPricePreviewDto): Promise<unknown> {
    this.assertMayBreachFloor(dto.allowBelowFloor);

    return this.db.run(async (tx) => {
      const { priceList, rows } = await this.bulkPriceRows(tx, dto);
      const changing = rows.filter((r) => !r.outcome.skip && !r.outcome.unchanged);

      const shown =
        dto.show === "changing"
          ? changing
          : dto.show === "skipped"
            ? rows.filter((r) => r.outcome.skip)
            : rows;
      const start = (dto.page - 1) * dto.pageSize;

      return {
        priceList,
        totals: this.bulkPriceTotals(rows, changing),
        expectedCount: changing.length,
        fingerprint: bulkPriceFingerprint(changing),
        canOverrideFloor: this.mayOverrideFloor(),
        items: shown.slice(start, start + dto.pageSize).map((r) => ({
          variantId: r.variantId,
          sku: r.sku,
          productName: r.productName,
          variantName: r.variantName,
          current: r.current,
          old: r.outcome.old,
          new: r.outcome.new,
          difference:
            r.outcome.skip === "no_current_value"
              ? null
              : Money.toDecimalString(
                  Money.subtract(Money.toMinor(r.outcome.new), Money.toMinor(r.outcome.old)),
                  4,
                ),
          unchanged: r.outcome.unchanged,
          belowFloor: r.outcome.belowFloor,
          belowCost: r.outcome.belowCost,
          skip: r.outcome.skip,
        })),
        total: shown.length,
        page: dto.page,
        pageSize: dto.pageSize,
      };
    });
  }

  /**
   * Write what the preview showed — and only that.
   *
   * The set is recomputed here, inside the transaction, and must match the
   * preview the user confirmed in both size and content. Someone else
   * re-pricing in between, or a product joining the category, changes the
   * fingerprint, and the apply is refused rather than run against rows the
   * user never looked at.
   */
  async applyBulkPrice(dto: BulkPriceApplyDto): Promise<unknown> {
    this.assertMayBreachFloor(dto.allowBelowFloor);
    const tenantId = RequestContext.requireTenantId();
    const userId = RequestContext.requireUser().id;
    const batchId = randomUUID();

    return this.db.run(async (tx) => {
      const { priceList, rows } = await this.bulkPriceRows(tx, dto);
      const changing = rows.filter((r) => !r.outcome.skip && !r.outcome.unchanged);

      if (changing.length !== dto.expectedCount || bulkPriceFingerprint(changing) !== dto.fingerprint) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          "These prices have changed since the preview. Preview again before applying.",
        );
      }

      for (const row of changing) {
        const next = row.outcome.next;
        await this.applyProductPrice(
          tx,
          tenantId,
          {
            variantId: row.variantId,
            priceListId: priceList.id,
            sellingPrice: next.sellingPrice,
            // applyProductPrice writes what it is given; an omitted field
            // becomes NULL, so the untouched ones are passed through.
            ...(next.purchasePrice !== null ? { purchasePrice: next.purchasePrice } : {}),
            ...(next.minSellingPrice !== null ? { minSellingPrice: next.minSellingPrice } : {}),
            minQuantity: 1,
            reason: dto.reason,
          },
          userId,
          batchId,
        );
      }

      return {
        batchId,
        priceList,
        changed: changing.length,
        totals: this.bulkPriceTotals(rows, changing),
      };
    });
  }

  private mayOverrideFloor(): boolean {
    return hasPermission(RequestContext.requireUser().permissions, "price:override_floor");
  }

  private assertMayBreachFloor(requested: boolean): void {
    if (requested && !this.mayOverrideFloor()) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_PERMISSIONS,
        "Pricing below the minimum selling price needs price:override_floor.",
      );
    }
  }

  private bulkPriceTotals(rows: EvaluatedRow[], changing: EvaluatedRow[]) {
    const skipped: Record<BulkPriceSkip, number> = {
      no_current_value: 0,
      not_positive: 0,
      below_floor: 0,
      scheduled: 0,
    };
    let unchanged = 0;
    for (const r of rows) {
      if (r.outcome.skip) skipped[r.outcome.skip] += 1;
      else if (r.outcome.unchanged) unchanged += 1;
    }
    return {
      matched: rows.length,
      changing: changing.length,
      unchanged,
      skipped,
      skippedTotal: Object.values(skipped).reduce((a, b) => a + b, 0),
      /** Of the lines that will be written. */
      belowCost: changing.filter((r) => r.outcome.belowCost).length,
      belowFloor: changing.filter((r) => r.outcome.belowFloor).length,
    };
  }

  /**
   * The base-tier current prices the filters select, each already evaluated.
   * Read through RLS like everything else; the category filter walks the
   * tree by `parent_id` so a parent category brings its subcategories.
   */
  private async bulkPriceRows(
    tx: Transaction,
    filter: BulkPriceFilter,
  ): Promise<{ priceList: { id: string; name: string }; rows: EvaluatedRow[] }> {
    const priceList = await tx.query.priceLists.findFirst({
      where: (t, { and: a, eq: e }) =>
        filter.priceListId ? e(t.id, filter.priceListId) : a(e(t.isDefault, true), e(t.isActive, true)),
      columns: { id: true, name: true },
    });
    if (!priceList) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        filter.priceListId ? "That price list does not exist." : "There is no default price list.",
      );
    }

    const term = containsPattern(filter.q);
    const found = await tx
      .select({
        priceId: schema.productPrices.id,
        variantId: schema.productVariants.id,
        sku: schema.productVariants.sku,
        productName: schema.products.name,
        variantName: schema.productVariants.variantName,
        effectiveFrom: schema.productPrices.effectiveFrom,
        sellingPrice: schema.productPrices.sellingPrice,
        purchasePrice: schema.productPrices.purchasePrice,
        minSellingPrice: schema.productPrices.minSellingPrice,
      })
      .from(schema.productPrices)
      .innerJoin(schema.productVariants, eq(schema.productVariants.id, schema.productPrices.variantId))
      .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
      .where(
        and(
          eq(schema.productPrices.priceListId, priceList.id),
          sql`${schema.productPrices.minQuantity} = 1`,
          isNull(schema.productPrices.effectiveTo),
          isNull(schema.productVariants.deletedAt),
          isNull(schema.products.deletedAt),
          filter.categoryId
            ? sql`${schema.products.categoryId} IN (
                WITH RECURSIVE sub AS (
                  SELECT id FROM categories WHERE id = ${filter.categoryId}
                  UNION ALL
                  SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
                )
                SELECT id FROM sub
              )`
            : undefined,
          filter.brandId ? eq(schema.products.brandId, filter.brandId) : undefined,
          filter.supplierId
            ? sql`EXISTS (
                SELECT 1 FROM ${schema.productSupplierLinks}
                WHERE ${schema.productSupplierLinks.variantId} = ${schema.productVariants.id}
                  AND ${schema.productSupplierLinks.supplierId} = ${filter.supplierId}
              )`
            : undefined,
          term
            ? or(ilike(schema.products.name, term), ilike(schema.productVariants.sku, term))
            : undefined,
        ),
      )
      .orderBy(asc(schema.products.name), asc(schema.productVariants.sku), asc(schema.productPrices.id))
      .limit(BULK_PRICE_CAP + 1);

    if (found.length > BULK_PRICE_CAP) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `That matches more than ${BULK_PRICE_CAP.toLocaleString("en")} prices. Narrow it by category, brand or supplier and apply in parts.`,
      );
    }

    const day = today();
    const change = {
      field: filter.field,
      mode: filter.mode,
      direction: filter.direction,
      value: filter.value,
      rounding: filter.rounding,
    };
    const rows = found.map((f): EvaluatedRow => {
      const current: CurrentPrices = {
        sellingPrice: f.sellingPrice,
        purchasePrice: f.purchasePrice ?? null,
        minSellingPrice: f.minSellingPrice ?? null,
      };
      const outcome = evaluateBulkPrice(current, change, { allowBelowFloor: filter.allowBelowFloor });
      return {
        priceId: f.priceId,
        variantId: f.variantId,
        sku: f.sku,
        productName: f.productName,
        variantName: f.variantName,
        effectiveFrom: f.effectiveFrom,
        current,
        outcome: f.effectiveFrom > day ? { ...outcome, skip: "scheduled" } : outcome,
      };
    });

    return { priceList, rows };
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
