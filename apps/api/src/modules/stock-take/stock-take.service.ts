import { and, count, desc, eq, isNull, schema, sql } from "@devsfleet/db";
import {
  AppError,
  ERROR_CODES,
  Money,
  formatDocumentNumber,
  sequenceKey,
} from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope, requireBranchId } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "../inventory/stock.service.js";
import type {
  ApproveCountDto,
  CreateStockCountDto,
  EnterCountDto,
  ListStockCountsDto,
} from "./dto.js";

type Transaction = Parameters<Parameters<TenantDatabase["run"]>[0]>[0];

/**
 * Stock take.
 *
 * draft → counting → pending_approval → approved, and nothing moves until the
 * last step. That gap is the whole point: counting is done by whoever is on the
 * floor, and writing off the difference is a decision with money attached.
 * Collapsing the two would let anyone with a clipboard make stock disappear.
 *
 * The system quantity is captured when the sheet is GENERATED, not when it is
 * approved. Otherwise a sale rung up mid-count would show as a variance the
 * counter has no way to explain.
 */
@Injectable()
export class StockTakeService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly stock: StockService,
  ) {}

  /**
   * Generate a count sheet.
   *
   * Every variant that could be on the shelf, including the ones the system
   * believes are at zero — a count that only lists what the system expects can
   * never find stock nobody knew about, which is half of what a count is for.
   */
  async create(dto: CreateStockCountDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();
    const branchId = requireBranchId(dto.branchId);

    return this.db.run(async (tx) => {
      const open = await tx.query.stockCounts.findFirst({
        where: (t, { and: a, eq: e, inArray: i }) =>
          a(e(t.branchId, branchId), i(t.status, ["draft", "counting", "pending_approval"])),
      });

      if (open) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          "A stock count is already in progress at this branch. Finish or cancel it first.",
          { stockCountId: open.id },
        );
      }

      const countNumber = await this.nextNumber(tx, branchId);

      const [stockCount] = await tx
        .insert(schema.stockCounts)
        .values({
          tenantId,
          branchId,
          countNumber,
          status: "counting",
          ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
          countedBy: user.id,
          ...(dto.notes ? { notes: dto.notes } : {}),
        })
        .returning();

      if (!stockCount) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not start the count");

      /**
       * Built in ONE statement rather than a row per variant.
       *
       * A full count on a 5,000-SKU catalogue is 5,000 inserts otherwise, in a
       * transaction that holds while somebody's browser waits.
       */
      const inserted = await tx.execute<{ inserted: number }>(sql`
        INSERT INTO stock_count_items (tenant_id, stock_count_id, variant_id, system_quantity)
        SELECT
          ${tenantId}::uuid,
          ${stockCount.id}::uuid,
          v.id,
          COALESCE(i.quantity, 0)
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        LEFT JOIN inventory i ON i.variant_id = v.id AND i.branch_id = ${branchId}::uuid
        WHERE v.deleted_at IS NULL
          AND v.is_active = true
          AND p.deleted_at IS NULL
          AND p.is_stock_tracked = true
          ${dto.categoryId ? sql`AND p.category_id = ${dto.categoryId}::uuid` : sql``}
      `);

      return { ...stockCount, itemCount: inserted.length };
    });
  }

  /** Enter what was on the shelf. Variance is stored, so no report recomputes it. */
  async enterCount(
    stockCountId: string,
    itemId: string,
    dto: EnterCountDto,
  ): Promise<unknown> {
    return this.db.run(async (tx) => {
      const stockCount = await this.requireCount(tx, stockCountId);

      if (stockCount.status !== "counting" && stockCount.status !== "draft") {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `This count is ${stockCount.status}. Counts can no longer be entered.`,
        );
      }

      const item = await tx.query.stockCountItems.findFirst({
        where: (t, { and: a, eq: e }) => a(e(t.id, itemId), e(t.stockCountId, stockCountId)),
      });
      if (!item) throw new AppError(ERROR_CODES.NOT_FOUND, "That line is not on this count sheet");

      const counted = Money.toMinor(String(dto.countedQuantity));
      const variance = Money.subtract(counted, Money.toMinor(item.systemQuantity));

      const [updated] = await tx
        .update(schema.stockCountItems)
        .set({
          countedQuantity: Money.toDecimalString(counted, 4),
          variance: Money.toDecimalString(variance, 4),
          ...(dto.notes ? { notes: dto.notes } : {}),
        })
        .where(eq(schema.stockCountItems.id, itemId))
        .returning();

      return updated;
    });
  }

  /** Hand it to someone who can approve it. Counting stops here. */
  async submit(id: string): Promise<unknown> {
    return this.db.run(async (tx) => {
      const stockCount = await this.requireCount(tx, id);
      if (stockCount.status !== "counting" && stockCount.status !== "draft") {
        throw new AppError(ERROR_CODES.CONFLICT, `This count is already ${stockCount.status}`);
      }

      const [progress] = await tx
        .select({
          uncounted: sql<number>`count(*) FILTER (WHERE counted_quantity IS NULL)::int`,
        })
        .from(schema.stockCountItems)
        .where(eq(schema.stockCountItems.stockCountId, id));

      // An uncounted line is not the same as a line counted at zero, and
      // approving would silently write every skipped shelf down to nothing.
      if ((progress?.uncounted ?? 0) > 0) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `${progress!.uncounted} lines have not been counted. Enter 0 for anything genuinely absent.`,
        );
      }

      await tx
        .update(schema.stockCounts)
        .set({ status: "pending_approval" })
        .where(eq(schema.stockCounts.id, id));

      return this.findById(id, tx);
    });
  }

  /**
   * Approve, and post every variance to the ledger.
   *
   * This is the only step that moves stock. Each variance becomes its own
   * adjustment row carrying the count's number, so a year later the question
   * "why did we lose eleven of these" has an answer attached to a document.
   */
  async approve(id: string, dto: ApproveCountDto): Promise<unknown> {
    const user = RequestContext.requireUser();

    return this.db.run(async (tx) => {
      const stockCount = await this.requireCount(tx, id);

      if (stockCount.status !== "pending_approval") {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          stockCount.status === "approved"
            ? "This count has already been posted and cannot be posted twice."
            : "Submit the count for approval before posting it.",
        );
      }

      const items = await tx.query.stockCountItems.findMany({
        where: (t, { and: a, eq: e, isNotNull: nn }) =>
          a(e(t.stockCountId, id), nn(t.countedQuantity)),
      });

      let posted = 0;
      let shrinkage = 0n;

      for (const item of items) {
        const variance = Money.toMinor(item.variance ?? "0");
        if (variance === 0n) continue;

        /**
         * `adjustStock` takes the TARGET quantity, not the delta, and
         * recomputes the difference against live stock inside the same
         * transaction. That matters: a sale rung up between the count and the
         * approval must not be silently undone by writing the counted figure
         * as though nothing had happened since.
         */
        await this.stock.adjustStock({
          tx,
          variantId: item.variantId,
          branchId: stockCount.branchId,
          newQuantity: item.countedQuantity!,
          reason: `${stockCount.countNumber}: ${dto.reason}`,
          referenceType: "stock_count",
          referenceId: id,
        });

        posted += 1;
        if (Money.isNegative(variance)) shrinkage = Money.add(shrinkage, variance);
      }

      await tx
        .update(schema.stockCounts)
        .set({
          status: "approved",
          approvedBy: user.id,
          approvedAt: new Date(),
        })
        .where(eq(schema.stockCounts.id, id));

      return {
        ...(await this.findById(id, tx) as object),
        postedLines: posted,
        shrinkageUnits: Money.toDecimalString(shrinkage, 4),
      };
    });
  }

  /** Abandon without posting anything. The sheet stays, as a record it happened. */
  async cancel(id: string): Promise<unknown> {
    return this.db.run(async (tx) => {
      const stockCount = await this.requireCount(tx, id);
      if (stockCount.status === "approved") {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          "This count has been posted. Correct it with a new count, not by cancelling.",
        );
      }

      await tx
        .update(schema.stockCounts)
        .set({ status: "cancelled" })
        .where(eq(schema.stockCounts.id, id));

      return this.findById(id, tx);
    });
  }

  async findById(id: string, existing?: Transaction): Promise<unknown> {
    const read = async (tx: Transaction) => {
      const stockCount = await this.requireCount(tx, id);

      const items = await tx
        .select({
          id: schema.stockCountItems.id,
          variantId: schema.stockCountItems.variantId,
          sku: schema.productVariants.sku,
          productName: schema.products.name,
          variantName: schema.productVariants.variantName,
          systemQuantity: schema.stockCountItems.systemQuantity,
          countedQuantity: schema.stockCountItems.countedQuantity,
          variance: schema.stockCountItems.variance,
          notes: schema.stockCountItems.notes,
        })
        .from(schema.stockCountItems)
        .innerJoin(
          schema.productVariants,
          eq(schema.stockCountItems.variantId, schema.productVariants.id),
        )
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .where(eq(schema.stockCountItems.stockCountId, id))
        .orderBy(schema.products.name, schema.productVariants.sku);

      return { ...stockCount, items };
    };

    return existing ? read(existing) : this.db.run(read);
  }

  async list(query: ListStockCountsDto): Promise<{ items: unknown[]; total: number }> {
    if (query.branchId) assertBranchInScope(query.branchId);

    return this.db.run(async (tx) => {
      const where = and(
        query.branchId ? eq(schema.stockCounts.branchId, query.branchId) : undefined,
        query.status ? eq(schema.stockCounts.status, query.status) : undefined,
      );

      const [total] = await tx.select({ value: count() }).from(schema.stockCounts).where(where);

      const items = await tx
        .select({
          id: schema.stockCounts.id,
          countNumber: schema.stockCounts.countNumber,
          status: schema.stockCounts.status,
          branchName: schema.branches.name,
          createdAt: schema.stockCounts.createdAt,
          approvedAt: schema.stockCounts.approvedAt,
          lineCount: sql<number>`(
            SELECT count(*)::int FROM stock_count_items s
            WHERE s.stock_count_id = stock_counts.id
          )`,
          varianceLines: sql<number>`(
            SELECT count(*)::int FROM stock_count_items s
            WHERE s.stock_count_id = stock_counts.id AND s.variance <> 0
          )`,
        })
        .from(schema.stockCounts)
        .innerJoin(schema.branches, eq(schema.stockCounts.branchId, schema.branches.id))
        .where(where)
        .orderBy(desc(schema.stockCounts.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return { items, total: total?.value ?? 0 };
    });
  }

  // ---------------------------------------------------------------------------

  private async requireCount(tx: Transaction, id: string) {
    const stockCount = await tx.query.stockCounts.findFirst({
      where: (t, { eq: e }) => e(t.id, id),
    });
    if (!stockCount) throw new AppError(ERROR_CODES.NOT_FOUND, `Stock count ${id} not found`);
    assertBranchInScope(stockCount.branchId);
    return stockCount;
  }

  private async nextNumber(tx: Transaction, branchId: string): Promise<string> {
    const tenantId = RequestContext.requireTenantId();
    const year = new Date().getFullYear();

    const branch = await tx.query.branches.findFirst({
      where: (t, { eq: e }) => e(t.id, branchId),
      columns: { code: true },
    });

    const [seq] = await tx.execute<{ next_document_number: number }>(
      sql`SELECT next_document_number(${tenantId}::uuid, ${sequenceKey("stock_count", year, branch?.code ?? null)})`,
    );

    return formatDocumentNumber({
      kind: "stock_count",
      year,
      sequence: Number((seq as { next_document_number?: number })?.next_document_number ?? 1),
      ...(branch?.code ? { branchCode: branch.code } : {}),
    });
  }
}
