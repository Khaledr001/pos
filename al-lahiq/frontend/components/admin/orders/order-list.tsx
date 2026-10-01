"use client";

import type { AdminOrderList, OrderStatus } from "@al-lahiq/api-client";
import Link from "next/link";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty";
import { cn } from "@/lib/cn";
import { DELIVERY_METHOD, emirateName, formatDateTime, ORDER_STATUS, PAYMENT_METHOD } from "@/lib/format";
import { useAdminQuery } from "../data";
import { FilterSelect, SearchInput, useListParams } from "../list-controls";
import { DataTable, ErrorState, FilterTabs, Loading, num, OrderStatusBadge, PageHeader, Panel, PaymentStatusBadge } from "../ui";

const TABS: OrderStatus[] = [
  "PLACED",
  "CONFIRMED",
  "PACKED",
  "SHIPPED",
  "READY_FOR_PICKUP",
  "DELIVERED",
  "COLLECTED",
  "CANCELLED",
  "REFUNDED",
  "PENDING_PAYMENT",
];
const PAGE_SIZE = 25;

export function OrderList() {
  const params = useListParams();
  const status = params.get("status");
  const q = params.get("q");
  const deliveryMethod = params.get("deliveryMethod");
  const { data, error, isPending, refetch, isFetching } = useAdminQuery<AdminOrderList>("/admin/orders", {
    status,
    q,
    deliveryMethod,
    page: params.page,
    pageSize: PAGE_SIZE,
  });

  const counts = data?.statusCounts ?? {};
  const allCount = Object.entries(counts).reduce((a, [s, n]) => (s === "PENDING_PAYMENT" ? a : a + (n ?? 0)), 0);
  const tabs = [
    { value: "", label: "All orders", count: data ? allCount : undefined },
    ...TABS.filter((s) => s !== "PENDING_PAYMENT" || counts[s]).map((s) => ({
      value: s,
      label: ORDER_STATUS[s],
      count: data ? (counts[s] ?? 0) : undefined,
    })),
  ];
  const filtered = !!(q || deliveryMethod);

  return (
    <>
      <PageHeader
        title="Orders"
        description="New orders arrive as “Order placed”. Confirm them, pack them, then mark them shipped or ready for pickup."
      />
      <Panel flush>
        <div className="px-3 pt-1">
          <FilterTabs label="Order status" items={tabs} value={status} onChange={(v) => params.set({ status: v })} />
        </div>
        <div className="flex flex-col gap-3 border-b border-galv p-3 sm:flex-row sm:items-center">
          <SearchInput
            className="flex-1"
            label="Search orders"
            placeholder="Order number, name, phone or email"
            value={q}
            onSearch={(v) => params.set({ q: v })}
          />
          <FilterSelect
            label="Delivery"
            value={deliveryMethod}
            onChange={(v) => params.set({ deliveryMethod: v })}
            options={[
              { value: "", label: "Courier and pickup" },
              { value: "COURIER", label: "Courier delivery" },
              { value: "PICKUP", label: "Store pickup" },
            ]}
          />
        </div>

        {error ? (
          <div className="p-3">
            <ErrorState error={error} onRetry={() => refetch()} />
          </div>
        ) : isPending ? (
          <Loading label="Loading orders" />
        ) : !data.items.length ? (
          <div className="p-3">
            <EmptyState title={filtered ? "No orders match your search" : "No orders here"}>
              {filtered ? (
                <button type="button" className="font-semibold text-pipe underline" onClick={() => params.set({ q: null, deliveryMethod: null })}>
                  Clear search and filters
                </button>
              ) : (
                "Orders with this status will show up here."
              )}
            </EmptyState>
          </div>
        ) : (
          <div className={cn(isFetching && "opacity-70")}>
            <DataTable minWidth={900}>
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Delivery</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="!text-right">
                    Items
                  </th>
                  <th scope="col" className="!text-right">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/admin/orders/${o.id}`} className="font-cond text-[17px] font-semibold text-pipe hover:underline">
                        {o.orderNumber}
                      </Link>
                      <p className="text-[13px] text-steel">{formatDateTime(o.placedAt ?? o.createdAt)}</p>
                    </td>
                    <td>
                      <p className="font-medium">{o.fullName}</p>
                      <p className="text-[13px] text-steel">{o.phone}</p>
                    </td>
                    <td>
                      <p>{DELIVERY_METHOD[o.deliveryMethod]}</p>
                      <p className="text-[13px] text-steel">
                        {o.deliveryMethod === "PICKUP"
                          ? [o.pickupBranch, o.pickupSlotStart && formatDateTime(o.pickupSlotStart)].filter(Boolean).join(", ")
                          : emirateName(o.emirate)}
                      </p>
                    </td>
                    <td>
                      <p>{PAYMENT_METHOD[o.paymentMethod]}</p>
                      <PaymentStatusBadge status={o.paymentStatus} />
                    </td>
                    <td>
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className={num}>{o.itemCount}</td>
                    <td className={num}>{o.total.formatted}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
        {data && data.total > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-galv px-3 py-2">
            <p className="text-sm text-steel">
              {data.total.toLocaleString("en-AE")} orders
            </p>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} href={params.pageHref} />
          </div>
        )}
      </Panel>
    </>
  );
}
