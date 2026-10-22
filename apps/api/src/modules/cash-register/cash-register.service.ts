import { and, asc, count, desc, eq, gte, inArray, isNull, lt, schema, sql } from "@devsfleet/db";
import { formatDocumentNumber, sequenceKey } from "@devsfleet/shared-utils";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope, branchFilter, branchScope } from "../../common/context/branch-scope.js";
import { containsPattern } from "../../common/db/list-query.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CloseSessionDto, CashMovementDto, ListSessionsDto, OpenSessionDto } from "./dto.js";
import { expectedCash } from "./expected-cash.js";

/**
 * The cash drawer.
 *
 * One open session per (branch, device). Sales attach to the session that was
 * open when they were rung up, which is what makes "who was on the till when
 * this went missing" answerable.
 *
 * The expected figure is only computed at CLOSE, from the session's own
 * movements. Showing a cashier the target before they count turns a count into
 * a confirmation, and a short drawer stops being visible.
 */
@Injectable()
export class CashRegisterService {
  constructor(private readonly db: TenantDatabase) {}

  /** The caller's currently open session, if any. */
  async current(branchId: string, deviceId?: string): Promise<unknown | null> {
    assertBranchInScope(branchId);

    return this.db.run(async (tx) => {
      const session = await tx.query.cashSessions.findFirst({
        where: (t, { and: a, eq: e }) =>
          a(
            e(t.branchId, branchId),
            e(t.status, "open"),
            deviceId ? e(t.deviceId, deviceId) : undefined,
          ),
        orderBy: (t, { desc: d }) => d(t.openedAt),
      });

      if (!session) return null;
      return { ...session, ...(await this.movementTotals(tx, session.id)) };
    });
  }

  /**
   * Open the drawer for a shift.
   *
   * Refuses if one is already open on this device. Two open sessions on one
   * till means sales land against whichever the code happened to pick, and the
   * close-out for both becomes meaningless.
   */
  async open(dto: OpenSessionDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();

    // The branch is a body field, so it is the caller's claim until checked.
    assertBranchInScope(dto.branchId);

    return this.db.run(async (tx) => {
      /**
       * A retried push is not a second drawer.
       *
       * The terminal resends the same `localId` on every attempt, so this
       * lookup has to come first — otherwise a reply lost to a timeout turns
       * into "a drawer is already open" and the cashier is blocked by their
       * own successful open.
       */
      if (dto.localId) {
        const known = await tx.query.cashSessions.findFirst({
          where: (t, { eq: e }) => e(t.localId, dto.localId!),
        });
        if (known) return { ...known, ...(await this.movementTotals(tx, known.id)) };
      }

      const existing = await tx.query.cashSessions.findFirst({
        where: (t, { and: a, eq: e }) =>
          a(
            e(t.branchId, dto.branchId),
            e(t.status, "open"),
            dto.deviceId ? e(t.deviceId, dto.deviceId) : undefined,
          ),
      });

      if (existing) {
        throw new AppError(
          ERROR_CODES.CASH_SESSION_ALREADY_OPEN,
          "A drawer is already open on this terminal. Close it before opening another.",
          { sessionId: existing.id },
        );
      }

      const branch = await tx.query.branches.findFirst({
        where: (t, { eq: e }) => e(t.id, dto.branchId),
        columns: { code: true },
      });

      const [seq] = await tx.execute<{ next_document_number: number }>(
        sql`SELECT next_document_number(${tenantId}::uuid, ${sequenceKey(
          "cash_session",
          new Date().getFullYear(),
          branch?.code ?? null,
        )})`,
      );

      const [session] = await tx
        .insert(schema.cashSessions)
        .values({
          tenantId,
          branchId: dto.branchId,
          ...(dto.deviceId ? { deviceId: dto.deviceId } : {}),
          userId: user.id,
          sessionNumber: formatDocumentNumber({
            kind: "cash_session",
            year: new Date().getFullYear(),
            sequence: Number(
              (seq as { next_document_number?: number })?.next_document_number ?? 1,
            ),
            ...(branch?.code ? { branchCode: branch.code } : {}),
          }),
          openingAmount: String(dto.openingAmount),
          ...(dto.notes ? { notes: dto.notes } : {}),
          ...(dto.localId ? { localId: dto.localId } : {}),
          // The drawer opened when the cashier said it did, not when the
          // network came back. A shift that spans a close-out is otherwise
          // attributed to the wrong day.
          ...(dto.openedAt ? { openedAt: new Date(dto.openedAt) } : {}),
        })
        .returning();

      if (!session) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not open the drawer");
      return { ...session, cashIn: "0", cashOut: "0", cashSales: "0" };
    });
  }

