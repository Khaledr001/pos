"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  Loader2,
  Receipt,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Money } from "@devsfleet/shared-utils";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { useTenantSettings } from "@/lib/tenant-settings";
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  SortableTh,
  Table,
  TableBody,
  TableContainer,
  TableEmpty,
  TableHead,
  TablePagination,
  TableSearch,
  Th,
  numericCell,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow, MobileSort, listCard } from "@/components/ui/mobile-list";
import { DateRangeFilter } from "../_components/date-range-filter";
import { SelectField } from "@/components/ui/select";

/**
 * Cash drawers — the back office's reconciliation view.
 *
 * Read-only on purpose. Opening a drawer, paying in or out and counting at
 * close all happen at the till, where the cash physically is; this page is
 * where a manager finds out how those counts came out. For a drawer still
 * open it shows what the drawer should hold so far, which the cashier never
 * sees before they count.
 */

interface Session {
  id: string;
  sessionNumber: string;
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  branchName: string;
  branchCode: string;
  cashierName: string;
  deviceName: string | null;
  openingAmount: string;
  closingAmount: string | null;
  /** Frozen at close; for an open drawer, the figure so far. */
  expectedAmount: string;
  difference: string | null;
  cashSales: string;
  cashIn: string;
  cashOut: string;
}

interface SessionDetail extends Session {
  notes: string | null;
  closedByName: string | null;
  cashSaleCount: number;
  cashRefunds: string;
  movements: Array<{
    id: string;
    type: string;
    /** Signed: positive into the drawer, negative out. */
    amount: string;
    reason: string | null;
    occurredAt: string;
    byName: string | null;
  }>;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

const PAGE_SIZE = 25;

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Over, short or exact — said in words and an icon as well as colour, so the
 * one thing this page exists to show does not depend on telling red from green.
 */
function Variance({ session, currency }: { session: Session; currency: string }) {
  if (session.status === "open" || session.difference === null) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CircleDot className="size-3.5" aria-hidden="true" />
        Not counted yet
      </span>
    );
  }
  const diff = Money.toMinor(session.difference);
  if (diff === 0n) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        Exact
      </span>
    );
  }
  const short = diff < 0n;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 font-mono text-xs font-semibold tabular-nums",
        short ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400",
      )}
    >
      {short ? (
        <TrendingDown className="size-3.5" aria-hidden="true" />
      ) : (
        <TrendingUp className="size-3.5" aria-hidden="true" />
      )}
      {short ? "Short" : "Over"} {formatMoney(Money.toDecimalString(Money.abs(diff), 2), { currency })}
    </span>
  );
}

function StatusBadge({ status }: { status: Session["status"] }) {
  return status === "open" ? (
    <Badge variant="success" className="gap-1">
      <CircleDot className="size-3" aria-hidden="true" />
      Open
    </Badge>
  ) : (
    <Badge variant="secondary">Closed</Badge>
  );
}

