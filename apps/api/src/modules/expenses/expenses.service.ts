import { and, count, desc, eq, gte, isNull, lte, schema, sql } from "@devsfleet/db";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope, requireBranchId } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CreateExpenseDto, ListExpensesDto, UpdateExpenseDto } from "./dto.js";

/**
 * Out-of-pocket spending: the diesel, the tea, the municipality fine.
 *
 * Small and constant, and the reason a drawer that balanced on paper is short
 * in practice. Recording them is what turns "we're always 200 down" into a
 * line item somebody can decide about.
 */
@Injectable()
export class ExpensesService {
  constructor(private readonly db: TenantDatabase) {}

  async create(dto: CreateExpenseDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();
    const branchId = requireBranchId(dto.branchId);
    const expenseDate = dto.expenseDate ?? today();

    return this.db.run(async (tx) => {
      /**
       * A closed day is frozen.
       *
       * Backdating an expense into it would leave the stored `totalExpenses`
       * disagreeing with the expenses the detail view lists — the signed
       * record and its own supporting documents, contradicting each other.
       */
      const day = await tx.query.dailyClosings.findFirst({
        where: (t, { and: a, eq: e }) =>
          a(e(t.branchId, branchId), e(t.closingDate, expenseDate)),
        columns: { status: true },
      });

      if (day?.status === "closed") {
        throw new AppError(
          ERROR_CODES.DAY_ALREADY_CLOSED,
          `${expenseDate} has already been closed. Record this against an open day.`,
        );
      }

      const [expense] = await tx
        .insert(schema.expenses)
        .values({
          tenantId,
          branchId,
          title: dto.title,
          amount: String(dto.amount),
          category: normaliseCategory(dto.category),
          expenseDate,
          paymentMethod: dto.paymentMethod,
          userId: user.id,
          ...(dto.notes ? { notes: dto.notes } : {}),
        })
        .returning();

      if (!expense) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not record the expense");
      return expense;
    });
  }

  async update(id: string, dto: UpdateExpenseDto): Promise<unknown> {
    return this.db.run(async (tx) => {
      const existing = await this.requireEditable(tx, id);

      const [updated] = await tx
        .update(schema.expenses)
        .set({
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.amount !== undefined ? { amount: String(dto.amount) } : {}),
          ...(dto.category !== undefined
            ? { category: normaliseCategory(dto.category) }
            : {}),
          ...(dto.expenseDate !== undefined ? { expenseDate: dto.expenseDate } : {}),
          ...(dto.paymentMethod !== undefined ? { paymentMethod: dto.paymentMethod } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        })
        .where(eq(schema.expenses.id, existing.id))
        .returning();

      return updated;
    });
  }

  /** Soft delete. A day close that already counted it still needs to show it. */
  async remove(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const existing = await this.requireEditable(tx, id);

      await tx
        .update(schema.expenses)
        .set({ deletedAt: new Date() })
        .where(eq(schema.expenses.id, existing.id));
    });
  }

  async list(query: ListExpensesDto): Promise<{ items: unknown[]; total: number }> {
    if (query.branchId) assertBranchInScope(query.branchId);

    // Normalised the same way it was stored, or filtering on "Diesel" finds
    // nothing that was typed as "diesel".
    const category = normaliseCategory(query.category);

    return this.db.run(async (tx) => {
      const where = and(
        isNull(schema.expenses.deletedAt),
        query.branchId ? eq(schema.expenses.branchId, query.branchId) : undefined,
        query.from ? gte(schema.expenses.expenseDate, query.from) : undefined,
        query.to ? lte(schema.expenses.expenseDate, query.to) : undefined,
        category ? eq(schema.expenses.category, category) : undefined,
      );

      const [total] = await tx.select({ value: count() }).from(schema.expenses).where(where);

      const items = await tx
        .select({
          id: schema.expenses.id,
          branchId: schema.expenses.branchId,
          title: schema.expenses.title,
          amount: schema.expenses.amount,
          category: schema.expenses.category,
          expenseDate: schema.expenses.expenseDate,
          paymentMethod: schema.expenses.paymentMethod,
          notes: schema.expenses.notes,
          userName: schema.users.name,
          dailyClosingId: schema.expenses.dailyClosingId,
          createdAt: schema.expenses.createdAt,
        })
        .from(schema.expenses)
        .innerJoin(schema.users, eq(schema.expenses.userId, schema.users.id))
        .where(where)
        .orderBy(desc(schema.expenses.expenseDate), desc(schema.expenses.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return { items, total: total?.value ?? 0 };
    });
  }

  /**
   * The categories this tenant actually uses, most-used first.
   *
   * Autocomplete from real data rather than a fixed list: it converges on a
   * shared vocabulary without anyone having to administer one, and a typo
   * sinks to the bottom instead of becoming a permanent menu entry.
   */
  async categories(): Promise<string[]> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({
          category: schema.expenses.category,
          uses: sql<number>`count(*)::int`,
        })
        .from(schema.expenses)
        .where(and(isNull(schema.expenses.deletedAt), sql`${schema.expenses.category} IS NOT NULL`))
        .groupBy(schema.expenses.category)
        .orderBy(desc(sql`count(*)`))
        .limit(50);

      return rows.map((row) => row.category).filter((c): c is string => Boolean(c));
    });
  }

  // ---------------------------------------------------------------------------

  private async requireEditable(
    tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0],
    id: string,
  ): Promise<{ id: string; branchId: string }> {
    const existing = await tx.query.expenses.findFirst({
      where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)),
    });
    if (!existing) throw new AppError(ERROR_CODES.NOT_FOUND, `Expense ${id} not found`);
    assertBranchInScope(existing.branchId);

    // Once a day is closed its expense total is frozen on the record. Editing
    // a counted expense would make the day's own detail contradict its total.
    if (existing.dailyClosingId) {
      throw new AppError(
        ERROR_CODES.DAY_ALREADY_CLOSED,
        "This expense belongs to a closed day and can no longer be changed.",
      );
    }

    return existing;
  }
}

/** Case- and space-insensitive, so "Diesel" and "diesel " are one category. */
function normaliseCategory(category?: string | null): string | null {
  const trimmed = category?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function today(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}
