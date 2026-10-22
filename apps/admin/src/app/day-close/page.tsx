"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Wallet,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Lock,
  Unlock,
  History,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { Money } from "@devsfleet/shared-utils";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { useTenantSettings } from "@/lib/tenant-settings";
import { readListResult, useListData } from "@/lib/use-list-query";
import {
  Table, TableBody, TableContainer, TableEmpty, TableHead, TablePagination, Th, numericCell,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow, listCard } from "@/components/ui/mobile-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface Preview {
  id: string | null;
  branchId: string;
  closingDate: string;
  status: "not_opened" | "open" | "closed";
  openingFloat: string;
  totalSales: string;
  totalReturns: string;
  totalExpenses: string;
  cashTotal: string;
  cardTotal: string;
  bankTotal: string;
  creditTotal: string;
  manualCashIn: string;
  manualCashOut: string;
  saleCount: number;
  expectedCash: string;
  countedCash?: string | null;
  cashVariance?: string | null;
  closedAt?: string | null;
  live: boolean;
}

interface DayHistoryRow {
  id: string;
  branchName: string;
  closingDate: string;
  status: string;
  totalSales: string;
  expectedCash: string;
  countedCash: string | null;
  cashVariance: string | null;
  closedAt: string | null;
}

const HISTORY_PAGE_SIZE = 10;

/** Counted minus expected, in `Money` — a float subtraction here showed a 0.01 shortfall that was not there. */
function variance(counted: string, expected: string): string | null {
  try {
    return Money.toDecimalString(Money.subtract(Money.toMinor(counted), Money.toMinor(expected)));
  } catch {
    return null;
  }
}

