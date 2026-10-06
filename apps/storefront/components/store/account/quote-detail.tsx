import type { QuoteView } from "@devsfleet/storefront-client";
import type { ReactNode } from "react";
import { formatDate, formatDateTime, uomShort } from "@/lib/format";
import { QuoteStatusBadge } from "./quote-status";

function statusMessage(quote: QuoteView): string {
  switch (quote.status) {
    case "REQUESTED":
      return "We've received your request and will price it. Figures below are an estimate at list price and may change.";
    case "QUOTED":
      return quote.validUntil
        ? `Our prices are held until ${formatDateTime(quote.validUntil)}. Accept to confirm them, or decline if you don't need them.`
        : "Our prices are below. Accept to confirm them, or decline if you don't need them.";
    case "ACCEPTED":
      return "You accepted this quote. Our team will be in touch to confirm your order.";
    case "DECLINED":
      return "This quote was declined. Nothing more will happen on it.";
    case "EXPIRED":
      return "This quote has expired and can no longer be accepted. Request a new quote from your cart and we'll price it again.";
    case "CONVERTED":
      return "This quote has been turned into an order.";
  }
}

/** A quote: status, lines and totals. The actions (accept / decline) are passed in so this stays a server component. */
export function QuoteDetail({ quote, back, actions }: { quote: QuoteView; back?: ReactNode; actions?: ReactNode }) {
  const { totals } = quote;
  return (
    <div>
      {back}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl">
            Quote <span className="font-cond">{quote.number}</span>
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-steel">
            <span>Requested {formatDate(quote.requestedAt)}</span>
            <QuoteStatusBadge status={quote.status} />
            {quote.validUntil && quote.status !== "REQUESTED" && (
              <span>
                {quote.status === "EXPIRED" ? "Expired" : "Valid until"} {formatDate(quote.validUntil)}
              </span>
            )}
          </p>
        </div>
      </div>

      <p className="mt-5 rounded-[var(--radius-tag)] bg-sheet px-3 py-2 text-[15px]" role="status">
        {statusMessage(quote)}
      </p>

      {actions && <div className="mt-5">{actions}</div>}

      <section aria-labelledby="quote-items" className="mt-6 overflow-hidden rounded-[var(--radius-panel)] border border-galv bg-paper">
        <h2 id="quote-items" className="sr-only">
          Items
        </h2>
        <table className="w-full text-left text-[15px]">
          <thead className="bg-sheet text-sm text-steel">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Item</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Qty</th>
              <th scope="col" className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">{quote.estimate ? "Est. price" : "Price"}</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-galv">
            {quote.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3">
                  <span className="font-medium">{line.name}</span>
                  {line.variantName && line.variantName !== line.name && <span className="block text-sm text-steel">{line.variantName}</span>}
                  <span className="block text-sm text-steel">SKU {line.sku}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  {line.quantity} {uomShort(line.uom)}
                </td>
                <td className="hidden px-4 py-3 text-right sm:table-cell">{line.unitPrice.formatted}</td>
                <td className="tag-price px-4 py-3 text-right text-xl">{line.lineTotal.formatted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <section className="rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
          <h2 className="mb-3 text-xl">{quote.estimate ? "Estimated total" : "Quote total"}</h2>
          <dl className="space-y-2 text-[15px]">
            <div className="flex justify-between">
              <dt className="text-steel">Items (excl. VAT)</dt>
              <dd>{totals.subtotalNet.formatted}</dd>
            </div>
            {totals.discountNet.fils > 0 && (
              <div className="flex justify-between text-pipe">
                <dt>Discount</dt>
                <dd>−{totals.discountNet.formatted}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-steel">VAT</dt>
              <dd>{totals.vat.formatted}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-galv pt-3">
              <dt className="font-semibold">Total</dt>
              <dd className="tag-price text-3xl">{totals.total.formatted}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-steel">Delivery is not included. We confirm it when your order is placed.</p>
        </section>

        <section className="rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
          <h2 className="mb-3 text-xl">Your details</h2>
          <dl className="space-y-1 text-[15px]">
            <div>{quote.contactName}</div>
            {quote.companyName && <div>{quote.companyName}</div>}
            <div>{quote.contactEmail}</div>
            <div>{quote.contactPhone}</div>
          </dl>
          {quote.notes && (
            <>
              <h3 className="mt-4 text-sm font-medium text-steel">Your notes</h3>
              <p className="mt-1 whitespace-pre-line text-[15px]">{quote.notes}</p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
