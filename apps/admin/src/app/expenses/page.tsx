"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import type { PaymentMethod } from "@devsfleet/shared-types";
import { Money } from "@devsfleet/shared-utils";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { usePermission } from "@/lib/require-auth";
import { useTenantSettings } from "@/lib/tenant-settings";
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";
import {
  SortableTh, Table, TableBody, TableContainer, TableEmpty, TableHead,
  TablePagination, TableSearch, Th, numericCell,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow, MobileSort, listCard } from "@/components/ui/mobile-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DateRangeFilter } from "../_components/date-range-filter";

interface Expense {
  id: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  title: string;
  amount: string;
  category: string | null;
  expenseDate: string;
  paymentMethod: PaymentMethod;
  notes: string | null;
  userName: string;
  /** Set once a day close has counted it — after that it is frozen. */
  dailyClosingId: string | null;
}

interface Branch {
  id: string;
  name: string;
  code: string;
}

/** What spending is actually settled with. Account and loyalty tenders are for sales. */
const EXPENSE_METHODS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "cheque", label: "Cheque" },
];

const methodLabel = (m: string) =>
  EXPENSE_METHODS.find((x) => x.value === m)?.label ?? m.replace(/_/g, " ");

/** Categories are stored lower-cased; shown the way people wrote them. */
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function today(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Digits and one point, two places — the amount is sent as typed, never through a float. */
function decimalOnly(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [whole = "", ...rest] = cleaned.split(".");
  return rest.length > 0 ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
}

const EMPTY_FORM = {
  title: "",
  amount: "",
  category: "",
  expenseDate: "",
  branchId: "",
  paymentMethod: "cash" as PaymentMethod,
  notes: "",
};

export default function ExpensesPage() {
  const { tokens } = useAuth();
  const accessToken = tokens?.accessToken;
  const currency = useTenantSettings().currency.base;

  const mayWrite = usePermission("expense:write");
  const mayDelete = usePermission("expense:delete");

  const PAGE_SIZE = 50;
  const list = useListQuery<"branchId" | "category" | "from" | "to">({
    sortBy: "expenseDate",
    sortOrder: "desc",
    filters: { branchId: "", category: "", from: "", to: "" },
  });
  const { q, page, sortBy, sortOrder, filters } = list;

  /**
   * The period total arrives with the page, summed by the server over every
   * matching expense. Held beside the list because the shared list hook only
   * carries items and a count.
   */
  const [periodSum, setPeriodSum] = useState("0");

  const loadExpenses = useCallback(
    async (signal: AbortSignal) => {
      const res = await api.get<{ items: Expense[]; total: number; sum: string }>("/expenses", {
        accessToken,
        signal,
        query: {
          q: q.trim() || undefined,
          branchId: filters.branchId || undefined,
          category: filters.category || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          page,
          pageSize: PAGE_SIZE,
          sortBy,
          sortOrder,
        },
      });
      if (!signal.aborted) setPeriodSum(res?.sum ?? "0");
      return readListResult<Expense>(res);
    },
    [accessToken, q, page, sortBy, sortOrder, filters],
  );
  const { items: expenses, total, loading, initialLoading, error: loadError, reload } =
    useListData(loadExpenses, list.ready);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  const loadCategories = useCallback(async () => {
    try {
      setCategories((await api.get<string[]>("/expenses/categories", { accessToken })) ?? []);
    } catch {
      // Only feeds the filter and the suggestions; the list works without it.
    }
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    void (async () => {
      try {
        const res = await api.get<{ items: Branch[] }>("/branches", { accessToken, query: { limit: 200 } });
        setBranches(res?.items ?? []);
      } catch {
        // The branch filter is optional; the list still loads.
      }
    })();
    void loadCategories();
  }, [accessToken, loadCategories]);

  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ── Create / edit ──────────────────────────────────────────────────────────

  const [editing, setEditing] = useState<Expense | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      expenseDate: today(),
      // One branch in view, or one branch filtered to: that is the obvious one.
      branchId: filters.branchId || (branches.length === 1 ? branches[0]!.id : ""),
    });
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(expense: Expense) {
    setEditing(expense);
    setForm({
      title: expense.title,
      amount: Money.toDecimalString(Money.toMinor(expense.amount), 2),
      category: expense.category ? titleCase(expense.category) : "",
      expenseDate: expense.expenseDate,
      branchId: expense.branchId,
      paymentMethod: expense.paymentMethod,
      notes: expense.notes ?? "",
    });
    setFormError(null);
    setFormOpen(true);
  }

  const amountValid = /^\d+(\.\d{1,2})?$/.test(form.amount) && Money.isPositive(Money.toMinor(form.amount));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!amountValid) {
      setFormError("Enter an amount greater than zero.");
      return;
    }
    if (!editing && !form.branchId) {
      setFormError("Choose the branch this was spent at.");
      return;
    }
    setSaving(true);
    setFormError(null);
    const body = {
      title: form.title.trim(),
      amount: form.amount,
      category: form.category.trim() || undefined,
      expenseDate: form.expenseDate || undefined,
      paymentMethod: form.paymentMethod,
      notes: form.notes.trim() || undefined,
    };
    try {
      if (editing) {
        await api.patch(`/expenses/${editing.id}`, body, { accessToken });
        setNotice(`“${body.title}” updated.`);
      } else {
        await api.post("/expenses", { ...body, branchId: form.branchId }, { accessToken });
        setNotice(`“${body.title}” recorded.`);
      }
      setFormOpen(false);
      reload();
      void loadCategories();
    } catch (err: any) {
      setFormError(err?.message || "The expense could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setDeletingBusy(true);
    setActionError(null);
    try {
      await api.delete(`/expenses/${deleting.id}`, { accessToken });
      setNotice(`“${deleting.title}” deleted.`);
      setDeleting(null);
      reload();
    } catch (err: any) {
      setActionError(err?.message || "The expense could not be deleted.");
      setDeleting(null);
    } finally {
      setDeletingBusy(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const filtered = Boolean(q || filters.branchId || filters.category || filters.from || filters.to);
  const emptyDescription = filtered
    ? "No expenses match these filters."
    : "Record diesel, tea, repairs and other out-of-pocket spending here.";

  const rowActions = (e: Expense, compact: boolean) => {
    // A counted day is frozen server-side; the buttons say so rather than fail.
    const frozen = Boolean(e.dailyClosingId);
    return (
      <>
        {mayWrite && (
          <Button
            variant={compact ? "ghost" : "outline"}
            size={compact ? "icon" : "sm"}
            onClick={() => openEdit(e)}
            disabled={frozen}
            title={frozen ? "Counted in a closed day — can no longer be changed" : "Edit"}
            aria-label={`Edit ${e.title}`}
            className={compact ? "h-7 w-7 text-muted-foreground" : undefined}
          >
            <Pencil className="h-3.5 w-3.5" />
            {!compact && "Edit"}
          </Button>
        )}
        {mayDelete && (
          <Button
            variant={compact ? "ghost" : "outline"}
            size={compact ? "icon" : "sm"}
            onClick={() => setDeleting(e)}
            disabled={frozen}
            title={frozen ? "Counted in a closed day — can no longer be deleted" : "Delete"}
            aria-label={`Delete ${e.title}`}
            className={cn(compact ? "h-7 w-7 text-muted-foreground hover:text-destructive" : "text-destructive hover:text-destructive")}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {!compact && "Delete"}
          </Button>
        )}
      </>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Expenses</h1>
            {total > 0 && <Badge variant="secondary">{total} recorded</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Out-of-pocket spending per branch. Cash expenses are deducted from the drawer at day close.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
          {mayWrite && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" />
              Record expense
            </Button>
          )}
        </div>
      </div>

      {notice && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            <span>{notice}</span>
          </div>
          <button onClick={() => setNotice(null)} className="cursor-pointer" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {(actionError || loadError) && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>{actionError || loadError}</span>
          </div>
          {actionError && (
            <button onClick={() => setActionError(null)} className="cursor-pointer" aria-label="Dismiss">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <TableSearch
            value={list.search}
            onChange={list.setSearch}
            label="Search expenses"
            placeholder="Search by title, category or note..."
            className="flex-1"
          />
          <MobileSort
            options={[
              { column: "expenseDate", label: "Date", firstOrder: "desc" },
              { column: "amount", label: "Amount", firstOrder: "desc" },
              { column: "title", label: "Title" },
            ]}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onChange={list.setSort}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <FilterSelect
            label="Branch"
            value={filters.branchId}
            onChange={(v) => list.setFilter("branchId", v)}
            options={[{ value: "", label: "All branches" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
          <FilterSelect
            label="Category"
            value={filters.category}
            onChange={(v) => list.setFilter("category", v)}
            options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c, label: titleCase(c) }))]}
          />
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">Period</span>
            <DateRangeFilter
              from={filters.from}
              to={filters.to}
              className="sm:w-full"
              onChange={(r) => {
                list.setFilter("from", r.from);
                list.setFilter("to", r.to);
              }}
            />
          </div>
        </div>
      </div>

      {/* Period total — from the server, over every matching expense. */}
      <Card className="flex items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Wallet className="h-4 w-4" />
          </span>
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              {filtered ? "Total for these filters" : "Total recorded"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {total} {total === 1 ? "expense" : "expenses"}
              {filters.from || filters.to
                ? ` · ${filters.from ? formatDate(filters.from) : "start"} – ${filters.to ? formatDate(filters.to) : "today"}`
                : ""}
            </p>
          </div>
        </div>
        <p className="font-mono text-xl font-bold tabular-nums" aria-live="polite">
          {formatMoney(periodSum, { currency })}
        </p>
      </Card>

      <MobileList
        loading={initialLoading}
        empty={<MobileEmpty icon={Receipt} title="No expenses found" description={emptyDescription} />}
      >
        {expenses.map((e) => (
          <MobileRow
            key={e.id}
            title={e.title}
            subtitle={formatMoney(e.amount, { currency })}
            badge={e.dailyClosingId ? <Badge variant="secondary">Closed</Badge> : undefined}
            fields={[
              { label: "Date", value: formatDate(e.expenseDate) },
              { label: "Category", value: e.category ? titleCase(e.category) : "—" },
              { label: "Branch", value: e.branchName },
              { label: "Paid by", value: methodLabel(e.paymentMethod) },
              { label: "Recorded by", value: e.userName },
              ...(e.notes ? [{ label: "Note", value: e.notes }] : []),
            ]}
            actions={mayWrite || mayDelete ? rowActions(e, false) : undefined}
          />
        ))}
      </MobileList>

      <Card className={listCard}>
        <TableContainer className="hidden md:block">
          <Table>
            <TableHead>
              <tr>
                <SortableTh column="expenseDate" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} firstOrder="desc">Date</SortableTh>
                <SortableTh column="title" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Expense</SortableTh>
                <Th>Category</Th>
                <Th>Branch</Th>
                <Th>Paid by</Th>
                <Th>Recorded by</Th>
                <SortableTh column="amount" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} firstOrder="desc" align="right">Amount ({currency})</SortableTh>
                <Th align="right"><span className="sr-only">Actions</span></Th>
              </tr>
            </TableHead>
            <TableBody
              columns={8}
              loading={initialLoading}
              empty={
                <TableEmpty
                  columns={8}
                  icon={Receipt}
                  title="No expenses found"
                  description={emptyDescription}
                  action={!filtered && mayWrite ? (
                    <Button size="sm" onClick={openCreate}>
                      <Plus className="h-3.5 w-3.5" /> Record expense
                    </Button>
                  ) : undefined}
                />
              }
            >
              {expenses.map((e) => (
                <tr key={e.id} className={cn("transition-colors hover:bg-secondary/30", loading && "opacity-60")}>
                  <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-muted-foreground">{formatDate(e.expenseDate)}</td>
                  <td className="max-w-64 px-4 py-3.5">
                    <p className="truncate font-medium text-foreground" title={e.title}>{e.title}</p>
                    {e.notes && <p className="truncate text-[11px] text-muted-foreground" title={e.notes}>{e.notes}</p>}
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">{e.category ? titleCase(e.category) : "—"}</td>
                  <td className="px-4 py-3.5">
                    <Badge variant="secondary" className="font-mono text-[10px] font-bold">{e.branchCode}</Badge>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">{methodLabel(e.paymentMethod)}</td>
                  <td className="px-4 py-3.5 text-muted-foreground">{e.userName}</td>
                  <td className={cn("px-4 py-3.5 font-semibold text-foreground", numericCell)}>{formatMoney(e.amount)}</td>
                  <td className="px-4 py-3.5 text-right">
                    <div className="flex justify-end gap-1">
                      {e.dailyClosingId && <Badge variant="secondary" className="mr-1">Closed</Badge>}
                      {rowActions(e, true)}
                    </div>
                  </td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun="expenses" />
      </Card>

      {/* Create / edit */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit expense" : "Record expense"}</DialogTitle>
            <DialogDescription>
              {editing
                ? `${editing.branchName} · the branch cannot be changed once recorded.`
                : "A day that has already been closed cannot take new expenses."}
            </DialogDescription>
          </DialogHeader>

          {formError && (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={save} className="space-y-3">
            <Field label="Title" htmlFor="ex-title" required>
              <Input
                id="ex-title"
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Van diesel"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Amount (${currency})`} htmlFor="ex-amount" required>
                <Input
                  id="ex-amount"
                  required
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: decimalOnly(e.target.value) })}
                  placeholder="0.00"
                  className="text-right font-mono"
                />
              </Field>
              <Field label="Date" htmlFor="ex-date">
                <Input
                  id="ex-date"
                  type="date"
                  max={today()}
                  value={form.expenseDate}
                  onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {!editing && (
                <Field label="Branch" htmlFor="ex-branch" required>
                  <select
                    id="ex-branch"
                    required
                    value={form.branchId}
                    onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                    className="h-9 w-full cursor-pointer rounded-lg border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="" disabled>Choose a branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Paid by" htmlFor="ex-method">
                <select
                  id="ex-method"
                  value={form.paymentMethod}
                  onChange={(e) => setForm({ ...form, paymentMethod: e.target.value as PaymentMethod })}
                  className="h-9 w-full cursor-pointer rounded-lg border border-input bg-transparent px-3 text-sm"
                >
                  {EXPENSE_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Category" htmlFor="ex-category" hint="Pick one in use, or type a new one.">
              <Input
                id="ex-category"
                list="expense-categories"
                maxLength={80}
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="e.g. Fuel"
              />
              <datalist id="expense-categories">
                {categories.map((c) => (
                  <option key={c} value={titleCase(c)} />
                ))}
              </datalist>
            </Field>

            <Field label="Note" htmlFor="ex-notes">
              <Input
                id="ex-notes"
                maxLength={1000}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Receipt number, who it was paid to…"
              />
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !form.title.trim() || !amountValid}>
                {saving ? "Saving…" : editing ? "Save changes" : "Record expense"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this expense?</DialogTitle>
            <DialogDescription>
              {deleting && `“${deleting.title}”, ${formatMoney(deleting.amount, { currency })} on ${formatDate(deleting.expenseDate)}. It stops counting towards the day's expenses.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={deletingBusy}>
              Keep it
            </Button>
            <Button
              variant="outline"
              onClick={() => void confirmDelete()}
              disabled={deletingBusy}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              {deletingBusy ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  required,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full cursor-pointer rounded-lg border border-input bg-secondary/30 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}
