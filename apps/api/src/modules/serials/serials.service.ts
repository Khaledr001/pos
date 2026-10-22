import { and, asc, count, desc, eq, ilike, or, schema } from "@devsfleet/db";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope, branchFilter } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { containsPattern } from "../../common/db/list-query.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "../inventory/stock.service.js";
import type { ListSerialsDto, MarkDamagedDto } from "./dto.js";

type Transaction = Parameters<Parameters<TenantDatabase["run"]>[0]>[0];

/**
 * Serial numbers — identity tracking for the units the aggregate stock
 * ledger already counts.
 *
 * `inventory.quantity` says "12 of these on the shelf"; this table says WHICH
 * twelve, so a warranty claim or a theft report can be answered by unit
 * rather than by count. The two are kept in step by the callers, not by this
 * service: `checkIn` runs alongside `StockService.addStock` in the same
 * receipt, `assignAtSale` alongside `StockService.deductStock` in the same
 * sale — one line of business, one aggregate movement, one set of identities.
 *
 * Lifecycle: `available` -> `sold` -> `returned` -> `available`; any state ->
 * `damaged`, which is terminal. The `returned` leg belongs to a returns flow
 * that does not exist yet in this codebase (feature.md B2) — neither
 * `markReturned` nor `restock` exists here either. Write both alongside the
 * return service, not before it: a serial can only be marked returned as
 * part of the same transaction that records the return itself.
 */
