"use client";

import type { Dashboard, OrderStatus } from "@al-lahiq/api-client";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useAdminQuery } from "./data";
import { formatAed, pluralize } from "./helpers";
import { can } from "./roles";
import { useStaff } from "./staff-context";
import { DataTable, ErrorState, Loading, num, OrderStatusBadge, PageHeader, Panel, Stat } from "./ui";

const RANGES = [7, 30, 90] as const;

export function DashboardView() {
  const staff = useStaff();
  if (!can(staff.role, "reports")) return <Welcome />;
  return <Reports />;
}

function Welcome() {
  const staff = useStaff();
  const links = [
    can(staff.role, "orders") && { href: "/admin/orders", title: "Orders", text: "Confirm, pack and ship orders, and print packing slips." },
    can(staff.role, "customers") && { href: "/admin/customers", title: "Customers", text: "Look up a customer, their addresses and past orders." },
    can(staff.role, "catalog") && { href: "/admin/products", title: "Products", text: "Add photos, descriptions and specs, and publish products." },
    can(staff.role, "catalog") && { href: "/admin/categories", title: "Categories", text: "Arrange the departments and categories shoppers browse." },
    can(staff.role, "content") && { href: "/admin/content", title: "Pages and banners", text: "Edit guides, policy pages and home page banners." },
  ].filter((x): x is { href: string; title: string; text: string } => !!x);

  return (
    <>
      <PageHeader title={`Hello, ${staff.name.split(" ")[0]}`} description="Here's where to find the things you work on." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="rounded-[var(--radius-panel)] border border-galv bg-paper p-4 hover:border-steel-light">
            <h2 className="text-xl">{l.title}</h2>
            <p className="mt-1 text-sm text-steel">{l.text}</p>
          </Link>
        ))}
      </div>
    </>
  );
}

function Reports() {
  const [days, setDays] = useState<number>(30);
  const { data, error, isPending, refetch, isFetching } = useAdminQuery<Dashboard>("/admin/reports/dashboard", { days });

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Sales from orders placed in the last ${days} days. Cancelled and refunded orders are left out.`}
        actions={
          <div role="group" aria-label="Period" className="inline-flex rounded-[var(--radius-tag)] border border-galv bg-paper p-0.5">
            {RANGES.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days === d}
                onClick={() => setDays(d)}
                className={cn(
                  "h-8 rounded-[3px] px-3 text-sm font-medium",
                  days === d ? "bg-ink text-white" : "text-steel hover:text-ink",
                )}
              >
                {d} days
              </button>
            ))}
          </div>
        }
      />
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <Loading label="Loading sales figures" />
      ) : (
        <div className={cn("flex flex-col gap-4 transition-opacity", isFetching && "opacity-70")}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Orders" value={data.totals.orders.toLocaleString("en-AE")} />
            <Stat label="Revenue (incl. VAT)" value={data.totals.revenue.formatted} />
            <Stat label="VAT collected" value={data.totals.vat.formatted} />
            <Stat label="Average order" value={data.totals.averageOrder.formatted} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Stat
              label="Trade account applications waiting"
              value={data.pendingTradeApplications}
              href="/admin/customers?tradeStatus=PENDING"
              hint={data.pendingTradeApplications ? "Review them in Customers" : "Nothing to review"}
            />
            <Stat
              label="Abandoned carts"
              value={data.abandonedCarts}
              hint="Carts with items left untouched for more than a day"
            />
          </div>

          <Panel title="Daily revenue" description="Order totals including VAT, by day (UAE time)">
            <RevenueChart daily={data.daily} days={days} />
          </Panel>

          <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
            <Panel title="Orders by status" description={`All orders created in the last ${days} days`} flush>
              <StatusList counts={data.ordersByStatus} />
            </Panel>
            <Panel title="Best-selling products" description="By revenue, top 10" flush>
              {data.topProducts.length ? (
                <DataTable minWidth={480}>
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col" className="!text-right">
                        Qty sold
                      </th>
                      <th scope="col" className="!text-right">
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topProducts.map((p) => (
                      <tr key={p.sku}>
                        <td>
                          <p className="font-medium">{p.name}</p>
                          <p className="font-mono text-xs text-steel">{p.sku}</p>
                        </td>
                        <td className={num}>{p.quantity.toLocaleString("en-AE", { maximumFractionDigits: 2 })}</td>
                        <td className={num}>{p.revenue.formatted}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              ) : (
                <p className="p-4 text-sm text-steel">No sales in this period yet.</p>
              )}
            </Panel>
          </div>

          <Panel
            title="Searches with no results"
            description="What shoppers looked for and didn't find. Worth checking: stock the item, or add a search synonym in Settings."
            flush
          >
            {data.failedSearches.length ? (
              <DataTable minWidth={320}>
                <thead>
                  <tr>
                    <th scope="col">Search term</th>
                    <th scope="col" className="!text-right">
                      Times searched
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.failedSearches.map((s) => (
                    <tr key={s.term}>
                      <td>
                        <Link href={`/search?q=${encodeURIComponent(s.term)}`} target="_blank" className="font-medium hover:underline">
                          {s.term}
                        </Link>
                      </td>
                      <td className={num}>{s.count}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <p className="p-4 text-sm text-steel">Every search found something in this period.</p>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}

const STATUS_ORDER: OrderStatus[] = [
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

function StatusList({ counts }: { counts: Partial<Record<OrderStatus, number>> }) {
  const rows = STATUS_ORDER.filter((s) => counts[s]);
  if (!rows.length) return <p className="p-4 text-sm text-steel">No orders in this period.</p>;
  return (
    <ul className="divide-y divide-galv">
      {rows.map((s) => (
        <li key={s}>
          <Link href={`/admin/orders?status=${s}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-sheet/60">
            <OrderStatusBadge status={s} />
            <span className="font-cond text-lg font-semibold tabular-nums">{counts[s]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** YYYY-MM-DD of today in Dubai. */
function dubaiToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date());
}

const dayLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function RevenueChart({ daily, days }: { daily: Dashboard["daily"]; days: number }) {
  const byDay = new Map(daily.map((d) => [d.day.slice(0, 10), d]));
  const end = new Date(`${dubaiToday()}T00:00:00Z`);
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(end.getTime() - (days - 1 - i) * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const row = byDay.get(key);
    return { key, label: dayLabel.format(d), fils: row?.revenue.fils ?? 0, orders: row?.orders ?? 0 };
  });
  const max = Math.max(...series.map((s) => s.fils), 0);
  const total = series.reduce((a, s) => a + s.fils, 0);

  if (!total) return <p className="py-6 text-center text-sm text-steel">No revenue in this period yet.</p>;

  // A round top for the scale, so gridlines land on readable values.
  const step = niceStep(max / 4);
  const top = Math.max(step * Math.ceil(max / step), 1);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = days <= 7 ? 1 : days <= 30 ? 7 : 30;

  return (
    <figure>
      <p className="mb-2 text-[12px] text-steel" aria-hidden>
        AED
      </p>
      <div className="flex gap-2">
        <div className="relative w-12 shrink-0 text-right text-[12px] text-steel" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 tabular-nums" style={{ bottom: `${(t / top) * 100}%` }}>
              {shortAed(t)}
            </span>
          ))}
          <div className="h-48" />
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-galv" style={{ bottom: `${(t / top) * 100}%` }} />
            ))}
          </div>
          <div className="relative flex h-48 items-end gap-[2px]" aria-hidden>
            {series.map((s) => (
              <div key={s.key} className="group relative flex h-full flex-1 items-end justify-center">
                <div
                  className="w-full max-w-10 rounded-t-[4px] bg-pipe transition-colors group-hover:bg-pipe-dark"
                  style={{ height: s.fils ? `max(${(s.fils / top) * 100}%, 3px)` : 0 }}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-tag)] bg-ink px-2 py-1 text-[12px] text-white shadow group-hover:block">
                  <span className="font-semibold">{s.label}</span>
                  <br />
                  {formatAed(s.fils)}
                  <br />
                  {pluralize(s.orders, "order")}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-[2px] text-[12px] text-steel" aria-hidden>
            {series.map((s, i) => (
              <div key={s.key} className="relative flex-1">
                {(i === series.length - 1 || (i % labelEvery === 0 && series.length - 1 - i >= labelEvery / 2)) && (
                  <span className={cn("absolute whitespace-nowrap", i === series.length - 1 ? "right-0" : "left-0")}>{s.label}</span>
                )}
              </div>
            ))}
          </div>
          <div className="h-4" />
        </div>
      </div>
      <figcaption className="sr-only">Daily revenue for the last {days} days</figcaption>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-steel hover:text-ink">Show as a table</summary>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-[var(--radius-tag)] border border-galv">
          <DataTable minWidth={300}>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col" className="!text-right">
                  Orders
                </th>
                <th scope="col" className="!text-right">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {series
                .filter((s) => s.orders)
                .map((s) => (
                  <tr key={s.key}>
                    <th scope="row">{s.label}</th>
                    <td className={num}>{s.orders}</td>
                    <td className={num}>{formatAed(s.fils)}</td>
                  </tr>
                ))}
            </tbody>
          </DataTable>
        </div>
      </details>
    </figure>
  );
}

function niceStep(raw: number) {
  if (raw <= 0) return 100;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function shortAed(fils: number) {
  const aed = fils / 100;
  if (aed >= 1000) return `${(aed / 1000).toLocaleString("en-AE", { maximumFractionDigits: 1 })}k`;
  return aed.toLocaleString("en-AE", { maximumFractionDigits: 0 });
}