export default function CashDrawersPage() {
  const { tokens } = useAuth();
  const settings = useTenantSettings();
  const currency = settings.currency.base;

  const list = useListQuery({
    sortBy: "openedAt",
    sortOrder: "desc",
    filters: { status: "", branchId: "", from: "", to: "" },
  });
  const { q, page, sortBy, sortOrder, filters } = list;

  const loadSessions = useCallback(
    async (signal: AbortSignal) =>
      readListResult<Session>(
        await api.get<unknown>("/cash-register/sessions", {
          accessToken: tokens?.accessToken,
          signal,
          query: {
            q: q.trim() || undefined,
            status: filters.status || undefined,
            branchId: filters.branchId || undefined,
            from: filters.from || undefined,
            to: filters.to || undefined,
            page,
            pageSize: PAGE_SIZE,
            sortBy,
            sortOrder,
          },
        }),
      ),
    [tokens?.accessToken, q, page, sortBy, sortOrder, filters],
  );
  const { items, total, loading, initialLoading, error, reload } = useListData(loadSessions, list.ready);

  const [branches, setBranches] = useState<Branch[]>([]);
  useEffect(() => {
    if (!tokens?.accessToken) return;
    void api
      .get<{ items: Branch[] }>("/branches", { accessToken: tokens.accessToken, query: { limit: 200 } })
      .then((res) => setBranches(res.items ?? []))
      .catch(() => setBranches([]));
  }, [tokens?.accessToken]);

  const [openId, setOpenId] = useState<string | null>(null);

  const STATUSES: Array<{ value: string; label: string }> = [
    { value: "", label: "All" },
    { value: "open", label: "Open" },
    { value: "closed", label: "Closed" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Cash Drawers</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Every till drawer session — its float, cash taken, pay-ins and pay-outs, and how the count came out.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <TableSearch
            value={list.search}
            onChange={list.setSearch}
            label="Search drawer sessions"
            placeholder="Search by session number..."
            className="flex-1"
          />
          <MobileSort
            options={[
              { column: "openedAt", label: "Opened", firstOrder: "desc" },
              { column: "difference", label: "Variance" },
            ]}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onChange={list.setSort}
          />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div role="group" aria-label="Drawer status" className="flex rounded-lg border border-input p-0.5">
            {STATUSES.map((s) => (
              <button
                key={s.value || "all"}
                type="button"
                onClick={() => list.setFilter("status", s.value)}
                aria-pressed={filters.status === s.value}
                className={cn(
                  "h-8 cursor-pointer rounded-md px-3 text-xs font-medium transition-colors",
                  filters.status === s.value
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
            Branch
            <SelectField
              value={filters.branchId}
              onValueChange={(v) => list.setFilter("branchId", v)}
              label="Branch"
              className="w-full sm:w-56"
              options={[
                { value: "", label: "All branches" },
                ...branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` })),
              ]}
            />
          </div>

          <div className="flex flex-col gap-1 text-[11px] font-medium text-muted-foreground">
            Opened
            <DateRangeFilter
              from={filters.from}
              to={filters.to}
              label="Opened"
              onChange={(r) => {
                list.setFilter("from", r.from);
                list.setFilter("to", r.to);
              }}
            />
          </div>
        </div>
      </div>

      <MobileList
        loading={initialLoading}
        empty={
          <MobileEmpty
            icon={Wallet}
            title="No drawer sessions"
            description={list.q ? `No session matches "${list.q}".` : "Drawers are opened at the POS terminal."}
          />
        }
      >
        {items.map((s) => (
          <MobileRow
            key={s.id}
            title={s.sessionNumber}
            subtitle={s.cashierName}
            badge={<StatusBadge status={s.status} />}
            fields={[
              { label: "Variance", value: <Variance session={s} currency={currency} /> },
              { label: "Branch", value: `${s.branchName} (${s.branchCode})` },
              { label: "Opened", value: formatWhen(s.openedAt) },
              { label: "Closed", value: formatWhen(s.closedAt) },
              { label: "Float", value: formatMoney(s.openingAmount), numeric: true },
              { label: "Cash sales", value: formatMoney(s.cashSales), numeric: true },
              { label: s.status === "open" ? "Expected so far" : "Expected", value: formatMoney(s.expectedAmount), numeric: true },
              { label: "Counted", value: formatMoney(s.closingAmount), numeric: true },
            ]}
            actions={
              <Button variant="outline" size="sm" onClick={() => setOpenId(s.id)}>
                <Receipt className="h-3.5 w-3.5" />
                Details
              </Button>
            }
          />
        ))}
      </MobileList>

      <Card className={listCard}>
        <TableContainer className="hidden md:block">
          <Table>
            <TableHead>
              <tr>
                <Th>Session</Th>
                <Th>Branch</Th>
                <Th>Cashier</Th>
                <SortableTh column="openedAt" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} firstOrder="desc">
                  Opened
                </SortableTh>
                <Th align="right">Float</Th>
                <Th align="right">Cash sales</Th>
                <Th align="right">In / Out</Th>
                <Th align="right">Expected</Th>
                <Th align="right">Counted</Th>
                <SortableTh column="difference" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} align="right">
                  Variance
                </SortableTh>
                <Th align="center">Status</Th>
              </tr>
            </TableHead>
            <TableBody
              columns={11}
              loading={initialLoading}
              empty={
                <TableEmpty
                  columns={11}
                  icon={Wallet}
                  title="No drawer sessions"
                  description={list.q ? `No session matches "${list.q}".` : "Drawers are opened at the POS terminal."}
                />
              }
            >
              {items.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setOpenId(s.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open drawer session ${s.sessionNumber}`}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenId(s.id);
                    }
                  }}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-secondary/30 focus:bg-secondary/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    loading && "opacity-60",
                  )}
                >
                  <td className="whitespace-nowrap px-4 py-3.5 font-mono font-bold text-primary">{s.sessionNumber}</td>
                  <td className="px-4 py-3.5">
                    <Badge variant="secondary" className="font-mono text-[10px] font-bold">
                      {s.branchCode}
                    </Badge>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-foreground">{s.cashierName}</p>
                    {s.deviceName && <p className="text-[11px] text-muted-foreground">{s.deviceName}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-muted-foreground">{formatWhen(s.openedAt)}</td>
                  <td className={cn("px-4 py-3.5 text-muted-foreground", numericCell)}>{formatMoney(s.openingAmount)}</td>
                  <td className={cn("px-4 py-3.5", numericCell)}>{formatMoney(s.cashSales)}</td>
                  <td className={cn("whitespace-nowrap px-4 py-3.5 text-muted-foreground", numericCell)}>
                    +{formatMoney(s.cashIn)} / −{formatMoney(s.cashOut)}
                  </td>
                  <td className={cn("px-4 py-3.5", numericCell)}>
                    {formatMoney(s.expectedAmount)}
                    {s.status === "open" && <span className="block text-[10px] font-sans text-muted-foreground">so far</span>}
                  </td>
                  <td className={cn("px-4 py-3.5 font-semibold", numericCell)}>{formatMoney(s.closingAmount)}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-right">
                    <Variance session={s} currency={currency} />
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <StatusBadge status={s.status} />
                  </td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun="sessions" />
      </Card>

      <SessionSheet
        id={openId}
        currency={currency}
        accessToken={tokens?.accessToken}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

const MOVEMENT_LABEL: Record<string, string> = {
  cash_in: "Paid in",
  cash_out: "Paid out",
  payout: "Payout",
};

function SessionSheet({
  id,
  currency,
  accessToken,
  onClose,
}: {
  id: string | null;
  currency: string;
  accessToken: string | undefined;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    setDetail(null);
    setLoadError(null);
    api
      .get<SessionDetail>(`/cash-register/sessions/${id}`, { accessToken, signal: controller.signal })
      .then((d) => !controller.signal.aborted && setDetail(d))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setLoadError(err instanceof Error ? err.message : "Could not load the session.");
      });
    return () => controller.abort();
  }, [id, accessToken]);

  const money = (v: string | null | undefined) => formatMoney(v, { currency });

  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-lg md:max-w-lg lg:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 font-mono">
            {detail?.sessionNumber ?? "Drawer session"}
            {detail && <StatusBadge status={detail.status} />}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {detail
              ? `${detail.branchName} · ${detail.cashierName}${detail.deviceName ? ` · ${detail.deviceName}` : ""}`
              : " "}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-5">
          {loadError && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {loadError}
            </p>
          )}
          {!detail && !loadError && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" aria-label="Loading" />
            </div>
          )}

          {detail && (
            <>
              <div className="rounded-xl border border-border bg-secondary/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Variance</span>
                  <Variance session={detail} currency={currency} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Opened {formatWhen(detail.openedAt)}
                  {detail.closedAt && ` · closed ${formatWhen(detail.closedAt)}`}
                  {detail.closedByName && ` by ${detail.closedByName}`}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Figure label="Opening float" value={money(detail.openingAmount)} />
                <Figure
                  label="Cash sales"
                  value={money(detail.cashSales)}
                  hint={`${detail.cashSaleCount} ${detail.cashSaleCount === 1 ? "sale" : "sales"}${
                    Money.isPositive(Money.toMinor(detail.cashRefunds)) ? ` · ${money(detail.cashRefunds)} refunded` : ""
                  }`}
                />
                <Figure label="Paid in" value={money(detail.cashIn)} />
                <Figure label="Paid out" value={money(detail.cashOut)} />
                <Figure
                  label={detail.status === "open" ? "Expected so far" : "Expected"}
                  value={money(detail.expectedAmount)}
                />
                <Figure label="Counted" value={detail.closingAmount ? money(detail.closingAmount) : "Not counted yet"} />
              </div>

              {detail.notes && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="size-3.5" aria-hidden="true" />
                    Note
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{detail.notes}</p>
                </div>
              )}

              <section aria-labelledby="movements-heading">
                <h3 id="movements-heading" className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Pay-ins and pay-outs
                </h3>
                {detail.movements.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    No cash was paid in or out of this drawer.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {detail.movements.map((m) => {
                      const into = !Money.isNegative(Money.toMinor(m.amount));
                      return (
                        <li key={m.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
                          <span
                            className={cn(
                              "flex size-7 shrink-0 items-center justify-center rounded-full",
                              into
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-red-500/10 text-red-600 dark:text-red-400",
                            )}
                          >
                            {into ? (
                              <ArrowDownLeft className="size-3.5" aria-hidden="true" />
                            ) : (
                              <ArrowUpRight className="size-3.5" aria-hidden="true" />
                            )}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="flex items-baseline justify-between gap-2 text-sm">
                              <span className="font-medium">{MOVEMENT_LABEL[m.type] ?? m.type}</span>
                              <span className="font-mono font-semibold tabular-nums">
                                {into ? "+" : "−"}
                                {money(Money.toDecimalString(Money.abs(Money.toMinor(m.amount)), 2))}
                              </span>
                            </p>
                            {m.reason && <p className="mt-0.5 text-xs text-foreground/80">{m.reason}</p>}
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {formatWhen(m.occurredAt)}
                              {m.byName && ` · ${m.byName}`}
                            </p>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>

              <Button variant="outline" className="w-full" asChild>
                <Link href={`/sales?cashSessionId=${detail.id}&drawer=${encodeURIComponent(detail.sessionNumber)}`}>
                  <Receipt className="size-4" />
                  View the sales rung up on this drawer
                </Link>
              </Button>
            </>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
