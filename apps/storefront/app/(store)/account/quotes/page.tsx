import type { Paged, QuoteSummary } from "@devsfleet/storefront-client";
import type { Metadata } from "next";
import Link from "next/link";
import { QuoteStatusBadge } from "@/components/store/account/quote-status";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Pagination } from "@/components/ui/pagination";
import { accountGet, requireSession } from "@/lib/account-server";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Your quotes", robots: { index: false } };

const PAGE_SIZE = 20;

export default async function QuotesPage({ searchParams }: PageProps<"/account/quotes">) {
  const raw = Number((await searchParams).page);
  const page = Number.isInteger(raw) && raw > 1 ? raw : 1;
  const path = page > 1 ? `/account/quotes?page=${page}` : "/account/quotes";
  await requireSession(path);
  const data = await accountGet<Paged<QuoteSummary>>(`/quotes?page=${page}`, path);

  return (
    <div>
      <h1 className="text-4xl">Your quotes</h1>
      <p className="mt-1 text-steel">Prices we have quoted you for larger orders. Open one to accept or decline it.</p>

      {data.items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={page > 1 ? "No quotes on this page" : "No quotes yet"}
            action={page > 1 ? <ButtonLink href="/account/quotes" variant="secondary">Back to your latest quotes</ButtonLink> : <ButtonLink href="/cart">Go to your cart</ButtonLink>}
          >
            {page > 1 ? null : "Fill your cart, then choose Request a quote to have us price it for you."}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-hidden rounded-[var(--radius-panel)] border border-galv bg-paper">
            <table className="w-full text-left text-[15px]">
              <thead className="bg-sheet text-sm text-steel">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Quote</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Requested</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Valid until</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-galv">
                {data.items.map((q) => (
                  <tr key={q.id} className="hover:bg-sheet/60">
                    <td className="px-4 py-3">
                      <Link href={`/account/quotes/${q.id}`} className="font-cond text-xl font-semibold text-pipe hover:underline">
                        {q.number}
                      </Link>
                      <span className="block text-sm text-steel">
                        {q.itemCount} {q.itemCount === 1 ? "item" : "items"}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">{formatDate(q.requestedAt)}</td>
                    <td className="px-4 py-3">
                      <QuoteStatusBadge status={q.status} />
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">{q.estimate ? "" : formatDate(q.validUntil)}</td>
                    <td className="tag-price px-4 py-3 text-right text-xl">
                      {q.total.formatted}
                      {q.estimate && <span className="block text-xs font-normal text-steel">estimate</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 flex justify-center">
            <Pagination page={page} pageSize={data.pageSize ?? PAGE_SIZE} total={data.total} href={(p) => (p > 1 ? `/account/quotes?page=${p}` : "/account/quotes")} />
          </div>
        </>
      )}
    </div>
  );
}
