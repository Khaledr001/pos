"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  Tags,
} from "lucide-react";
import { Money } from "@devsfleet/shared-utils";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { formatMoney } from "@/lib/format";
import { usePermission } from "@/lib/require-auth";
import { useTenantSettings } from "@/lib/tenant-settings";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableContainer,
  TableEmpty,
  TableHead,
  TablePagination,
  Th,
  numericCell,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow, listCard } from "@/components/ui/mobile-list";

/**
 * Re-price many products at once: pick them by category, brand or supplier,
 * say how the price moves, see every line before anything is written.
 *
 * Nothing is computed here. The preview is the server's answer to the exact
 * request the apply will send, and the apply is refused if the set has moved
 * since — so the confirmation dialog's numbers are the numbers that land.
 */

type Field = "sellingPrice" | "purchasePrice" | "minSellingPrice";
type Rounding = "none" | "0.05" | "0.25" | "0.50" | "1.00";
type Skip = "no_current_value" | "not_positive" | "below_floor" | "scheduled";
type Show = "all" | "changing" | "skipped";

interface PriceList { id: string; name: string; isDefault: boolean; isActive: boolean }
interface Named { id: string; name: string }
interface CategoryNode extends Named { children?: CategoryNode[] }

interface PreviewLine {
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  old: string;
  new: string;
  difference: string | null;
  unchanged: boolean;
  belowFloor: boolean;
  belowCost: boolean;
  skip: Skip | null;
}

interface Totals {
  matched: number;
  changing: number;
  unchanged: number;
  skipped: Record<Skip, number>;
  skippedTotal: number;
  belowCost: number;
  belowFloor: number;
}

interface Preview {
  priceList: Named;
  totals: Totals;
  expectedCount: number;
  fingerprint: string;
  canOverrideFloor: boolean;
  items: PreviewLine[];
  total: number;
  page: number;
  pageSize: number;
}

interface ApplyResult { batchId: string; priceList: Named; changed: number; totals: Totals }

const FIELD_LABEL: Record<Field, string> = {
  sellingPrice: "Selling price",
  purchasePrice: "Purchase cost",
  minSellingPrice: "Minimum selling price (floor)",
};

const SKIP_LABEL: Record<Skip, string> = {
  no_current_value: "No current value",
  not_positive: "Would reach zero",
  below_floor: "Below floor",
  scheduled: "Future price set",
};

const ALL = "all";
const PAGE_SIZE = 50;

function flatten(nodes: CategoryNode[], depth = 0): Array<{ id: string; label: string }> {
  return nodes.flatMap((n) => [
    { id: n.id, label: `${"— ".repeat(depth)}${n.name}` },
    ...flatten(n.children ?? [], depth + 1),
  ]);
}

/** Digits and one point, at most 4 places — what the API's money field accepts. */
function decimalOnly(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [whole = "", ...rest] = cleaned.split(".");
  return rest.length > 0 ? `${whole}.${rest.join("").slice(0, 4)}` : whole;
}

