"use client";

import type { AdminCustomerDetail, AdminCustomerList, TradeStatus } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { FormError } from "@/components/ui/field";
import { Pagination } from "@/components/ui/pagination";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { emirateName, formatDate, formatDateTime } from "@/lib/format";
import { useAdminQuery, useInvalidate } from "../data";
import { SearchInput, useListParams } from "../list-controls";
import { ConfirmModal } from "../modal";
import { useCan } from "../staff-context";
import { useToast } from "../toast";
import { DataTable, ErrorState, Facts, FilterTabs, Loading, Notice, num, OrderStatusBadge, PageHeader, Panel } from "../ui";

export const TRADE_STATUS: Record<TradeStatus, { label: string; tone: "neutral" | "pipe" | "brass" | "signal" }> = {
  NONE: { label: "Retail", tone: "neutral" },
  PENDING: { label: "Trade application waiting", tone: "brass" },
  APPROVED: { label: "Trade account", tone: "pipe" },
  REJECTED: { label: "Trade application declined", tone: "signal" },
};

const PAGE_SIZE = 25;

export function CustomerList() {
  const params = useListParams();
  const q = params.get("q");
  const tradeStatus = params.get("tradeStatus");
  const { data, error, isPending, refetch, isFetching } = useAdminQuery<AdminCustomerList>("/admin/customers", {
    q,
    tradeStatus,
    page: params.page,
    pageSize: PAGE_SIZE,
  });

  return (
    <>
      <PageHeader title="Customers" description="Everyone with an account in the shop. Guests who checked out without an account only appear in Orders." />
      <Panel flush>
        <div className="px-3 pt-1">
          <FilterTabs
            label="Account type"
            value={tradeStatus}
            onChange={(v) => params.set({ tradeStatus: v })}
            items={[
              { value: "", label: "All customers" },
              { value: "PENDING", label: "Waiting for trade approval" },
              { value: "APPROVED", label: "Trade accounts" },
              { value: "NONE", label: "Retail" },
              { value: "REJECTED", label: "Declined" },
            ]}
          />
        </div>
        <div className="border-b border-galv p-3">
          <SearchInput label="Search customers" placeholder="Name, company, email or phone" value={q} onSearch={(v) => params.set({ q: v })} />
        </div>
        {error ? (
          <div className="p-3">
            <ErrorState error={error} onRetry={() => refetch()} />
          </div>
        ) : isPending ? (
          <Loading label="Loading customers" />
        ) : !data.items.length ? (
          <div className="p-3">
            <EmptyState title={q ? "No customers match your search" : "No customers here"}>
              {tradeStatus === "PENDING" ? "No trade applications are waiting." : undefined}
            </EmptyState>
          </div>
        ) : (
          <div className={cn(isFetching && "opacity-70")}>
            <DataTable minWidth={760}>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Company</th>
                  <th scope="col">Account</th>
                  <th scope="col" className="!text-right">
                    Orders
                  </th>
                  <th scope="col">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">
                      <Link href={`/admin/customers/${c.id}`} className="font-medium text-pipe hover:underline">
                        {c.firstName} {c.lastName}
                      </Link>
                    </th>
                    <td>
                      <p className="break-all">{c.email}</p>
                      {c.phone && <p className="text-[13px] text-steel">{c.phone}</p>}
                    </td>
                    <td>
                      {c.companyName ?? <span className="text-steel-light">None</span>}
                      {c.trn && <p className="font-mono text-[12px] text-steel">TRN {c.trn}</p>}
                    </td>
                    <td>
                      <Badge tone={TRADE_STATUS[c.tradeStatus].tone}>{TRADE_STATUS[c.tradeStatus].label}</Badge>
                    </td>
                    <td className={num}>{c.orderCount}</td>
                    <td className="whitespace-nowrap">{formatDate(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
        {data && data.total > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-galv px-3 py-2">
            <p className="text-sm text-steel">{data.total.toLocaleString("en-AE")} customers</p>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} href={params.pageHref} />
          </div>
        )}
      </Panel>
    </>
  );
}

export function CustomerDetail({ id }: { id: string }) {
  const path = `/admin/customers/${id}`;
  const { data: c, error, isPending, refetch } = useAdminQuery<AdminCustomerDetail>(path);
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isPending) return <Loading label="Loading customer" />;

  return (
    <>
      <PageHeader
        back={{ href: "/admin/customers", label: "All customers" }}
        title={`${c.firstName} ${c.lastName}`}
        meta={
          <>
            <Badge tone={TRADE_STATUS[c.tradeStatus].tone}>{TRADE_STATUS[c.tradeStatus].label}</Badge>
            <span>Customer since {formatDate(c.createdAt)}</span>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          {c.tradeStatus === "PENDING" && <TradeDecision customer={c} path={path} />}
          <Panel title="Recent orders" description={`Total spent: ${c.totalSpent.formatted} (excluding cancelled and refunded orders)`} flush>
            {c.orders.length ? (
              <DataTable minWidth={480}>
                <thead>
                  <tr>
                    <th scope="col">Order</th>
                    <th scope="col">Date</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="!text-right">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {c.orders.map((o) => (
                    <tr key={o.id}>
                      <th scope="row">
                        <Link href={`/admin/orders/${o.id}`} className="font-cond text-[17px] font-semibold text-pipe hover:underline">
                          {o.orderNumber}
                        </Link>
                      </th>
                      <td>{formatDateTime(o.createdAt)}</td>
                      <td>
                        <OrderStatusBadge status={o.status} />
                      </td>
                      <td className={num}>{o.total.formatted}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            ) : (
              <p className="p-4 text-sm text-steel">No orders yet.</p>
            )}
          </Panel>
          <Panel title="Saved addresses">
            {c.addresses.length ? (
              <ul className="grid gap-3 sm:grid-cols-2">
                {c.addresses.map((a) => (
                  <li key={a.id} className="rounded-[var(--radius-tag)] border border-galv p-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {a.label ?? a.fullName}
                      {a.isDefault && <Badge>Default</Badge>}
                    </p>
                    {a.label && <p>{a.fullName}</p>}
                    <p>{[a.building, a.street].filter(Boolean).join(", ")}</p>
                    <p>
                      {a.area}, {emirateName(a.emirate)}
                    </p>
                    <p className="text-steel">{a.phone}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-steel">No saved addresses.</p>
            )}
          </Panel>
        </div>
        <div className="flex flex-col gap-4">
          <Panel title="Contact">
            <Facts
              items={[
                [
                  "Email",
                  <a key="e" href={`mailto:${c.email}`} className="break-all text-pipe hover:underline">
                    {c.email}
                  </a>,
                ],
                [
                  "Phone",
                  c.phone ? (
                    <a key="p" href={`tel:${c.phone}`} className="text-pipe hover:underline">
                      {c.phone}
                    </a>
                  ) : (
                    "None"
                  ),
                ],
                ["Company", c.companyName ?? "None"],
                ["TRN", c.trn ? <span key="t" className="font-mono">{c.trn}</span> : "None"],
              ]}
            />
          </Panel>
          <Panel title="From the POS" description="Pricing for this customer is set in the POS.">
            <Facts
              items={[
                ["Customer code", c.posCustomerCode ? <span key="c" className="font-mono">{c.posCustomerCode}</span> : "Not linked yet"],
                [
                  "Price lists",
                  c.priceLists.length ? (
                    <ul key="l" className="flex flex-col gap-1">
                      {c.priceLists.map((p) => (
                        <li key={p.code}>
                          {p.name} <span className="font-mono text-[12px] text-steel">{p.code}</span>{" "}
                          <Badge tone={p.type === "TRADE" ? "pipe" : p.type === "PROMO" ? "brass" : "neutral"}>
                            {p.type === "TRADE" ? "Trade" : p.type === "PROMO" ? "Promotion" : "Retail"}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "Retail prices only"
                  ),
                ],
              ]}
            />
          </Panel>
        </div>
      </div>
    </>
  );
}

function TradeDecision({ customer: c, path }: { customer: AdminCustomerDetail; path: string }) {
  const canDecide = useCan("trade");
  const invalidate = useInvalidate();
  const toast = useToast();
  const [confirmReject, setConfirmReject] = useState(false);
  const decide = useMutation({
    mutationFn: (decision: "approve" | "reject") => adminApi.post(`${path}/trade`, { decision }),
    onSuccess: (_, decision) => {
      setConfirmReject(false);
      void invalidate(path, "/admin/customers", "/admin/reports/dashboard");
      toast(decision === "approve" ? `${c.firstName}'s trade account is approved` : `${c.firstName}'s trade application was declined`);
    },
  });

  return (
    <Panel title="Trade account application" className="border-brass/50">
      <div className="flex flex-col gap-3">
        <Facts
          items={[
            ["Company", c.companyName ?? "Not given"],
            ["TRN", c.trn ? <span key="t" className="font-mono">{c.trn}</span> : "Not given"],
          ]}
        />
        <Notice tone="info">
          Approving opens the trade account and emails the customer. Their trade price tier is assigned in the POS: link them to a trade
          price list there{c.posCustomerCode ? ` (customer code ${c.posCustomerCode})` : ""} to give them trade prices.
        </Notice>
        {canDecide ? (
          <>
            {!confirmReject && <FormError message={decide.error ? errorMessage(decide.error) : null} />}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => decide.mutate("approve")} loading={decide.isPending && decide.variables === "approve"} disabled={decide.isPending}>
                Approve trade account
              </Button>
              <Button variant="secondary" onClick={() => setConfirmReject(true)} disabled={decide.isPending}>
                Decline application
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-steel">A manager needs to approve or decline this application.</p>
        )}
      </div>
      <ConfirmModal
        open={confirmReject}
        onClose={() => setConfirmReject(false)}
        onConfirm={() => decide.mutate("reject")}
        title="Decline this trade application?"
        confirmLabel="Decline application"
        loading={decide.isPending}
        error={confirmReject && decide.error ? errorMessage(decide.error) : null}
      >
        The customer is told by email and keeps a normal retail account.
      </ConfirmModal>
    </Panel>
  );
}
