"use client";

import React, { useCallback, useState } from "react";
import { FileSignature, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  SortableTh, Table, TableBody, TableContainer, TableEmpty, TableHead,
  TablePagination, TableSearch, Th, numericCell,
} from "@/components/ui/data-table";
import { useTenantSettings } from "@/lib/tenant-settings";
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";
import { Field, Notice, PageHeader, StatusBadge, errorText, humanize, textareaClass } from "../shared";

interface Money { amount: string; formatted: string }

interface QuoteRow {
  id: string;
  number: string;
  status: string;
  estimate: boolean;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  companyName: string | null;
  requestedAt: string;
  validUntil: string | null;
  total: Money;
}

interface QuoteDetail {
  id: string;
  number: string;
  status: string;
  estimate: boolean;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  companyName: string | null;
  notes: string | null;
  staffNotes: string | null;
  discountPercent: string;
  currency: string;
  taxMode: string;
  validUntil: string | null;
  totals: { subtotalNet: Money; discountNet: Money; vat: Money; total: Money };
  items: { id: string; sku: string; name: string; variantName: string | null; uom: string; quantity: string; taxPercent: string; listUnitPrice: string; quotedUnitPrice: string | null }[];
  canPrice: boolean;
  canDecline: boolean;
  canExpire: boolean;
}

const FILTERS = ["", "REQUESTED", "QUOTED", "ACCEPTED", "DECLINED", "EXPIRED", "CONVERTED"];
const PAGE_SIZE = 25;

/** "45.0000" -> "45", "9.5000" -> "9.5". Display only: the string, not a number, is what is sent. */
const trimZeros = (value: string) => (value.includes(".") ? value.replace(/\.?0+$/, "") : value);