export default function BulkPricePage() {
  const { tokens } = useAuth();
  const accessToken = tokens?.accessToken;
  const currency = useTenantSettings().currency.base;
  const mayWrite = usePermission("price:write");
  const mayBreachFloor = usePermission("price:override_floor");

  const [lists, setLists] = useState<PriceList[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; label: string }>>([]);
  const [brands, setBrands] = useState<Named[]>([]);
  const [suppliers, setSuppliers] = useState<Named[]>([]);

  // Step 1 — which prices
  const [priceListId, setPriceListId] = useState("");
  const [categoryId, setCategoryId] = useState(ALL);
  const [brandId, setBrandId] = useState(ALL);
  const [supplierId, setSupplierId] = useState(ALL);
  const [q, setQ] = useState("");

  // Step 2 — how they move
  const [field, setField] = useState<Field>("sellingPrice");
  const [mode, setMode] = useState<"percent" | "amount">("percent");
  const [direction, setDirection] = useState<"increase" | "decrease">("increase");
  const [value, setValue] = useState("");
  const [rounding, setRounding] = useState<Rounding>("none");
  const [allowBelowFloor, setAllowBelowFloor] = useState(false);

  // Step 3 — preview and apply
  const [preview, setPreview] = useState<Preview | null>(null);
  const [page, setPage] = useState(1);
  const [show, setShow] = useState<Show>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);

  useEffect(() => {
    if (!accessToken) return;
    void Promise.allSettled([
      api.get<PriceList[]>("/pricing/lists", { accessToken }),
      api.get<CategoryNode[]>("/categories", { accessToken }),
      api.get<Named[]>("/brands", { accessToken }),
      api.get<{ items: Named[] }>("/suppliers", { accessToken, query: { pageSize: 200, sortBy: "name", sortOrder: "asc" } }),
    ]).then(([l, c, b, s]) => {
      if (l.status === "fulfilled") {
        const active = (l.value ?? []).filter((x) => x.isActive);
        setLists(active);
        setPriceListId((current) => current || active.find((x) => x.isDefault)?.id || active[0]?.id || "");
      }
      if (c.status === "fulfilled") setCategories(flatten(c.value ?? []));
      if (b.status === "fulfilled") setBrands(b.value ?? []);
      if (s.status === "fulfilled") setSuppliers(s.value?.items ?? []);
    });
  }, [accessToken]);

  /** Exactly what preview and apply both send. */
  const request = useMemo(
    () => ({
      ...(priceListId ? { priceListId } : {}),
      ...(categoryId !== ALL ? { categoryId } : {}),
      ...(brandId !== ALL ? { brandId } : {}),
      ...(supplierId !== ALL ? { supplierId } : {}),
      ...(q.trim() ? { q: q.trim() } : {}),
      field,
      mode,
      direction,
      value,
      rounding,
      allowBelowFloor,
    }),
    [priceListId, categoryId, brandId, supplierId, q, field, mode, direction, value, rounding, allowBelowFloor],
  );

  // Any change to the question makes the last answer wrong: drop it rather
  // than leave an Apply button standing on numbers for a different request.
  useEffect(() => {
    setPreview(null);
    setPage(1);
    setResult(null);
  }, [request]);

  const valueOk = value !== "" && Money.isPositive(Money.toMinor(value || "0"));
  const percentTooBig =
    mode === "percent" && direction === "decrease" && valueOk && Money.toMinor(value) >= Money.toMinor("100");

  const runPreview = useCallback(
    async (nextPage: number, nextShow: Show) => {
      if (!accessToken) return;
      setLoading(true);
      setError(null);
      try {
        const res = await api.post<Preview>(
          "/pricing/bulk/preview",
          { ...request, page: nextPage, pageSize: PAGE_SIZE, show: nextShow },
          { accessToken },
        );
        setPreview(res);
        setPage(nextPage);
        setShow(nextShow);
      } catch (err) {
        setError(err instanceof Error ? err.message : "The preview failed.");
      } finally {
        setLoading(false);
      }
    },
    [accessToken, request],
  );

  async function apply() {
    if (!preview || !accessToken) return;
    setApplying(true);
    setError(null);
    try {
      const res = await api.post<ApplyResult>(
        "/pricing/bulk/apply",
        { ...request, reason: reason.trim(), expectedCount: preview.expectedCount, fingerprint: preview.fingerprint },
        { accessToken },
      );
      setConfirmOpen(false);
      setReason("");
      setPreview(null);
      setResult(res);
    } catch (err) {
      setConfirmOpen(false);
      setError(err instanceof Error ? err.message : "The prices were not changed.");
    } finally {
      setApplying(false);
    }
  }

  const changeLabel =
    mode === "percent"
      ? `${direction === "increase" ? "+" : "−"}${value || "0"}%`
      : `${direction === "increase" ? "+" : "−"}${formatMoney(value || "0", { currency })}`;

  if (!mayWrite) {
    return (
      <Card className="p-10 text-center text-sm text-muted-foreground">
        Changing prices needs the <span className="font-mono">price:write</span> permission.
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href="/products" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Products
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Tags className="size-6 text-primary" />
          Bulk price update
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Move many prices at once — every change is previewed first and recorded in price history.
        </p>
      </div>

      {result && (
        <div role="status" className="flex items-start gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div>
            <p className="font-semibold text-foreground">
              {result.changed.toLocaleString()} {result.changed === 1 ? "price" : "prices"} updated on {result.priceList.name}.
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {result.totals.skippedTotal > 0 && `${result.totals.skippedTotal} skipped · `}
              {result.totals.unchanged > 0 && `${result.totals.unchanged} unchanged · `}
              Batch <span className="font-mono">{result.batchId.slice(0, 8)}</span> in price history.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* ── Step 1 ─────────────────────────────────────────────────────── */}
      <Card className="space-y-4 p-4 sm:p-5">
        <StepTitle n={1} title="Which prices" hint="Leave a filter on “All” to ignore it. A category includes its subcategories." />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Price list">
            <Select value={priceListId} onValueChange={setPriceListId}>
              <SelectTrigger className="h-10"><SelectValue placeholder="Default price list" /></SelectTrigger>
              <SelectContent>
                {lists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}{l.isDefault ? " (default)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Category">
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Brand">
            <Select value={brandId} onValueChange={setBrandId}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All brands</SelectItem>
                {brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Supplier">
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All suppliers</SelectItem>
                {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Name or SKU contains" htmlFor="bp-q">
            <Input id="bp-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. cable" className="h-10" maxLength={100} />
          </Field>
        </div>
      </Card>

      {/* ── Step 2 ─────────────────────────────────────────────────────── */}
      <Card className="space-y-4 p-4 sm:p-5">
        <StepTitle n={2} title="How they change" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Price to change">
            <Select value={field} onValueChange={(v) => setField(v as Field)}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(FIELD_LABEL) as Field[]).map((f) => <SelectItem key={f} value={f}>{FIELD_LABEL[f]}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Direction">
            <Segmented
              value={direction}
              onChange={setDirection}
              options={[
                { value: "increase", label: "Increase", icon: ArrowUp },
                { value: "decrease", label: "Decrease", icon: ArrowDown },
              ]}
            />
          </Field>

          <Field label={mode === "percent" ? "By percent" : `By amount (${currency})`} htmlFor="bp-value">
            <div className="flex gap-2">
              <Input
                id="bp-value"
                value={value}
                onChange={(e) => setValue(decimalOnly(e.target.value))}
                inputMode="decimal"
                placeholder={mode === "percent" ? "5" : "1.00"}
                className="h-10 flex-1 text-right font-mono"
                aria-invalid={percentTooBig || undefined}
              />
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: "percent", label: "%", ariaLabel: "Percent" },
                  { value: "amount", label: currency, ariaLabel: "Fixed amount" },
                ]}
              />
            </div>
            {percentTooBig && <p className="mt-1 text-[11px] text-destructive">A decrease of 100% or more would leave no price.</p>}
          </Field>

          <Field label="Round the result to">
            <Select value={rounding} onValueChange={(v) => setRounding(v as Rounding)}>
              <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No rounding</SelectItem>
                <SelectItem value="0.05">Nearest 0.05</SelectItem>
                <SelectItem value="0.25">Nearest 0.25</SelectItem>
                <SelectItem value="0.50">Nearest 0.50</SelectItem>
                <SelectItem value="1.00">Nearest 1.00</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        {mayBreachFloor && (
          <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={allowBelowFloor}
              onChange={(e) => setAllowBelowFloor(e.target.checked)}
              className="mt-0.5 size-4 rounded border-input"
            />
            <span>
              Also change prices that would go <strong className="text-foreground">below their minimum selling price</strong>.
              Off, those lines are skipped. Needs <span className="font-mono">price:override_floor</span>.
            </span>
          </label>
        )}

        {/* No list chosen means the default one — the server resolves it, so a
            list lookup that failed to load does not block a preview. */}
        <Button onClick={() => void runPreview(1, "all")} disabled={!valueOk || percentTooBig || loading}>
          {loading && !preview ? <Loader2 className="size-4 animate-spin" /> : null}
          Preview {changeLabel} on {FIELD_LABEL[field].toLowerCase()}
        </Button>
      </Card>

      {/* ── Step 3 ─────────────────────────────────────────────────────── */}
      {preview && (
        <Card className="space-y-4 p-4 sm:p-5">
          <StepTitle n={3} title="Check and apply" hint={`${preview.priceList.name} · ${changeLabel} on ${FIELD_LABEL[field].toLowerCase()}`} />

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Matched" value={preview.totals.matched} />
            <Stat label="Will change" value={preview.totals.changing} tone="good" />
            <Stat label="Unchanged" value={preview.totals.unchanged} />
            <Stat label="Skipped" value={preview.totals.skippedTotal} tone={preview.totals.skippedTotal > 0 ? "warn" : undefined} />
          </dl>

          {(preview.totals.belowCost > 0 || preview.totals.belowFloor > 0 || preview.totals.skippedTotal > 0) && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {(Object.keys(preview.totals.skipped) as Skip[])
                .filter((k) => preview.totals.skipped[k] > 0)
                .map((k) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <AlertTriangle className="size-3.5 text-amber-500" />
                    {preview.totals.skipped[k]} skipped — {SKIP_LABEL[k].toLowerCase()}
                  </li>
                ))}
              {preview.totals.belowCost > 0 && (
                <li className="flex items-center gap-1.5">
                  <ShieldAlert className="size-3.5 text-amber-500" />
                  {preview.totals.belowCost} will sell below cost (they are still changed)
                </li>
              )}
              {preview.totals.belowFloor > 0 && (
                <li className="flex items-center gap-1.5">
                  <ShieldAlert className="size-3.5 text-amber-500" />
                  {preview.totals.belowFloor} will remain below their floor
                </li>
              )}
            </ul>
          )}

          <div role="group" aria-label="Lines to show" className="flex flex-wrap gap-1.5">
            {(
              [
                ["all", `All (${preview.totals.matched})`],
                ["changing", `Changing (${preview.totals.changing})`],
                ["skipped", `Skipped (${preview.totals.skippedTotal})`],
              ] as Array<[Show, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={show === key}
                onClick={() => void runPreview(1, key)}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  show === key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <MobileList
            loading={false}
            empty={<MobileEmpty icon={Tags} title="No prices in this view" />}
          >
            {preview.items.map((line) => (
              <MobileRow
                key={line.variantId}
                title={line.sku}
                subtitle={`${formatMoney(line.old)} → ${formatMoney(line.new)}`}
                badge={<LineBadge line={line} />}
                fields={[
                  { label: "Product", value: `${line.productName}${line.variantName && line.variantName !== "Default" ? ` · ${line.variantName}` : ""}` },
                  { label: "Current", value: formatMoney(line.old, { currency }), numeric: true },
                  { label: "New", value: formatMoney(line.new, { currency }), numeric: true },
                  { label: "Change", value: signed(line.difference, currency), numeric: true },
                ]}
              />
            ))}
          </MobileList>

          <Card className={listCard}>
            <TableContainer className="hidden md:block">
              <Table>
                <TableHead>
                  <tr>
                    <Th>Product</Th>
                    <Th align="right">Current ({currency})</Th>
                    <Th align="right">New ({currency})</Th>
                    <Th align="right">Change</Th>
                    <Th>Status</Th>
                  </tr>
                </TableHead>
                <TableBody
                  columns={5}
                  loading={false}
                  empty={<TableEmpty columns={5} icon={Tags} title="No prices in this view" />}
                >
                  {preview.items.map((line) => (
                    <tr key={line.variantId} className={cn(line.skip && "opacity-60", loading && "opacity-50")}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">
                          {line.productName}
                          {line.variantName && line.variantName !== "Default" && (
                            <span className="text-muted-foreground"> · {line.variantName}</span>
                          )}
                        </p>
                        <p className="font-mono text-[11px] text-muted-foreground">{line.sku}</p>
                      </td>
                      <td className={cn("px-4 py-3 text-muted-foreground", numericCell)}>{formatMoney(line.old)}</td>
                      <td className={cn("px-4 py-3 font-semibold", numericCell)}>{formatMoney(line.new)}</td>
                      <td className={cn("px-4 py-3", numericCell)}>{signed(line.difference)}</td>
                      <td className="px-4 py-3"><LineBadge line={line} /></td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={preview.total}
              onPageChange={(p) => void runPreview(p, show)}
              noun="prices"
            />
          </Card>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            <p className="mr-auto text-xs text-muted-foreground">
              Nothing has changed yet. Applying writes {preview.totals.changing.toLocaleString()} new{" "}
              {preview.totals.changing === 1 ? "price" : "prices"} and a price-history row for each.
            </p>
            <Button
              size="lg"
              disabled={preview.totals.changing === 0 || loading}
              onClick={() => {
                setReason("");
                setConfirmOpen(true);
              }}
            >
              Apply to {preview.totals.changing.toLocaleString()} {preview.totals.changing === 1 ? "price" : "prices"}
            </Button>
          </div>
        </Card>
      )}

      <Dialog open={confirmOpen} onOpenChange={(open) => !applying && setConfirmOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change {preview?.totals.changing.toLocaleString()} prices?</DialogTitle>
            <DialogDescription>
              {FIELD_LABEL[field]} {changeLabel} on <strong>{preview?.priceList.name}</strong>
              {rounding !== "none" ? `, rounded to ${rounding}` : ""}.{" "}
              {preview && preview.totals.skippedTotal > 0 && `${preview.totals.skippedTotal} skipped lines stay as they are. `}
              Prices take effect today and the old ones stay in price history.
            </DialogDescription>
          </DialogHeader>
          <div>
            <label htmlFor="bp-reason" className="mb-1 block text-xs font-medium">
              Reason (kept in price history)
            </label>
            <Input
              id="bp-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Supplier increase Oct 2026"
              maxLength={500}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={applying}>
              Cancel
            </Button>
            <Button onClick={() => void apply()} disabled={applying || reason.trim().length < 3}>
              {applying ? <Loader2 className="size-4 animate-spin" /> : null}
              {applying ? "Updating…" : `Change ${preview?.totals.changing.toLocaleString()} prices`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function signed(difference: string | null, currency?: string): string {
  if (difference === null) return "—";
  const minor = Money.toMinor(difference);
  const text = formatMoney(Money.toDecimalString(Money.abs(minor), 4), currency ? { currency } : {});
  if (Money.isPositive(minor)) return `+${text}`;
  if (Money.isNegative(minor)) return `−${text}`;
  return text;
}

function LineBadge({ line }: { line: PreviewLine }) {
  if (line.skip) {
    return (
      <Badge variant="warning" className="gap-1 whitespace-nowrap">
        <AlertTriangle className="size-3" /> Skipped: {SKIP_LABEL[line.skip]}
      </Badge>
    );
  }
  if (line.unchanged) return <Badge variant="secondary">Unchanged</Badge>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge variant="success" className="gap-1 whitespace-nowrap">
        <CheckCircle2 className="size-3" /> Will change
      </Badge>
      {line.belowCost && (
        <Badge variant="warning" className="gap-1 whitespace-nowrap">
          <ShieldAlert className="size-3" /> Below cost
        </Badge>
      )}
      {line.belowFloor && (
        <Badge variant="warning" className="gap-1 whitespace-nowrap">
          <ShieldAlert className="size-3" /> Below floor
        </Badge>
      )}
    </span>
  );
}

function StepTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">{n}</span>
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      {htmlFor ? (
        <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      ) : (
        <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      )}
      {children}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 px-3 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "text-lg font-bold tabular-nums",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value.toLocaleString()}
      </dd>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: typeof ArrowUp; ariaLabel?: string }>;
}) {
  return (
    <div role="group" className="flex h-10 shrink-0 rounded-lg border border-input p-0.5">
      {options.map(({ value: v, label, icon: Icon, ariaLabel }) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          aria-label={ariaLabel}
          onClick={() => onChange(v)}
          className={cn(
            "flex flex-1 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-md px-3 text-xs font-medium transition-colors",
            value === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          {Icon && <Icon className="size-3.5" />}
          {label}
        </button>
      ))}
    </div>
  );
}
