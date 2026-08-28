import { and, eq, schema, sql, type Transaction } from "@devsfleet/db";
import type { InventoryTxType } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { RequestContext } from "../../common/context/request-context.js";
import { DomainEvents } from "../../common/events/domain-events.js";
import { DOMAIN_EVENTS } from "../../common/events/event-names.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";

/**
 * THE ONLY THING THAT MAY WRITE STOCK.
 *
 * Sales, returns, purchases, transfers, adjustments, stock takes and paint
 * orders all call this. No module inserts an `inventory_transactions` row
 * directly, ever.
 *
 * One choke point means one place that enforces the sign convention, stamps
 * the tenant, keeps the running balance in step with the ledger, and can later
 * grow reservations or costing without hunting down scattered writers.
 * Scattered ledger writes guarantee eventual inconsistency.
 *
 * TWO TABLES, ONE TRANSACTION:
 *
 *   inventory_transactions  the append-only ledger. The truth.
 *   inventory               the running balance. A CACHE of the ledger, kept
 *                           correct by being written here and nowhere else.
 *
 * The balance column exists because reading stock happens constantly — every
 * POS search, every catalogue page — and summing a ledger that grows forever
 * is the wrong shape for that. It is safe only because this service is its
 * sole writer and updates it in the same transaction as the ledger row.
 * `scripts/verify-stock.mjs` replays the ledger and asserts they agree.
 *
 * Every method takes the caller's transaction. That is deliberate: a sale must
 * write its lines, its payments and its stock movements atomically, so this
 * cannot open a transaction of its own.
 */

export interface StockMovementInput {
  tx: Transaction;
  variantId: string;
  branchId: string;
  /** Always positive. Direction comes from the method you call. */
  quantity: string;
  /** What caused it: "sale", "purchase_receipt", "stock_transfer", "adjustment". */
  referenceType: string;
  referenceId: string;
  notes?: string;
  /** Unit cost at the time of movement. Feeds the weighted-average cost. */
  unitCost?: string;
  /**
   * What this movement cost IN TOTAL, when the caller knows it exactly.
   *
   * Preferred over `unitCost` wherever a per-unit figure had to be derived by
   * division. Money carries four decimals, so a box of 1,000 screws costing
   * AED 1.55 gives a per-piece cost of 0.00155 that stores as 0.0016 — and
   * multiplying that back by 1,000 values the box at 1.60. The error is
   * per-unit and scales with the pack, so it lands at 3% on cheap goods
   * bought in bulk, which is exactly what a hardware business buys.
   *
   * Given the total, the weighted average is computed from it directly and
   * that rounding never happens. `unitCost` is still recorded on the ledger
   * row either way, because a movement should say what a unit cost.
   */
  totalCost?: string;
  deviceId?: string;
  /**
   * Skip the low-stock crossing check for this movement.
   *
   * For a bulk writer whose movements are not each individually meaningful —
   * a stock take reconciling hundreds of variants, a warehouse-wide import —
   * where per-movement alerts would flood every recipient's inbox rather than
   * surface anything actionable. Unset by default: a single sale or transfer
   * IS individually meaningful, and that is the common case.
   */
  suppressEvents?: boolean;
}