export default function DayClosePage() {
  const { tokens } = useAuth();
  const currency = useTenantSettings().currency.base;
  const money = (value: string | null | undefined) => formatMoney(value ?? "0", { currency });

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [openingFloat, setOpeningFloat] = useState("0");
  const [countedCash, setCountedCash] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!tokens?.accessToken) return;
    api
      .get<Branch[]>("/branches", { accessToken: tokens.accessToken })
      .then((res) => {
        const list = (res as any)?.items ?? res ?? [];
        setBranches(list);
        if (list.length > 0) setBranchId((current) => current || list[0].id);
      })
      .catch(() => undefined);
  }, [tokens]);

  const [historyPage, setHistoryPage] = useState(1);
  useEffect(() => setHistoryPage(1), [branchId]);
  const loadHistory = useCallback(
    async (signal: AbortSignal) =>
      readListResult<DayHistoryRow>(
        await api.get<unknown>("/day-close", {
          accessToken: tokens?.accessToken,
          signal,
          query: { branchId, page: historyPage, pageSize: HISTORY_PAGE_SIZE },
        }),
      ),
    [tokens?.accessToken, branchId, historyPage],
  );
  const history = useListData(loadHistory, Boolean(branchId));

  const fetchPreview = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    try {
      setPreview(
        await api.get<Preview>("/day-close/preview", {
          accessToken: tokens?.accessToken,
          query: { branchId },
        }),
      );
    } catch (err: any) {
      setError(err?.message ?? "Failed to load today's figures.");
    } finally {
      setLoading(false);
    }
    history.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, branchId, history.reload]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const handleOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post(
        "/day-close/open",
        { branchId, openingFloat: openingFloat.trim() || "0", notes: notes || undefined },
        { accessToken: tokens?.accessToken },
      );
      setSuccess("Day opened.");
      setNotes("");
      fetchPreview();
    } catch (err: any) {
      setError(err?.message || "Failed to open the day.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview?.id) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.post(
        `/day-close/${preview.id}/close`,
        { countedCash: countedCash.trim(), notes: notes || undefined },
        { accessToken: tokens?.accessToken },
      );
      setSuccess("Day closed and frozen.");
      setCountedCash("");
      setNotes("");
      fetchPreview();
    } catch (err: any) {
      setError(err?.message || "Failed to close the day.");
    } finally {
      setSubmitting(false);
    }
  };

  const varianceFromCounted =
    preview && countedCash ? variance(countedCash, preview.expectedCash) : null;
  const shortFromCounted = varianceFromCounted !== null && varianceFromCounted.startsWith("-");

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Day Close</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Open the drawer, review today&apos;s figures, count the cash and freeze the day.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Select value={branchId} onValueChange={setBranchId}>
            <SelectTrigger className="w-45 h-9 text-xs">
              <SelectValue placeholder="Select Branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchPreview} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /><span>{success}</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /><span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Loading...
        </div>
      ) : preview && (
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">{preview.closingDate}</CardTitle>
              </div>
              <Badge
                variant={
                  preview.status === "closed" ? "secondary" : preview.status === "open" ? "success" : "outline"
                }
              >
                {preview.status === "closed" ? "Closed" : preview.status === "open" ? "Open" : "Not Opened"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Sales" value={money(preview.totalSales)} sub={`${preview.saleCount} transactions`} />
              <Stat label="Returns" value={money(preview.totalReturns)} />
              <Stat label="Expenses" value={money(preview.totalExpenses)} />
              <Stat label="Cash" value={money(preview.cashTotal)} />
              <Stat label="Card" value={money(preview.cardTotal)} />
              <Stat label="Bank / Credit" value={`${money(preview.bankTotal)} / ${formatMoney(preview.creditTotal ?? "0")}`} />
            </div>

            <div className="rounded-xl border border-border p-4 bg-secondary/20 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Expected cash in drawer</span>
              <span className="text-lg font-bold font-mono tabular-nums text-foreground">{money(preview.expectedCash)}</span>
            </div>

            {preview.status === "closed" && (
              <div className="rounded-xl border border-border p-4 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Counted</span>
                  <span className="font-mono font-semibold tabular-nums">{money(preview.countedCash)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Variance</span>
                  <span
                    className={cn(
                      "font-mono font-semibold",
                      Number(preview.cashVariance) < 0 ? "text-destructive" : "text-emerald-600",
                    )}
                  >
                    {money(preview.cashVariance)}
                  </span>
                </div>
                {preview.closedAt && (
                  <p className="text-[11px] text-muted-foreground">
                    Closed {new Date(preview.closedAt).toLocaleString()}
                  </p>
                )}
              </div>
            )}

            {preview.status === "not_opened" && (
              <form onSubmit={handleOpen} className="rounded-xl border border-border p-4 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Unlock className="h-3.5 w-3.5" /> Open the day
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Opening cash float</label>
                    <Input type="number" min="0" step="0.01" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} className="font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Notes</label>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
                  </div>
                </div>
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? "Opening..." : "Open Day"}
                </Button>
              </form>
            )}

            {preview.status === "open" && (
              <form onSubmit={handleClose} className="rounded-xl border border-border p-4 space-y-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5" /> Count and close the day
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">Cash counted in drawer</label>
                    <Input required type="number" min="0" step="0.01" value={countedCash} onChange={(e) => setCountedCash(e.target.value)} className="font-mono" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-foreground mb-1.5">
                      Notes {shortFromCounted && <span className="text-destructive">(required — short)</span>}
                    </label>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explain any shortfall" />
                  </div>
                </div>
                {varianceFromCounted !== null && (
                  <p className={cn("text-xs font-mono tabular-nums", shortFromCounted ? "text-destructive" : "text-emerald-600")}>
                    Variance: {money(varianceFromCounted)}
                  </p>
                )}
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? "Closing..." : "Close Day"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      <Card className={listCard}>
        <CardHeader className="pb-4 max-md:px-0 max-md:pt-0">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">History</CardTitle>
          </div>
        </CardHeader>
        <MobileList
          loading={history.initialLoading}
          empty={<MobileEmpty icon={History} title="No closed days yet" />}
        >
          {history.items.map((row) => (
            <MobileRow
              key={row.id}
              title={<span className="tabular-nums">{row.closingDate}</span>}
              subtitle={formatMoney(row.totalSales, { currency })}
              badge={
                <Badge variant={row.status === "closed" ? "secondary" : "success"}>
                  {row.status}
                </Badge>
              }
              fields={[
                { label: `Sales (${currency})`, value: formatMoney(row.totalSales), numeric: true },
                { label: "Expected", value: formatMoney(row.expectedCash), numeric: true },
                { label: "Counted", value: formatMoney(row.countedCash), numeric: true },
                {
                  label: "Variance",
                  value: (
                    <span className={cn(row.cashVariance?.trim().startsWith("-") && "text-destructive")}>
                      {formatMoney(row.cashVariance)}
                    </span>
                  ),
                  numeric: true,
                },
              ]}
            />
          ))}
        </MobileList>
        <TableContainer className="hidden md:block">
          <Table>
            <TableHead>
              <tr>
                <Th>Date</Th>
                <Th>Status</Th>
                <Th align="right">Sales ({currency})</Th>
                <Th align="right">Expected</Th>
                <Th align="right">Counted</Th>
                <Th align="right">Variance</Th>
              </tr>
            </TableHead>
            <TableBody
              columns={6}
              loading={history.initialLoading}
              empty={<TableEmpty columns={6} icon={History} title="No closed days yet" />}
            >
              {history.items.map((row) => (
                <tr key={row.id} className={cn(history.loading && "opacity-60")}>
                  <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{row.closingDate}</td>
                  <td className="px-4 py-2.5">
                    <Badge variant={row.status === "closed" ? "secondary" : "success"} className="text-[10px]">
                      {row.status}
                    </Badge>
                  </td>
                  <td className={cn("px-4 py-2.5", numericCell)}>{formatMoney(row.totalSales)}</td>
                  <td className={cn("px-4 py-2.5", numericCell)}>{formatMoney(row.expectedCash)}</td>
                  <td className={cn("px-4 py-2.5", numericCell)}>{formatMoney(row.countedCash)}</td>
                  <td
                    className={cn(
                      "px-4 py-2.5",
                      numericCell,
                      row.cashVariance?.trim().startsWith("-") && "text-destructive",
                    )}
                  >
                    {formatMoney(row.cashVariance)}
                  </td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          page={historyPage}
          pageSize={HISTORY_PAGE_SIZE}
          total={history.total}
          onPageChange={setHistoryPage}
          noun="days"
        />
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono font-semibold text-foreground">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
