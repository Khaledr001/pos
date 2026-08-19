import { and, eq, schema } from "@devsfleet/db";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
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

  /** Warranty and provenance lookup: one serial, wherever it is in its life. */
  async findBySerial(serial: string): Promise<unknown> {
    const found = await this.db.run(async (tx) =>
      tx.query.serialNumbers.findFirst({
        where: (t, { eq: e }) => e(t.serial, serial.trim()),
      }),
    );
    if (!found) throw new AppError(ERROR_CODES.NOT_FOUND, `Serial ${serial} not found`);
    if (found.branchId) assertBranchInScope(found.branchId);

    const [variant, saleItem] = await Promise.all([
      this.db.run(async (tx) =>
        tx.query.productVariants.findFirst({
          where: (t, { eq: e }) => e(t.id, found.variantId),
          columns: { sku: true, variantName: true },
        }),
      ),
      found.saleItemId
        ? this.db.run(async (tx) =>
            tx.query.saleItems.findFirst({
              where: (t, { eq: e }) => e(t.id, found.saleItemId!),
              columns: { saleId: true },
            }),
          )
        : null,
    ]);

    return { ...found, variant, saleId: saleItem?.saleId ?? null };
  }

  async list(query: ListSerialsDto): Promise<unknown[]> {
    if (query.branchId) assertBranchInScope(query.branchId);

    return this.db.run(async (tx) =>
      tx
        .select({
          id: schema.serialNumbers.id,
          serial: schema.serialNumbers.serial,
          status: schema.serialNumbers.status,
          branchId: schema.serialNumbers.branchId,
          sku: schema.productVariants.sku,
          variantName: schema.productVariants.variantName,
        })
        .from(schema.serialNumbers)
        .innerJoin(
          schema.productVariants,
          eq(schema.serialNumbers.variantId, schema.productVariants.id),
        )
        .where(
          and(
            query.variantId ? eq(schema.serialNumbers.variantId, query.variantId) : undefined,
            query.status ? eq(schema.serialNumbers.status, query.status) : undefined,
            query.branchId ? eq(schema.serialNumbers.branchId, query.branchId) : undefined,
          ),
        )
        .orderBy(schema.serialNumbers.serial)
        .limit(200),
    );
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