@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  constructor(private readonly db: TenantDatabase) {}

  /** Stock in: a purchase receipt, a return, an opening balance, a transfer arriving. */
  async addStock(input: StockMovementInput): Promise<string> {
    return this.post({ ...input, signedQuantity: Money.toMinor(input.quantity) });
  }

  /**
   * Stock out: a sale, a transfer leaving, a damage write-off.
   *
   * Does NOT refuse to go negative. That is the caller's policy decision —
   * a POS terminal syncing an offline sale must be able to push stock below
   * zero, because the sale already happened and refusing it would lose the
   * transaction rather than surface the discrepancy.
   */
  async deductStock(input: StockMovementInput): Promise<string> {
    const magnitude = Money.toMinor(input.quantity);
    if (magnitude <= 0n) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        "Deduction quantity must be greater than zero",
      );
    }
    return this.post({ ...input, signedQuantity: -magnitude });
  }

  /**
   * Set stock to an absolute figure, writing only the DELTA to the ledger.
   *
   * A stock take says "there are 47 on the shelf", not "add 3". Recording the
   * delta keeps the ledger a record of movements rather than of assertions,
   * so the history still explains how the balance got where it is.
   *
   * A zero delta writes nothing: an adjustment that changes nothing is not an
   * event, and logging it would bury the ones that matter.
   */
  async adjustStock(input: {
    tx: Transaction;
    variantId: string;
    branchId: string;
    newQuantity: string;
    /** Mandatory. An unexplained adjustment is exactly what shrinkage hides behind. */
    reason: string;
    referenceType?: string;
    referenceId?: string;
  }): Promise<{ ledgerId: string | null; delta: string }> {
    if (!input.reason?.trim()) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        "A stock adjustment needs a reason",
      );
    }

    const current = await this.getCurrentStock(input.tx, input.variantId, input.branchId);
    const target = Money.toMinor(input.newQuantity);
    const delta = target - Money.toMinor(current);

    if (delta === 0n) {
      return { ledgerId: null, delta: "0" };
    }

    const ledgerId = await this.post({
      tx: input.tx,
      variantId: input.variantId,
      branchId: input.branchId,
      signedQuantity: delta,
      quantity: Money.toDecimalString(delta < 0n ? -delta : delta, 4),
      referenceType: input.referenceType ?? "adjustment",
      referenceId: input.referenceId ?? randomUUID(),
      notes: input.reason,
    });

    return { ledgerId, delta: Money.toDecimalString(delta, 4) };
  }

  /**
   * Move stock between branches.
   *
   * Writes TWO rows sharing one reference id, in the caller's transaction, so
   * the pair can never half-apply. Refuses to take more than the source holds:
   * unlike a sale, a transfer has not happened yet, so there is nothing to
   * preserve by allowing it to go negative.
   */
  async transferStock(input: {
    tx: Transaction;
    variantId: string;
    fromBranchId: string;
    toBranchId: string;
    quantity: string;
    referenceId?: string;
    notes?: string;
  }): Promise<{ referenceId: string; outLedgerId: string; inLedgerId: string }> {
    if (input.fromBranchId === input.toBranchId) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        "Source and destination branches must differ",
      );
    }

    const available = await this.getCurrentStock(
      input.tx,
      input.variantId,
      input.fromBranchId,
    );
    if (Money.toMinor(available) < Money.toMinor(input.quantity)) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_STOCK,
        `Only ${available} available at the source branch`,
        { available, requested: input.quantity },
      );
    }

    const referenceId = input.referenceId ?? randomUUID();

    const outLedgerId = await this.deductStock({
      tx: input.tx,
      variantId: input.variantId,
      branchId: input.fromBranchId,
      quantity: input.quantity,
      referenceType: "stock_transfer",
      referenceId,
      ...(input.notes ? { notes: input.notes } : {}),
    });

    const inLedgerId = await this.addStock({
      tx: input.tx,
      variantId: input.variantId,
      branchId: input.toBranchId,
      quantity: input.quantity,
      referenceType: "stock_transfer",
      referenceId,
      ...(input.notes ? { notes: input.notes } : {}),
    });

    return { referenceId, outLedgerId, inLedgerId };
  }

  /**
   * Current balance for one (variant, branch).
   *
   * Reads the cached balance rather than summing the ledger — that is what the
   * cache is for. `recomputeFromLedger` is the authority when they are
   * suspected of disagreeing.
   */
  async getCurrentStock(
    tx: Transaction,
    variantId: string,
    branchId: string,
  ): Promise<string> {
    const row = await tx.query.inventory.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.variantId, variantId), e(t.branchId, branchId)),
      columns: { quantity: true },
    });
    return row?.quantity ?? "0";
  }

  /** Available to sell: on hand minus what quotations and orders have reserved. */
  async getAvailableStock(
    tx: Transaction,
    variantId: string,
    branchId: string,
  ): Promise<string> {
    const row = await tx.query.inventory.findFirst({
      where: (t, { and: a, eq: e }) => a(e(t.variantId, variantId), e(t.branchId, branchId)),
      columns: { quantity: true, reservedQuantity: true },
    });
    if (!row) return "0";

    return Money.toDecimalString(
      Money.subtract(Money.toMinor(row.quantity), Money.toMinor(row.reservedQuantity)),
      4,
    );
  }

  /**
   * Hold stock for a confirmed order — not yet shipped, but no longer free to
   * promise to somebody else. Writes only `reservedQuantity`, never the
   * ledger: nothing has actually moved yet, so there is nothing to post.
   *
   * Upserts like `post()` does, for the same reason: the first reservation
   * against a (variant, branch) with no inventory row yet must not need a
   * separate "create the row" step.
   */
  async reserveStock(input: {
    tx: Transaction;
    variantId: string;
    branchId: string;
    quantity: string;
  }): Promise<void> {
    const tenantId = RequestContext.requireTenantId();

    await input.tx
      .insert(schema.inventory)
      .values({
        tenantId,
        variantId: input.variantId,
        branchId: input.branchId,
        reservedQuantity: input.quantity,
      })
      .onConflictDoUpdate({
        target: [schema.inventory.variantId, schema.inventory.branchId],
        set: {
          reservedQuantity: sql`${schema.inventory.reservedQuantity} + ${input.quantity}::numeric`,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Give back a hold — an order was cancelled, or the reserved units just
   * left as an actual fulfilment (see `deductStock`, called alongside this
   * in that case). Clamped at zero: a reservation released twice, or by more
   * than remains, must not drive this negative and quietly free stock that
   * was never held.
   */
  async releaseReservedStock(input: {
    tx: Transaction;
    variantId: string;
    branchId: string;
    quantity: string;
  }): Promise<void> {
    await input.tx
      .update(schema.inventory)
      .set({
        reservedQuantity: sql`GREATEST(${schema.inventory.reservedQuantity} - ${input.quantity}::numeric, 0)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.inventory.variantId, input.variantId),
          eq(schema.inventory.branchId, input.branchId),
        ),
      );
  }

  /**
   * Replay the ledger and correct the cached balance.
   *
   * The reconciliation the cache's existence depends on. Run nightly and after
   * any incident; if it ever finds drift, the ledger wins and the difference is
   * a bug in something that bypassed this service.
   */
  async recomputeFromLedger(
    variantId: string,
    branchId: string,
  ): Promise<{ cached: string; actual: string; drifted: boolean }> {
    return this.db.run(async (tx) => {
      const [summed] = await tx
        .select({ total: sql<string>`coalesce(sum(quantity), 0)::text` })
        .from(schema.inventoryTransactions)
        .where(
          and(
            eq(schema.inventoryTransactions.variantId, variantId),
            eq(schema.inventoryTransactions.branchId, branchId),
          ),
        );

      const actual = summed?.total ?? "0";
      const cached = await this.getCurrentStock(tx, variantId, branchId);
      const drifted = Money.toMinor(cached) !== Money.toMinor(actual);

      if (drifted) {
        this.logger.error(
          { variantId, branchId, cached, actual },
          "Stock balance drifted from the ledger — correcting from the ledger",
        );
        await tx
          .update(schema.inventory)
          .set({ quantity: actual })
          .where(
            and(
              eq(schema.inventory.variantId, variantId),
              eq(schema.inventory.branchId, branchId),
            ),
          );
      }

      return { cached, actual, drifted };
    });
  }

  // ---------------------------------------------------------------------------

  /**
   * The single write path. Everything above funnels through here.
   *
   * Order matters: the balance is updated FIRST and its post-update value is
   * used as the ledger row's `balanceAfter`. Reading the balance, then writing
   * the ledger, then writing the balance would leave a window where two
   * concurrent movements compute the same `balanceAfter`. The `UPDATE ...
   * RETURNING` takes a row lock, so concurrent movements on the same
   * (variant, branch) serialise and each sees the other's result.
   */
  private async post(input: {
    tx: Transaction;
    variantId: string;
    branchId: string;
    signedQuantity: Money.Minor4;
    quantity?: string;
    referenceType: string;
    referenceId: string;
    notes?: string;
    unitCost?: string;
    totalCost?: string;
    deviceId?: string;
    suppressEvents?: boolean;
  }): Promise<string> {
    const { tx, variantId, branchId, signedQuantity } = input;

    if (signedQuantity === 0n) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        "A stock movement of zero is not a movement",
      );
    }

    const tenantId = RequestContext.requireTenantId();
    const userId = RequestContext.get()?.user?.id ?? null;
    const delta = Money.toDecimalString(signedQuantity, 4);

    /**
     * Weighted average cost, recomputed on the way IN.
     *
     *   new = (onHand x oldAverage + arriving x arrivingCost) / (onHand + arriving)
     *
     * Only stock coming in moves it. Selling at any price does not change what
     * the remaining units cost, and letting an outbound movement rewrite the
     * average would make margin depend on the order things were sold in.
     *
     * Computed in SQL against the row being locked by this very statement, so
     * two receipts landing together cannot both read the same "old" average and
     * each overwrite the other's result.
     *
     * `GREATEST(..., 0)` guards the denominator: a variant whose on-hand has
     * gone negative through an out-of-order sale would otherwise divide by a
     * quantity smaller than what is arriving, and produce an average far above
     * anything ever paid.
     */
    const inbound = signedQuantity > 0n;
    const arriving = inbound && input.unitCost ? input.unitCost : null;

    /**
     * What the arriving stock cost in total.
     *
     * `totalCost` when the caller knows it exactly — a goods receipt does,
     * and its per-unit figure is a division it had to round. Otherwise
     * reconstructed as `delta x unitCost`, which is what this always did.
     */
    const arrivingValue = inbound
      ? input.totalCost
        ? sql`${input.totalCost}::numeric`
        : arriving
          ? sql`${delta}::numeric * ${arriving}::numeric`
          : null
      : null;

    // The seed for a (variant, branch) with no prior row: the average IS this
    // delivery's cost. Derived from the total when there is one, so the first
    // receipt is as exact as every later one.
    const seedAverage = input.totalCost
      ? sql`round(${input.totalCost}::numeric / NULLIF(${delta}::numeric, 0), 4)`
      : arriving
        ? sql`${arriving}::numeric`
        : null;

    // Upsert so the first movement for a (variant, branch) does not need a
    // separate "create the inventory row" step that every caller could forget.
    const [balance] = await tx
      .insert(schema.inventory)
      .values({
        tenantId,
        variantId,
        branchId,
        quantity: delta,
        ...(seedAverage ? { averageCost: seedAverage } : {}),
      })
      .onConflictDoUpdate({
        target: [schema.inventory.variantId, schema.inventory.branchId],
        set: {
          quantity: sql`${schema.inventory.quantity} + ${delta}::numeric`,
          ...(arrivingValue
            ? {
                averageCost: sql`
                  CASE
                    WHEN ${schema.inventory.averageCost} IS NULL
                      THEN round(${arrivingValue} / NULLIF(${delta}::numeric, 0), 4)
                    ELSE round(
                      (
                        GREATEST(${schema.inventory.quantity}, 0) * ${schema.inventory.averageCost}
                        + ${arrivingValue}
                      ) / NULLIF(GREATEST(${schema.inventory.quantity}, 0) + ${delta}::numeric, 0),
                      4
                    )
                  END`,
              }
            : {}),
          updatedAt: new Date(),
        },
      })
      .returning({
        quantity: schema.inventory.quantity,
        averageCost: schema.inventory.averageCost,
        reservedQuantity: schema.inventory.reservedQuantity,
      });

    if (!balance) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not update the stock balance");
    }

    const [ledgerRow] = await tx
      .insert(schema.inventoryTransactions)
      .values({
        tenantId,
        variantId,
        branchId,
        type: this.typeFor(input.referenceType, signedQuantity),
        quantity: delta,
        balanceAfter: balance.quantity,
        ...(input.unitCost ? { unitCost: input.unitCost } : {}),
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        ...(input.notes ? { notes: input.notes } : {}),
        createdBy: userId,
        ...(input.deviceId ? { deviceId: input.deviceId } : {}),
      })
      .returning({ id: schema.inventoryTransactions.id });

    if (!ledgerRow) {
      throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not write the stock ledger");
    }

    // Crossing INTO low stock can only happen on a decrease — an inbound
    // movement only ever raises `available`, never drops it — so the extra
    // read below is skipped entirely on stock coming in.
    if (!input.suppressEvents && signedQuantity < 0n) {
      await this.checkLowStockCrossing({
        tx,
        tenantId,
        variantId,
        branchId,
        availableAfter: Money.subtract(Money.toMinor(balance.quantity), Money.toMinor(balance.reservedQuantity)),
        magnitudeOut: -signedQuantity,
      });
    }

    return ledgerRow.id;
  }

  /**
   * Record a LOW_STOCK_THRESHOLD_CROSSED event if this movement just pushed
   * `available` (on hand minus reserved) to or below the variant's minStock,
   * having been above it before this movement.
   *
   * One extra indexed read per outbound movement — the cost the crossing
   * check needs `minStock`, which `post()`'s own upsert has no reason to
   * return. Measure this against the sale path if it ever shows up; the
   * escape hatch is `suppressEvents` on the caller's input, for a bulk writer
   * where per-movement alerts are the wrong shape (see StockMovementInput).
   */
  private async checkLowStockCrossing(input: {
    tx: Transaction;
    tenantId: string;
    variantId: string;
    branchId: string;
    availableAfter: Money.Minor4;
    magnitudeOut: Money.Minor4;
  }): Promise<void> {
    const variant = await input.tx.query.productVariants.findFirst({
      where: (t, { eq: e }) => e(t.id, input.variantId),
      columns: { minStock: true },
    });
    if (!variant) return;

    // A variant with no reorder point set has opted out of this entirely —
    // matches the predicate InventoryService.lowStock() already uses.
    const minStock = Money.toMinor(variant.minStock);
    if (minStock <= 0n) return;

    const availableBefore = Money.add(input.availableAfter, input.magnitudeOut);
    const crossed = input.availableAfter <= minStock && availableBefore > minStock;
    if (!crossed) return;

    DomainEvents.record({
      name: DOMAIN_EVENTS.LOW_STOCK_THRESHOLD_CROSSED,
      tenantId: input.tenantId,
      payload: {
        variantId: input.variantId,
        branchId: input.branchId,
        available: Money.toDecimalString(input.availableAfter, 4),
        minStock: variant.minStock,
      },
    });
  }

  /**
   * Derive the ledger type from what caused the movement plus its direction.
   *
   * Inferred rather than passed in, so a caller cannot label a sale as a
   * purchase — the reporting that splits shrinkage from trade depends on this
   * being consistent.
   */
  private typeFor(referenceType: string, signed: Money.Minor4): InventoryTxType {
    const inbound = signed > 0n;

    switch (referenceType) {
      case "sale":
        return inbound ? "sale_return" : "sale";
      case "purchase_receipt":
      case "purchase_order":
        return inbound ? "purchase" : "purchase_return";
      case "stock_transfer":
        return inbound ? "transfer_in" : "transfer_out";
      case "stock_count":
        return "adjustment";
      case "opening_stock":
        return "opening_balance";
      case "reservation":
        return inbound ? "release" : "reservation";
      default:
        return "adjustment";
    }
  }
}
