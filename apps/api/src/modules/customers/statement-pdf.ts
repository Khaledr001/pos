import {
  formatDate,
  renderStatementDocument,
  type StatementDocumentInput,
} from "@devsfleet/pdf-documents";
import { Money } from "@devsfleet/shared-utils";

/**
 * A customer's statement for a period, as the A4 statement of account.
 *
 * The layout lives in `@devsfleet/pdf-documents` beside the tax invoice; this
 * file only maps the ledger onto it. Every figure is formatted here, in Money,
 * from the decimal strings the ledger query returned — the layout prints
 * strings and adds nothing up.
 */

export interface StatementPdfEntry {
  date: Date;
  kind: "invoice" | "return" | "payment";
  docNumber: string | null;
  branchName: string | null;
  method: string | null;
  debit: string;
  credit: string;
  balance: string;
}

export interface StatementPdfInput {
  business: StatementDocumentInput["business"];
  currency: string;
  timezone: string;
  issuedAt: Date;
  /** YYYY-MM-DD, inclusive; null = open-ended. */
  from: string | null;
  to: string | null;
  customer: StatementDocumentInput["customer"];
  openingBalance: string;
  closingBalance: string;
  /** Null or zero = no credit facility. */
  creditLimit: string | null;
  entries: StatementPdfEntry[];
}

/** "1,440.75" — grouped, two places, from a decimal string, no floats. */
export function amount(value: string): string {
  const plain = Money.toDecimalString(Money.toMinor(value || "0"), 2);
  const negative = plain.startsWith("-");
  const [whole = "0", frac = "00"] = (negative ? plain.slice(1) : plain).split(".");
  return `${negative ? "-" : ""}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

const withCurrency = (currency: string, value: string) => `${currency} ${amount(value)}`;

/** Blank rather than "0.00" in a debit or credit column — the eye is looking for the side that moved. */
const side = (value: string) => (Money.isPositive(Money.toMinor(value || "0")) ? amount(value) : "");

const KIND = { invoice: "Invoice", return: "Return", payment: "Payment" } as const;

export function describeEntry(entry: Pick<StatementPdfEntry, "kind" | "branchName" | "method">): string {
  const detail = entry.kind === "payment" ? entry.method?.replace(/_/g, " ") : entry.branchName;
  return detail ? `${KIND[entry.kind]} · ${detail}` : KIND[entry.kind];
}

/** Worded the way a customer reads it, in the business's own timezone. */
export function periodLabel(from: string | null, to: string | null, issuedAt: Date, timezone: string): string {
  const day = (d: string) => formatDate(new Date(`${d}T12:00:00Z`), "UTC");
  if (from && to) return `${day(from)} – ${day(to)}`;
  if (from) return `${day(from)} – ${formatDate(issuedAt, timezone)}`;
  if (to) return `Up to ${day(to)}`;
  return `All activity to ${formatDate(issuedAt, timezone)}`;
}

export function statementDocumentInput(input: StatementPdfInput): StatementDocumentInput {
  const debits = input.entries.reduce((sum, e) => Money.add(sum, Money.toMinor(e.debit || "0")), Money.ZERO);
  const credits = input.entries.reduce((sum, e) => Money.add(sum, Money.toMinor(e.credit || "0")), Money.ZERO);
  const limit = input.creditLimit ? Money.toMinor(input.creditLimit) : Money.ZERO;
  const hasCredit = Money.isPositive(limit);
  const available = Money.max(Money.subtract(limit, Money.toMinor(input.closingBalance)), Money.ZERO);

  return {
    business: input.business,
    currency: input.currency,
    timezone: input.timezone,
    issuedAt: input.issuedAt,
    periodLabel: periodLabel(input.from, input.to, input.issuedAt, input.timezone),
    customer: input.customer,
    openingBalance: withCurrency(input.currency, input.openingBalance),
    totalDebit: withCurrency(input.currency, Money.toDecimalString(debits, 4)),
    totalCredit: withCurrency(input.currency, Money.toDecimalString(credits, 4)),
    closingBalance: withCurrency(input.currency, input.closingBalance),
    creditLimit: hasCredit ? withCurrency(input.currency, Money.toDecimalString(limit, 4)) : null,
    availableCredit: hasCredit ? withCurrency(input.currency, Money.toDecimalString(available, 4)) : null,
    entries: input.entries.map((e) => ({
      date: e.date,
      documentNumber: e.docNumber,
      description: describeEntry(e),
      debit: side(e.debit),
      credit: side(e.credit),
      balance: amount(e.balance),
    })),
  };
}

export function renderStatementPdf(input: StatementPdfInput): Promise<Buffer> {
  return renderStatementDocument(statementDocumentInput(input));
}
