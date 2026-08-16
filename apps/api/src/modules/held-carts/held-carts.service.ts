import { and, desc, eq, schema } from "@devsfleet/db";
import { hasPermission } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { assertBranchInScope, requireBranchId } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { HoldCartDto, ListHeldCartsDto } from "./dto.js";

/**
 * Parked carts.
 *
 * A customer goes to fetch their wallet, or wants to add one more thing while
 * a queue builds behind them. The cart is set aside and the till is free.
 *
 * Held carts do NOT reserve stock. A cart parked over lunch must not make the
 * last tap unsellable to the customer standing at the counter — the stock check
 * happens when the cart is completed, which is also the only moment it is
 * meaningful.
 */
@Injectable()
export class HeldCartsService {
  constructor(private readonly db: TenantDatabase) {}

  async hold(dto: HoldCartDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();
    const branchId = requireBranchId(dto.branchId);

    return this.db.run(async (tx) => {
      // Idempotent on the terminal's own id: a hold retried over a flaky link
      // is one parked cart, not a list of near-identical ones.
      if (dto.clientId) {
        const known = await tx.query.heldCarts.findFirst({
          where: (t, { eq: e }) => e(t.clientId, dto.clientId!),
        });
        if (known) return known;
      }

      const [cart] = await tx
        .insert(schema.heldCarts)
        .values({
          tenantId,
          branchId,
          userId: user.id,
          label: dto.label ?? null,
          customerId: dto.customerId ?? null,
          cartData: dto.cartData,
          lineCount: dto.lineCount,
          total: String(dto.total),
          ...(dto.clientId ? { clientId: dto.clientId } : {}),
        })
        .returning();

      if (!cart) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not hold the cart");
      return cart;
    });
  }

  /**
   * The list a cashier picks from.
   *
   * Own carts by default. Someone else's parked cart is not usually theirs to
   * ring up, and a shared list at a busy counter is how one customer's basket
   * gets sold to another.
   */
  async list(query: ListHeldCartsDto): Promise<unknown[]> {
    const user = RequestContext.requireUser();
    const branchId = requireBranchId(query.branchId);

    // Only someone who can void a sale — a supervisor — may reach across.
    const canSeeOthers = hasPermission(user.permissions, "sale:void") && !query.mine;

    return this.db.run(async (tx) =>
      tx
        .select({
          id: schema.heldCarts.id,
          label: schema.heldCarts.label,
          lineCount: schema.heldCarts.lineCount,
          total: schema.heldCarts.total,
          customerId: schema.heldCarts.customerId,
          customerName: schema.customers.name,
          userName: schema.users.name,
          createdAt: schema.heldCarts.createdAt,
        })
        .from(schema.heldCarts)
        .innerJoin(schema.users, eq(schema.heldCarts.userId, schema.users.id))
        .leftJoin(schema.customers, eq(schema.heldCarts.customerId, schema.customers.id))
        .where(
          and(
            eq(schema.heldCarts.branchId, branchId),
            canSeeOthers ? undefined : eq(schema.heldCarts.userId, user.id),
          ),
        )
        .orderBy(desc(schema.heldCarts.createdAt))
        .limit(50),
    );
  }

  /**
   * Restore a cart, and remove it in the same transaction.
   *
   * Restoring without deleting leaves the same basket parked and on a till: the
   * next cashier rings up a cart that is already being paid for at the counter.
   */
  async restore(id: string): Promise<unknown> {
    return this.db.run(async (tx) => {
      const cart = await this.requireOwn(tx, id);

      await tx.delete(schema.heldCarts).where(eq(schema.heldCarts.id, id));
      return cart;
    });
  }

  async discard(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      await this.requireOwn(tx, id);
      await tx.delete(schema.heldCarts).where(eq(schema.heldCarts.id, id));
    });
  }

  // ---------------------------------------------------------------------------

  private async requireOwn(
    tx: Parameters<Parameters<TenantDatabase["run"]>[0]>[0],
    id: string,
  ) {
    const user = RequestContext.requireUser();
    const cart = await tx.query.heldCarts.findFirst({
      where: (t, { eq: e }) => e(t.id, id),
    });

    if (!cart) throw new AppError(ERROR_CODES.NOT_FOUND, "That held cart is no longer there");
    assertBranchInScope(cart.branchId);

    if (cart.userId !== user.id && !hasPermission(user.permissions, "sale:void")) {
      throw new AppError(
        ERROR_CODES.INSUFFICIENT_PERMISSIONS,
        "That cart belongs to another cashier",
      );
    }

    return cart;
  }
}
