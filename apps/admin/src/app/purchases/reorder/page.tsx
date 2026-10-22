"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShoppingBasket,
  Truck,
} from "lucide-react";
import { Money } from "@devsfleet/shared-utils";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { useTenantSettings } from "@/lib/tenant-settings";
import { usePermission } from "@/lib/require-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectField,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MobileRow } from "@/components/ui/mobile-list";

// ── Contracts ────────────────────────────────────────────────────────────────

interface Branch {
  id: string;
  name: string;
  code: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface SuggestionLine {
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  unitAbbr: string | null;
  available: string;
  threshold: string;
  reorderQuantity: string;
  incoming: string;
  suggestedQuantity: string;
  coveredByIncoming: boolean;
  unitCost: string | null;
  supplierId: string | null;
  suppliers: Array<{ supplierId: string; name: string; lastCost: string | null; leadTimeDays: number | null }>;
}

interface SuggestionGroup {
  supplierId: string | null;
  supplierName: string | null;
  lines: SuggestionLine[];
}

interface Suggestions {
  branchId: string;
  groups: SuggestionGroup[];
  coveredByIncoming: number;
}

interface DraftOrderResult {
  clientId: string;
  supplierId: string;
  ok: boolean;
  purchaseOrderId?: string;
  poNumber?: string;
  error?: string;
}

/** What the operator has done to one suggestion. */
interface Edit {
  selected: boolean;
  quantity: string;
  unitCost: string;
  supplierId: string;
}

const BRANCH_KEY = "devsfleet_reorder_branch";
const NO_SUPPLIER = "";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Digits and one point, at most four places — `Money.toMinor` throws on anything else. */
function decimalOnly(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [whole = "", ...rest] = cleaned.split(".");
  return rest.length > 0 ? `${whole}.${rest.join("").slice(0, 4)}` : whole;
}

function isPositive(value: string): boolean {
  try {
    return Money.isPositive(Money.toMinor(value || "0"));
  } catch {
    return false;
  }
}

/** "30.0000" → "30". Display only. */
function qty(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

function lineTotal(edit: Edit): bigint {
  if (!isPositive(edit.quantity) || !isPositive(edit.unitCost)) return 0n;
  return Money.multiplyByQuantity(Money.toMinor(edit.unitCost), edit.quantity);
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ReorderPage() {
  const { user, tokens } = useAuth();
  const accessToken = tokens?.accessToken;
  const settings = useTenantSettings();
  const currency = settings.currency.base;
  const mayCreate = usePermission("purchase:write");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);

  const [data, setData] = useState<Suggestions | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState<DraftOrderResult[] | null>(null);

  /**
   * One retry key per supplier for as long as its order is unconfirmed. A
   * double-click or a retry after a timeout resends the same key, and the
   * server hands back the order it already raised instead of a second one.
   */
  const clientIds = useRef(new Map<string, string>());

  // ── Branches and suppliers ────────────────────────────────────────────────

  useEffect(() => {
    if (!accessToken) return;
    void (async () => {
      try {
        // Only the caller's own branches come back — reorders are raised for
        // a shelf you are responsible for.
        const res = await api.get<{ items: Branch[] }>("/branches", { accessToken, query: { limit: 200 } });
        const items = res.items ?? [];
        setBranches(items);
        let remembered: string | null = null;
        try {
          remembered = localStorage.getItem(BRANCH_KEY);
        } catch {
          // Storage blocked: fall through to the user's own branch.
        }
        const preselect =
          (remembered && items.some((b) => b.id === remembered) && remembered) ||
          (user?.branchId && items.some((b) => b.id === user.branchId) && user.branchId) ||
          (items.length === 1 ? items[0]!.id : "");
        if (preselect) setBranchId(preselect);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load branches.");
      }
    })();
    void api
      .get<{ items: Supplier[] }>("/suppliers", { accessToken, query: { pageSize: 200, sortBy: "name", sortOrder: "asc" } })
      .then((res) => setSuppliers(res.items ?? []))
      .catch(() => undefined);
  }, [accessToken, user?.branchId]);

  function chooseBranch(id: string) {
    setBranchId(id);
    setResults(null);
    try {
      localStorage.setItem(BRANCH_KEY, id);
    } catch {
      // Not worth telling anyone about.
    }
  }

  // ── Suggestions ───────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!accessToken || !branchId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Suggestions>("/reorder/suggestions", { accessToken, query: { branchId } });
      setData(res);
      const next: Record<string, Edit> = {};
      for (const group of res.groups) {
        for (const line of group.lines) {
          next[line.variantId] = {
            // Covered lines are shown, not pre-selected: what is on its way
            // should not be ordered again by default.
            selected: !line.coveredByIncoming && Boolean(line.supplierId),
            quantity: line.coveredByIncoming ? qty(line.reorderQuantity) || "1" : line.suggestedQuantity,
            unitCost: line.unitCost ? qty(line.unitCost) : "",
            supplierId: line.supplierId ?? NO_SUPPLIER,
          };
        }
      }
      setEdits(next);
      clientIds.current.clear();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load suggestions.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, branchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const lines = useMemo(() => data?.groups.flatMap((g) => g.lines) ?? [], [data]);
  const supplierName = useCallback(
    (id: string) => suppliers.find((s) => s.id === id)?.name
      ?? lines.flatMap((l) => l.suppliers).find((s) => s.supplierId === id)?.name
      ?? data?.groups.find((g) => g.supplierId === id)?.supplierName
      ?? "Supplier",
    [suppliers, lines, data],
  );

  /** Grouped by the supplier each line is CURRENTLY set to, so a reassignment moves it. */
  const groups = useMemo(() => {
    const map = new Map<string, SuggestionLine[]>();
    for (const line of lines) {
      const key = edits[line.variantId]?.supplierId ?? NO_SUPPLIER;
      map.set(key, [...(map.get(key) ?? []), line]);
    }
    return [...map.entries()].sort(([a], [b]) => {
      if (a === NO_SUPPLIER) return 1;
      if (b === NO_SUPPLIER) return -1;
      return supplierName(a).localeCompare(supplierName(b));
    });
  }, [lines, edits, supplierName]);

  function patch(variantId: string, change: Partial<Edit>) {
    setEdits((current) => ({ ...current, [variantId]: { ...current[variantId]!, ...change } }));
  }

  function setGroupSelected(groupLines: SuggestionLine[], selected: boolean) {
    setEdits((current) => {
      const next = { ...current };
      for (const l of groupLines) next[l.variantId] = { ...next[l.variantId]!, selected };
      return next;
    });
  }

  // ── What would be raised ─────────────────────────────────────────────────

  const chosen = useMemo(() => {
    const bySupplier = new Map<string, Array<{ line: SuggestionLine; edit: Edit }>>();
    let problems = 0;
    for (const line of lines) {
      const edit = edits[line.variantId];
      if (!edit?.selected) continue;
      if (!edit.supplierId || !isPositive(edit.quantity) || !isPositive(edit.unitCost)) {
        problems += 1;
        continue;
      }
      bySupplier.set(edit.supplierId, [...(bySupplier.get(edit.supplierId) ?? []), { line, edit }]);
    }
    const orders = [...bySupplier.entries()].map(([supplierId, items]) => ({
      supplierId,
      items,
      total: items.reduce((sum, i) => sum + lineTotal(i.edit), 0n),
    }));
    return { orders, problems, total: orders.reduce((sum, o) => sum + o.total, 0n) };
  }, [lines, edits]);

  async function createOrders() {
    if (!accessToken || chosen.orders.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<{ orders: DraftOrderResult[] }>(
        "/reorder/draft-orders",
        {
          branchId,
          orders: chosen.orders.map((o) => {
            let clientId = clientIds.current.get(o.supplierId);
            if (!clientId) {
              clientId = crypto.randomUUID();
              clientIds.current.set(o.supplierId, clientId);
            }
            return {
              clientId,
              supplierId: o.supplierId,
              lines: o.items.map(({ line, edit }) => ({
                variantId: line.variantId,
                quantity: Number(edit.quantity),
                unitPrice: edit.unitCost,
              })),
            };
          }),
        },
        { accessToken },
      );
      setResults(res.orders);
      setConfirmOpen(false);
      // Raised orders are now incoming stock: re-reading the suggestions shows
      // them as covered and keeps the failed groups for a retry. A failed
      // group's key is kept so its retry still cannot double up.
      const failed = new Set(res.orders.filter((o) => !o.ok).map((o) => o.supplierId));
      const keep = new Map([...clientIds.current].filter(([supplierId]) => failed.has(supplierId)));
      await load();
      clientIds.current = keep;
    } catch (err) {
      setError(err instanceof Error ? err.message : "The orders could not be created.");
    } finally {
      setCreating(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const selectedCount = chosen.orders.reduce((n, o) => n + o.items.length, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <Link href="/purchases" className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Purchase orders
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Reorder suggestions</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Items at or below their reorder level, less what is already on order — raised as one draft purchase order per supplier.
          </p>
        </div>
        <div className="flex w-full gap-2 md:w-auto">
          <SelectField
            size="sm"
            value={branchId}
            onValueChange={chooseBranch}
            label="Branch"
            placeholder="Choose a branch…"
            className="min-w-0 flex-1 text-sm md:w-64 md:flex-none"
            options={branches.map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
          />
          <Button variant="outline" size="sm" className="h-9 shrink-0" onClick={() => void load()} disabled={!branchId || loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {results && results.length > 0 && (
        <Card className="space-y-2 p-4" role="status">
          {results.map((r) => (
            <p key={r.clientId} className="flex items-start gap-2 text-sm">
              {r.ok ? (
                <>
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span>
                    Draft{" "}
                    <Link href={`/purchases?q=${encodeURIComponent(r.poNumber ?? "")}`} className="font-mono font-semibold text-primary underline underline-offset-2">
                      {r.poNumber}
                    </Link>{" "}
                    raised for {supplierName(r.supplierId)}.
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <span className="text-destructive">
                    {supplierName(r.supplierId)}: {r.error} Its lines are still selected — fix and create again.
                  </span>
                </>
              )}
            </p>
          ))}
        </Card>
      )}

      {!branchId ? (
        <Card className="flex flex-col items-center gap-2 p-12 text-center">
          <Truck className="h-8 w-8 text-muted-foreground/50" />
          <p className="text-sm font-semibold">Choose a branch</p>
          <p className="max-w-sm text-xs text-muted-foreground">What is running low is a question about one shelf at a time.</p>
        </Card>
      ) : loading && !data ? (
        <Card className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Working out what is low…
        </Card>
      ) : lines.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-12 text-center">
          <PackageCheck className="h-10 w-10 text-emerald-500/70" />
          <p className="text-sm font-semibold">Nothing to reorder</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Every item this branch stocks is above its reorder level. Set a minimum stock on a product, or a reorder level for this branch, to have it watched here.
          </p>
        </Card>
      ) : (
        <>
          {data && data.coveredByIncoming > 0 && (
            <p className="text-xs text-muted-foreground">
              {data.coveredByIncoming} low {data.coveredByIncoming === 1 ? "item is" : "items are"} already covered by open purchase orders — shown dimmed and not selected.
            </p>
          )}

          {groups.map(([supplierId, groupLines]) => {
            const key = supplierId || "none";
            const isOpen = !collapsed[key];
            const selectedHere = groupLines.filter((l) => edits[l.variantId]?.selected);
            const allSelected = selectedHere.length === groupLines.length;
            const subtotal = groupLines.reduce(
              (sum, l) => (edits[l.variantId]?.selected ? sum + lineTotal(edits[l.variantId]!) : sum),
              0n,
            );
            const title = supplierId ? supplierName(supplierId) : "No supplier yet";
            const panelId = `reorder-group-${key}`;

            return (
              <Card key={key} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 border-b border-border bg-secondary/40 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selectedHere.length > 0 && !allSelected;
                    }}
                    onChange={(e) => setGroupSelected(groupLines, e.target.checked)}
                    aria-label={`Select every item for ${title}`}
                    className="h-4 w-4 cursor-pointer rounded border-input"
                  />
                  <button
                    type="button"
                    onClick={() => setCollapsed((c) => ({ ...c, [key]: isOpen }))}
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                  >
                    <span className={cn("truncate text-sm font-semibold", !supplierId && "text-amber-600 dark:text-amber-400")}>
                      {title}
                    </span>
                    <Badge variant="secondary" className="shrink-0">
                      {selectedHere.length}/{groupLines.length}
                    </Badge>
                    <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                  </button>
                  <span className="font-mono text-sm font-semibold tabular-nums">{formatMoney(Money.toDecimalString(subtotal, 4), { currency })}</span>
                </div>

                {!supplierId && isOpen && (
                  <p className="border-b border-border bg-amber-500/10 px-4 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                    No supplier is linked to these items and none has been ordered from before. Pick one per line to include it in an order.
                  </p>
                )}

                <div id={panelId} hidden={!isOpen}>
                  {/* Desktop */}
                  <div className="hidden overflow-x-auto md:block">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-border text-muted-foreground">
                        <tr>
                          <th scope="col" className="w-10 px-4 py-2.5"><span className="sr-only">Include</span></th>
                          <th scope="col" className="px-2 py-2.5 font-medium">Item</th>
                          <th scope="col" className="px-2 py-2.5 text-right font-medium">Available</th>
                          <th scope="col" className="px-2 py-2.5 text-right font-medium">Reorder at</th>
                          <th scope="col" className="px-2 py-2.5 text-right font-medium">On order</th>
                          <th scope="col" className="px-2 py-2.5 text-right font-medium">Order qty</th>
                          <th scope="col" className="px-2 py-2.5 text-right font-medium">Unit cost ({currency})</th>
                          <th scope="col" className="px-2 py-2.5 text-right font-medium">Line total</th>
                          <th scope="col" className="px-4 py-2.5 font-medium">Supplier</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {groupLines.map((line) => {
                          const edit = edits[line.variantId]!;
                          return (
                            <tr key={line.variantId} className={cn(line.coveredByIncoming && !edit.selected && "opacity-55")}>
                              <td className="px-4 py-2.5">
                                <input
                                  type="checkbox"
                                  checked={edit.selected}
                                  onChange={(e) => patch(line.variantId, { selected: e.target.checked })}
                                  aria-label={`Include ${line.sku}`}
                                  className="h-4 w-4 cursor-pointer rounded border-input"
                                />
                              </td>
                              <td className="max-w-72 px-2 py-2.5">
                                <p className="truncate font-medium text-foreground" title={line.productName}>{line.productName}</p>
                                <p className="font-mono text-[11px] text-muted-foreground">
                                  {line.sku}
                                  {line.variantName && line.variantName !== "Default" ? ` · ${line.variantName}` : ""}
                                </p>
                              </td>
                              <td className="px-2 py-2.5 text-right font-mono tabular-nums">{qty(line.available)} {line.unitAbbr}</td>
                              <td className="px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">{qty(line.threshold)}</td>
                              <td className="px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                                {isPositive(line.incoming) ? qty(line.incoming) : "—"}
                              </td>
                              <td className="px-2 py-2.5 text-right">
                                <Input
                                  value={edit.quantity}
                                  onChange={(e) => patch(line.variantId, { quantity: decimalOnly(e.target.value) })}
                                  inputMode="decimal"
                                  aria-label={`Order quantity for ${line.sku}`}
                                  className="ml-auto h-8 w-20 text-right font-mono text-xs"
                                />
                              </td>
                              <td className="px-2 py-2.5 text-right">
                                <Input
                                  value={edit.unitCost}
                                  onChange={(e) => patch(line.variantId, { unitCost: decimalOnly(e.target.value) })}
                                  inputMode="decimal"
                                  placeholder="0.00"
                                  aria-label={`Unit cost for ${line.sku}`}
                                  className={cn(
                                    "ml-auto h-8 w-24 text-right font-mono text-xs",
                                    edit.selected && !isPositive(edit.unitCost) && "border-destructive",
                                  )}
                                />
                              </td>
                              <td className="px-2 py-2.5 text-right font-mono font-semibold tabular-nums">
                                {formatMoney(Money.toDecimalString(lineTotal(edit), 4))}
                              </td>
                              <td className="px-4 py-2.5">
                                <SupplierSelect
                                  value={edit.supplierId}
                                  line={line}
                                  suppliers={suppliers}
                                  onChange={(supplierId) => patch(line.variantId, { supplierId, selected: Boolean(supplierId) || edit.selected })}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Phone */}
                  <div className="space-y-2 p-3 md:hidden">
                    {groupLines.map((line) => {
                      const edit = edits[line.variantId]!;
                      return (
                        <MobileRow
                          key={line.variantId}
                          className={cn(line.coveredByIncoming && !edit.selected && "opacity-60")}
                          title={line.sku}
                          subtitle={line.productName}
                          badge={
                            edit.selected ? (
                              <Badge variant="success">Ordering</Badge>
                            ) : line.coveredByIncoming ? (
                              <Badge variant="secondary">On order</Badge>
                            ) : (
                              <Badge variant="secondary">Skipped</Badge>
                            )
                          }
                          fields={[
                            { label: "Available", value: `${qty(line.available)} ${line.unitAbbr ?? ""}`, numeric: true },
                            { label: "Reorder at", value: qty(line.threshold), numeric: true },
                            { label: "On order", value: isPositive(line.incoming) ? qty(line.incoming) : "—", numeric: true },
                            {
                              label: "Order qty",
                              value: (
                                <Input
                                  value={edit.quantity}
                                  onChange={(e) => patch(line.variantId, { quantity: decimalOnly(e.target.value) })}
                                  inputMode="decimal"
                                  aria-label={`Order quantity for ${line.sku}`}
                                  className="ml-auto h-9 w-24 text-right font-mono"
                                />
                              ),
                            },
                            {
                              label: `Unit cost (${currency})`,
                              value: (
                                <Input
                                  value={edit.unitCost}
                                  onChange={(e) => patch(line.variantId, { unitCost: decimalOnly(e.target.value) })}
                                  inputMode="decimal"
                                  placeholder="0.00"
                                  aria-label={`Unit cost for ${line.sku}`}
                                  className="ml-auto h-9 w-28 text-right font-mono"
                                />
                              ),
                            },
                            { label: "Line total", value: formatMoney(Money.toDecimalString(lineTotal(edit), 4), { currency }), numeric: true },
                            {
                              label: "Supplier",
                              value: (
                                <SupplierSelect
                                  value={edit.supplierId}
                                  line={line}
                                  suppliers={suppliers}
                                  onChange={(supplierId) => patch(line.variantId, { supplierId, selected: Boolean(supplierId) || edit.selected })}
                                />
                              ),
                            },
                          ]}
                          actions={
                            <Button
                              variant={edit.selected ? "outline" : "default"}
                              size="sm"
                              onClick={() => patch(line.variantId, { selected: !edit.selected })}
                            >
                              {edit.selected ? "Leave out" : "Include"}
                            </Button>
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              </Card>
            );
          })}
        </>
      )}

      {/* What will be raised, and the one way to raise it. Sticky inside the
          page rather than fixed to the window, so it follows the content's
          edges whether the sidebar is open, collapsed or a drawer. */}
      {mayCreate && lines.length > 0 && (
        <div className="sticky bottom-0 z-20 -mb-3 rounded-t-xl border border-b-0 border-border bg-card/95 shadow-lg backdrop-blur sm:-mb-4 md:-mb-6">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex-1 text-xs text-muted-foreground">
              <p>
                <span className="font-semibold text-foreground">{selectedCount}</span> {selectedCount === 1 ? "item" : "items"} for{" "}
                <span className="font-semibold text-foreground">{chosen.orders.length}</span>{" "}
                {chosen.orders.length === 1 ? "supplier" : "suppliers"} ·{" "}
                <span className="font-mono font-semibold tabular-nums text-foreground">{formatMoney(Money.toDecimalString(chosen.total, 4), { currency })}</span>
              </p>
              {chosen.problems > 0 && (
                <p className="mt-0.5 text-amber-600 dark:text-amber-400">
                  {chosen.problems} selected {chosen.problems === 1 ? "line needs" : "lines need"} a supplier, a quantity or a unit cost.
                </p>
              )}
            </div>
            <Button
              className="h-11 w-full sm:w-auto"
              disabled={chosen.orders.length === 0 || chosen.problems > 0 || creating}
              onClick={() => setConfirmOpen(true)}
            >
              <ShoppingBasket className="h-4 w-4" />
              Create {chosen.orders.length} draft purchase {chosen.orders.length === 1 ? "order" : "orders"}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={(open) => !creating && setConfirmOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create draft purchase orders?</DialogTitle>
            <DialogDescription>
              Drafts only — nothing is sent to a supplier until you send each order from Purchase orders.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1.5 text-sm">
            {chosen.orders.map((o) => (
              <li key={o.supplierId} className="flex items-baseline justify-between gap-3 rounded-lg border border-border px-3 py-2">
                <span className="min-w-0 truncate">
                  {supplierName(o.supplierId)}
                  <span className="text-xs text-muted-foreground"> · {o.items.length} {o.items.length === 1 ? "line" : "lines"}</span>
                </span>
                <span className="shrink-0 font-mono text-xs font-semibold tabular-nums">{formatMoney(Money.toDecimalString(o.total, 4), { currency })}</span>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="text-xs text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={creating}>Cancel</Button>
            <Button onClick={() => void createOrders()} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingBasket className="h-4 w-4" />}
              {creating ? "Creating…" : `Create ${chosen.orders.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Linked suppliers first (with their last cost), then everyone else. */
function SupplierSelect({
  value,
  line,
  suppliers,
  onChange,
}: {
  value: string;
  line: SuggestionLine;
  suppliers: Supplier[];
  onChange: (supplierId: string) => void;
}) {
  const linked = new Set(line.suppliers.map((s) => s.supplierId));
  const others = suppliers.filter((s) => !linked.has(s.id));
  return (
    // The lower-level parts rather than SelectField: this list is grouped, and
    // the built-in search (over 8 suppliers) filters within the groups.
    <Select
      value={value || undefined}
      onValueChange={(v) => onChange(v === CLEAR_SUPPLIER ? "" : v)}
    >
      <SelectTrigger
        aria-label={`Supplier for ${line.sku}`}
        className={cn("h-8 w-full max-w-48", value ? "border-input" : "border-amber-500/60")}
      >
        <SelectValue placeholder="Choose…" />
      </SelectTrigger>
      <SelectContent searchPlaceholder="Search suppliers…">
        {value && <SelectItem value={CLEAR_SUPPLIER}>No supplier</SelectItem>}
        {line.suppliers.length > 0 && (
          <SelectGroup>
            <SelectLabel>Supplies this item</SelectLabel>
            {line.suppliers.map((s) => (
              <SelectItem key={s.supplierId} value={s.supplierId}>
                {`${s.name}${s.lastCost ? ` · last ${qty(s.lastCost)}` : ""}`}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        <SelectGroup>
          <SelectLabel>{line.suppliers.length > 0 ? "Other suppliers" : "Suppliers"}</SelectLabel>
          {others.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

/** Radix reserves "" for "no value", so clearing the supplier needs its own item. */
const CLEAR_SUPPLIER = "__none__";