  /**
   * Close the drawer.
   *
   * Freezes the computed totals onto the row rather than deriving them on read.
   * A sale voided next week must not retroactively rewrite a reconciliation
   * somebody already signed off — the whole point of a close-out is that it is
   * a statement about a moment.
   */
  async close(sessionId: string, dto: CloseSessionDto): Promise<unknown> {
    const user = RequestContext.requireUser();

    return this.db.run(async (tx) => {
      const session = await tx.query.cashSessions.findFirst({
        where: (t, { eq: e }) => e(t.id, sessionId),
      });
      if (!session) throw new AppError(ERROR_CODES.NOT_FOUND, "Session not found");
      // A session id is a plain uuid in the path; scope is what stops one
      // branch closing another branch's drawer and owning its variance.
      assertBranchInScope(session.branchId);
      if (session.status !== "open") {
        throw new AppError(ERROR_CODES.CONFLICT, "This drawer is already closed");
      }

      const totals = await this.movementTotals(tx, sessionId);

      const expected = Money.add(
        Money.toMinor(session.openingAmount),
        Money.toMinor(totals.cashSales),
        Money.toMinor(totals.cashIn),
        Money.negate(Money.toMinor(totals.cashOut)),
      );
      const counted = Money.toMinor(String(dto.countedAmount));
      const variance = Money.subtract(counted, expected);

      // A shortfall without an explanation is precisely what a shrinkage report
      // is looking for, so it cannot be closed silently.
      if (Money.isNegative(variance) && !dto.notes?.trim()) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `The drawer is ${Money.toDecimalString(Money.abs(variance), 2)} short. Explain the difference before closing.`,
        );
      }

      const [closed] = await tx
        .update(schema.cashSessions)
        .set({
          status: "closed",
          closedAt: new Date(),
          closedBy: user.id,
          closingAmount: Money.toDecimalString(counted, 4),
          expectedAmount: Money.toDecimalString(expected, 4),
          difference: Money.toDecimalString(variance, 4),
          ...(dto.notes ? { notes: dto.notes } : {}),
        })
        .where(eq(schema.cashSessions.id, sessionId))
        .returning();

      return {
        ...closed,
        ...totals,
        expected: Money.toDecimalString(expected, 2),
        variance: Money.toDecimalString(variance, 2),
      };
    });
  }

  /** Cash in or out, outside a sale. The reason is mandatory. */
  async recordMovement(sessionId: string, dto: CashMovementDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();

    return this.db.run(async (tx) => {
      const session = await tx.query.cashSessions.findFirst({
        where: (t, { eq: e }) => e(t.id, sessionId),
      });
      if (!session) throw new AppError(ERROR_CODES.NOT_FOUND, "Session not found");
      assertBranchInScope(session.branchId);
      if (session.status !== "open") {
        throw new AppError(
          ERROR_CODES.CASH_SESSION_NOT_OPEN,
          "That drawer is closed. Cash cannot move through it.",
        );
      }

      // Signed: the sign is the direction, so the running total is a plain sum.
      const signed =
        dto.type === "cash_out"
          ? Money.negate(Money.toMinor(String(dto.amount)))
          : Money.toMinor(String(dto.amount));

      const [movement] = await tx
        .insert(schema.cashMovements)
        .values({
          tenantId,
          cashSessionId: sessionId,
          type: dto.type,
          amount: Money.toDecimalString(signed, 4),
          reason: dto.reason,
          createdBy: user.id,
        })
        .returning();

      return movement;
    });
  }

  /** History, newest first. Variance is what a manager scans for. */
  async history(branchId?: string, limit = 30): Promise<unknown[]> {
    if (branchId) assertBranchInScope(branchId);

    // Drawer variance by cashier, for every shop, was readable by anyone with
    // `cash:close` at one of them until this filter existed.
    const scope = branchScope();

    return this.db.run(async (tx) =>
      tx
        .select({
          id: schema.cashSessions.id,
          sessionNumber: schema.cashSessions.sessionNumber,
          branchName: schema.branches.name,
          userName: schema.users.name,
          status: schema.cashSessions.status,
          openedAt: schema.cashSessions.openedAt,
          closedAt: schema.cashSessions.closedAt,
          openingAmount: schema.cashSessions.openingAmount,
          closingAmount: schema.cashSessions.closingAmount,
          expectedAmount: schema.cashSessions.expectedAmount,
          difference: schema.cashSessions.difference,
        })
        .from(schema.cashSessions)
        .innerJoin(schema.branches, eq(schema.cashSessions.branchId, schema.branches.id))
        .innerJoin(schema.users, eq(schema.cashSessions.userId, schema.users.id))
        .where(
          and(
            scope ? inArray(schema.cashSessions.branchId, scope) : undefined,
            branchId ? eq(schema.cashSessions.branchId, branchId) : undefined,
          ),
        )
        .orderBy(desc(schema.cashSessions.openedAt))
        .limit(limit),
    );
  }

  /**
   * Every drawer, for the back office — the reconciliation view.
   *
   * `history()` above serves the till and stops at 30 rows. This pages, filters
   * and sorts, and carries each session's own totals so a manager can see a
   * short drawer without opening it. A closed session shows the figures frozen
   * at close; an open one shows what it should hold so far. That is not the
   * count-before-you-see rule being broken: the cashier at the till still never
   * sees it, and this is gated on `day_close:read`, not `cash:open`.
   */
  async listSessions(query: ListSessionsDto): Promise<{ items: unknown[]; total: number }> {
    const term = containsPattern(query.q);

    return this.db.run(async (tx) => {
      const where = and(
        branchFilter(schema.cashSessions.branchId, query.branchId),
        query.status ? eq(schema.cashSessions.status, query.status) : undefined,
        query.userId ? eq(schema.cashSessions.userId, query.userId) : undefined,
        query.from ? gte(schema.cashSessions.openedAt, new Date(`${query.from}T00:00:00Z`)) : undefined,
        query.to ? lt(schema.cashSessions.openedAt, sql`(${query.to}::date + 1)`) : undefined,
        term ? sql`${schema.cashSessions.sessionNumber} ILIKE ${term}` : undefined,
      );

      const [counted] = await tx.select({ value: count() }).from(schema.cashSessions).where(where);

      const cashSales = sql<string>`(
        SELECT coalesce(sum(${schema.payments.amount}), 0) FROM ${schema.payments}
        WHERE ${schema.payments.cashSessionId} = ${schema.cashSessions.id}
          AND ${schema.payments.method} = 'cash'
      )`;
      // Sale and refund rows in cash_movements mirror `payments`; counting
      // them here as well would double every sale.
      const manual = sql`${schema.cashMovements.cashSessionId} = ${schema.cashSessions.id}
        AND ${schema.cashMovements.type} NOT IN ('sale', 'refund')`;
      const cashIn = sql<string>`(
        SELECT coalesce(sum(${schema.cashMovements.amount}) FILTER (WHERE ${schema.cashMovements.amount} > 0), 0)
        FROM ${schema.cashMovements} WHERE ${manual}
      )`;
      const cashOut = sql<string>`(
        SELECT coalesce(abs(sum(${schema.cashMovements.amount}) FILTER (WHERE ${schema.cashMovements.amount} < 0)), 0)
        FROM ${schema.cashMovements} WHERE ${manual}
      )`;

      const order =
        query.sortBy === "difference"
          ? sql`${schema.cashSessions.difference} ${sql.raw(query.sortOrder === "asc" ? "ASC" : "DESC")} NULLS LAST`
          : query.sortOrder === "asc"
            ? asc(schema.cashSessions.openedAt)
            : desc(schema.cashSessions.openedAt);

      const rows = await tx
        .select({
          id: schema.cashSessions.id,
          sessionNumber: schema.cashSessions.sessionNumber,
          status: schema.cashSessions.status,
          openedAt: schema.cashSessions.openedAt,
          closedAt: schema.cashSessions.closedAt,
          branchId: schema.cashSessions.branchId,
          branchName: schema.branches.name,
          branchCode: schema.branches.code,
          userId: schema.cashSessions.userId,
          cashierName: schema.users.name,
          deviceName: schema.devices.name,
          openingAmount: schema.cashSessions.openingAmount,
          closingAmount: schema.cashSessions.closingAmount,
          expectedAmount: schema.cashSessions.expectedAmount,
          difference: schema.cashSessions.difference,
          cashSales: sql<string>`${cashSales}::text`,
          cashIn: sql<string>`${cashIn}::text`,
          cashOut: sql<string>`${cashOut}::text`,
        })
        .from(schema.cashSessions)
        .innerJoin(schema.branches, eq(schema.cashSessions.branchId, schema.branches.id))
        .innerJoin(schema.users, eq(schema.cashSessions.userId, schema.users.id))
        .leftJoin(schema.devices, eq(schema.cashSessions.deviceId, schema.devices.id))
        .where(where)
        .orderBy(order, desc(schema.cashSessions.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      const items = rows.map((r) => ({
        ...r,
        // Frozen at close; for a drawer still open, what it should hold so far.
        expectedAmount:
          r.status === "closed" && r.expectedAmount !== null
            ? r.expectedAmount
            : expectedCash({ opening: r.openingAmount, cashSales: r.cashSales, cashIn: r.cashIn, cashOut: r.cashOut }),
      }));

      return { items, total: counted?.value ?? 0 };
    });
  }

  /** One drawer: its figures, every manual pay-in/out with who and why, and its cash sales. */
  async getSession(sessionId: string): Promise<unknown> {
    return this.db.run(async (tx) => {
      const [session] = await tx
        .select({
          id: schema.cashSessions.id,
          sessionNumber: schema.cashSessions.sessionNumber,
          status: schema.cashSessions.status,
          openedAt: schema.cashSessions.openedAt,
          closedAt: schema.cashSessions.closedAt,
          closedBy: schema.cashSessions.closedBy,
          notes: schema.cashSessions.notes,
          branchId: schema.cashSessions.branchId,
          branchName: schema.branches.name,
          branchCode: schema.branches.code,
          cashierName: schema.users.name,
          deviceName: schema.devices.name,
          openingAmount: schema.cashSessions.openingAmount,
          closingAmount: schema.cashSessions.closingAmount,
          expectedAmount: schema.cashSessions.expectedAmount,
          difference: schema.cashSessions.difference,
        })
        .from(schema.cashSessions)
        .innerJoin(schema.branches, eq(schema.cashSessions.branchId, schema.branches.id))
        .innerJoin(schema.users, eq(schema.cashSessions.userId, schema.users.id))
        .leftJoin(schema.devices, eq(schema.cashSessions.deviceId, schema.devices.id))
        .where(eq(schema.cashSessions.id, sessionId));

      if (!session) throw new AppError(ERROR_CODES.NOT_FOUND, "Session not found");
      // A session id in the path is the caller's claim; scope is what stops
      // one branch reading another's drawer.
      assertBranchInScope(session.branchId);

      const totals = await this.movementTotals(tx, sessionId);

      const closer = session.closedBy
        ? await tx.query.users.findFirst({
            where: (t, { eq: e }) => e(t.id, session.closedBy!),
            columns: { name: true },
          })
        : null;

      const movements = await tx
        .select({
          id: schema.cashMovements.id,
          type: schema.cashMovements.type,
          amount: schema.cashMovements.amount,
          reason: schema.cashMovements.reason,
          occurredAt: schema.cashMovements.occurredAt,
          byName: schema.users.name,
        })
        .from(schema.cashMovements)
        .leftJoin(schema.users, eq(schema.cashMovements.createdBy, schema.users.id))
        .where(
          and(
            eq(schema.cashMovements.cashSessionId, sessionId),
            sql`${schema.cashMovements.type} NOT IN ('sale', 'refund')`,
          ),
        )
        .orderBy(asc(schema.cashMovements.occurredAt), asc(schema.cashMovements.id));

      const [sales] = await tx
        .select({
          count: sql<number>`count(DISTINCT ${schema.payments.saleId})::int`,
          refunds: sql<string>`coalesce(abs(sum(${schema.payments.amount}) FILTER (WHERE ${schema.payments.amount} < 0)), 0)::text`,
        })
        .from(schema.payments)
        .where(and(eq(schema.payments.cashSessionId, sessionId), eq(schema.payments.method, "cash")));

      return {
        ...session,
        closedByName: closer?.name ?? null,
        ...totals,
        cashSaleCount: sales?.count ?? 0,
        cashRefunds: sales?.refunds ?? "0",
        expectedAmount:
          session.status === "closed" && session.expectedAmount !== null
            ? session.expectedAmount
            : expectedCash({ opening: session.openingAmount, ...totals }),
        movements,
      };
    });
  }

  /**
   * What has moved through this drawer.
   *
   * Cash sales come from `payments` rather than `cash_movements`, because a
   * sale writes its tender there — counting both would double every sale.
   */
  private async movementTotals(
    tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0],
    sessionId: string,
  ): Promise<{ cashIn: string; cashOut: string; cashSales: string }> {
    const [movements] = await tx
      .select({
        cashIn: sql<string>`coalesce(sum(amount) FILTER (WHERE amount > 0), 0)::text`,
        cashOut: sql<string>`coalesce(abs(sum(amount) FILTER (WHERE amount < 0)), 0)::text`,
      })
      .from(schema.cashMovements)
      .where(
        and(
          eq(schema.cashMovements.cashSessionId, sessionId),
          // Sale and refund rows are mirrors of `payments`; excluding them here
          // is what stops the double count.
          sql`${schema.cashMovements.type} NOT IN ('sale', 'refund')`,
        ),
      );

    const [sales] = await tx
      .select({
        total: sql<string>`coalesce(sum(amount), 0)::text`,
      })
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.cashSessionId, sessionId),
          eq(schema.payments.method, "cash"),
        ),
      );

    return {
      cashIn: movements?.cashIn ?? "0",
      cashOut: movements?.cashOut ?? "0",
      cashSales: sales?.total ?? "0",
    };
  }
}
