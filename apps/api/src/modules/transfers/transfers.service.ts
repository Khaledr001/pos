import { and, count, desc, eq, inArray, schema, sql, or } from "@devsfleet/db";
import type { Paginated } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope, branchScope } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "../inventory/stock.service.js";
import type { CreateTransferDto, ListTransfersDto } from "./dto.js";

/** Scope test that answers rather than throws — `get` needs either end to pass. */
function inScope(branchId: string | null): boolean {
  const scope = branchScope();
  return scope === null || (branchId !== null && scope.includes(branchId));
}

@Injectable()
export class TransfersService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly stock: StockService,
  ) {}

  async create(dto: CreateTransferDto): Promise<{ id: string }> {
    /**
     * Both ends are checked. Requesting stock INTO a branch you do not run is
     * not a transfer, it is a way to empty someone else's shelves; requesting
     * it OUT of one you do not run is the same thing from the other side.
     */
    assertBranchInScope(dto.fromBranchId);
    assertBranchInScope(dto.toBranchId);

    if (dto.fromBranchId === dto.toBranchId) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        "A transfer needs two different branches",
      );
    }

    const transferNumber = "TRF-" + Date.now().toString(36).toUpperCase();
    const tenantId = RequestContext.requireTenantId();
    const userId = RequestContext.requireUser().id;

    return this.db.run(async (tx) => {
      const [transfer] = await tx
        .insert(schema.stockTransfers)
        .values({
          tenantId,
          transferNumber,
          fromBranchId: dto.fromBranchId,
          toBranchId: dto.toBranchId,
          status: "requested",
          notes: dto.notes,
          requestedBy: userId,
        })
        .returning();

      if (!transfer) {
        throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Transfer creation failed");
      }

      const items = dto.items.map((item) => ({
        tenantId,
        transferId: transfer.id,
        variantId: item.variantId,
        requestedQuantity: String(item.quantity),
      }));

      await tx.insert(schema.stockTransferItems).values(items);

      return { id: transfer.id };
    });
  }

  async list(query: ListTransfersDto): Promise<Paginated<unknown>> {
    const { page, limit, status, branchId, direction } = query;
    const offset = (page - 1) * limit;

    // A scoped user sees transfers that touch one of their branches, at either
    // end. Without this an unfiltered list showed the whole estate's movements.
    const scope = branchScope();
    const where = and(
      status ? eq(schema.stockTransfers.status, status) : undefined,
      scope
        ? or(
            inArray(schema.stockTransfers.fromBranchId, scope),
            inArray(schema.stockTransfers.toBranchId, scope),
          )
        : undefined,
      branchId
        ? direction === "incoming"
          ? eq(schema.stockTransfers.toBranchId, branchId)
          : direction === "outgoing"
            ? eq(schema.stockTransfers.fromBranchId, branchId)
            : or(
                eq(schema.stockTransfers.toBranchId, branchId),
                eq(schema.stockTransfers.fromBranchId, branchId),
              )
        : undefined,
    );

    return this.db.run(async (tx) => {
      const [items, [totals]] = await Promise.all([
        tx
          .select({
            id: schema.stockTransfers.id,
            transferNumber: schema.stockTransfers.transferNumber,
            fromBranchId: schema.stockTransfers.fromBranchId,
            toBranchId: schema.stockTransfers.toBranchId,
            status: schema.stockTransfers.status,
            createdAt: schema.stockTransfers.createdAt,
            notes: schema.stockTransfers.notes,
          })
          .from(schema.stockTransfers)
          .where(where)
          .orderBy(desc(schema.stockTransfers.createdAt))
          .limit(limit)
          .offset(offset),
        tx.select({ value: count() }).from(schema.stockTransfers).where(where),
      ]);

      const transferIds = items.map((i) => i.id);
      let lineItems: any[] = [];

      if (transferIds.length > 0) {
        lineItems = await tx
          .select({
            transferId: schema.stockTransferItems.transferId,
            variantId: schema.stockTransferItems.variantId,
            quantity: schema.stockTransferItems.requestedQuantity,
            productName: schema.products.name,
            sku: schema.productVariants.sku,
          })
          .from(schema.stockTransferItems)
          .innerJoin(
            schema.productVariants,
            eq(schema.stockTransferItems.variantId, schema.productVariants.id),
          )
          .innerJoin(
            schema.products,
            eq(schema.productVariants.productId, schema.products.id),
          )
          .where(sql`${schema.stockTransferItems.transferId} IN ${transferIds}`);
      }

      const results = items.map((item) => ({
        ...item,
        items: lineItems.filter((l) => l.transferId === item.id),
      }));

      const total = totals?.value ?? 0;
      const totalPages = Math.ceil(total / limit);

      return {
        items: results,
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    });
  }

  async get(id: string) {
    const transfer = await this.db.run(async (tx) => {
      const record = await tx
        .select()
        .from(schema.stockTransfers)
        .where(eq(schema.stockTransfers.id, id))
        .limit(1)
        .then((res) => res[0]);

      if (!record) {
        throw new AppError(ERROR_CODES.NOT_FOUND, "Transfer not found");
      }
      // Scoped at either end: both branches are party to the movement.
      if (!inScope(record.fromBranchId) && !inScope(record.toBranchId)) {
        assertBranchInScope(record.fromBranchId);
      }

      const items = await tx
        .select({
          id: schema.stockTransferItems.id,
          variantId: schema.stockTransferItems.variantId,
          quantity: schema.stockTransferItems.requestedQuantity,
          productName: schema.products.name,
          sku: schema.productVariants.sku,
        })
        .from(schema.stockTransferItems)
        .innerJoin(
          schema.productVariants,
          eq(schema.stockTransferItems.variantId, schema.productVariants.id),
        )
        .innerJoin(
          schema.products,
          eq(schema.productVariants.productId, schema.products.id),
        )
        .where(eq(schema.stockTransferItems.transferId, id));

      return { ...record, items };
    });

    return transfer;
  }

  async approve(id: string) {
    // The source branch is the one giving up stock, so that is the scope that
    // matters for approval.
    const transfer = await this.db.run((tx) => this.getInternal(tx, id));
    assertBranchInScope(transfer.fromBranchId);

    await this.updateStatus(id, "requested", "approved");
    return { id };
  }

  async ship(id: string) {
    await this.db.run(async (tx) => {
      const transfer = await this.getInternal(tx, id);

      /**
       * Approved only.
       *
       * `requested` used to be accepted here, which meant `transfer:approve`
       * never had to be held by anybody: the same person could raise a request
       * and ship against it, moving stock between branches with no second pair
       * of eyes and no record that anyone reviewed it.
       */
      if (transfer.status !== "approved") {
        throw new AppError(
          ERROR_CODES.TRANSFER_INVALID_STATUS,
          transfer.status === "requested"
            ? "This transfer has not been approved yet"
            : "Transfer cannot be shipped from its current status",
        );
      }
      assertBranchInScope(transfer.fromBranchId);

      const userId = RequestContext.requireUser().id;
      await tx
        .update(schema.stockTransfers)
        .set({ status: "shipped", shippedBy: userId, shippedAt: new Date() })
        .where(eq(schema.stockTransfers.id, id));

      for (const item of transfer.items) {
        await this.stock.deductStock({
          tx,
          variantId: item.variantId,
          branchId: transfer.fromBranchId,
          quantity: item.requestedQuantity,
          referenceType: "stock_transfer",
          referenceId: id,
        });
      }
    });

    return { id };
  }

  async receive(id: string) {
    await this.db.run(async (tx) => {
      const transfer = await this.getInternal(tx, id);
      if (transfer.status !== "shipped") {
        throw new AppError(
          ERROR_CODES.TRANSFER_INVALID_STATUS,
          "Transfer cannot be received unless shipped",
        );
      }
      assertBranchInScope(transfer.toBranchId);

      const userId = RequestContext.requireUser().id;
      await tx
        .update(schema.stockTransfers)
        .set({ status: "received", receivedBy: userId, receivedAt: new Date() })
        .where(eq(schema.stockTransfers.id, id));

      for (const item of transfer.items) {
        await this.stock.addStock({
          tx,
          variantId: item.variantId,
          branchId: transfer.toBranchId,
          quantity: item.requestedQuantity,
          referenceType: "stock_transfer",
          referenceId: id,
        });
      }
    });

    return { id };
  }

  private async updateStatus(id: string, from: string, to: any) {
    const result = await this.db.run((tx) =>
      tx
        .update(schema.stockTransfers)
        .set({ status: to })
        .where(
          and(
            eq(schema.stockTransfers.id, id),
            eq(schema.stockTransfers.status, from as any),
          ),
        )
        .returning(),
    );

    if (result.length === 0) {
      throw new AppError(ERROR_CODES.CONFLICT, `Transfer could not be updated to ${to}`);
    }
  }

  private async getInternal(tx: any, id: string) {
    const record = await tx
      .select()
      .from(schema.stockTransfers)
      .where(eq(schema.stockTransfers.id, id))
      .limit(1)
      .then((res: any[]) => res[0]);

    if (!record) {
      throw new AppError(ERROR_CODES.NOT_FOUND, "Transfer not found");
    }

    const items = await tx
      .select()
      .from(schema.stockTransferItems)
      .where(eq(schema.stockTransferItems.transferId, id));

    return { ...record, items };
  }
}
