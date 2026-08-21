import type { printer as ThermalPrinterInstance } from "node-thermal-printer";

/**
 * Renders a completed sale onto an already-configured ThermalPrinter's
 * buffer. Does not call `execute()` — the caller decides whether this is a
 * real print, a test page, or something being inspected before it goes out.
 *
 * Money and quantities arrive as the decimal strings they already are
 * everywhere else in this codebase — formatted for display here, never used
 * for arithmetic. The only arithmetic on this page is `sum(payments) - total`
 * for change, which is exactly what PaymentDialog itself computes.
 */

export interface ReceiptLine {
  productName: string;
  /** "Default" for a product sold with no variant of its own. */
  variantName: string;
  productSku: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  /** Line value before tax, after any line discount. */
  lineSubtotal: string;
  taxAmount: string;
  total: string;
}

export interface ReceiptPayment {
  method: string;
  amount: string;
  reference?: string | null;
}

export interface ReceiptSale {
  saleNumber: string | null;
  localId: string;
  occurredAt: string;
  lines: ReceiptLine[];
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  total: string;
  payments: ReceiptPayment[];
}

export interface ReceiptBusiness {
  legalName: string;
  trn: string | null;
  phone: string | null;
  email: string | null;
  addressLines: string[];
  currency: string;
  taxLabel: string;
  /** THIS terminal's own branch — set on activation, pulled fresh on every sync. */
  branchName: string | null;
  /** The business's own timezone, so a printed receipt reads the shop's clock. */
  timezone: string;
}

const METHOD_LABEL: Record<string, string> = {
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank Transfer",
  credit: "On Account",
  loyalty_points: "Loyalty Points",
};

function money(value: string): string {
  const n = Number(value || "0");
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function buildReceipt(
  printer: ThermalPrinterInstance,
  sale: ReceiptSale,
  business: ReceiptBusiness,
  options: { duplicate?: boolean; customerName?: string | null } = {},
): void {
  printer.alignCenter();
  printer.setTextDoubleHeight();
  printer.bold(true);
  printer.println(business.legalName || "Receipt");
  printer.bold(false);
  printer.setTextNormal();

  for (const line of business.addressLines) printer.println(line);
  if (business.phone) printer.println(`Tel: ${business.phone}`);
  if (business.trn) printer.println(`TRN: ${business.trn}`);

  printer.newLine();
  if (options.duplicate) {
    printer.invert(true);
    printer.println(" DUPLICATE ");
    printer.invert(false);
  }
  printer.bold(true);
  printer.println("TAX INVOICE");
  printer.bold(false);
  printer.newLine();

  printer.alignLeft();
  printer.println(`Invoice: ${sale.saleNumber ?? `PENDING-${sale.localId.slice(0, 8)}`}`);
  printer.println(`Date: ${formatDate(sale.occurredAt)}`);
  if (options.customerName) printer.println(`Customer: ${options.customerName}`);

  printer.drawLine();

  for (const line of sale.lines) {
    printer.println(line.productName);
    printer.leftRight(
      `  ${line.quantity} x ${money(line.unitPrice)}`,
      `${business.currency} ${money(line.total)}`,
    );
  }

  printer.drawLine();
  printer.leftRight("Subtotal", `${business.currency} ${money(sale.subtotal)}`);
  if (Number(sale.discountAmount) > 0) {
    printer.leftRight("Discount", `-${business.currency} ${money(sale.discountAmount)}`);
  }
  printer.leftRight(`${business.taxLabel}`, `${business.currency} ${money(sale.taxAmount)}`);

  printer.setTextDoubleHeight();
  printer.bold(true);
  printer.leftRight("TOTAL", `${business.currency} ${money(sale.total)}`);
  printer.bold(false);
  printer.setTextNormal();

  printer.drawLine();

  const tendered = sale.payments.reduce((sum, p) => sum + Number(p.amount || "0"), 0);
  const change = Math.max(0, tendered - Number(sale.total || "0"));

  for (const payment of sale.payments) {
    printer.leftRight(
      METHOD_LABEL[payment.method] ?? payment.method,
      `${business.currency} ${money(payment.amount)}`,
    );
  }
  if (change > 0) {
    printer.leftRight("Change", `${business.currency} ${money(String(change))}`);
  }

  printer.newLine();
  printer.alignCenter();
  printer.println("Thank you for your business");
  printer.newLine();
  printer.cut();
}
