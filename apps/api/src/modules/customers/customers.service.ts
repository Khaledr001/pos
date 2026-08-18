import { and, count, desc, eq, ilike, isNull, or, schema, sql } from "@devsfleet/db";
import type { Customer } from "@devsfleet/db";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type {
  AdjustLoyaltyDto,
  CreateCustomerDto,
  ListCustomersDto,
  RecordPaymentDto,
  SetCreditDto,
  UpdateCustomerDto,
} from "./dto.js";

type Transaction = Parameters<Parameters<TenantDatabase["run"]>[0]>[0];

/**
 * Customers: contact record, credit account, and loyalty account in one.
 *
 * `creditBalance` and `loyaltyPoints` are both caches of a ledger — sales and
 * loyalty transactions respectively — maintained inside the same transaction
 * as whatever moved them. Neither is ever set directly from this service
 * except by the reconciliation check, which corrects the cache FROM the
 * ledger and never the other way around.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly db: TenantDatabase) {}

  async create(dto: CreateCustomerDto): Promise<Customer> {
    const tenantId = RequestContext.requireTenantId();

    return this.db.run(async (tx) => {
      const [customer] = await tx
        .insert(schema.customers)
        .values({
          tenantId,
          name: dto.name,
          branchId: dto.branchId ?? null,
          ...(dto.company ? { company: dto.company } : {}),
          ...(dto.phone ? { phone: dto.phone } : {}),
          ...(dto.email ? { email: dto.email } : {}),
          ...(dto.trn ? { trn: dto.trn } : {}),
          ...(dto.address ? { address: dto.address } : {}),
          type: dto.type,
          locale: dto.locale,
          priceListId: dto.priceListId ?? null,
          creditLimit: String(dto.creditLimit),
          paymentTermDays: dto.paymentTermDays,
          ...(dto.whatsappPhone ? { whatsappPhone: dto.whatsappPhone } : {}),
          ...(dto.notes ? { notes: dto.notes } : {}),
          ...(dto.localId ? { localId: dto.localId } : {}),
          ...(dto.occurredAt ? { createdAt: new Date(dto.occurredAt), updatedAt: new Date(dto.occurredAt) } : {}),
        })
        .returning();

      if (!customer) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not create the customer");
      return customer;
    });
  }

  async update(id: string, dto: UpdateCustomerDto): Promise<Customer> {
    return this.db.run(async (tx) => {
      const [updated] = await tx
        .update(schema.customers)
        .set({
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.company !== undefined ? { company: dto.company } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.trn !== undefined ? { trn: dto.trn } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.type !== undefined ? { type: dto.type } : {}),
          ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
          ...(dto.priceListId !== undefined ? { priceListId: dto.priceListId } : {}),
          ...(dto.paymentTermDays !== undefined ? { paymentTermDays: dto.paymentTermDays } : {}),
          ...(dto.whatsappPhone !== undefined ? { whatsappPhone: dto.whatsappPhone } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          // creditLimit is deliberately NOT accepted here — see setCredit below.
        })
        .where(and(eq(schema.customers.id, id), isNull(schema.customers.deletedAt)))
        .returning();

      if (!updated) throw new AppError(ERROR_CODES.NOT_FOUND, `Customer ${id} not found`);
      return updated;
    });
  }

  /**
   * `customer:credit` only, kept separate from `update`.
   *
   * A role permitted to fix a customer's phone number must not thereby be able
   * to raise its own credit ceiling — the two are different powers with
   * different blast radii, and folding them into one endpoint means the
   * permission check can only gate all of it or none of it.
   */
  async setCredit(id: string, dto: SetCreditDto): Promise<Customer> {
    return this.db.run(async (tx) => {
      const [updated] = await tx
        .update(schema.customers)
        .set({
          creditLimit: String(dto.creditLimit),
          ...(dto.creditOnHold !== undefined ? { creditOnHold: dto.creditOnHold } : {}),
        })
        .where(and(eq(schema.customers.id, id), isNull(schema.customers.deletedAt)))
        .returning();

      if (!updated) throw new AppError(ERROR_CODES.NOT_FOUND, `Customer ${id} not found`);
      return updated;
    });
  }

  /**
   * Settle an old credit invoice.
   *
   * Decreases `creditBalance` in the same transaction as the payment row, so
   * the two can never disagree. Refuses to take a payment past what is owed —
   * an overpayment is a different transaction (a deposit or a refund), not a
   * bigger version of this one.
   */
  async recordPayment(id: string, dto: RecordPaymentDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();

    return this.db.run(async (tx) => {
      const customer = await tx.query.customers.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)),
      });
      if (!customer) throw new AppError(ERROR_CODES.NOT_FOUND, `Customer ${id} not found`);

      const owed = Money.toMinor(customer.creditBalance);
      const amount = Money.toMinor(String(dto.amount));

      if (Money.isNegative(owed) || amount > owed) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `This customer owes ${Money.toDecimalString(Money.max(owed, 0n), 2)}. A payment cannot exceed that.`,
        );
      }

      const [payment] = await tx
        .insert(schema.customerPayments)
        .values({
          tenantId,
          customerId: id,
          amount: String(dto.amount),
          method: dto.method,
          ...(dto.referenceNumber ? { referenceNumber: dto.referenceNumber } : {}),
          ...(dto.notes ? { notes: dto.notes } : {}),
          createdBy: user.id,
        })
        .returning();

      await tx
        .update(schema.customers)
        .set({
          creditBalance: sql`${schema.customers.creditBalance} - ${String(dto.amount)}::numeric`,
        })
        .where(eq(schema.customers.id, id));

      return payment;
    });
  }

  async paymentHistory(id: string): Promise<unknown[]> {
    return this.db.run(async (tx) =>
      tx
        .select()
        .from(schema.customerPayments)
        .where(eq(schema.customerPayments.customerId, id))
        .orderBy(desc(schema.customerPayments.createdAt))
        .limit(100),
    );
  }

  /**
   * Grant or spend loyalty points, and record why.
   *
   * Ledger-first: the transaction row is written, then the cache is moved by
   * the exact same signed amount in the same statement — the two can never
   * drift from a partial failure the way two independent writes could.
   */
  async adjustLoyalty(id: string, dto: AdjustLoyaltyDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();

    return this.db.run(async (tx) => {
      const customer = await tx.query.customers.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)),
      });
      if (!customer) throw new AppError(ERROR_CODES.NOT_FOUND, `Customer ${id} not found`);

      if (dto.points < 0 && customer.loyaltyPoints + dto.points < 0) {
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          `This customer has ${customer.loyaltyPoints} points. Cannot redeem ${-dto.points}.`,
        );
      }

      const [entry] = await tx
        .insert(schema.loyaltyTransactions)
        .values({
          tenantId,
          customerId: id,
          points: dto.points,
          type: dto.points > 0 ? "earned" : "redeemed",
          referenceType: "manual",
          notes: dto.reason,
          createdBy: user.id,
        })
        .returning();

      const [updated] = await tx
        .update(schema.customers)
        .set({ loyaltyPoints: sql`${schema.customers.loyaltyPoints} + ${dto.points}` })
        .where(eq(schema.customers.id, id))
        .returning({ loyaltyPoints: schema.customers.loyaltyPoints });

      return { entry, loyaltyPoints: updated?.loyaltyPoints ?? customer.loyaltyPoints + dto.points };
    });
  }

  async loyaltyHistory(id: string): Promise<unknown[]> {
    return this.db.run(async (tx) =>
      tx
        .select()
        .from(schema.loyaltyTransactions)
        .where(eq(schema.loyaltyTransactions.customerId, id))
        .orderBy(desc(schema.loyaltyTransactions.createdAt))
        .limit(100),
    );
  }

  async findById(id: string): Promise<Customer> {
    const customer = await this.db.run(async (tx) =>
      tx.query.customers.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)),
      }),
    );
    if (!customer) throw new AppError(ERROR_CODES.NOT_FOUND, `Customer ${id} not found`);
    return customer;
  }

  async list(query: ListCustomersDto): Promise<{ items: Customer[]; total: number }> {
    return this.db.run(async (tx) => {
      const term = query.q ? `%${query.q}%` : null;
      const where = and(
        isNull(schema.customers.deletedAt),
        query.includeInactive ? undefined : eq(schema.customers.isActive, true),
        query.type ? eq(schema.customers.type, query.type) : undefined,
        query.overLimitOnly
          ? sql`${schema.customers.creditBalance} > ${schema.customers.creditLimit}`
          : undefined,
        term
          ? or(
              ilike(schema.customers.name, term),
              ilike(schema.customers.company, term),
              ilike(schema.customers.phone, term),
            )
          : undefined,
      );

      const [total] = await tx.select({ value: count() }).from(schema.customers).where(where);
      const items = await tx
        .select()
        .from(schema.customers)
        .where(where)
        .orderBy(desc(schema.customers.createdAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      return { items, total: total?.value ?? 0 };
    });
  }

  /**
   * Soft delete, refused with an open balance.
   *
   * Deactivating a customer who owes money would make the debt invisible to
   * every collections view without settling it — the balance has to reach
   * zero first, one way or another.
   */
  async remove(id: string): Promise<void> {
    await this.db.run(async (tx) => {
      const customer = await tx.query.customers.findFirst({
        where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)),
      });
      if (!customer) throw new AppError(ERROR_CODES.NOT_FOUND, `Customer ${id} not found`);

      if (Money.isPositive(Money.toMinor(customer.creditBalance))) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          `This customer owes ${customer.creditBalance}. Settle the balance before removing them.`,
        );
      }

      await tx
        .update(schema.customers)
        .set({ deletedAt: new Date(), isActive: false })
        .where(eq(schema.customers.id, id));
    });
  }
}
