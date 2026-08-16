import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, schema, sql } from "@devsfleet/db";
import type { Paginated } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "./stock.service.js";
import type {
  AdjustStockDto,
  ListStockDto,
  ListTransactionsDto,
  TransferStockDto,
} from "./dto.js";

/**
 * Reading stock, and the HTTP-facing operations that change it.
 *
 * Every mutation delegates to StockService — this class never touches
 * `inventory_transactions` itself. It exists to shape queries and enforce the
 * branch scope, not to be a second writer.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly stock: StockService,
  ) {}

  /**
   * Stock per variant per branch.
   *
   * `lowStockOnly` compares AVAILABLE (on hand minus reserved) against the
   * variant's threshold. Comparing on-hand alone would hide an item whose
   * entire shelf is already promised to a confirmed order.
   */
  async listStock(query: ListStockDto): Promise<Paginated<unknown>> {
    const { page, limit, q, branchId, categoryId, lowStockOnly } = query;
    const offset = (page - 1) * limit;
    this.assertBranchInScope(branchId);

    const where = and(
      branchId ? eq(schema.inventory.branchId, branchId) : undefined,
      categoryId ? eq(schema.products.categoryId, categoryId) : undefined,
      isNull(schema.productVariants.deletedAt),
      q
        ? or(
            ilike(schema.products.name, `%${q}%`),
            ilike(schema.productVariants.sku, `%${q}%`),
            eq(schema.productVariants.barcode, q),
          )
        : undefined,
      lowStockOnly
        ? sql`${schema.inventory.quantity} - ${schema.inventory.reservedQuantity} <= ${schema.productVariants.minStock}`
        : undefined,
    );

    return this.db.run(async (tx) => {
      const [items, [totals]] = await Promise.all([
        tx
          .select({
            variantId: schema.productVariants.id,
            sku: schema.productVariants.sku,
            barcode: schema.productVariants.barcode,
            variantName: schema.productVariants.variantName,
            productName: schema.products.name,
            categoryName: schema.categories.name,
            unitAbbr: schema.units.abbreviation,
            branchId: schema.inventory.branchId,
            branchName: schema.branches.name,
            quantity: schema.inventory.quantity,
            reservedQuantity: schema.inventory.reservedQuantity,
            available: sql<string>`(${schema.inventory.quantity} - ${schema.inventory.reservedQuantity})::text`,
            minStock: schema.productVariants.minStock,
            binLocation: schema.inventory.binLocation,
            updatedAt: schema.inventory.updatedAt,
          })
          .from(schema.inventory)
          .innerJoin(
            schema.productVariants,
            eq(schema.inventory.variantId, schema.productVariants.id),
          )
          .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
          .innerJoin(schema.units, eq(schema.products.unitId, schema.units.id))
          .innerJoin(schema.branches, eq(schema.inventory.branchId, schema.branches.id))
          .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
          .where(where)
          .orderBy(asc(schema.products.name), asc(schema.productVariants.sortOrder))
          .limit(limit)
          .offset(offset),
        tx
          .select({ value: count() })
          .from(schema.inventory)
          .innerJoin(
            schema.productVariants,
            eq(schema.inventory.variantId, schema.productVariants.id),
          )
          .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
          .where(where),
      ]);

      const total = totals?.value ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      return {
        items,
        meta: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      };
    });
  }

  /**
   * The stock card: every movement for a variant, newest first.
   *
   * This is the answer to "where did those twelve go?", so it shows the
   * reference document and the person, not just the number.
   */
  async listTransactions(query: ListTransactionsDto): Promise<Paginated<unknown>> {
    const { page, limit, variantId, branchId, type, from, to } = query;
    const offset = (page - 1) * limit;
    this.assertBranchInScope(branchId);

    const where = and(
      variantId ? eq(schema.inventoryTransactions.variantId, variantId) : undefined,
      branchId ? eq(schema.inventoryTransactions.branchId, branchId) : undefined,
      type ? eq(schema.inventoryTransactions.type, type) : undefined,
      from ? gte(schema.inventoryTransactions.createdAt, new Date(from)) : undefined,
      to ? lte(schema.inventoryTransactions.createdAt, new Date(`${to}T23:59:59.999Z`)) : undefined,
    );

    return this.db.run(async (tx) => {
      const [items, [totals]] = await Promise.all([
        tx
          .select({
            id: schema.inventoryTransactions.id,
            createdAt: schema.inventoryTransactions.createdAt,
            type: schema.inventoryTransactions.type,
            quantity: schema.inventoryTransactions.quantity,
            balanceAfter: schema.inventoryTransactions.balanceAfter,
            referenceType: schema.inventoryTransactions.referenceType,
            referenceId: schema.inventoryTransactions.referenceId,
            notes: schema.inventoryTransactions.notes,
            sku: schema.productVariants.sku,
            variantName: schema.productVariants.variantName,
            productName: schema.products.name,
            branchName: schema.branches.name,
            userName: schema.users.name,
          })
          .from(schema.inventoryTransactions)
          .innerJoin(
            schema.productVariants,
            eq(schema.inventoryTransactions.variantId, schema.productVariants.id),
          )
          .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
          .innerJoin(schema.branches, eq(schema.inventoryTransactions.branchId, schema.branches.id))
          .leftJoin(schema.users, eq(schema.inventoryTransactions.createdBy, schema.users.id))
          .where(where)
          .orderBy(desc(schema.inventoryTransactions.createdAt))
          .limit(limit)
          .offset(offset),
        tx
          .select({ value: count() })
          .from(schema.inventoryTransactions)
          .where(where),
      ]);

      const total = totals?.value ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      return {
        items,
        meta: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      };
    });
  }

  /** Set an absolute quantity. The reason is mandatory and lands in the ledger. */
  async adjust(dto: AdjustStockDto): Promise<{ delta: string; newQuantity: string }> {
    this.assertBranchInScope(dto.branchId);

    return this.db.run(async (tx) => {
      const { delta } = await this.stock.adjustStock({
        tx,
        variantId: dto.variantId,
        branchId: dto.branchId,
        newQuantity: String(dto.newQuantity),
        reason: dto.reason,
      });

      return {
        delta,
        newQuantity: await this.stock.getCurrentStock(tx, dto.variantId, dto.branchId),
      };
    });
  }

  /**
   * Move stock between branches.
   *
   * Both branches must be in the user's scope. A manager restricted to Dubai
   * must not be able to move stock out of Sharjah, which they cannot see and
   * cannot be held accountable for.
   */
  async transfer(dto: TransferStockDto): Promise<{ referenceId: string }> {
    this.assertBranchInScope(dto.fromBranchId);
    this.assertBranchInScope(dto.toBranchId);

    return this.db.run(async (tx) => {
      const { referenceId } = await this.stock.transferStock({
        tx,
        variantId: dto.variantId,
        fromBranchId: dto.fromBranchId,
        toBranchId: dto.toBranchId,
        quantity: String(dto.quantity),
        referenceId: randomUUID(),
        ...(dto.notes ? { notes: dto.notes } : {}),
      });
      return { referenceId };
    });
  }

  /**
   * What needs reordering, ordered by how far below the line it is.
   *
   * Sorted by shortfall rather than alphabetically: a buyer working down this
   * list should hit the items closest to stocking out first.
   */
  async lowStock(branchId?: string): Promise<unknown[]> {
    this.assertBranchInScope(branchId);

    return this.db.run(async (tx) =>
      tx
        .select({
          variantId: schema.productVariants.id,
          sku: schema.productVariants.sku,
          variantName: schema.productVariants.variantName,
          productName: schema.products.name,
          branchName: schema.branches.name,
          quantity: schema.inventory.quantity,
          available: sql<string>`(${schema.inventory.quantity} - ${schema.inventory.reservedQuantity})::text`,
          minStock: schema.productVariants.minStock,
          reorderQuantity: schema.productVariants.reorderQuantity,
          shortfall: sql<string>`(${schema.productVariants.minStock} - (${schema.inventory.quantity} - ${schema.inventory.reservedQuantity}))::text`,
        })
        .from(schema.inventory)
        .innerJoin(
          schema.productVariants,
          eq(schema.inventory.variantId, schema.productVariants.id),
        )
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .innerJoin(schema.branches, eq(schema.inventory.branchId, schema.branches.id))
        .where(
          and(
            branchId ? eq(schema.inventory.branchId, branchId) : undefined,
            isNull(schema.productVariants.deletedAt),
            eq(schema.productVariants.isActive, true),
            sql`${schema.productVariants.minStock} > 0`,
            sql`${schema.inventory.quantity} - ${schema.inventory.reservedQuantity} <= ${schema.productVariants.minStock}`,
          ),
        )
        .orderBy(
          desc(
            sql`${schema.productVariants.minStock} - (${schema.inventory.quantity} - ${schema.inventory.reservedQuantity})`,
          ),
        )
        .limit(200),
    );
  }

  /**
   * Total stock value at cost. Behind `report:financial`.
   *
   * Uses the branch's weighted-average cost rather than the current purchase
   * price — what the stock actually cost, not what replacing it would cost.
   */
  async valuation(branchId?: string): Promise<{ branches: unknown[]; total: string }> {
    this.assertBranchInScope(branchId);

    const rows = await this.db.run(async (tx) =>
      tx
        .select({
          branchId: schema.inventory.branchId,
          branchName: schema.branches.name,
          value: sql<string>`coalesce(sum(${schema.inventory.quantity} * coalesce(${schema.inventory.averageCost}, 0)), 0)::text`,
          variants: count(),
        })
        .from(schema.inventory)
        .innerJoin(schema.branches, eq(schema.inventory.branchId, schema.branches.id))
        .where(branchId ? eq(schema.inventory.branchId, branchId) : undefined)
        .groupBy(schema.inventory.branchId, schema.branches.name),
    );

    const total = rows.reduce<bigint>((sum, r) => sum + Money.toMinor(r.value), 0n);
    return { branches: rows, total: Money.toDecimalString(total, 2) };
  }

  /**
   * Refuse a branch the user is not scoped to.
   *
   * An empty `allowedBranchIds` means every branch — that is how an owner is
   * represented, and treating empty as "none" would lock them out of their own
   * business.
   */
  private assertBranchInScope(branchId?: string): void {
    if (!branchId) return;

    const user = RequestContext.get()?.user;
    if (!user || user.isPlatformAdmin) return;

    const allowed = user.abac.allowedBranchIds;
    if (allowed.length === 0) return;

    if (!allowed.includes(branchId)) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_PERMISSIONS,
        "You do not have access to that branch",
      );
    }
  }
}
