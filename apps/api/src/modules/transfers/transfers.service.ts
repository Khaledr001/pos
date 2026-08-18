import { and, count, desc, eq, schema, sql, or } from "@devsfleet/db";
import type { Paginated } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, id } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "../inventory/stock.service.js";
import type { CreateTransferDto, ListTransfersDto } from "./dto.js";
import { randomUUID } from "node:crypto";

@Injectable()
export class TransfersService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly stock: StockService,
  ) {}

  async create(dto: CreateTransferDto): Promise<{ id: string }> {
    const transferId = randomUUID();
    const transferNumber = id.generate("TRF-");
    const tenantId = RequestContext.tenantId();
    const userId = RequestContext.userId();

    await this.db.run(async (tx) => {
      await tx.insert(schema.stockTransfers).values({
        id: transferId,
        tenantId,
        transferNumber,
        fromBranchId: dto.fromBranchId,
        toBranchId: dto.toBranchId,
        status: "requested",
        notes: dto.notes,
        createdBy: userId,
      });

      const items = dto.items.map((item) => ({
        id: randomUUID(),
        tenantId,
        transferId,
        variantId: item.variantId,
        quantity: String(item.quantity),
        createdBy: userId,
      }));

      await tx.insert(schema.stockTransferItems).values(items);
    });

    return { id: transferId };
  }

  async list(query: ListTransfersDto): Promise<Paginated<unknown>> {
    const { page, limit, status, branchId, direction } = query;
    const offset = (page - 1) * limit;

    const where = and(
      status ? eq(schema.stockTransfers.status, status) : undefined,
      branchId
        ? direction === "incoming"
          ? eq(schema.stockTransfers.toBranchId, branchId)
          : direction === "outgoing"
            ? eq(schema.stockTransfers.fromBranchId, branchId)
            : or(
                eq(schema.stockTransfers.toBranchId, branchId),
                eq(schema.stockTransfers.fromBranchId, branchId)
              )
        : undefined
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
        tx
          .select({ value: count() })
          .from(schema.stockTransfers)
          .where(where),
      ]);

      const transferIds = items.map(i => i.id);
      let lineItems: any[] = [];
      
      if (transferIds.length > 0) {
        lineItems = await tx
          .select({
            transferId: schema.stockTransferItems.transferId,
            variantId: schema.stockTransferItems.variantId,
            quantity: schema.stockTransferItems.quantity,
            productName: schema.products.name,
            sku: schema.productVariants.sku,
          })
          .from(schema.stockTransferItems)
          .innerJoin(schema.productVariants, eq(schema.stockTransferItems.variantId, schema.productVariants.id))
          .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
          .where(sql`${schema.stockTransferItems.transferId} IN ${transferIds}`);
      }

      const results = items.map((item) => ({
        ...item,
        items: lineItems.filter(l => l.transferId === item.id),
      }));

      return {
        data: results,
        meta: {
          total: totals?.value ?? 0,
          page,
          limit,
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

      const items = await tx
        .select({
          id: schema.stockTransferItems.id,
          variantId: schema.stockTransferItems.variantId,
          quantity: schema.stockTransferItems.quantity,
          productName: schema.products.name,
          sku: schema.productVariants.sku,
        })
        .from(schema.stockTransferItems)
        .innerJoin(schema.productVariants, eq(schema.stockTransferItems.variantId, schema.productVariants.id))
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .where(eq(schema.stockTransferItems.transferId, id));

      return { ...record, items };
    });

    return transfer;
  }

  async approve(id: string) {
    await this.updateStatus(id, "requested", "approved");
    return { id };
  }

  async ship(id: string) {
    await this.db.run(async (tx) => {
      const transfer = await this.getInternal(tx, id);
      if (transfer.status !== "approved" && transfer.status !== "requested") {
        throw new AppError(ERROR_CODES.INVALID_STATE, "Transfer cannot be shipped from current status");
      }

      await tx
        .update(schema.stockTransfers)
        .set({ status: "shipped" })
        .where(eq(schema.stockTransfers.id, id));

      // Deduct stock from origin
      for (const item of transfer.items) {
        await this.stock.transferStock({
          variantId: item.variantId,
          branchId: transfer.fromBranchId,
          quantity: item.quantity,
          inbound: false, // Stock leaving
          referenceId: id,
          db: tx,
        });
      }
    });

    return { id };
  }

  async receive(id: string) {
    await this.db.run(async (tx) => {
      const transfer = await this.getInternal(tx, id);
      if (transfer.status !== "shipped") {
        throw new AppError(ERROR_CODES.INVALID_STATE, "Transfer cannot be received unless shipped");
      }

      await tx
        .update(schema.stockTransfers)
        .set({ status: "received" })
        .where(eq(schema.stockTransfers.id, id));

      // Add stock to destination
      for (const item of transfer.items) {
        await this.stock.transferStock({
          variantId: item.variantId,
          branchId: transfer.toBranchId,
          quantity: item.quantity,
          inbound: true, // Stock arriving
          referenceId: id,
          db: tx,
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
        .where(and(eq(schema.stockTransfers.id, id), eq(schema.stockTransfers.status, from as any)))
    );

    if (result.rowCount === 0) {
      throw new AppError(ERROR_CODES.INVALID_STATE, `Transfer could not be updated to ${to}`);
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
