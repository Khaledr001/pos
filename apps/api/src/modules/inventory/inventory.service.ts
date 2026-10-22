import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, schema, sql } from "@devsfleet/db";
import { resolveTenantSettings, type Paginated } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { assertBranchInScope, branchFilter } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { containsPattern, localDateRange } from "../../common/db/list-query.js";
import { assertExportSize, type ExportColumn, type ExportSheet } from "../../common/http/send-export.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { StockService } from "./stock.service.js";
import type {
  AdjustStockDto,
  ExportStockDto,
  ExportTransactionsDto,
  ListStockDto,
  ListTransactionsDto,
  TransferStockDto,
} from "./dto.js";

type Transaction = Parameters<Parameters<TenantDatabase["run"]>[0]>[0];

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
  /** Shared by the stock list and its export. */
  private stockWhere(query: Omit<ListStockDto, "page" | "limit">) {
    const { q, branchId, categoryId, lowStockOnly } = query;
    assertBranchInScope(branchId);
    const term = containsPattern(q);

    return and(
      branchFilter(schema.inventory.branchId, branchId),
      categoryId ? eq(schema.products.categoryId, categoryId) : undefined,
      isNull(schema.productVariants.deletedAt),
      term
        ? or(
            ilike(schema.products.name, term),
            ilike(schema.productVariants.sku, term),
            eq(schema.productVariants.barcode, q!.trim()),
          )
        : undefined,
      lowStockOnly
        ? sql`${schema.inventory.quantity} - ${schema.inventory.reservedQuantity} <= ${schema.productVariants.minStock}`
        : undefined,
    );
  }

  private stockOrder(query: Pick<ListStockDto, "sortBy" | "sortOrder">) {
    const available = sql`${schema.inventory.quantity} - ${schema.inventory.reservedQuantity}`;
    const sortColumn = {
      productName: schema.products.name,
      sku: schema.productVariants.sku,
      available,
      branchName: schema.branches.name,
    }[query.sortBy];
    const direction = query.sortOrder === "asc" ? asc : desc;
    return [
      direction(sortColumn),
      asc(schema.productVariants.sortOrder),
      // Tiebreak: one variant held at two branches is two rows with the same
      // name, and they must not swap places between pages.
      asc(schema.inventory.id),
    ];
  }

  async listStock(query: ListStockDto): Promise<Paginated<unknown>> {
    const { page, limit } = query;
    const offset = (page - 1) * limit;
    const where = this.stockWhere(query);

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
          .orderBy(...this.stockOrder(query))
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
  /** Shared by the movement list and its export. Days are the business's days. */
  private transactionsWhere(query: Omit<ListTransactionsDto, "page" | "limit">, timeZone: string) {
    const { variantId, branchId, type } = query;
    assertBranchInScope(branchId);
    return and(
      variantId ? eq(schema.inventoryTransactions.variantId, variantId) : undefined,
      branchFilter(schema.inventoryTransactions.branchId, branchId),
      type ? eq(schema.inventoryTransactions.type, type) : undefined,
      localDateRange(schema.inventoryTransactions.createdAt, query, timeZone),
    );
  }

  private async timeZone(tx: Transaction): Promise<string> {
    const tenant = await tx.query.tenants.findFirst({ columns: { settings: true } });
    return resolveTenantSettings(tenant?.settings).locale.timezone;
  }

  async listTransactions(query: ListTransactionsDto): Promise<Paginated<unknown>> {
    const { page, limit } = query;
    const offset = (page - 1) * limit;

    return this.db.run(async (tx) => {
      const where = this.transactionsWhere(query, await this.timeZone(tx));
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
    assertBranchInScope(dto.branchId);

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
    assertBranchInScope(dto.fromBranchId);
    assertBranchInScope(dto.toBranchId);

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
    assertBranchInScope(branchId);

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
            branchFilter(schema.inventory.branchId, branchId),
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
    assertBranchInScope(branchId);

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
        .where(branchFilter(schema.inventory.branchId, branchId))
        .groupBy(schema.inventory.branchId, schema.branches.name),
    );

    const total = rows.reduce<bigint>((sum, r) => sum + Money.toMinor(r.value), 0n);
    return { branches: rows, total: Money.toDecimalString(total, 2) };
  }

  /**
   * Stock on hand, every line the filter matches. Cost and value only for a
   * user allowed to see cost — the same rule as the screen.
   */
  async exportStock(query: ExportStockDto): Promise<{ timeZone: string; sheets: ExportSheet<any>[] }> {
    const where = this.stockWhere(query);
    const canViewCost = RequestContext.get()?.user?.abac.canViewCost ?? false;

    return this.db.run(async (tx) => {
      const timeZone = await this.timeZone(tx);
      const [counted] = await tx
        .select({ value: count() })
        .from(schema.inventory)
        .innerJoin(schema.productVariants, eq(schema.inventory.variantId, schema.productVariants.id))
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .where(where);
      assertExportSize(counted?.value ?? 0);

      const rows = await tx
        .select({
          sku: schema.productVariants.sku,
          barcode: schema.productVariants.barcode,
          productName: schema.products.name,
          variantName: schema.productVariants.variantName,
          categoryName: schema.categories.name,
          unitAbbr: schema.units.abbreviation,
          branchCode: schema.branches.code,
          quantity: schema.inventory.quantity,
          reservedQuantity: schema.inventory.reservedQuantity,
          available: sql<string>`(${schema.inventory.quantity} - ${schema.inventory.reservedQuantity})::text`,
          minStock: schema.productVariants.minStock,
          binLocation: schema.inventory.binLocation,
          averageCost: schema.inventory.averageCost,
          value: sql<string>`(${schema.inventory.quantity} * coalesce(${schema.inventory.averageCost}, 0))::text`,
        })
        .from(schema.inventory)
        .innerJoin(schema.productVariants, eq(schema.inventory.variantId, schema.productVariants.id))
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .leftJoin(schema.units, eq(schema.products.unitId, schema.units.id))
        .innerJoin(schema.branches, eq(schema.inventory.branchId, schema.branches.id))
        .leftJoin(schema.categories, eq(schema.products.categoryId, schema.categories.id))
        .where(where)
        .orderBy(...this.stockOrder(query));

      type Row = (typeof rows)[number];
      const columns: ExportColumn<Row>[] = [
        { header: "SKU", value: (r) => r.sku, width: 18 },
        { header: "Barcode", value: (r) => r.barcode, width: 16 },
        { header: "Product", value: (r) => r.productName, width: 36 },
        { header: "Variant", value: (r) => r.variantName, width: 18 },
        { header: "Category", value: (r) => r.categoryName, width: 18 },
        { header: "Unit", value: (r) => r.unitAbbr },
        { header: "Branch", value: (r) => r.branchCode },
        { header: "Bin", value: (r) => r.binLocation },
        { header: "On Hand", kind: "quantity", value: (r) => r.quantity },
        { header: "Reserved", kind: "quantity", value: (r) => r.reservedQuantity },
        { header: "Available", kind: "quantity", value: (r) => r.available },
        { header: "Min Stock", kind: "quantity", value: (r) => r.minStock },
      ];
      if (canViewCost) {
        columns.push(
          { header: "Average Cost", kind: "money", value: (r) => r.averageCost },
          { header: "Stock Value", kind: "money", value: (r) => r.value },
        );
      }
      return { timeZone, sheets: [{ name: "Stock", rows, columns }] };
    });
  }

  /** Every stock movement the filter matches, oldest first — a ledger reads forwards. */
  async exportTransactions(query: ExportTransactionsDto): Promise<{ timeZone: string; sheets: ExportSheet<any>[] }> {
    return this.db.run(async (tx) => {
      const timeZone = await this.timeZone(tx);
      const where = this.transactionsWhere(query, timeZone);

      const [counted] = await tx
        .select({ value: count() })
        .from(schema.inventoryTransactions)
        .where(where);
      assertExportSize(counted?.value ?? 0);

      const rows = await tx
        .select({
          createdAt: schema.inventoryTransactions.createdAt,
          type: schema.inventoryTransactions.type,
          sku: schema.productVariants.sku,
          productName: schema.products.name,
          variantName: schema.productVariants.variantName,
          branchCode: schema.branches.code,
          quantity: schema.inventoryTransactions.quantity,
          balanceAfter: schema.inventoryTransactions.balanceAfter,
          referenceType: schema.inventoryTransactions.referenceType,
          notes: schema.inventoryTransactions.notes,
          userName: schema.users.name,
        })
        .from(schema.inventoryTransactions)
        .innerJoin(schema.productVariants, eq(schema.inventoryTransactions.variantId, schema.productVariants.id))
        .innerJoin(schema.products, eq(schema.productVariants.productId, schema.products.id))
        .innerJoin(schema.branches, eq(schema.inventoryTransactions.branchId, schema.branches.id))
        .leftJoin(schema.users, eq(schema.inventoryTransactions.createdBy, schema.users.id))
        .where(where)
        .orderBy(asc(schema.inventoryTransactions.createdAt), asc(schema.inventoryTransactions.id));

      type Row = (typeof rows)[number];
      const columns: ExportColumn<Row>[] = [
        { header: "Date", kind: "datetime", value: (r) => r.createdAt, width: 18 },
        { header: "Type", value: (r) => r.type },
        { header: "SKU", value: (r) => r.sku, width: 18 },
        { header: "Product", value: (r) => r.productName, width: 36 },
        { header: "Variant", value: (r) => r.variantName, width: 18 },
        { header: "Branch", value: (r) => r.branchCode },
        { header: "Quantity", kind: "quantity", value: (r) => r.quantity },
        { header: "Balance After", kind: "quantity", value: (r) => r.balanceAfter },
        { header: "Reference", value: (r) => r.referenceType },
        { header: "By", value: (r) => r.userName },
        { header: "Notes", value: (r) => r.notes, width: 30 },
      ];
      return { timeZone, sheets: [{ name: "Stock Movements", rows, columns }] };
    });
  }
}
