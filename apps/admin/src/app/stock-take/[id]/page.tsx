"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle, ArrowLeft, Ban, CheckCircle2, ClipboardCheck, Loader2, ScanBarcode, Send, X,
} from "lucide-react";
import { Money } from "@devsfleet/shared-utils";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { usePermission } from "@/lib/require-auth";
import { useTenantSettings } from "@/lib/tenant-settings";
import {
  Table, TableBody, TableContainer, TableEmpty, TableHead, TablePagination, Th, numericCell,
} from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  STATUS_LABEL, STATUS_VARIANT, isEditable, parseCount, signedQty, trimQty, varianceTone, varianceValue,
  type CountStatus,
} from "../shared";

interface CountItem {
  id: string;
  variantId: string;
  sku: string;
  barcode: string | null;
  productName: string;
  variantName: string | null;
  unitAbbr: string | null;
  systemQuantity: string;
  countedQuantity: string | null;
  variance: string | null;
  notes: string | null;
  /** Only present for someone allowed to see cost. */
  unitCost?: string | null;
}

interface StockCount {
  id: string;
  countNumber: string;
  status: CountStatus;
  branchName: string | null;
  categoryName: string | null;
  notes: string | null;
  createdAt: string;
  approvedAt: string | null;
  canViewCost: boolean;
  items: CountItem[];
}

type LineFilter = "all" | "uncounted" | "differences";
type SaveState = { state: "saving" } | { state: "saved" } | { state: "error"; message: string };

/**
 * Lines shown per page. A full count is every variant at the branch —
 * thousands of rows, each with a live input — and rendering all of them makes
 * every keystroke on the page slow. The scan box searches all of them anyway.
 */
const LINES_PER_PAGE = 100;

