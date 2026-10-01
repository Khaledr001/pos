import type { OrderSummary, Paged } from "@al-lahiq/api-client";
import type { Metadata } from "next";
import Link from "next/link";
import { OrderStatusBadge } from "@/components/store/account/order-status";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Pagination } from "@/components/ui/pagination";
import { accountGet, requireSession } from "@/lib/account-server";
import { DELIVERY_METHOD, formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Your orders", robots: { index: false } };

const PAGE_SIZE = 20;

export default async function OrdersPage({ searchParams }: PageProps<"/account/orders">) {
  const raw = Number((await searchParams).page);
  const page = Number.isInteger(raw) && raw > 1 ? raw : 1;
  const path = page > 1 ? `/account/orders?page=${page}` : "/account/orders";
  await requireSession(path);
  const data = await accountGet<Paged<OrderSummary>>(`/me/orders?page=${page}`, path);

  return (
    <div>
      <h1 className="text-4xl">Your orders</h1>
      <p className="mt-1 text-steel">Open an order to track it, download the tax invoice or order the same items again.</p>

      {data.items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={page > 1 ? "No orders on this page" : "No orders yet"}
            action={page > 1 ? <ButtonLink href="/account/orders" variant="secondary">Back to your latest orders</ButtonLink> : <ButtonLink href="/">Start shopping</ButtonLink>}
          >
            {page > 1 ? null : "When you place an order while logged in, it shows up here with its tax invoice."}
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-6 overflow-hidden rounded-[var(--radius-panel)] border border-galv bg-paper">
            <table className="w-full text-left text-[15px]">
              <thead className="bg-sheet text-sm text-steel">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Order</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium sm:table-cell">Date</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                  <th scope="col" className="hidden px-4 py-2.5 font-medium md:table-cell">Items</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-galv">
                {data.items.map((o) => (
                  <tr key={o.id} className="hover:bg-sheet/60">
                    <td className="px-4 py-3">
                      <Link href={`/account/orders/${o.id}`} className="font-cond text-xl font-semibold text-pipe hover:underline">
                        {o.orderNumber}
                      </Link>
                      <span className="block text-sm text-steel sm:hidden">{formatDate(o.placedAt)}</span>
                      <span className="hidden text-sm text-steel sm:block">{DELIVERY_METHOD[o.deliveryMethod]}</span>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">{formatDate(o.placedAt)}</td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">{o.itemCount}</td>
                    <td className="tag-price px-4 py-3 text-right text-xl">{o.total.formatted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 flex justify-center">
            <Pagination page={page} pageSize={data.pageSize ?? PAGE_SIZE} total={data.total} href={(p) => (p > 1 ? `/account/orders?page=${p}` : "/account/orders")} />
          </div>
        </>
      )}
    </div>
  );
}
