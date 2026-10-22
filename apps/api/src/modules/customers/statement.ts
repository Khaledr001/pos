import { inArray, schema, sql, type SQL } from "@devsfleet/db";
import { Money } from "@devsfleet/shared-utils";

/**
 * A customer's account ledger, one row per movement of what they owe.
 *
 * It mirrors exactly what moves `customers.credit_balance`, so the running
 * balance on a statement agrees with the balance on the profile:
 *
 *   invoice  debit the total, credit what was paid at the counter
 *            (net: the sale's due amount — what create() adds to the balance)
 *   return   credit the returned value, debit any cash refunded
 *            (net: the uncovered part — what createReturn() takes off)
 *   payment  credit the amount settled on account
 *
 * A voided sale is left out: void() withdraws its due from the balance and
 * zeroes the document, so it moved nothing in the end.
 *
 * Computed in SQL over every row rather than from whatever page of sales a
 * client happened to load — a balance summed from the latest hundred invoices
 * is wrong for every customer with a hundred and one.
 */
export function ledgerQuery(customerId: string, branchIds: string[] | null): SQL {
  const s = schema.sales;
  const p = schema.customerPayments;
  const pm = schema.payments;
  const b = schema.branches;

  const saleScope = branchIds ? sql`and ${inArray(s.branchId, branchIds)}` : sql``;
  const payScope = branchIds ? sql`and ${inArray(p.branchId, branchIds)}` : sql``;

  // Refunds are negative payment rows against the return document.
  const refunded = sql`coalesce((select -sum(${pm.amount}) from ${pm} where ${pm.saleId} = ${s.id}), 0)`;

  return sql`
    select
      ${s.id} as id,
      case when ${s.returnOfSaleId} is null then 'invoice' else 'return' end as kind,
      ${s.occurredAt} as date,
      ${s.saleNumber} as doc_number,
      ${s.status} as status,
      null::text as method,
      ${s.notes} as notes,
      ${b.name} as branch_name,
      case when ${s.returnOfSaleId} is null then ${s.total} else ${refunded} end as debit,
      case when ${s.returnOfSaleId} is null then ${s.total} - ${s.dueAmount} else -${s.total} end as credit
    from ${s}
    join ${b} on ${b.id} = ${s.branchId}
    where ${s.customerId} = ${customerId}
      and ${s.status} <> 'voided'
      ${saleScope}
    union all
    select
      ${p.id},
      'payment',
      ${p.createdAt},
      ${p.referenceNumber},
      null,
      ${p.method},
      ${p.notes},
      ${b.name},
      0,
      ${p.amount}
    from ${p}
    join ${b} on ${b.id} = ${p.branchId}
    where ${p.customerId} = ${customerId}
      ${payScope}
  `;
}

/** Raw aggregate figures as Postgres returns numerics: decimal strings, or null on no rows. */
export interface LedgerAggregates {
  invoiceCount: number | string;
  invoiced: string | null;
  paidAtSale: string | null;
  returned: string | null;
  refunded: string | null;
  accountPayments: string | null;
  entryCount: number | string;
}

export interface CustomerSummary {
  invoiceCount: number;
  /** Invoice totals, before returns. */
  invoiced: string;
  returned: string;
  /** Paid at the counter plus settled on account, less cash refunded. */
  paid: string;
  paidAtSale: string;
  accountPayments: string;
  refunded: string;
  /** What the ledger says is owed — the statement's closing balance. */
  balance: string;
  /** Statement rows, for the tab badge. */
  entryCount: number;
}

const m = (v: string | null) => Money.toMinor(v ?? "0");
const out = (v: bigint) => Money.toDecimalString(v, 4);

/**
 * Turns the SQL aggregates into the figures the profile shows. In Money, so a
 * balance over thousands of documents is exact to the last fils.
 */
export function summariseLedger(raw: LedgerAggregates): CustomerSummary {
  const invoiced = m(raw.invoiced);
  const paidAtSale = m(raw.paidAtSale);
  const returned = m(raw.returned);
  const refunded = m(raw.refunded);
  const accountPayments = m(raw.accountPayments);

  const debits = Money.add(invoiced, refunded);
  const credits = Money.add(paidAtSale, returned, accountPayments);

  return {
    invoiceCount: Number(raw.invoiceCount),
    invoiced: out(invoiced),
    returned: out(returned),
    paid: out(Money.subtract(Money.add(paidAtSale, accountPayments), refunded)),
    paidAtSale: out(paidAtSale),
    accountPayments: out(accountPayments),
    refunded: out(refunded),
    balance: out(Money.subtract(debits, credits)),
    entryCount: Number(raw.entryCount),
  };
}

/**
 * The balance carried into a page of the statement: the running balance
 * after its oldest row, less that row's own movement. Empty page — the
 * closing balance carries straight through.
 */
export function openingBalance(
  oldestRow: { balance: string; debit: string; credit: string } | undefined,
  closingBalance: string,
): string {
  if (!oldestRow) return out(Money.toMinor(closingBalance));
  const before = Money.subtract(
    Money.toMinor(oldestRow.balance),
    Money.subtract(Money.toMinor(oldestRow.debit), Money.toMinor(oldestRow.credit)),
  );
  return out(before);
}
