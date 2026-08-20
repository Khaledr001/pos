import { and, eq, schema, sql } from "@devsfleet/db";
import { Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope } from "../../common/context/branch-scope.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { InventoryReportDto, ReportRangeDto, TopProductsDto } from "./dto.js";

type Transaction = Parameters<Parameters<TenantDatabase["run"]>[0]>[0];

/**
 * Reporting.
 *
 * Read-only, and computed from the documents rather than from a cache. Every
 * figure here traces to rows a person can open: a sale, a payment, a ledger
 * entry. A reporting table that drifts from its source is worse than no report,
 * because somebody will act on it.
 *
 * Margin uses `sale_items.costPrice` — the landed cost SNAPSHOTTED at the
 * moment of sale. Joining live inventory cost instead would rewrite last
 * quarter's margin every time a supplier changed their price.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly db: TenantDatabase) {}

  /** Sales, day by day, with the tender split beneath. */
  async sales(query: ReportRangeDto): Promise<unknown> {
    if (query.branchId) assertBranchInScope(query.branchId);
    const { from, to } = window(query);

    return this.db.run(async (tx) => {
      const scope = this.saleScope(query.branchId, from, to);

      const [summary] = await tx
        .select({
          saleCount: sql<number>`count(*)::int`,
          gross: sql<string>`coalesce(sum(${schema.sales.subtotal}), 0)::text`,
          discount: sql<string>`coalesce(sum(${schema.sales.discountAmount}), 0)::text`,
          tax: sql<string>`coalesce(sum(${schema.sales.taxAmount}), 0)::text`,
          total: sql<string>`coalesce(sum(${schema.sales.total}), 0)::text`,
          // Averaged over sales, not over lines: "what does a customer spend"
          // is the question a shop actually acts on.
          averageSale: sql<string>`coalesce(round(avg(${schema.sales.total}), 4), 0)::text`,
        })
        .from(schema.sales)
        .where(scope);

      const daily = await tx
        .select({
          date: sql<string>`(${schema.sales.occurredAt} AT TIME ZONE 'UTC')::date::text`,
          saleCount: sql<number>`count(*)::int`,
          total: sql<string>`coalesce(sum(${schema.sales.total}), 0)::text`,
        })
        .from(schema.sales)
        .where(scope)
        .groupBy(sql`(${schema.sales.occurredAt} AT TIME ZONE 'UTC')::date`)
        .orderBy(sql`(${schema.sales.occurredAt} AT TIME ZONE 'UTC')::date`);

      const tender = await tx
        .select({
          method: schema.payments.method,
          // Net of refunds: a refund is a negative row against the same method,
          // so the sum is already what the tender actually took.
          total: sql<string>`coalesce(sum(${schema.payments.amount}), 0)::text`,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.payments)
        .where(
          and(
            query.branchId ? eq(schema.payments.branchId, query.branchId) : undefined,
            sql`(${schema.payments.occurredAt} AT TIME ZONE 'UTC')::date BETWEEN ${from}::date AND ${to}::date`,
          ),
        )
        .groupBy(schema.payments.method);

      return { range: { from, to }, summary, daily, tender };
    });
  }

  /**
   * What earns, what moves, or what actually makes money.
   *
   * Those are three different lists, and a shop that only ever looks at the
   * first stocks a lot of high-turnover, zero-margin bulk.
   */
  async topProducts(query: TopProductsDto): Promise<unknown> {
    if (query.branchId) assertBranchInScope(query.branchId);
    const { from, to } = window(query);

    return this.db.run(async (tx) => {
      const orderBy =
        query.by === "quantity"
          ? sql`sum(${schema.saleItems.quantity}) DESC`
          : query.by === "margin"
            ? sql`sum(${schema.saleItems.lineSubtotal} - (${schema.saleItems.quantity} * coalesce(${schema.saleItems.costPrice}, 0))) DESC`
            : sql`sum(${schema.saleItems.lineSubtotal}) DESC`;

      const rows = await tx
        .select({
          variantId: schema.saleItems.variantId,
          sku: schema.saleItems.productSku,
          productName: schema.saleItems.productName,
          quantity: sql<string>`sum(${schema.saleItems.quantity})::text`,
          revenue: sql<string>`sum(${schema.saleItems.lineSubtotal})::text`,
          cost: sql<string>`round(sum(${schema.saleItems.quantity} * coalesce(${schema.saleItems.costPrice}, 0)), 4)::text`,
          margin: sql<string>`round(sum(${schema.saleItems.lineSubtotal} - (${schema.saleItems.quantity} * coalesce(${schema.saleItems.costPrice}, 0))), 4)::text`,
          saleCount: sql<number>`count(DISTINCT ${schema.saleItems.saleId})::int`,
        })
        .from(schema.saleItems)
        .innerJoin(schema.sales, eq(schema.saleItems.saleId, schema.sales.id))
        .where(this.saleScope(query.branchId, from, to))
        .groupBy(
          schema.saleItems.variantId,
          schema.saleItems.productSku,
          schema.saleItems.productName,
        )
        .orderBy(orderBy)
        .limit(query.limit);

      return {
        range: { from, to },
        by: query.by,
        items: rows.map((row) => ({ ...row, marginPercent: marginPercent(row.revenue, row.margin) })),
      };
    });
  }

  /** Stock health: what it is worth, what is about to run out, what never moves. */
  async inventory(query: InventoryReportDto): Promise<unknown> {
    if (query.branchId) assertBranchInScope(query.branchId);

    return this.db.run(async (tx) => {
      const branchFilter = query.branchId
        ? eq(schema.inventory.branchId, query.branchId)
        : undefined;

      const [totals] = await tx
        .select({
          variants: sql<number>`count(*)::int`,
          units: sql<string>`coalesce(sum(${schema.inventory.quantity}), 0)::text`,
          // At COST, not at retail. Valuing stock at what you hope to sell it
          // for is how a balance sheet ends up describing an ambition.
          // Rounded: numeric(12,4) x numeric(12,4) is numeric(_,8), and a stock
          // valuation printed to eight decimal places reads as a bug.
          value: sql<string>`round(coalesce(sum(${schema.inventory.quantity} * coalesce(${schema.inventory.averageCost}, 0)), 0), 4)::text`,
          outOfStock: sql<number>`count(*) FILTER (WHERE ${schema.inventory.quantity} <= 0)::int`,
        })
        .from(schema.inventory)
        .where(branchFilter);

      const lowStock = await tx
        .select({
          variantId: schema.inventory.variantId,
          sku: schema.productVariants.sku,
          productName: schema.products.name,
          branchName: schema.branches.name,
          quantity: schema.inventory.quantity,
          minStock: schema.productVariants.minStock,
          averageCost: schema.inventory.averageCost,
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
            branchFilter,
            sql`${schema.productVariants.deletedAt} IS NULL`,
            // A variant with no minimum set has no opinion about being low.
            sql`${schema.productVariants.minStock} IS NOT NULL`,
            sql`${schema.inventory.quantity} <= ${schema.productVariants.minStock}`,
          ),
        )
        .orderBy(sql`${schema.inventory.quantity} - ${schema.productVariants.minStock}`)
        .limit(query.limit);

      return { totals, lowStock };
    });
  }

  /**
   * Revenue, cost, profit, margin — the report behind `report:financial`.
   *
   * Separated from the sales report on purpose: this one exposes cost, and cost
   * is exactly what a cashier must not see. Splitting them at the route means
   * the permission does the work, not a conditional deep inside a serialiser.
   */
  async financial(query: ReportRangeDto): Promise<unknown> {
    if (query.branchId) assertBranchInScope(query.branchId);
    const { from, to } = window(query);

    return this.db.run(async (tx) => {
      const [trading] = await tx
        .select({
          revenue: sql<string>`coalesce(sum(${schema.saleItems.lineSubtotal}), 0)::text`,
          cost: sql<string>`round(coalesce(sum(${schema.saleItems.quantity} * coalesce(${schema.saleItems.costPrice}, 0)), 0), 4)::text`,
          unitsSold: sql<string>`coalesce(sum(${schema.saleItems.quantity}), 0)::text`,
          // Output tax on what was sold. A return's items carry negative
          // quantities and a negative taxAmount already, so summing across
          // the window nets a refunded sale's tax back out on its own.
          taxCollected: sql<string>`coalesce(sum(${schema.saleItems.taxAmount}), 0)::text`,
        })
        .from(schema.saleItems)
        .innerJoin(schema.sales, eq(schema.saleItems.saleId, schema.sales.id))
        .where(this.saleScope(query.branchId, from, to));

      const [expenses] = await tx
        .select({
          total: sql<string>`coalesce(sum(${schema.expenses.amount}), 0)::text`,
        })
        .from(schema.expenses)
        .where(
          and(
            query.branchId ? eq(schema.expenses.branchId, query.branchId) : undefined,
            sql`${schema.expenses.expenseDate} BETWEEN ${from}::date AND ${to}::date`,
            sql`${schema.expenses.deletedAt} IS NULL`,
          ),
        );

      const revenue = Money.toMinor(trading?.revenue ?? "0");
      const cost = Money.toMinor(trading?.cost ?? "0");
      const grossProfit = Money.subtract(revenue, cost);
      const overheads = Money.toMinor(expenses?.total ?? "0");

      return {
        range: { from, to },
        revenue: Money.toDecimalString(revenue, 2),
        cost: Money.toDecimalString(cost, 2),
        grossProfit: Money.toDecimalString(grossProfit, 2),
        grossMarginPercent: marginPercent(
          Money.toDecimalString(revenue, 4),
          Money.toDecimalString(grossProfit, 4),
        ),
        expenses: Money.toDecimalString(overheads, 2),
        // Gross profit less recorded overheads. Not statutory net profit —
        // payroll, rent accruals and depreciation live outside this system.
        netProfit: Money.toDecimalString(Money.subtract(grossProfit, overheads), 2),
        unitsSold: trading?.unitsSold ?? "0",
        taxCollected: Money.toDecimalString(Money.toMinor(trading?.taxCollected ?? "0"), 2),
      };
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * The window every sales figure shares.
   *
   * `occurredAt`, not `createdAt`: a sale rung up offline at 11pm and synced at
   * 7am belongs to the day it was made. Voided sales are excluded everywhere —
   * they stay in the table for the audit trail, and counting them would inflate
   * whichever day they were voided from.
   */
  private saleScope(branchId: string | undefined, from: string, to: string) {
    return and(
      branchId ? eq(schema.sales.branchId, branchId) : undefined,
      sql`(${schema.sales.occurredAt} AT TIME ZONE 'UTC')::date BETWEEN ${from}::date AND ${to}::date`,
      sql`${schema.sales.status} <> 'voided'`,
    );
  }
}

/** Defaults to the last 30 days — the range a manager means by "recently". */
function window(query: { from?: string; to?: string }): { from: string; to: string } {
  const to = query.to ?? isoToday();
  const from = query.from ?? shiftDays(to, -29);
  return { from, to };
}

function isoToday(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function shiftDays(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Margin as a percentage OF REVENUE, not of cost.
 *
 * Markup and margin are different numbers, and quoting one while calling it the
 * other is how a business convinces itself a 20% margin covers a 25% overhead.
 */
export function marginPercent(revenue: string, margin: string): string {
  const base = Money.toMinor(revenue);
  if (base === 0n) return "0.00";

  /**
   * `100n * SCALE`, not `SCALE`.
   *
   * Dividing two `Minor4` values cancels the scale, so the result is a bare
   * ratio — one factor of 10^4 restores it to Minor4, and the 100 turns the
   * ratio into a percentage. Getting this wrong reports a 41.82% margin as
   * 0.42%, which reads as a plausible-looking disaster rather than an error.
   */
  return Money.toDecimalString(
    Money.divideRoundHalfUp(Money.toMinor(margin) * 1_000_000n, base),
    2,
  );
}
