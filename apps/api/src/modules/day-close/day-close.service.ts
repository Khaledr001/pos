import { and, count, desc, eq, gte, isNull, lte, schema, sql } from "@devsfleet/db";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope, requireBranchId } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CloseDayDto, ListDaysDto, OpenDayDto, PreviewDayDto } from "./dto.js";

/**
 * The day close.
 *
 * One row per branch per calendar day, and the thing a manager signs. Where a
 * cash session answers "who was on the till", this answers "did the branch take
 * what it says it took".
 *
 * The whole design rests on one rule: **closed figures are frozen**. They are
 * computed once, written onto the row, and never recomputed on read. A sale
 * voided next week must not silently rewrite a day somebody already counted and
 * signed off — a total that can change after the signature is not a
 * reconciliation, it is a guess with a date on it.
 */
@Injectable()
export class DayCloseService {
  constructor(private readonly db: TenantDatabase) {}

  /**
   * What the drawer should hold.
   *
   * A closed day returns its FROZEN snapshot. Recomputing it would let the
   * preview and the signed-off record disagree, and the person looking at them
   * has no way to tell which is authoritative.
   */
  async preview(query: PreviewDayDto): Promise<unknown> {
    const branchId = requireBranchId(query.branchId);
    const date = query.date ?? today();

    return this.db.run(async (tx) => {
      const existing = await tx.query.dailyClosings.findFirst({
        where: (t, { and: a, eq: e }) =>
          a(e(t.branchId, branchId), e(t.closingDate, date)),
      });

      if (existing?.status === "closed") {
        return { ...existing, live: false, status: "closed" };
      }

      const totals = await this.computeTotals(tx, branchId, date);
      const openingFloat = Money.toMinor(existing?.openingFloat ?? "0");
      const expected = expectedCash(openingFloat, totals);

      return {
        id: existing?.id ?? null,
        branchId,
        closingDate: date,
        // `not_opened` is not a stored status — no row exists. Saying "open"
        // would tell a manager the float has been declared when it has not.
        status: existing ? "open" : "not_opened",
        openingFloat: Money.toDecimalString(openingFloat, 4),
        ...totals,
        expectedCash: Money.toDecimalString(expected, 4),
        live: true,
      };
    });
  }

  async open(dto: OpenDayDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();
    const branchId = requireBranchId(dto.branchId);
    const date = dto.date ?? today();

    return this.db.run(async (tx) => {
      const existing = await tx.query.dailyClosings.findFirst({
        where: (t, { and: a, eq: e }) =>
          a(e(t.branchId, branchId), e(t.closingDate, date)),
      });

      if (existing) {
        throw new AppError(
          existing.status === "closed"
            ? ERROR_CODES.DAY_ALREADY_CLOSED
            : ERROR_CODES.DAY_ALREADY_OPEN,
          existing.status === "closed"
            ? `${date} has already been closed and cannot be reopened.`
            : `${date} is already open.`,
          { dayId: existing.id },
        );
      }

      const [day] = await tx
        .insert(schema.dailyClosings)
        .values({
          tenantId,
          branchId,
          closingDate: date,
          openingFloat: String(dto.openingFloat),
          openedBy: user.id,
          ...(dto.notes ? { notes: dto.notes } : {}),
        })
        .returning();

      if (!day) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not open the day");
      return day;
    });
  }