@Injectable()
export class SerialsService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly stock: StockService,
  ) {}

  /**
   * Register serials arriving on a receipt.
   *
   * The count must match exactly — a receipt line for 10 units with 8 serials
   * means two units nobody can identify later, which defeats the entire point
   * of tracking them. Called from `PurchasesService.receive` inside its own
   * transaction, so a duplicate serial rolls back the whole receipt rather
   * than leaving stock added with no identity behind two of it.
   */
  async checkIn(
    tx: Transaction,
    input: { branchId: string; variantId: string; serials: string[] },
  ): Promise<void> {
    const tenantId = RequestContext.requireTenantId();
    const unique = new Set(input.serials.map((s) => s.trim()).filter(Boolean));

    if (unique.size !== input.serials.length) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "Duplicate serial number in this receipt");
    }

    await tx.insert(schema.serialNumbers).values(
      [...unique].map((serial) => ({
        tenantId,
        variantId: input.variantId,
        serial,
        status: "available" as const,
        branchId: input.branchId,
      })),
    );
  }

  /**
   * Consume specific units at the point of sale.
   *
   * Each serial is claimed with an UPDATE ... WHERE status = 'available',
   * not a SELECT-then-UPDATE: two cashiers racing to sell the same imei
   * must not both succeed, and the row lock inside the UPDATE is what
   * prevents it, not application-level checking.
   */
  async assignAtSale(
    tx: Transaction,
    input: { branchId: string; variantId: string; serials: string[]; saleItemId: string },
  ): Promise<void> {
    const tenantId = RequestContext.requireTenantId();

    for (const serial of input.serials) {
      const [claimed] = await tx
        .update(schema.serialNumbers)
        .set({ status: "sold", saleItemId: input.saleItemId })
        .where(
          and(
            eq(schema.serialNumbers.tenantId, tenantId),
            eq(schema.serialNumbers.variantId, input.variantId),
            eq(schema.serialNumbers.branchId, input.branchId),
            eq(schema.serialNumbers.serial, serial),
            eq(schema.serialNumbers.status, "available"),
          ),
        )
        .returning({ id: schema.serialNumbers.id });

      if (!claimed) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `Serial ${serial} is not available at this branch — it may already be sold, or was never checked in here.`,
        );
      }
    }
  }

  /**
   * Warranty and provenance lookup: one serial, wherever it is in its life.
   *
   * One joined read rather than ids to chase: the person at the counter with
   * a customer's drill in hand needs the product, where it was, and which
   * invoice it left on, not a uuid. The original fields are kept as they were.
   */
  async findBySerial(serial: string): Promise<unknown> {
    const [found] = await this.db.run(async (tx) =>
      tx
        .select({
          serial: schema.serialNumbers,
          productId: schema.products.id,
          productName: schema.products.name,
          sku: schema.productVariants.sku,
          variantName: schema.productVariants.variantName,
          branchName: schema.branches.name,
          branchCode: schema.branches.code,
          saleId: schema.sales.id,
          saleNumber: schema.sales.saleNumber,
          soldAt: schema.sales.occurredAt,
          saleStatus: schema.sales.status,
          customerId: schema.customers.id,
          customerName: schema.customers.name,
        })
        .from(schema.serialNumbers)
        .innerJoin(schema.productVariants, eq(schema.serialNumbers.variantId, schema.productVariants.id))
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .leftJoin(schema.branches, eq(schema.serialNumbers.branchId, schema.branches.id))
        .leftJoin(schema.saleItems, eq(schema.serialNumbers.saleItemId, schema.saleItems.id))
        .leftJoin(schema.sales, eq(schema.saleItems.saleId, schema.sales.id))
        .leftJoin(schema.customers, eq(schema.sales.customerId, schema.customers.id))
        .where(eq(schema.serialNumbers.serial, serial.trim()))
        .limit(1),
    );
    if (!found) throw new AppError(ERROR_CODES.NOT_FOUND, `Serial ${serial} not found`);
    if (found.serial.branchId) assertBranchInScope(found.serial.branchId);

    const { serial: row, ...context } = found;
    return {
      ...row,
      variant: { sku: context.sku, variantName: context.variantName },
      ...context,
      /** When it was checked in on a receipt — the row is written at receipt time. */
      receivedAt: row.createdAt,
    };
  }

  async list(query: ListSerialsDto): Promise<unknown> {
    const term = containsPattern(query.q);

    const where = and(
      query.variantId ? eq(schema.serialNumbers.variantId, query.variantId) : undefined,
      query.productId ? eq(schema.productVariants.productId, query.productId) : undefined,
      query.status ? eq(schema.serialNumbers.status, query.status) : undefined,
      branchFilter(schema.serialNumbers.branchId, query.branchId),
      term
        ? or(
            ilike(schema.serialNumbers.serial, term),
            ilike(schema.productVariants.sku, term),
            ilike(schema.products.name, term),
          )
        : undefined,
    );

    const sortColumn = {
      createdAt: schema.serialNumbers.createdAt,
      serial: schema.serialNumbers.serial,
      status: schema.serialNumbers.status,
      expiryDate: schema.serialNumbers.expiryDate,
    }[query.sortBy];

    return this.db.run(async (tx) => {
      // Same joins as the page: the search and the product filter reach into
      // variants and products, so a count without them counts the wrong rows.
      const [counted] = await tx
        .select({ value: count() })
        .from(schema.serialNumbers)
        .innerJoin(schema.productVariants, eq(schema.serialNumbers.variantId, schema.productVariants.id))
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .where(where);
      const total = counted?.value ?? 0;

      const items = await tx
        .select({
          id: schema.serialNumbers.id,
          serial: schema.serialNumbers.serial,
          status: schema.serialNumbers.status,
          branchId: schema.serialNumbers.branchId,
          branchName: schema.branches.name,
          branchCode: schema.branches.code,
          variantId: schema.serialNumbers.variantId,
          productId: schema.products.id,
          productName: schema.products.name,
          sku: schema.productVariants.sku,
          variantName: schema.productVariants.variantName,
          expiryDate: schema.serialNumbers.expiryDate,
          createdAt: schema.serialNumbers.createdAt,
          saleId: schema.sales.id,
          saleNumber: schema.sales.saleNumber,
        })
        .from(schema.serialNumbers)
        .innerJoin(schema.productVariants, eq(schema.serialNumbers.variantId, schema.productVariants.id))
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .leftJoin(schema.branches, eq(schema.serialNumbers.branchId, schema.branches.id))
        .leftJoin(schema.saleItems, eq(schema.serialNumbers.saleItemId, schema.saleItems.id))
        .leftJoin(schema.sales, eq(schema.saleItems.saleId, schema.sales.id))
        .where(where)
        .orderBy(
          query.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn),
          desc(schema.serialNumbers.id),
        )
        .limit(query.limit)
        .offset((query.page - 1) * query.limit);

      const totalPages = Math.max(1, Math.ceil(total / query.limit));
      return {
        items,
        meta: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages,
          hasNext: query.page < totalPages,
          hasPrev: query.page > 1,
        },
      };
    });
  }

  /**
   * Found broken. Terminal from any state, but only `available` moves stock:
   * a unit that was `sold` already left the ledger at sale time, and one
   * that is `returned` was never added back to it.
   */
  async markDamaged(id: string, dto: MarkDamagedDto): Promise<unknown> {
    return this.db.run(async (tx) => {
      const serial = await tx.query.serialNumbers.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
      });
      if (!serial) throw new AppError(ERROR_CODES.NOT_FOUND, "Serial not found");
      if (serial.branchId) assertBranchInScope(serial.branchId);

      if (serial.status === "damaged") {
        throw new AppError(ERROR_CODES.CONFLICT, "Already recorded as damaged");
      }

      if (serial.status === "available" && serial.branchId) {
        const current = await this.stock.getCurrentStock(tx, serial.variantId, serial.branchId);
        const target = Money.subtract(Money.toMinor(current), Money.toMinor("1"));
        await this.stock.adjustStock({
          tx,
          variantId: serial.variantId,
          branchId: serial.branchId,
          newQuantity: Money.toDecimalString(target, 4),
          reason: `Serial ${serial.serial} damaged: ${dto.reason}`,
          referenceType: "adjustment",
          referenceId: id,
        });
      }

      const [updated] = await tx
        .update(schema.serialNumbers)
        .set({ status: "damaged" })
        .where(eq(schema.serialNumbers.id, id))
        .returning();

      return updated;
    });
  }
}