export default function StockCountPage() {
  const { id } = useParams<{ id: string }>();
  const { tokens } = useAuth();
  const accessToken = tokens?.accessToken;
  const currency = useTenantSettings().currency.base;

  const mayCount = usePermission("inventory:count");
  const mayApprove = usePermission("inventory:adjust");

  const [count, setCount] = useState<StockCount | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** What is typed in each count box, until it is saved. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saves, setSaves] = useState<Record<string, SaveState>>({});

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LineFilter>("all");
  const [page, setPage] = useState(1);

  const [busy, setBusy] = useState<"submit" | "approve" | "cancel" | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState("");

  const scanRef = useRef<HTMLInputElement>(null);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());
  /** Set by Escape so the blur that follows does not save what was just abandoned. */
  const discardOnBlur = useRef(false);

  const load = useCallback(async () => {
    if (!accessToken || !id) return;
    try {
      setCount(await api.get<StockCount>(`/stock-take/${id}`, { accessToken }));
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message || "Could not load the stock count.");
    }
  }, [accessToken, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = Boolean(count && isEditable(count.status) && mayCount);

  // The cursor starts in the scan box, so the first scan needs no click.
  useEffect(() => {
    if (editable) scanRef.current?.focus();
  }, [editable]);

  // ── Derived figures ───────────────────────────────────────────────────────

  const items = count?.items ?? [];
  const countedLines = items.filter((i) => i.countedQuantity !== null).length;
  const differenceLines = items.filter((i) => i.variance && Money.toMinor(i.variance) !== 0n).length;
  const progressPct = items.length ? Math.round((countedLines / items.length) * 100) : 0;

  /**
   * Null when cost is hidden from this user, or when no differing line has a
   * cost on record — "0.00" there would read as "the differences cost
   * nothing", which nobody knows.
   */
  const totalVarianceValue = useMemo(() => {
    if (!count?.canViewCost) return null;
    const costed = items.filter(
      (i) => i.unitCost && i.variance && Money.toMinor(i.variance) !== 0n,
    );
    if (costed.length === 0) return null;
    return costed.reduce<bigint>((sum, i) => sum + (varianceValue(i.variance, i.unitCost) ?? 0n), 0n);
  }, [items, count?.canViewCost]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((i) => {
      if (filter === "uncounted" && i.countedQuantity !== null) return false;
      if (filter === "differences" && !(i.variance && Money.toMinor(i.variance) !== 0n)) return false;
      if (!term) return true;
      return (
        i.sku.toLowerCase().includes(term) ||
        (i.barcode ?? "").toLowerCase().includes(term) ||
        i.productName.toLowerCase().includes(term) ||
        (i.variantName ?? "").toLowerCase().includes(term)
      );
    });
  }, [items, filter, search]);

  const pageLines = visible.slice((page - 1) * LINES_PER_PAGE, page * LINES_PER_PAGE);

  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  // ── Counting ──────────────────────────────────────────────────────────────

  /** The input actually on screen — the table's at md and up, the card's below. */
  function visibleInput(itemId: string): HTMLInputElement | undefined {
    for (const where of ["table", "card"]) {
      const el = inputRefs.current.get(`${where}:${itemId}`);
      if (el && el.offsetParent !== null) return el;
    }
    return undefined;
  }

  function focusLine(itemId: string) {
    const index = visible.findIndex((i) => i.id === itemId);
    if (index >= 0) setPage(Math.floor(index / LINES_PER_PAGE) + 1);
    // After the page change has rendered the row.
    requestAnimationFrame(() => {
      const el = visibleInput(itemId);
      el?.scrollIntoView({ block: "center" });
      el?.focus();
      el?.select();
    });
  }

  /**
   * The scan loop. A scanner types the code and sends Enter: an exact barcode
   * or SKU jumps straight to that line's count box; anything else that leaves
   * exactly one line on screen does the same.
   */
  function onScanKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && search) {
      e.preventDefault();
      setSearch("");
      return;
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    const term = search.trim().toLowerCase();
    if (!term) return;
    const exact = items.find((i) => i.barcode?.toLowerCase() === term || i.sku.toLowerCase() === term);
    const target = exact ?? (visible.length === 1 ? visible[0] : undefined);
    if (!target) {
      setNotice(visible.length === 0 ? `Nothing on this sheet matches “${search.trim()}”.` : null);
      return;
    }
    setNotice(null);
    if (exact && !visible.some((i) => i.id === exact.id)) setFilter("all");
    focusLine(target.id);
  }

  async function saveLine(item: CountItem, raw: string) {
    if (discardOnBlur.current) {
      discardOnBlur.current = false;
      return;
    }
    if (!accessToken || !count) return;
    const typed = raw.trim();
    if (typed === "") return; // Clearing the box is not a count of zero.
    const value = parseCount(typed);
    if (value === null) {
      setSaves((s) => ({ ...s, [item.id]: { state: "error", message: "Whole or decimal number, up to 4 places" } }));
      return;
    }
    if (item.countedQuantity !== null && Money.toMinor(value) === Money.toMinor(item.countedQuantity)) {
      setDrafts(({ [item.id]: _, ...rest }) => rest);
      return;
    }

    setSaves((s) => ({ ...s, [item.id]: { state: "saving" } }));
    try {
      const updated = await api.patch<Pick<CountItem, "countedQuantity" | "variance">>(
        `/stock-take/${count.id}/items/${item.id}`,
        { countedQuantity: value },
        { accessToken },
      );
      setCount((c) =>
        c
          ? {
              ...c,
              items: c.items.map((i) =>
                i.id === item.id ? { ...i, countedQuantity: updated.countedQuantity, variance: updated.variance } : i,
              ),
            }
          : c,
      );
      setDrafts(({ [item.id]: _, ...rest }) => rest);
      setSaves((s) => ({ ...s, [item.id]: { state: "saved" } }));
    } catch (err: any) {
      setSaves((s) => ({ ...s, [item.id]: { state: "error", message: err?.message || "Not saved" } }));
    }
  }

  function onCountKeyDown(e: React.KeyboardEvent<HTMLInputElement>, item: CountItem) {
    if (e.key === "Enter") {
      e.preventDefault();
      // Back to the scan box for the next item; leaving the box is what saves
      // it (onBlur), so saving here as well would send every count twice.
      setSearch("");
      scanRef.current?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      discardOnBlur.current = true;
      setDrafts(({ [item.id]: _, ...rest }) => rest);
      scanRef.current?.focus();
    }
  }

  // ── Workflow ──────────────────────────────────────────────────────────────

  async function runAction(kind: "submit" | "approve" | "cancel") {
    if (!accessToken || !count) return;
    setBusy(kind);
    setActionError(null);
    try {
      const body = kind === "approve" ? { reason: reason.trim() } : {};
      const next = await api.post<StockCount & { postedLines?: number }>(
        `/stock-take/${count.id}/${kind}`,
        body,
        { accessToken },
      );
      // The action answers with the count, but not with cost — reload so the
      // view keeps whatever the caller is allowed to see.
      await load();
      setNotice(
        kind === "submit"
          ? "Submitted for approval. Counts can no longer be changed."
          : kind === "approve"
            ? `Approved. ${next.postedLines ?? 0} difference${next.postedLines === 1 ? "" : "s"} posted to stock.`
            : "Count cancelled. Nothing was posted to stock.",
      );
      setApproveOpen(false);
      setCancelOpen(false);
    } catch (err: any) {
      setActionError(err?.message || "That did not go through.");
    } finally {
      setBusy(null);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="space-y-4">
        <BackLink />
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {loadError}
        </div>
      </div>
    );
  }

  if (!count) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading count sheet…
      </div>
    );
  }

  const uncounted = items.length - countedLines;

  return (
    <div className="space-y-5">
      <BackLink />

      {/* Header */}
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-tight text-foreground">{count.countNumber}</h1>
            <Badge variant={STATUS_VARIANT[count.status]}>{STATUS_LABEL[count.status]}</Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {count.branchName} · {count.categoryName ?? "Whole branch"} · started{" "}
            {new Date(count.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          </p>
          {count.notes && <p className="mt-1 text-sm text-foreground/80">{count.notes}</p>}
        </div>

        <div className="flex flex-wrap gap-2">
          {mayCount && isEditable(count.status) && (
            <Button
              onClick={() => void runAction("submit")}
              disabled={busy !== null || uncounted > 0}
              title={uncounted > 0 ? `${uncounted} lines still to count` : undefined}
            >
              {busy === "submit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit for approval
            </Button>
          )}
          {mayApprove && count.status === "pending_approval" && (
            <Button onClick={() => { setActionError(null); setReason(""); setApproveOpen(true); }} disabled={busy !== null}>
              <ClipboardCheck className="h-4 w-4" />
              Approve and post
            </Button>
          )}
          {mayCount && count.status !== "approved" && count.status !== "cancelled" && (
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => { setActionError(null); setCancelOpen(true); }}
              disabled={busy !== null}
            >
              <Ban className="h-4 w-4" />
              Cancel count
            </Button>
          )}
        </div>
      </div>

      {(actionError || notice) && (
        <div
          role={actionError ? "alert" : "status"}
          className={cn(
            "flex items-center gap-2 rounded-xl border p-3 text-sm",
            actionError
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          )}
        >
          {actionError ? <AlertCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
          <span>{actionError ?? notice}</span>
        </div>
      )}

      {/* Progress */}
      <Card className="grid gap-4 p-4 sm:grid-cols-3">
        <div className="sm:col-span-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium text-muted-foreground">Counted</span>
            <span className="font-mono tabular-nums text-foreground">
              {countedLines} / {items.length}
            </span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={items.length}
            aria-valuenow={countedLines}
            aria-label="Lines counted"
          >
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
        <Figure label="Lines with a difference" value={String(differenceLines)} tone={differenceLines > 0 ? "text-amber-600 dark:text-amber-400" : undefined} />
        {count.canViewCost ? (
          <Figure
            label="Value of differences (at average cost)"
            value={
              totalVarianceValue === null
                ? "—"
                : formatMoney(Money.toDecimalString(totalVarianceValue, 4), { currency })
            }
            tone={
              totalVarianceValue === null
                ? "text-muted-foreground"
                : totalVarianceValue < 0n
                  ? "text-destructive"
                  : totalVarianceValue > 0n
                    ? "text-emerald-600 dark:text-emerald-400"
                    : undefined
            }
          />
        ) : (
          <Figure label="Still to count" value={String(uncounted)} />
        )}
      </Card>

      {/* Scan + filter */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        {/* Not the shared TableSearch: the counting loop has to put the cursor
            back here after every line, which needs a ref to the input. */}
        <div role="search" className="relative flex-1">
          <ScanBarcode aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={scanRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onScanKeyDown}
            placeholder={editable ? "Scan a barcode or type a SKU, then Enter to count it…" : "Search this count…"}
            aria-label="Scan or search a product on this count"
            className="h-10 bg-secondary/30 pl-10 pr-9 [&::-webkit-search-cancel-button]:hidden"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(""); scanRef.current?.focus(); }}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div role="group" aria-label="Show lines" className="flex shrink-0 rounded-lg border border-input p-0.5">
          {(
            [
              ["all", `All ${items.length}`],
              ["uncounted", `To count ${uncounted}`],
              ["differences", `Differences ${differenceLines}`],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
              className={cn(
                "flex-1 cursor-pointer whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium tabular-nums transition-colors",
                filter === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Phone: the count box stays on the card face — it is the one thing touched on every line. */}
      <div className="space-y-2 md:hidden">
        {pageLines.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
            {search ? "No line matches that search." : "No lines to show."}
          </p>
        ) : (
          pageLines.map((item) => (
            <div key={item.id} className="rounded-xl border border-border bg-card p-3 shadow-xs">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{item.productName}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {item.sku}
                    {item.variantName && item.variantName !== "Default" ? ` · ${item.variantName}` : ""}
                  </p>
                </div>
                <SaveBadge save={saves[item.id]} />
              </div>
              <div className="mt-2.5 grid grid-cols-3 items-end gap-2 text-xs">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">System</p>
                  <p className="font-mono tabular-nums">{trimQty(item.systemQuantity)} {item.unitAbbr}</p>
                </div>
                <CountInput
                  item={item}
                  where="card"
                  editable={editable}
                  draft={drafts[item.id]}
                  onDraft={(v) => setDrafts((d) => ({ ...d, [item.id]: v }))}
                  onSave={(v) => void saveLine(item, v)}
                  onKeyDown={(e) => onCountKeyDown(e, item)}
                  registerRef={(key, el) => (el ? inputRefs.current.set(key, el) : inputRefs.current.delete(key))}
                />
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Difference</p>
                  <p className={cn("font-mono font-semibold tabular-nums", varianceTone(item.variance))}>
                    {signedQty(item.variance)}
                  </p>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <Card className="overflow-hidden max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none">
        <TableContainer className="hidden md:block">
          <Table>
            <TableHead>
              <tr>
                <Th>Product</Th>
                <Th>SKU</Th>
                <Th align="right">System</Th>
                <Th align="right">Counted</Th>
                <Th align="right">Difference</Th>
                {count.canViewCost && <Th align="right">Value ({currency})</Th>}
                <Th><span className="sr-only">Save status</span></Th>
              </tr>
            </TableHead>
            <TableBody
              columns={count.canViewCost ? 7 : 6}
              loading={false}
              empty={
                <TableEmpty
                  columns={count.canViewCost ? 7 : 6}
                  icon={ScanBarcode}
                  title={search ? "No line matches that search" : "No lines to show"}
                  description={filter !== "all" ? "Try showing all lines." : undefined}
                />
              }
            >
              {pageLines.map((item) => {
                const value = varianceValue(item.variance, item.unitCost);
                return (
                  <tr key={item.id} className="hover:bg-secondary/20">
                    <td className="max-w-80 px-4 py-2.5">
                      <p className="truncate font-medium text-foreground" title={item.productName}>{item.productName}</p>
                      {item.variantName && item.variantName !== "Default" && (
                        <p className="truncate text-[11px] text-muted-foreground">{item.variantName}</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{item.sku}</td>
                    <td className={cn("px-4 py-2.5", numericCell)}>
                      {trimQty(item.systemQuantity)} <span className="text-muted-foreground">{item.unitAbbr}</span>
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <CountInput
                        item={item}
                        where="table"
                        editable={editable}
                        draft={drafts[item.id]}
                        onDraft={(v) => setDrafts((d) => ({ ...d, [item.id]: v }))}
                        onSave={(v) => void saveLine(item, v)}
                        onKeyDown={(e) => onCountKeyDown(e, item)}
                        registerRef={(key, el) => (el ? inputRefs.current.set(key, el) : inputRefs.current.delete(key))}
                        compact
                      />
                    </td>
                    <td className={cn("px-4 py-2.5 font-semibold", numericCell, varianceTone(item.variance))}>
                      {signedQty(item.variance)}
                    </td>
                    {count.canViewCost && (
                      <td className={cn("px-4 py-2.5", numericCell, value !== null && value < 0n ? "text-destructive" : "text-muted-foreground")}>
                        {value === null ? "—" : formatMoney(Money.toDecimalString(value, 4))}
                      </td>
                    )}
                    <td className="w-24 px-4 py-2.5">
                      <SaveBadge save={saves[item.id]} />
                    </td>
                  </tr>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination page={page} pageSize={LINES_PER_PAGE} total={visible.length} onPageChange={setPage} noun="lines" />
      </Card>

      {/* Approve */}
      <Dialog open={approveOpen} onOpenChange={(o) => busy === null && setApproveOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve {count.countNumber}?</DialogTitle>
            <DialogDescription>
              {differenceLines === 0
                ? "No line differs from the system, so nothing will change in stock."
                : `${differenceLines} line${differenceLines === 1 ? "" : "s"} will be adjusted in stock. This posts to the stock ledger and cannot be undone — a mistake is corrected with a new count.`}
            </DialogDescription>
          </DialogHeader>
          {totalVarianceValue !== null && differenceLines > 0 && (
            <p className="rounded-lg border border-border bg-secondary/40 p-2.5 text-xs">
              Net value of the differences:{" "}
              <span className={cn("font-mono font-semibold", totalVarianceValue < 0n && "text-destructive")}>
                {formatMoney(Money.toDecimalString(totalVarianceValue, 4), { currency })}
              </span>
            </p>
          )}
          <div className="space-y-1.5">
            <label htmlFor="approve-reason" className="text-xs font-medium">Reason (recorded on every adjustment)</label>
            <Input
              id="approve-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Month-end count, breakage found in aisle 4"
              maxLength={500}
              autoFocus
            />
          </div>
          {actionError && (
            <p role="alert" className="text-xs text-destructive">{actionError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveOpen(false)} disabled={busy !== null}>Back</Button>
            <Button onClick={() => void runAction("approve")} disabled={busy !== null || reason.trim().length < 3}>
              {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
              Approve and post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel */}
      <Dialog open={cancelOpen} onOpenChange={(o) => busy === null && setCancelOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel {count.countNumber}?</DialogTitle>
            <DialogDescription>
              Nothing is posted to stock. The sheet stays on record as cancelled, and the {countedLines} line
              {countedLines === 1 ? "" : "s"} counted so far cannot be reused — a new count starts from scratch.
            </DialogDescription>
          </DialogHeader>
          {actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={busy !== null}>Keep counting</Button>
            <Button variant="destructive" onClick={() => void runAction("cancel")} disabled={busy !== null}>
              {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
              Cancel count
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/stock-take"
      className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      All stock counts
    </Link>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-lg font-bold tabular-nums", tone)}>{value}</p>
    </div>
  );
}

function CountInput({
  item,
  where,
  editable,
  draft,
  onDraft,
  onSave,
  onKeyDown,
  registerRef,
  compact = false,
}: {
  item: CountItem;
  where: "table" | "card";
  editable: boolean;
  draft: string | undefined;
  onDraft: (value: string) => void;
  onSave: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  registerRef: (key: string, el: HTMLInputElement | null) => void;
  compact?: boolean;
}) {
  const shown = draft ?? (item.countedQuantity !== null ? trimQty(item.countedQuantity) : "");
  if (!editable) {
    return (
      <div className={cn(compact ? "" : "text-center")}>
        {!compact && <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Counted</p>}
        <p className="font-mono tabular-nums">{item.countedQuantity !== null ? trimQty(item.countedQuantity) : "—"}</p>
      </div>
    );
  }
  return (
    <div className={cn(!compact && "text-center")}>
      {!compact && (
        <label htmlFor={`${where}-count-${item.id}`} className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Counted
        </label>
      )}
      <Input
        id={`${where}-count-${item.id}`}
        ref={(el) => registerRef(`${where}:${item.id}`, el)}
        value={shown}
        onChange={(e) => onDraft(e.target.value.replace(/[^\d.]/g, ""))}
        onBlur={(e) => onSave(e.target.value)}
        onKeyDown={onKeyDown}
        inputMode="decimal"
        placeholder="—"
        aria-label={`Counted quantity of ${item.productName} (${item.sku})`}
        className={cn(
          "text-right font-mono tabular-nums",
          compact ? "ml-auto h-8 w-24" : "mt-0.5 h-10",
          item.countedQuantity === null && draft === undefined && "border-dashed",
        )}
      />
    </div>
  );
}

function SaveBadge({ save }: { save: SaveState | undefined }) {
  if (!save) return null;
  if (save.state === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground" aria-live="polite">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving
      </span>
    );
  }
  if (save.state === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400" aria-live="polite">
        <CheckCircle2 className="h-3 w-3" /> Saved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-destructive" role="alert" title={save.message}>
      <AlertCircle className="h-3 w-3" /> {save.message.length > 24 ? "Not saved" : save.message}
    </span>
  );
}