/** A `datetime-local` value, `days` from now. Dates only; no money passes through here. */
function defaultValidity(days = 14): string {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function toLocalInput(iso: string | null): string {
  if (!iso) return defaultValidity();
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function QuotesPage() {
  const { tokens } = useAuth();
  const mayWrite = usePermission("order:write");
  const taxLabel = useTenantSettings().tax.label;
  const auth = { accessToken: tokens?.accessToken };

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [selected, setSelected] = useState<QuoteDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [discount, setDiscount] = useState("0");
  const [validUntil, setValidUntil] = useState(defaultValidity());
  const [staffNotes, setStaffNotes] = useState("");

  const list = useListQuery({ sortBy: "createdAt", sortOrder: "desc", filters: { status: "" } });
  const { q, page, sortBy, sortOrder } = list;
  const status = list.filters.status;

  const loadQuotes = useCallback(
    async (signal: AbortSignal) => {
      const res = await api.get<{ items: QuoteRow[]; total: number; countsByStatus: Record<string, number> }>(
        "/storefront-admin/quotes",
        {
          accessToken: tokens?.accessToken,
          signal,
          query: { page, pageSize: PAGE_SIZE, status: status || undefined, q: q.trim() || undefined, sortBy, sortOrder },
        },
      );
      setCounts(res.countsByStatus ?? {});
      return readListResult<QuoteRow>(res);
    },
    [tokens?.accessToken, page, status, q, sortBy, sortOrder],
  );
  const { items: rows, total, loading, initialLoading, error: loadError, reload: load } = useListData(loadQuotes, list.ready);

  function show(detail: QuoteDetail) {
    setSelected(detail);
    setPrices(Object.fromEntries(detail.items.map((i) => [i.id, trimZeros(i.quotedUnitPrice ?? i.listUnitPrice)])));
    setDiscount(trimZeros(detail.discountPercent));
    setValidUntil(toLocalInput(detail.validUntil && new Date(detail.validUntil) > new Date() ? detail.validUntil : null));
    setStaffNotes(detail.staffNotes ?? "");
  }

  async function open(id: string) {
    setError(null);
    try {
      show(await api.get<QuoteDetail>(`/storefront-admin/quotes/${id}`, auth));
    } catch (err) {
      setError(errorText(err, "Failed to load the quote."));
    }
  }

  async function sendQuote() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.post<QuoteDetail>(
        `/storefront-admin/quotes/${selected.id}/price`,
        {
          lines: selected.items.map((i) => ({ itemId: i.id, unitPrice: (prices[i.id] ?? "").trim() })),
          discountPercent: discount.trim() || "0",
          validUntil: new Date(validUntil).toISOString(),
          ...(staffNotes.trim() ? { staffNotes: staffNotes.trim() } : {}),
        },
        auth,
      );
      show(next);
      setSuccess(`${next.number} priced. The shopper can now accept it from their account.`);
      void load();
    } catch (err) {
      setError(errorText(err, "That quote was refused."));
    } finally {
      setBusy(false);
    }
  }

  async function close(to: "declined" | "expired") {
    if (!selected) return;
    const note = to === "declined" ? (window.prompt("Reason (optional, kept on the quote):") ?? undefined) : undefined;
    setBusy(true);
    setError(null);
    try {
      const next = await api.post<QuoteDetail>(`/storefront-admin/quotes/${selected.id}/close`, { status: to, ...(note ? { note } : {}) }, auth);
      show(next);
      setSuccess(`${next.number} marked ${to}.`);
      void load();
    } catch (err) {
      setError(errorText(err, "That change was refused."));
    } finally {
      setBusy(false);
    }
  }

  const editable = mayWrite && !!selected?.canPrice;

  return (
    <div className="space-y-6">
      <PageHeader title="Quotes" description="Trade requests from the website. Price each line, set how long the price holds, and send it back; the shopper accepts or declines from their account.">
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </PageHeader>

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && !selected && <Notice kind="error" message={error} onClose={() => setError(null)} />}
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <span>{loadError}</span>
          <Button variant="outline" size="sm" onClick={load}>Retry</Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f || "all"}
            type="button"
            aria-pressed={status === f}
            onClick={() => list.setFilter("status", f)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs cursor-pointer transition-colors",
              status === f ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {f ? humanize(f) : "All"}
            {f && counts[f] ? <span className="ml-1.5 opacity-70">{counts[f]}</span> : null}
          </button>
        ))}
      </div>

      <TableSearch
        className="max-w-sm"
        value={list.search}
        onChange={list.setSearch}
        label="Search quotes"
        placeholder="Quote number, name, email or company"
      />

      <Card className="overflow-hidden">
        <TableContainer>
          <Table>
            <TableHead>
              <tr>
                <SortableTh column="number" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Quote</SortableTh>
                <Th>Customer</Th>
                <Th>Status</Th>
                <Th>Valid until</Th>
                <Th align="right">Total</Th>
              </tr>
            </TableHead>
            <TableBody
              columns={5}
              loading={initialLoading}
              empty={
                <TableEmpty
                  columns={5}
                  icon={FileSignature}
                  title={q ? "No matching quotes" : `No quotes ${status ? `that are ${humanize(status).toLowerCase()}` : "yet"}`}
                  description={q ? `Nothing matches "${q}".` : undefined}
                />
              }
            >
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => void open(r.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open quote ${r.number}`}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void open(r.id);
                    }
                  }}
                  className={cn(
                    "cursor-pointer hover:bg-secondary/30 transition-colors focus:bg-secondary/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    loading && "opacity-60",
                  )}
                >
                  <td className="px-4 py-3.5">
                    <div className="font-mono font-medium text-foreground">{r.number}</div>
                    <div className="text-muted-foreground tabular-nums">{new Date(r.requestedAt).toLocaleString("en-AE")}</div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="text-foreground">{r.companyName ?? r.contactName}</div>
                    <div className="text-muted-foreground">{r.contactName} · {r.contactPhone}</div>
                  </td>
                  <td className="px-4 py-3.5"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-3.5 text-muted-foreground tabular-nums">{r.validUntil && !r.estimate ? new Date(r.validUntil).toLocaleDateString("en-AE") : "—"}</td>
                  <td className={cn("px-4 py-3.5 font-medium text-foreground", numericCell)}>
                    {r.total.formatted}
                    {r.estimate && <div className="font-sans font-normal text-muted-foreground">estimate</div>}
                  </td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun="quotes" />
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selected.number} <StatusBadge status={selected.status} />
                </DialogTitle>
                <DialogDescription>
                  {selected.companyName ? `${selected.companyName} · ` : ""}{selected.contactName} · {selected.contactEmail} · {selected.contactPhone}
                </DialogDescription>
              </DialogHeader>

              {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
              {selected.notes && <p className="rounded-lg bg-secondary/50 p-3 text-xs"><span className="font-semibold text-foreground">Customer notes: </span>{selected.notes}</p>}

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border text-muted-foreground">
                    <tr>
                      <th className="py-2 font-medium">Item</th>
                      <th className="py-2 text-right font-medium">Qty</th>
                      <th className="py-2 text-right font-medium">List price</th>
                      <th className="py-2 text-right font-medium">Quoted price</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {selected.items.map((i) => (
                      <tr key={i.id}>
                        <td className="py-2">
                          <div className="text-foreground">{i.name}{i.variantName ? ` — ${i.variantName}` : ""}</div>
                          <div className="font-mono text-muted-foreground">{i.sku} · {taxLabel} {trimZeros(i.taxPercent)}%</div>
                        </td>
                        <td className="py-2 text-right">{trimZeros(i.quantity)} {i.uom}</td>
                        <td className="py-2 text-right text-muted-foreground">{trimZeros(i.listUnitPrice)}</td>
                        <td className="py-2 text-right">
                          {editable ? (
                            <Input
                              aria-label={`Quoted unit price for ${i.sku}`}
                              inputMode="decimal"
                              className="ml-auto h-8 w-28 text-right"
                              value={prices[i.id] ?? ""}
                              onChange={(e) => setPrices((p) => ({ ...p, [i.id]: e.target.value }))}
                            />
                          ) : (
                            <span className="font-medium text-foreground">{i.quotedUnitPrice ? trimZeros(i.quotedUnitPrice) : "—"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Unit prices are in {selected.currency}, {selected.taxMode === "inclusive" ? "including" : "excluding"} {taxLabel}. Pricing below list needs the discount permission and stays within your discount limit.
              </p>

              {editable && (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Valid until" hint="After this the shopper can no longer accept.">
                    <Input type="datetime-local" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                  </Field>
                  <Field label="Extra discount %" hint="Off the whole quote.">
                    <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                  </Field>
                  <div className="sm:col-span-3">
                    <Field label="Internal notes" hint="Never shown to the shopper.">
                      <textarea className={textareaClass} rows={2} maxLength={2000} value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} />
                    </Field>
                  </div>
                </div>
              )}
              {!editable && selected.staffNotes && (
                <p className="rounded-lg bg-secondary/50 p-3 text-xs"><span className="font-semibold text-foreground">Internal notes: </span>{selected.staffNotes}</p>
              )}

              <div className="ml-auto w-64 space-y-1 text-xs">
                <Row label="Subtotal (net)" value={selected.totals.subtotalNet.formatted} />
                {selected.totals.discountNet.amount !== "0.00" && <Row label="Discount" value={`− ${selected.totals.discountNet.formatted}`} />}
                <Row label={taxLabel} value={selected.totals.vat.formatted} />
                <Row label={selected.estimate ? "Estimated total" : "Total"} value={selected.totals.total.formatted} strong />
                {selected.validUntil && !selected.estimate && <Row label="Valid until" value={new Date(selected.validUntil).toLocaleString("en-AE")} />}
              </div>

              <DialogFooter className="flex-wrap gap-2">
                {mayWrite && selected.canPrice && (
                  <Button size="sm" disabled={busy} onClick={() => void sendQuote()}>
                    {selected.status === "QUOTED" ? "Update and re-send quote" : "Send quote"}
                  </Button>
                )}
                {mayWrite && selected.canExpire && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void close("expired")}>Mark expired</Button>
                )}
                {mayWrite && selected.canDecline && (
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => void close("declined")}>Decline request</Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "border-t border-border pt-1 font-semibold text-foreground")}>
      <span className="text-muted-foreground">{label}</span><span>{value}</span>
    </div>
  );
}
