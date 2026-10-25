"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Inbox, Mail, MessageCircle, Phone, Trash2 } from "lucide-react";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type FormDef, type LeadPage, type LeadRow, type LeadStatus } from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api, apiDownload, saveBlob } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select";
import { MobileEmpty, MobileList, MobileRow } from "@/components/ui/mobile-list";
import { Table, TableBody, TableContainer, TableEmpty, TableHead, TablePagination, Th } from "@/components/ui/data-table";
import { Field, Loading, Notice, PageHeader, errorText, textareaClass } from "../shared";
import { StoreTabs } from "../store-nav";

const PAGE_SIZE = 25;

const TONE: Record<LeadStatus, "default" | "warning" | "success" | "secondary" | "destructive"> = {
  new: "default",
  contacted: "warning",
  qualified: "warning",
  won: "success",
  lost: "secondary",
  spam: "destructive",
};

const EMPTY_COUNTS = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
const contactOf = (l: LeadRow) => [l.email, l.phone].filter(Boolean).join(" · ") || "—";
const when = (iso: string) => new Date(iso).toLocaleString();
const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
const sourceOf = (l: LeadRow) => l.source.productName ?? l.source.path ?? "—";

export default function LeadsPage() {
  const { tokens } = useAuth();
  const mayWrite = usePermission("storefront:write");
  const auth = useMemo(() => ({ accessToken: tokens?.accessToken }), [tokens]);

  const [status, setStatus] = useState<LeadStatus | "">("");
  const [form, setForm] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LeadPage | null>(null);
  const [forms, setForms] = useState<{ slug: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [open, setOpen] = useState<LeadRow | null>(null);
  const [exporting, setExporting] = useState(false);

  // Typing in the search box must not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    api.get<FormDef[]>("/storefront-admin/forms", auth).then((f) => setForms((f ?? []).map((x) => ({ slug: x.slug, name: x.name })))).catch(() => setForms([]));
  }, [auth]);

  const filters = useMemo(() => ({ status: status || undefined, form: form || undefined, q: query || undefined }), [status, form, query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get<LeadPage>("/storefront-admin/leads", { ...auth, query: { page, pageSize: PAGE_SIZE, ...filters } }));
      setError(null);
    } catch (err) {
      setError(errorText(err, "Failed to load leads."));
    } finally {
      setLoading(false);
    }
  }, [auth, page, filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = data?.counts ?? EMPTY_COUNTS;
  const totalAll = LEAD_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const items = data?.items ?? [];
  const emptyTitle = status ? `No ${LEAD_STATUS_LABELS[status].toLowerCase()} leads` : query || form ? "No leads match" : "No leads yet";
  const emptyText = status || query || form ? "Try another filter." : "Submissions from your website forms will appear here.";

  async function exportCsv() {
    setExporting(true);
    try {
      const { blob, filename } = await apiDownload("/storefront-admin/leads/export", { ...auth, query: filters });
      saveBlob(blob, filename ?? "leads.csv");
    } catch (err) {
      setError(errorText(err, "The export failed."));
    } finally {
      setExporting(false);
    }
  }

  const tab = (value: LeadStatus | "", label: string, n: number) => (
    <button
      key={value || "all"}
      type="button"
      aria-pressed={status === value}
      onClick={() => {
        setStatus(value);
        setPage(1);
      }}
      className={cn("cursor-pointer rounded-full border px-3 py-1 text-xs", status === value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent")}
    >
      {label} <span className="ml-1 font-mono tabular-nums opacity-80">{n}</span>
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Leads" description="Enquiries and messages from your website forms.">
        <Button size="sm" variant="outline" disabled={exporting || totalAll === 0} onClick={() => void exportCsv()}><Download className="h-4 w-4" /> {exporting ? "Exporting..." : "Export CSV"}</Button>
      </PageHeader>
      <StoreTabs current="/online-store/leads" />
      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && !open && <Notice kind="error" message={error} onClose={() => setError(null)} />}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Lead status">
        {tab("", "All", totalAll)}
        {LEAD_STATUSES.map((s) => tab(s, LEAD_STATUS_LABELS[s], counts[s] ?? 0))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-72"><Input type="search" aria-label="Search leads" placeholder="Search name, email, phone or message" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="w-full sm:w-56">
          <SelectField size="sm" label="Filter by form" value={form} onValueChange={(v) => { setForm(v); setPage(1); }} options={[{ value: "", label: "All forms" }, ...forms.map((f) => ({ value: f.slug, label: f.name }))]} />
        </div>
      </div>

      {loading && !data ? (
        <Loading label="Loading leads..." />
      ) : (
        <>
          <MobileList loading={false} empty={<MobileEmpty icon={Inbox} title={emptyTitle} description={emptyText} />}>
            {items.map((l) => (
              <MobileRow
                key={l.id}
                title={l.name ?? l.email ?? l.phone ?? "Anonymous"}
                subtitle={when(l.createdAt)}
                badge={<Badge variant={TONE[l.status]}>{LEAD_STATUS_LABELS[l.status]}</Badge>}
                fields={[{ label: "Contact", value: contactOf(l) }, { label: "Form", value: l.formName }, { label: "About", value: sourceOf(l) }]}
                actions={<Button variant="outline" size="sm" onClick={() => setOpen(l)}>Open</Button>}
              />
            ))}
          </MobileList>
          <Card className="hidden overflow-hidden md:block">
            <TableContainer>
              <Table>
                <TableHead>
                  <tr><Th>Received</Th><Th>Name</Th><Th>Contact</Th><Th>Form</Th><Th>About</Th><Th>Status</Th></tr>
                </TableHead>
                <TableBody columns={6} loading={false} empty={<TableEmpty columns={6} icon={Inbox} title={emptyTitle} description={emptyText} />}>
                  {items.map((l) => (
                    <tr key={l.id} className="cursor-pointer hover:bg-secondary/30" onClick={() => setOpen(l)}>
                      <td className="whitespace-nowrap px-4 py-3.5 text-muted-foreground">{when(l.createdAt)}</td>
                      <td className="px-4 py-3.5 font-medium text-foreground">
                        <button type="button" className="cursor-pointer text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(e) => { e.stopPropagation(); setOpen(l); }}>{l.name ?? "Anonymous"}</button>
                        {l.status === "new" && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-primary align-middle" title="New" aria-label="New" />}
                      </td>
                      <td className="px-4 py-3.5">{contactOf(l)}</td>
                      <td className="px-4 py-3.5">{l.formName}</td>
                      <td className="max-w-56 truncate px-4 py-3.5 text-muted-foreground">{sourceOf(l)}</td>
                      <td className="px-4 py-3.5"><Badge variant={TONE[l.status]}>{LEAD_STATUS_LABELS[l.status]}</Badge></td>
                    </tr>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
          <TablePagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} noun="leads" />
        </>
      )}

      <LeadDialog
        lead={open}
        mayWrite={mayWrite}
        auth={auth}
        error={error}
        clearError={() => setError(null)}
        onClose={() => {
          setOpen(null);
          setError(null);
        }}
        onChanged={(row, message) => {
          setOpen(row);
          if (message) setSuccess(message);
          void load();
        }}
        onDeleted={(message) => {
          setOpen(null);
          setSuccess(message);
          void load();
        }}
        setError={setError}
      />
    </div>
  );
}

function LeadDialog({
  lead,
  mayWrite,
  auth,
  error,
  clearError,
  onClose,
  onChanged,
  onDeleted,
  setError,
}: {
  lead: LeadRow | null;
  mayWrite: boolean;
  auth: { accessToken: string | undefined };
  error: string | null;
  clearError: () => void;
  onClose: () => void;
  onChanged: (row: LeadRow | null, message?: string) => void;
  onDeleted: (message: string) => void;
  setError: (m: string | null) => void;
}) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNotes(lead?.notes ?? "");
  }, [lead?.id, lead?.notes]);

  if (!lead) return <Dialog open={false} onOpenChange={() => undefined}><DialogContent className="hidden" /></Dialog>;

  async function patch(body: { status?: LeadStatus; notes?: string }, message: string) {
    if (!lead) return;
    setBusy(true);
    try {
      const row = await api.patch<LeadRow | undefined>(`/storefront-admin/leads/${lead.id}`, body, auth);
      // The API may answer with the updated row or with nothing; either way keep the dialog honest.
      onChanged(row && "id" in row ? row : { ...lead, ...body }, message);
    } catch (err) {
      setError(errorText(err, "Could not update that lead."));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!lead || !window.confirm(`Delete this lead from ${lead.name ?? lead.email ?? lead.phone ?? "an anonymous visitor"}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api.delete(`/storefront-admin/leads/${lead.id}`, auth);
      onDeleted("Lead deleted.");
    } catch (err) {
      setError(errorText(err, "Could not delete that lead."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{lead.name ?? lead.email ?? lead.phone ?? "Lead"}</DialogTitle></DialogHeader>
        {error && <Notice kind="error" message={error} onClose={clearError} />}
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{lead.formName} · received {when(lead.createdAt)}</p>

          <div className="flex flex-wrap gap-2">
            {lead.phone && <a href={`tel:${lead.phone.replace(/\s/g, "")}`}><Button type="button" size="sm" variant="outline"><Phone className="h-4 w-4" /> Call</Button></a>}
            {lead.phone && <a href={waLink(lead.phone)} target="_blank" rel="noopener noreferrer"><Button type="button" size="sm" variant="outline"><MessageCircle className="h-4 w-4" /> WhatsApp</Button></a>}
            {lead.email && <a href={`mailto:${lead.email}`}><Button type="button" size="sm" variant="outline"><Mail className="h-4 w-4" /> Email</Button></a>}
          </div>

          <dl className="divide-y divide-border rounded-xl border border-border text-xs">
            {lead.answers.map((a, i) => (
              <div key={i} className="grid gap-1 px-3 py-2 sm:grid-cols-[10rem_1fr]">
                <dt className="font-medium text-muted-foreground">{a.label}</dt>
                <dd className="whitespace-pre-wrap break-words text-foreground">{a.value || "—"}</dd>
              </div>
            ))}
            {lead.answers.length === 0 && <div className="px-3 py-2 text-muted-foreground">No answers were recorded.</div>}
          </dl>

          {(lead.source.productName || lead.source.path) && (
            <div className="rounded-xl border border-border p-3 text-xs">
              <div className="font-medium text-muted-foreground">Came from</div>
              {lead.source.productName && <div className="mt-1 text-foreground">{lead.source.productName}{lead.source.productSku && <span className="ml-2 font-mono text-muted-foreground">{lead.source.productSku}</span>}</div>}
              {lead.source.path && <div className="mt-0.5 font-mono text-muted-foreground">{lead.source.path}</div>}
            </div>
          )}

          <fieldset disabled={!mayWrite || busy} className="space-y-3">
            <Field label="Status">
              <SelectField size="sm" label="Lead status" value={lead.status} onValueChange={(v) => void patch({ status: v as LeadStatus }, `Marked ${LEAD_STATUS_LABELS[v as LeadStatus].toLowerCase()}.`)} options={LEAD_STATUSES.map((s) => ({ value: s, label: LEAD_STATUS_LABELS[s] }))} />
            </Field>
            <Field label="Notes" hint="Only your team sees these.">
              <textarea rows={4} maxLength={4000} className={textareaClass} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="button" size="sm" disabled={notes === lead.notes} onClick={() => void patch({ notes }, "Notes saved.")}>Save notes</Button>
            </div>
          </fieldset>
        </div>
        <DialogFooter>
          {mayWrite && <Button type="button" variant="outline" className="mr-auto text-destructive" disabled={busy} onClick={() => void remove()}><Trash2 className="h-4 w-4" /> Delete</Button>}
          <Button type="button" variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
