import { and, desc, eq, inArray, isNull, schema, sql } from "@devsfleet/db";
import { formatDocumentNumber, sequenceKey } from "@devsfleet/shared-utils";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope, branchScope } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { CloseSessionDto, CashMovementDto, OpenSessionDto } from "./dto.js";

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
