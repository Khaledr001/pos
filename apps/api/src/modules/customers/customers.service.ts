import { and, asc, count, desc, eq, ilike, inArray, isNull, or, schema, sql } from "@devsfleet/db";
import type { Customer } from "@devsfleet/db";
import { AppError, ERROR_CODES, Money } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { branchScope, requireBranchId } from "../../common/context/branch-scope.js";
import { RequestContext } from "../../common/context/request-context.js";
import { checkedSubdivision, partySettings } from "../../common/tax/party.js";
import { checkedTaxId, fieldError } from "../../common/tax/tenant-region.js";
import { containsPattern } from "../../common/db/list-query.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import {
  ledgerQuery,
  openingBalance,
  summariseLedger,
  type CustomerSummary,
  type LedgerAggregates,
} from "./statement.js";
import type {
  AdjustLoyaltyDto,
  CreateCustomerDto,
  ListCustomersDto,
  RecordPaymentDto,
  SetCreditDto,
  UpdateCustomerDto,
  CustomerStatementDto,
} from "./dto.js";

type Transaction = Parameters<Parameters<TenantDatabase["run"]>[0]>[0];

/** The columns whose values are tax-identity data an e-invoice is built from. */
const PARTY_KEYS = [
  "trn",
  "addressLine1",
  "addressLine2",
  "addressCity",
  "addressSubdivision",
  "addressPostalCode",
  "addressCountry",
  "einvoiceScheme",
  "einvoiceEndpoint",
] as const;
type PartyInput = Partial<Record<(typeof PARTY_KEYS)[number], string | null | undefined>>;

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
      const party = await this.checkedParty(tx, dto);
      const [customer] = await tx
        .insert(schema.customers)
        .values({
          tenantId,
          name: dto.name,
          branchId: dto.branchId ?? null,
          ...(dto.company ? { company: dto.company } : {}),
          ...(dto.phone ? { phone: dto.phone } : {}),
          ...(dto.email ? { email: dto.email } : {}),
          ...party,
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
      // Only the party fields (TRN, structured address, Peppol address) are
      // re-validated, and only when the request names one: fixing a phone
      // number never fails because an old customer has a TRN typed before TRNs
      // were checked.
      const partyTouched = PARTY_KEYS.some((key) => dto[key] !== undefined);
      const existing = partyTouched
        ? await tx.query.customers.findFirst({ where: (t, { and: a, eq: e, isNull: n }) => a(e(t.id, id), n(t.deletedAt)) })
        : undefined;
      if (partyTouched && !existing) throw new AppError(ERROR_CODES.NOT_FOUND, `Customer ${id} not found`);
      const party = partyTouched ? await this.checkedParty(tx, dto, existing) : {};

      const [updated] = await tx
        .update(schema.customers)
        .set({
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.company !== undefined ? { company: dto.company } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...party,
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
   * The party fields a write results in, validated against the tenant's region.
   *
   * Returns only the columns the request named, normalised (TRN without spaces,
   * emirate as its code, blanks as null) — so it can be spread straight into an
   * insert or an update. `existing` is the stored row for an update: the
   * "Peppol scheme and id come as a pair" rule looks at the result, not just
   * at what this request happened to send.
   */
  private async checkedParty(tx: Transaction, dto: PartyInput, existing?: Customer) {
    const tenant = await tx.query.tenants.findFirst({ columns: { settings: true } });
    const settings = partySettings(tenant?.settings);
    const out: {
      [K in (typeof PARTY_KEYS)[number]]?: K extends "addressCountry" ? string : string | null;
    } = {};

    if (dto.trn !== undefined) out.trn = checkedTaxId(dto.trn, settings, "trn");

    const country = (dto.addressCountry ?? existing?.addressCountry ?? "AE").toUpperCase();
    if (dto.addressCountry !== undefined) out.addressCountry = country;
    if (dto.addressSubdivision !== undefined) out.addressSubdivision = checkedSubdivision(dto.addressSubdivision, country, "addressSubdivision");
    for (const key of ["addressLine1", "addressLine2", "addressCity", "addressPostalCode"] as const) {
      if (dto[key] !== undefined) out[key] = dto[key] ?? null;
    }

    if (dto.einvoiceScheme !== undefined) out.einvoiceScheme = dto.einvoiceScheme ?? null;
    if (dto.einvoiceEndpoint !== undefined) out.einvoiceEndpoint = dto.einvoiceEndpoint ?? null;
    if (dto.einvoiceScheme !== undefined || dto.einvoiceEndpoint !== undefined) {
      const scheme = dto.einvoiceScheme !== undefined ? dto.einvoiceScheme : (existing?.einvoiceScheme ?? null);
      const endpoint = dto.einvoiceEndpoint !== undefined ? dto.einvoiceEndpoint : (existing?.einvoiceEndpoint ?? null);
      if (!!scheme !== !!endpoint) {
        throw fieldError(scheme ? "einvoiceEndpoint" : "einvoiceScheme", "Give both the Peppol scheme and the address, or neither.");
      }
    }
    return out;
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
   *
   * A `method: "cash"` payment given a `cashSessionId` also writes a
   * `cash_movements` row, in the SAME transaction. Without that, cash a
   * customer hands over at the counter to settle an old invoice is real money
   * that neither the till's close-out nor the branch's day-close has any way
   * to see — the drawer counts over at the end of the day with nothing in the
   * system to explain why. The insert is written directly against `tx` here
   * rather than by calling `CashRegisterService.recordMovement()`: that method
   * opens its OWN transaction via `TenantDatabase.run()`, and calling it from
   * inside this one would run on a second connection with no shared atomicity
   * — the payment could commit while the drawer entry silently didn't, or the
   * reverse. Cross-service composition in this codebase always works this way
   * (see `QuotationsService.convert`, which calls `SalesService.create` as a
   * separate top-level transaction for exactly this reason) — services that
   * must share one transaction take the caller's `tx` as a parameter instead
   * (see `StockService`).
   */
  async recordPayment(id: string, dto: RecordPaymentDto): Promise<unknown> {
    const tenantId = RequestContext.requireTenantId();
    const user = RequestContext.requireUser();
    const branchId = requireBranchId(dto.branchId);

    return this.db.run(async (tx) => {
      // Idempotent on the terminal's own id: a push retried after a timeout
      // resends the same payment, and it must not decrement the balance twice.
      if (dto.localId) {
        const known = await tx.query.customerPayments.findFirst({
          where: (t, { eq: e }) => e(t.localId, dto.localId!),
        });
        if (known) return known;
      }

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
          branchId,
          customerId: id,
          amount: String(dto.amount),
          method: dto.method,
          ...(dto.cashSessionId ? { cashSessionId: dto.cashSessionId } : {}),
          ...(dto.referenceNumber ? { referenceNumber: dto.referenceNumber } : {}),
          ...(dto.notes ? { notes: dto.notes } : {}),
          createdBy: user.id,
          ...(dto.localId ? { localId: dto.localId } : {}),
          ...(dto.occurredAt
            ? { createdAt: new Date(dto.occurredAt), updatedAt: new Date(dto.occurredAt) }
            : {}),
        })
        .returning();

      if (!payment) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Could not record the payment");

      if (dto.method === "cash" && dto.cashSessionId) {
        const session = await tx.query.cashSessions.findFirst({
          where: (t, { eq: e }) => e(t.id, dto.cashSessionId!),
        });

        // Silently skip the drawer entry rather than fail the whole payment —
        // the customer's balance moving is the part that must never be lost.
        // A closed or missing session means this cash cannot be attributed to
        // any reconciliation; it does not mean the payment never happened.
        if (session && session.status === "open") {
          await tx.insert(schema.cashMovements).values({
            tenantId,
            cashSessionId: dto.cashSessionId,
            type: "cash_in",
            amount: String(dto.amount),
            reason: `Account payment from ${customer.name}${dto.referenceNumber ? ` (${dto.referenceNumber})` : ""}`,
            referenceType: "customer_payment",
            referenceId: payment.id,
            createdBy: user.id,
          });
        }
      }

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

  /**
   * Lifetime figures for the profile, over every document rather than the
   * latest page of them. Branch-scoped like the sales list: someone limited
   * to one shop sees that shop's dealings with the customer.
   */
  async summary(id: string): Promise<CustomerSummary> {
    await this.findById(id);
    const scope = branchScope();
    const s = schema.sales;
    const p = schema.customerPayments;
    const pm = schema.payments;

    return this.db.run(async (tx) => {
      const saleScope = scope ? sql`and ${inArray(s.branchId, scope)}` : sql``;
      const payScope = scope ? sql`and ${inArray(p.branchId, scope)}` : sql``;

      const [sales] = (
        await tx.execute(sql`
          select
            count(*) filter (where ${s.returnOfSaleId} is null) as "invoiceCount",
            sum(${s.total}) filter (where ${s.returnOfSaleId} is null) as "invoiced",
            sum(${s.total} - ${s.dueAmount}) filter (where ${s.returnOfSaleId} is null) as "paidAtSale",
            -sum(${s.total}) filter (where ${s.returnOfSaleId} is not null) as "returned",
            sum((select -sum(${pm.amount}) from ${pm} where ${pm.saleId} = ${s.id}))
              filter (where ${s.returnOfSaleId} is not null) as "refunded",
            count(*) as "saleRows"
          from ${s}
          where ${s.customerId} = ${id} and ${s.status} <> 'voided' ${saleScope}
        `)
      ) as unknown as Array<Record<string, string | number | null>>;

      const [payments] = (
        await tx.execute(sql`
          select sum(${p.amount}) as "accountPayments", count(*) as "paymentRows"
          from ${p}
          where ${p.customerId} = ${id} ${payScope}
        `)
      ) as unknown as Array<Record<string, string | number | null>>;

      return summariseLedger({
        invoiceCount: sales?.invoiceCount ?? 0,
        invoiced: (sales?.invoiced as string | null) ?? null,
        paidAtSale: (sales?.paidAtSale as string | null) ?? null,
        returned: (sales?.returned as string | null) ?? null,
        refunded: (sales?.refunded as string | null) ?? null,
        accountPayments: (payments?.accountPayments as string | null) ?? null,
        entryCount: Number(sales?.saleRows ?? 0) + Number(payments?.paymentRows ?? 0),
      } satisfies LedgerAggregates);
    });
  }

  /**
   * One page of the account statement, with the running balance worked out
   * over the WHOLE ledger before paging — so page 2 carries on from where
   * page 1 left off, whichever way it is sorted. Ties on the same instant are
   * broken by id, or two rows could swap between pages and the running
   * balance would jump.
   */
  async statement(id: string, query: CustomerStatementDto) {
    await this.findById(id);
    const scope = branchScope();
    const direction = query.order === "asc" ? sql`asc` : sql`desc`;

    return this.db.run(async (tx) => {
      const ledger = ledgerQuery(id, scope);
      const result = await tx.execute(sql`
        with ledger as (${ledger}),
        running as (
          select ledger.*,
            sum(debit - credit) over (
              order by date asc, id asc rows between unbounded preceding and current row
            ) as balance
          from ledger
        )
        select
          id, kind, date, doc_number as "docNumber", status, method, notes,
          branch_name as "branchName",
          debit::text as debit, credit::text as credit, balance::text as balance,
          count(*) over () as "totalRows",
          (select coalesce(sum(debit - credit), 0) from ledger)::text as "closingBalance"
        from running
        order by date ${direction}, id ${direction}
        limit ${query.pageSize} offset ${(query.page - 1) * query.pageSize}
      `);

      type Row = {
        id: string;
        kind: "invoice" | "return" | "payment";
        date: string;
        docNumber: string | null;
        status: string | null;
        method: string | null;
        notes: string | null;
        branchName: string | null;
        debit: string;
        credit: string;
        balance: string;
        totalRows: string | number;
        closingBalance: string;
      };
      const rows = result as unknown as Row[];

      let total = Number(rows[0]?.totalRows ?? 0);
      let closing = rows[0]?.closingBalance ?? "0";
      if (rows.length === 0) {
        // Past the last page the window functions have nothing to report on.
        const [agg] = (
          await tx.execute(sql`
            with ledger as (${ledger})
            select count(*) as n, coalesce(sum(debit - credit), 0)::text as closing from ledger
          `)
        ) as unknown as Array<{ n: string | number; closing: string }>;
        total = Number(agg?.n ?? 0);
        closing = agg?.closing ?? "0";
      }

      const items = rows.map(({ totalRows: _t, closingBalance: _c, ...row }) => row);
      const oldest = query.order === "asc" ? items[0] : items[items.length - 1];
      const totalPages = Math.max(1, Math.ceil(total / query.pageSize));

      return {
        items,
        meta: {
          page: query.page,
          limit: query.pageSize,
          total,
          totalPages,
          hasNext: query.page < totalPages,
          hasPrev: query.page > 1,
          openingBalance: openingBalance(oldest, closing),
          closingBalance: Money.toDecimalString(Money.toMinor(closing), 4),
        },
      };
    });
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
      const term = containsPattern(query.q);
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
        .orderBy(
          query.sortOrder === "asc"
            ? asc(schema.customers[query.sortBy])
            : desc(schema.customers[query.sortBy]),
          desc(schema.customers.id),
        )
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
