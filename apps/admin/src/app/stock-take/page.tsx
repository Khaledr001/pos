"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ClipboardList, Loader2, Plus, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { usePermission } from "@/lib/require-auth";
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";
import {
  SortableTh, Table, TableBody, TableContainer, TableEmpty, TableHead,
  TablePagination, TableSearch, Th, numericCell,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow, MobileSort, listCard } from "@/components/ui/mobile-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STATUS_LABEL, STATUS_VARIANT, type CountStatus } from "./shared";

interface StockCountRow {
  id: string;
  countNumber: string;
  status: CountStatus;
  branchName: string;
  categoryName: string | null;
  createdAt: string;
  approvedAt: string | null;
  countedLines: number;
  lineCount: number;
  varianceLines: number;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface Category {
  id: string;
  name: string;
  children?: Category[];
}

const PAGE_SIZE = 25;

function flattenCategories(cats: Category[], depth = 0): { id: string; label: string }[] {
  return cats.flatMap((c) => [
    { id: c.id, label: `${"  ".repeat(depth)}${c.name}` },
    ...flattenCategories(c.children ?? [], depth + 1),
  ]);
}

const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function StockTakePage() {
  const { tokens, user } = useAuth();
  const router = useRouter();
  const mayCount = usePermission("inventory:count");

  const list = useListQuery({ sortBy: "createdAt", sortOrder: "desc", filters: { status: "" } });
  const { q, page, sortBy, sortOrder } = list;
  const status = list.filters.status;

  const loadCounts = useCallback(
    async (signal: AbortSignal) =>
      readListResult<StockCountRow>(
        await api.get<unknown>("/stock-take", {
          accessToken: tokens?.accessToken,
          signal,
          query: {
            q: q.trim() || undefined,
            status: status || undefined,
            page,
            pageSize: PAGE_SIZE,
            sortBy,
            sortOrder,
          },
        }),
      ),
    [tokens?.accessToken, q, status, page, sortBy, sortOrder],
  );
  const { items: counts, total, loading, initialLoading, error, reload } = useListData(loadCounts, list.ready);

  const [newOpen, setNewOpen] = useState(false);
  const open = (id: string) => router.push(`/stock-take/${id}`);

  const statusBadge = (s: CountStatus) => <Badge variant={STATUS_VARIANT[s]}>{STATUS_LABEL[s]}</Badge>;
  const progress = (c: StockCountRow) => `${c.countedLines} / ${c.lineCount}`;
  const scope = (c: StockCountRow) => c.categoryName ?? "Whole branch";

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Stock Take</h1>
            {total > 0 && <Badge variant="secondary">{total} {total === 1 ? "count" : "counts"}</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Count what is on the shelf, review the differences, and post them to stock once approved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          {mayCount && (
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" />
              New count
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <TableSearch
          value={list.search}
          onChange={list.setSearch}
          label="Search stock counts"
          placeholder="Search by count number or branch..."
          className="flex-1"
        />
        <Select value={status || "all"} onValueChange={(v) => list.setFilter("status", v === "all" ? "" : v)}>
          <SelectTrigger className="h-10 sm:w-48" aria-label="Filter by status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_LABEL) as CountStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <MobileSort
          options={[
            { column: "createdAt", label: "Started", firstOrder: "desc" },
            { column: "countNumber", label: "Count #" },
          ]}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onChange={list.setSort}
        />
      </div>

      <MobileList
        loading={initialLoading}
        empty={
          <MobileEmpty
            icon={ClipboardList}
            title="No stock counts"
            description={q || status ? "No counts match your search or filter." : "Start a count to check the shelves against the system."}
          />
        }
      >
        {counts.map((c) => (
          <MobileRow
            key={c.id}
            title={c.countNumber}
            subtitle={c.branchName}
            badge={statusBadge(c.status)}
            fields={[
              { label: "Scope", value: scope(c) },
              { label: "Counted", value: progress(c), numeric: true },
              { label: "Differences", value: String(c.varianceLines), numeric: true },
              { label: "Started", value: formatDate(c.createdAt) },
              ...(c.approvedAt ? [{ label: "Approved", value: formatDate(c.approvedAt) }] : []),
            ]}
            actions={
              <Button variant="outline" size="sm" onClick={() => open(c.id)}>
                <ClipboardList className="h-3.5 w-3.5" />
                {c.status === "counting" || c.status === "draft" ? "Continue counting" : "Open"}
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
                <SortableTh column="countNumber" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Count #</SortableTh>
                <Th>Branch</Th>
                <Th>Scope</Th>
                <Th align="center">Status</Th>
                <Th align="right">Counted</Th>
                <Th align="right">Differences</Th>
                <SortableTh column="createdAt" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} firstOrder="desc">Started</SortableTh>
                <Th>Approved</Th>
              </tr>
            </TableHead>
            <TableBody
              columns={8}
              loading={initialLoading}
              empty={
                <TableEmpty
                  columns={8}
                  icon={ClipboardList}
                  title="No stock counts"
                  description={q || status ? "No counts match your search or filter." : "Start a count to check the shelves against the system."}
                />
              }
            >
              {counts.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => open(c.id)}
                  tabIndex={0}
                  role="link"
                  aria-label={`Open stock count ${c.countNumber}`}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open(c.id);
                    }
                  }}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-secondary/30 focus:bg-secondary/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    loading && "opacity-60",
                  )}
                >
                  <td className="whitespace-nowrap px-4 py-3.5 font-mono font-bold text-primary">
                    <Link href={`/stock-take/${c.id}`} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
                      {c.countNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5 font-medium text-foreground">{c.branchName}</td>
                  <td className="px-4 py-3.5 text-muted-foreground">{scope(c)}</td>
                  <td className="px-4 py-3.5 text-center">{statusBadge(c.status)}</td>
                  <td className={cn("px-4 py-3.5", numericCell)}>{progress(c)}</td>
                  <td className={cn("px-4 py-3.5", numericCell, c.varianceLines > 0 && "font-semibold text-amber-600 dark:text-amber-400")}>
                    {c.varianceLines}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-muted-foreground">{formatDate(c.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-muted-foreground">{formatDate(c.approvedAt)}</td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun="counts" />
      </Card>

      <NewCountDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        accessToken={tokens?.accessToken}
        defaultBranchId={user?.branchId ?? ""}
        onCreated={(id) => {
          setNewOpen(false);
          open(id);
        }}
      />
    </div>
  );
}

/**
 * Start a count. The system quantities are frozen the moment this succeeds,
 * so the dialog says so: a count started an hour before anyone walks the
 * aisles will show every sale in between as a difference.
 */
function NewCountDialog({
  open,
  onOpenChange,
  accessToken,
  defaultBranchId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accessToken: string | undefined;
  defaultBranchId: string;
  onCreated: (id: string) => void;
}) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [branchId, setBranchId] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !accessToken) return;
    setError(null);
    setExistingId(null);
    setNotes("");
    setCategoryId("all");
    void Promise.allSettled([
      api.get<{ items: Branch[] }>("/branches", { accessToken, query: { limit: 200 } }),
      api.get<Category[]>("/categories", { accessToken }),
    ]).then(([b, c]) => {
      if (b.status === "fulfilled") {
        const items = b.value.items ?? [];
        setBranches(items);
        // The operator's own branch is not a guess; any other is.
        setBranchId(items.some((x) => x.id === defaultBranchId) ? defaultBranchId : items.length === 1 ? items[0]!.id : "");
      }
      if (c.status === "fulfilled") setCategories(flattenCategories(c.value ?? []));
    });
  }, [open, accessToken, defaultBranchId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!branchId) return;
    setSubmitting(true);
    setError(null);
    setExistingId(null);
    try {
      const created = await api.post<{ id: string }>(
        "/stock-take",
        {
          branchId,
          ...(categoryId !== "all" ? { categoryId } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        { accessToken },
      );
      onCreated(created.id);
    } catch (err: any) {
      setError(err?.message || "Could not start the count.");
      // One open count per branch: offer the way to it rather than a dead end.
      const id = err?.details?.stockCountId;
      if (typeof id === "string") setExistingId(id);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={create} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New stock count</DialogTitle>
            <DialogDescription>
              The system quantity of every line is taken now. Start the count when you are about to
              walk the shelves, so sales in between do not show up as differences.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label htmlFor="count-branch" className="text-xs font-medium">Branch</label>
            <Select value={branchId} onValueChange={setBranchId}>
              <SelectTrigger id="count-branch" className="h-10">
                <SelectValue placeholder="Choose a branch" />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name} ({b.code})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="count-scope" className="text-xs font-medium">What to count</label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="count-scope" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everything at the branch</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="whitespace-pre">{c.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              A category includes everything under it.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="count-notes" className="text-xs font-medium">Note (optional)</label>
            <Input
              id="count-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Month-end count, aisle 4"
              maxLength={1000}
            />
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                {error}
                {existingId && (
                  <>
                    {" "}
                    <Link href={`/stock-take/${existingId}`} className="font-semibold underline">
                      Open the count in progress
                    </Link>
                  </>
                )}
              </span>
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!branchId || submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Start count
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
