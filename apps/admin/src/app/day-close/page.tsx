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
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

function money(value: string | null | undefined): string {
  return Number(value ?? "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DayClosePage() {
  const { tokens } = useAuth();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<DayHistoryRow[]>([]);
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

  const fetchPreview = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    try {
      const [prevRes, listRes] = await Promise.allSettled([
        api.get<Preview>("/day-close/preview", {
          accessToken: tokens?.accessToken,
          query: { branchId },
        }),
        api.get<{ items: DayHistoryRow[] }>("/day-close", {
          accessToken: tokens?.accessToken,
          query: { branchId, pageSize: 10 },
        }),
      ]);
      if (prevRes.status === "fulfilled") setPreview(prevRes.value);
      else setError(prevRes.reason?.message ?? "Failed to load today's figures.");
      if (listRes.status === "fulfilled") setHistory(listRes.value.items ?? []);
    } finally {
      setLoading(false);
    }
  }, [tokens, branchId]);

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
        { branchId, openingFloat: Number(openingFloat), notes: notes || undefined },
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
        { countedCash: Number(countedCash), notes: notes || undefined },
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
    preview && countedCash
      ? Number(countedCash) - Number(preview.expectedCash)
      : null;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Day Close</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Open the drawer, review today&apos;s figures, count the cash and freeze the day.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="flex h-9 rounded-lg border border-input bg-transparent px-3 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
            ))}
          </select>
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
              <Stat label="Sales" value={`AED ${money(preview.totalSales)}`} sub={`${preview.saleCount} transactions`} />
              <Stat label="Returns" value={`AED ${money(preview.totalReturns)}`} />
              <Stat label="Expenses" value={`AED ${money(preview.totalExpenses)}`} />
              <Stat label="Cash" value={`AED ${money(preview.cashTotal)}`} />
              <Stat label="Card" value={`AED ${money(preview.cardTotal)}`} />
              <Stat label="Bank / Credit" value={`AED ${money(preview.bankTotal)} / ${money(preview.creditTotal)}`} />
            </div>

            <div className="rounded-xl border border-border p-4 bg-secondary/20 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Expected cash in drawer</span>
              <span className="text-lg font-bold font-mono text-foreground">AED {money(preview.expectedCash)}</span>
            </div>

            {preview.status === "closed" && (
              <div className="rounded-xl border border-border p-4 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Counted</span>
                  <span className="font-mono font-semibold">AED {money(preview.countedCash)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Variance</span>
                  <span
                    className={cn(
                      "font-mono font-semibold",
                      Number(preview.cashVariance) < 0 ? "text-destructive" : "text-emerald-600",
                    )}
                  >
                    AED {money(preview.cashVariance)}
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
                      Notes {varianceFromCounted !== null && varianceFromCounted < 0 && <span className="text-destructive">(required — short)</span>}
                    </label>
                    <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explain any shortfall" />
                  </div>
                </div>
                {varianceFromCounted !== null && (
                  <p className={cn("text-xs font-mono", varianceFromCounted < 0 ? "text-destructive" : "text-emerald-600")}>
                    Variance: AED {money(String(varianceFromCounted))}
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

      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">History</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">No closed days yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Date</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Sales</th>
                    <th className="px-4 py-2.5 text-right font-medium">Expected</th>
                    <th className="px-4 py-2.5 text-right font-medium">Counted</th>
                    <th className="px-4 py-2.5 text-right font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-2.5">{row.closingDate}</td>
                      <td className="px-4 py-2.5">
                        <Badge variant={row.status === "closed" ? "secondary" : "success"} className="text-[10px]">
                          {row.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{money(row.totalSales)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{money(row.expectedCash)}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{row.countedCash ? money(row.countedCash) : "—"}</td>
                      <td className={cn("px-4 py-2.5 text-right font-mono", row.cashVariance && Number(row.cashVariance) < 0 && "text-destructive")}>
                        {row.cashVariance ? money(row.cashVariance) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
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