  /**
   * Count the cash and freeze the day.
   *
   * The order is deliberate: compute, freeze, THEN link the day's sales and
   * expenses to the record. Linking first would point a foreign key at a row
   * that a later failure could roll back.
   */
  async close(id: string, dto: CloseDayDto): Promise<unknown> {
    const user = RequestContext.requireUser();

    return this.db.run(async (tx) => {
      const day = await tx.query.dailyClosings.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
      });
      if (!day) throw new AppError(ERROR_CODES.NOT_FOUND, "That day was never opened");
      assertBranchInScope(day.branchId);

      if (day.status === "closed") {
        throw new AppError(
          ERROR_CODES.DAY_ALREADY_CLOSED,
          `${day.closingDate} has already been closed and cannot be reopened.`,
        );
      }

      const totals = await this.computeTotals(tx, day.branchId, day.closingDate);
      const expected = expectedCash(Money.toMinor(day.openingFloat), totals);
      const counted = Money.toMinor(String(dto.countedCash));
      const variance = Money.subtract(counted, expected);

      // A shortfall with no explanation is exactly what a shrinkage report is
      // looking for, so it cannot be signed off silently.
      if (Money.isNegative(variance) && !dto.notes?.trim()) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `The day is ${Money.toDecimalString(Money.abs(variance), 2)} short. Explain the difference before closing.`,
        );
      }

      const [closed] = await tx
        .update(schema.dailyClosings)
        .set({
          status: "closed",
          totalSales: totals.totalSales,
          totalReturns: totals.totalReturns,
          totalExpenses: totals.totalExpenses,
          cashTotal: totals.cashTotal,
          cardTotal: totals.cardTotal,
          bankTotal: totals.bankTotal,
          creditTotal: totals.creditTotal,
          saleCount: totals.saleCount,
          expectedCash: Money.toDecimalString(expected, 4),
          countedCash: Money.toDecimalString(counted, 4),
          cashVariance: Money.toDecimalString(variance, 4),
          closedBy: user.id,
          closedAt: new Date(),
          ...(dto.notes ? { notes: dto.notes } : {}),
        })
        .where(eq(schema.dailyClosings.id, id))
        .returning();

      // After the freeze, so the foreign key points at a row that exists in
      // its final form.
      await tx
        .update(schema.expenses)
        .set({ dailyClosingId: id })
        .where(
          and(
            eq(schema.expenses.branchId, day.branchId),
            eq(schema.expenses.expenseDate, day.closingDate),
            isNull(schema.expenses.dailyClosingId),
            isNull(schema.expenses.deletedAt),
          ),
        );

      return closed;
    });
  }

  async findById(id: string): Promise<unknown> {
    return this.db.run(async (tx) => {
      const day = await tx.query.dailyClosings.findFirst({
        where: (t, { eq: e }) => e(t.id, id),
      });
      if (!day) throw new AppError(ERROR_CODES.NOT_FOUND, `Day close ${id} not found`);
      assertBranchInScope(day.branchId);

      const expenses = await tx
        .select({
          id: schema.expenses.id,
          title: schema.expenses.title,
          amount: schema.expenses.amount,
          category: schema.expenses.category,
          paymentMethod: schema.expenses.paymentMethod,
          userName: schema.users.name,
        })
        .from(schema.expenses)
        .innerJoin(schema.users, eq(schema.expenses.userId, schema.users.id))
        .where(
          and(
            eq(schema.expenses.branchId, day.branchId),
            eq(schema.expenses.expenseDate, day.closingDate),
            isNull(schema.expenses.deletedAt),
          ),
        )
        .orderBy(desc(schema.expenses.createdAt));

      return { ...day, expenses };
    });
  }

  async list(query: ListDaysDto): Promise<{ items: unknown[]; total: number }> {
    if (query.branchId) assertBranchInScope(query.branchId);

    return this.db.run(async (tx) => {
      const where = and(
        query.branchId ? eq(schema.dailyClosings.branchId, query.branchId) : undefined,
        query.from ? gte(schema.dailyClosings.closingDate, query.from) : undefined,
        query.to ? lte(schema.dailyClosings.closingDate, query.to) : undefined,
      );

      const [total] = await tx
        .select({ value: count() })
        .from(schema.dailyClosings)
        .where(where);

      const items = await tx
        .select({
          id: schema.dailyClosings.id,
          branchId: schema.dailyClosings.branchId,
          branchName: schema.branches.name,
          closingDate: schema.dailyClosings.closingDate,
          status: schema.dailyClosings.status,
          openingFloat: schema.dailyClosings.openingFloat,
          totalSales: schema.dailyClosings.totalSales,
          expectedCash: schema.dailyClosings.expectedCash,
          countedCash: schema.dailyClosings.countedCash,
          cashVariance: schema.dailyClosings.cashVariance,
          closedAt: schema.dailyClosings.closedAt,
        })
        .from(schema.dailyClosings)
        .innerJoin(schema.branches, eq(schema.dailyClosings.branchId, schema.branches.id))
        .where(where)
        .orderBy(desc(schema.dailyClosings.closingDate))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return { items, total: total?.value ?? 0 };
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * The day's live figures.
   *
   * The tender split comes from `payments`, not from `sales`, and that is the
   * only way it can be right: a refund is a negative payment row against the
   * same method, so summing by method gives each tender NET of what went back
   * out through it. Deriving cash from sale totals would count a cash sale that
   * was refunded in cash twice — once in, never out.
   *
   * `occurredAt` is the basis, not `createdAt`. A sale rung up at 11pm and
   * synced at 7am the next morning belongs to the day it was made, which is the
   * day whose drawer it is in.
   */
  private async computeTotals(
    tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0],
    branchId: string,
    date: string,
  ): Promise<{
    totalSales: string;
    totalReturns: string;
    totalExpenses: string;
    cashExpenses: string;
    cashTotal: string;
    cardTotal: string;
    bankTotal: string;
    creditTotal: string;
    manualCashIn: string;
    manualCashOut: string;
    saleCount: number;
  }> {
    const dayBounds = and(
      eq(schema.payments.branchId, branchId),
      sql`${schema.payments.occurredAt}::date = ${date}::date`,
    );

    const tender = await tx
      .select({
        method: schema.payments.method,
        total: sql<string>`coalesce(sum(${schema.payments.amount}), 0)::text`,
        refunded: sql<string>`coalesce(sum(${schema.payments.amount}) FILTER (WHERE ${schema.payments.amount} < 0), 0)::text`,
      })
      .from(schema.payments)
      .where(dayBounds)
      .groupBy(schema.payments.method);

    const byMethod = new Map(tender.map((row) => [row.method, row.total]));
    const refunds = tender.reduce(
      (sum, row) => Money.add(sum, Money.toMinor(row.refunded)),
      0n,
    );

    const [sales] = await tx
      .select({
        total: sql<string>`coalesce(sum(${schema.sales.total}), 0)::text`,
        saleCount: sql<number>`count(*)::int`,
      })
      .from(schema.sales)
      .where(
        and(
          eq(schema.sales.branchId, branchId),
          sql`${schema.sales.occurredAt}::date = ${date}::date`,
          // A voided sale is not a sale. It stays in the table for the audit
          // trail, and counting it would inflate the day it was voided from.
          sql`${schema.sales.status} <> 'voided'`,
        ),
      );

    const [expenseTotals] = await tx
      .select({
        total: sql<string>`coalesce(sum(${schema.expenses.amount}), 0)::text`,
        cash: sql<string>`coalesce(sum(${schema.expenses.amount}) FILTER (WHERE ${schema.expenses.paymentMethod} = 'cash'), 0)::text`,
      })
      .from(schema.expenses)
      .where(
        and(
          eq(schema.expenses.branchId, branchId),
          eq(schema.expenses.expenseDate, date),
          isNull(schema.expenses.deletedAt),
        ),
      );

    /**
     * Manual drawer movements — cash in or out that is not itself a sale or
     * refund (those are mirrors of `payments`, already counted above via
     * `cashTotal`; summing them again here would double every cash sale).
     *
     * This is also where a customer settling an old invoice in cash shows up:
     * `CustomersService.recordPayment` writes exactly this kind of row so the
     * day's expected cash accounts for it, rather than the drawer counting
     * over at close with nothing in the system to explain why.
     *
     * Joined through `cash_sessions` for the branch, because a movement has no
     * `branch_id` of its own — only the session it belongs to does. Filtered
     * on the MOVEMENT's own `occurred_at`, not the session's, since a session
     * opened yesterday can still take a movement today.
     */
    const [movements] = await tx
      .select({
        cashIn: sql<string>`coalesce(sum(${schema.cashMovements.amount}) FILTER (WHERE ${schema.cashMovements.amount} > 0), 0)::text`,
        cashOut: sql<string>`coalesce(abs(sum(${schema.cashMovements.amount}) FILTER (WHERE ${schema.cashMovements.amount} < 0)), 0)::text`,
      })
      .from(schema.cashMovements)
      .innerJoin(schema.cashSessions, eq(schema.cashMovements.cashSessionId, schema.cashSessions.id))
      .where(
        and(
          eq(schema.cashSessions.branchId, branchId),
          sql`${schema.cashMovements.occurredAt}::date = ${date}::date`,
          sql`${schema.cashMovements.type} NOT IN ('sale', 'refund')`,
        ),
      );

    return {
      totalSales: sales?.total ?? "0",
      // Refunds are negative rows; reported as a positive figure because
      // "returns: -240" reads as a double negative on a summary card.
      totalReturns: Money.toDecimalString(Money.abs(refunds), 4),
      totalExpenses: expenseTotals?.total ?? "0",
      cashExpenses: expenseTotals?.cash ?? "0",
      cashTotal: byMethod.get("cash") ?? "0",
      cardTotal: byMethod.get("card") ?? "0",
      bankTotal: byMethod.get("bank_transfer") ?? "0",
      creditTotal: byMethod.get("credit") ?? "0",
      manualCashIn: movements?.cashIn ?? "0",
      manualCashOut: movements?.cashOut ?? "0",
      saleCount: sales?.saleCount ?? 0,
    };
  }

}

/**
 * openingFloat + cash sales + manual cash in - manual cash out - cash expenses.
 *
 * A standalone function, not a private method, so it can be pinned by a unit
 * test independent of Postgres — see day-close.service.spec.ts. A duplicate
 * copy of this formula living only inside a test would drift the moment this
 * one changes, which is exactly what happened to the version it replaced.
 */
export function expectedCash(
  openingFloat: Money.Minor4,
  totals: { cashTotal: string; manualCashIn: string; manualCashOut: string; cashExpenses: string },
): Money.Minor4 {
  return Money.add(
    openingFloat,
    Money.toMinor(totals.cashTotal),
    Money.toMinor(totals.manualCashIn),
    Money.negate(Money.toMinor(totals.manualCashOut)),
    Money.negate(Money.toMinor(totals.cashExpenses)),
  );
}

/**
 * Today, as the branch sees it.
 *
 * Uses the server's local date deliberately: a UTC date rolls over at 4am in
 * the Gulf, which would split a late shift across two day-close records.
 */
function today(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}
