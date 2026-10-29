"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Download, FileCheck2, RotateCw, Send, XCircle } from "lucide-react";
import {
  EINVOICE_STATUSES,
  EINVOICE_STATUS_LABELS,
  type EinvoiceDocType,
  type EinvoiceDocumentDetail,
  type EinvoiceDocumentPage,
  type EinvoiceDocumentRow,
  type EinvoiceStatus,
} from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api, apiDownload, saveBlob } from "@/lib/api-client";
import { fixLinkFor } from "@/lib/einvoice";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { EinvoiceStatusBadge } from "@/components/einvoice/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select";
import { MobileEmpty, MobileList, MobileRow, listCard } from "@/components/ui/mobile-list";
import { Table, TableBody, TableContainer, TableEmpty, TableHead, TablePagination, TableSearch, Th } from "@/components/ui/data-table";
import { Loading, Notice, PageHeader, errorText } from "@/app/online-store/shared";

const PAGE_SIZE = 25;
/** Rejections beyond this many earn a banner: one bad customer is routine, a pile is a pattern. */
const MANY_REJECTED = 5;
const POLL_MS = 30_000;

const EMPTY_COUNTS = Object.fromEntries(EINVOICE_STATUSES.map((s) => [s, 0])) as Record<EinvoiceStatus, number>;
const TYPE_LABEL: Record<EinvoiceDocType, string> = { invoice: "Invoice", credit_note: "Credit note" };
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "—");

export default function EinvoiceRegisterPage() {
  // useSearchParams needs a Suspense boundary or the production build fails.
  return (
    <Suspense fallback={<Loading label="Loading e-invoices…" />}>
      <Register />
    </Suspense>
  );
}

function Register() {
  const { tokens } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const auth = useMemo(() => ({ accessToken: tokens?.accessToken }), [tokens]);

  const [status, setStatus] = useState<EinvoiceStatus | "">("");
  const [type, setType] = useState<EinvoiceDocType | "">("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EinvoiceDocumentPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get("doc"));

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        setData(
          await api.get<EinvoiceDocumentPage>("/einvoice/documents", {
            ...auth,
            query: { page, pageSize: PAGE_SIZE, status: status || undefined, type: type || undefined, q: query || undefined },
          }),
        );
        setError(null);
      } catch (err) {
        if (!quiet) setError(errorText(err, "Failed to load e-invoices."));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [auth, page, status, type, query],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const counts = data?.counts ?? EMPTY_COUNTS;
  const inFlight = (counts.queued ?? 0) + (counts.submitting ?? 0) > 0;

  // Refresh while something is waiting or being sent — and only while the tab
  // is in front, so a forgotten tab does not poll the API all night.
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [inFlight, load]);

  const totalAll = EINVOICE_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0);
  const items = data?.items ?? [];
  const filtered = !!(status || type || query);
  const emptyTitle = filtered ? "No e-invoices match" : "No e-invoices yet";
  const emptyText = filtered
    ? "Try another filter."
    : "Invoices and credit notes to business customers appear here once e-invoicing is on.";

  const tab = (value: EinvoiceStatus | "", label: string, n: number) => (
    <button
      key={value || "all"}
      type="button"
      aria-pressed={status === value}
      onClick={() => {
        setStatus(value);
        setPage(1);
      }}
      className={cn(
        "cursor-pointer rounded-full border px-3 py-1 text-xs",
        status === value ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent",
      )}
    >
      {label} <span className="ml-1 font-mono tabular-nums opacity-80">{n}</span>
    </button>
  );

  function open(id: string) {
    setOpenId(id);
  }
  function close() {
    setOpenId(null);
    if (params.get("doc")) router.replace("/einvoicing");
  }

  return (
    <div className="space-y-6">
      <PageHeader title="E-invoices" description="Tax invoices and credit notes reported to the UAE e-invoicing network.">
        <Link href="/settings/einvoicing"><Button size="sm" variant="outline">E-invoicing settings</Button></Link>
      </PageHeader>

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}

      {(counts.rejected ?? 0) >= MANY_REJECTED && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {counts.rejected} documents were rejected. Open each one, fix what its issue list says (usually a customer&rsquo;s TRN or address), then retry.
          </span>
          <Button size="sm" variant="outline" onClick={() => { setStatus("rejected"); setPage(1); }}>Show rejected</Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="E-invoice status">
        {tab("", "All", totalAll)}
        {EINVOICE_STATUSES.map((s) => tab(s, EINVOICE_STATUS_LABELS[s], counts[s] ?? 0))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <TableSearch value={search} onChange={setSearch} label="Search e-invoices" placeholder="Search number or buyer…" className="w-full sm:w-72" />
        <div className="w-full sm:w-48">
          <SelectField
            size="sm"
            label="Filter by type"
            value={type}
            onValueChange={(v) => { setType(v as EinvoiceDocType | ""); setPage(1); }}
            options={[
              { value: "", label: "Invoices and credit notes" },
              { value: "invoice", label: "Invoices" },
              { value: "credit_note", label: "Credit notes" },
            ]}
          />
        </div>
      </div>

      {loading && !data ? (
        <Loading label="Loading e-invoices…" />
      ) : (
        <>
          <MobileList loading={false} empty={<MobileEmpty icon={FileCheck2} title={emptyTitle} description={emptyText} />}>
            {items.map((d) => (
              <MobileRow
                key={d.id}
                title={d.documentNumber}
                subtitle={`${TYPE_LABEL[d.docType]} · ${d.buyerName ?? "No buyer name"}`}
                badge={<EinvoiceStatusBadge status={d.status} />}
                fields={[
                  { label: "Total", value: formatMoney(d.total, { currency: d.currency }), numeric: true },
                  { label: "Issued", value: when(d.issuedAt) },
                  { label: "Attempts", value: String(d.attempts), numeric: true },
                  ...(d.lastError ? [{ label: "Last error", value: d.lastError }] : []),
                ]}
                actions={<Button variant="outline" size="sm" onClick={() => open(d.id)}>Open</Button>}
              />
            ))}
          </MobileList>

          <Card className={cn(listCard, "hidden md:block")}>
            <TableContainer>
              <Table>
                <TableHead>
                  <tr>
                    <Th>Number</Th>
                    <Th>Type</Th>
                    <Th>Buyer</Th>
                    <Th align="right">Total</Th>
                    <Th>Status</Th>
                    <Th>Issued</Th>
                    <Th align="right">Tries</Th>
                    <Th>Last error</Th>
                  </tr>
                </TableHead>
                <TableBody columns={8} loading={false} empty={<TableEmpty columns={8} icon={FileCheck2} title={emptyTitle} description={emptyText} />}>
                  {items.map((d) => (
                    <Row key={d.id} d={d} onOpen={() => open(d.id)} />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
          <TablePagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} noun="e-invoices" />
        </>
      )}

      {openId && (
        <DocumentDialog
          id={openId}
          auth={auth}
          onClose={close}
          onChanged={(message) => {
            if (message) setSuccess(message);
            void load(true);
          }}
        />
      )}
    </div>
  );
}

function Row({ d, onOpen }: { d: EinvoiceDocumentRow; onOpen: () => void }) {
  return (
    <tr
      className="cursor-pointer hover:bg-secondary/30"
      tabIndex={0}
      role="link"
      aria-label={`Open e-invoice ${d.documentNumber}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <td className="whitespace-nowrap px-4 py-3.5 font-mono font-semibold text-primary">{d.documentNumber}</td>
      <td className="px-4 py-3.5">
        {d.docType === "credit_note" ? <Badge variant="warning" className="text-[10px]">Credit note</Badge> : <span className="text-muted-foreground">Invoice</span>}
      </td>
      <td className="max-w-48 truncate px-4 py-3.5 text-foreground" title={d.buyerName ?? undefined}>{d.buyerName ?? "—"}</td>
      <td className="whitespace-nowrap px-4 py-3.5 text-right font-mono tabular-nums">{formatMoney(d.total, { currency: d.currency })}</td>
      <td className="px-4 py-3.5"><EinvoiceStatusBadge status={d.status} /></td>
      <td className="whitespace-nowrap px-4 py-3.5 text-muted-foreground">{when(d.issuedAt)}</td>
      <td className="px-4 py-3.5 text-right font-mono tabular-nums text-muted-foreground">{d.attempts}</td>
      <td className="max-w-56 truncate px-4 py-3.5 text-muted-foreground" title={d.lastError ?? undefined}>{d.lastError ?? "—"}</td>
    </tr>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-xs text-foreground">{children}</dd>
    </div>
  );
}

function DocumentDialog({
  id,
  auth,
  onClose,
  onChanged,
}: {
  id: string;
  auth: { accessToken: string | undefined };
  onClose: () => void;
  onChanged: (message?: string) => void;
}) {
  const [doc, setDoc] = useState<EinvoiceDocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"retry" | "send" | "xml" | null>(null);

  const load = useCallback(async () => {
    try {
      setDoc(await api.get<EinvoiceDocumentDetail>(`/einvoice/documents/${id}`, auth));
      setError(null);
    } catch (err) {
      setError(errorText(err, "Failed to load that e-invoice."));
    } finally {
      setLoading(false);
    }
  }, [id, auth]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function act(kind: "retry" | "send") {
    if (!doc) return;
    if (
      kind === "send" &&
      !window.confirm(`Send ${doc.documentNumber} now? Once it has been sent it cannot be edited or voided — only corrected with a credit note.`)
    ) {
      return;
    }
    setBusy(kind);
    setError(null);
    try {
      await api.post(`/einvoice/documents/${id}/${kind}`, {}, auth);
      onChanged(kind === "retry" ? `${doc.documentNumber} queued to retry.` : `${doc.documentNumber} is being sent.`);
      await load();
    } catch (err) {
      setError(errorText(err, kind === "retry" ? "The retry was refused." : "It could not be sent."));
    } finally {
      setBusy(null);
    }
  }

  async function downloadXml() {
    if (!doc) return;
    setBusy("xml");
    setError(null);
    try {
      const { blob, filename } = await apiDownload(`/einvoice/documents/${id}/xml`, auth);
      saveBlob(blob, filename ?? `${doc.documentNumber}.xml`);
    } catch (err) {
      setError(errorText(err, "The XML could not be downloaded."));
    } finally {
      setBusy(null);
    }
  }

  const canRetry = doc?.status === "rejected" || doc?.status === "failed";
  const canSend = doc?.status === "queued";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 font-mono">
            {doc?.documentNumber ?? "E-invoice"}
            {doc && <EinvoiceStatusBadge status={doc.status} />}
          </DialogTitle>
          <DialogDescription>{doc ? `${TYPE_LABEL[doc.docType]} · ${doc.buyerName ?? "No buyer name"}` : "Loading…"}</DialogDescription>
        </DialogHeader>

        {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}

        {loading && !doc ? (
          <Loading label="Loading…" />
        ) : doc ? (
          <div className="space-y-5">
            <dl className="grid gap-3 sm:grid-cols-3">
              <Fact label="Total">{formatMoney(doc.total, { currency: doc.currency })}</Fact>
              <Fact label="Issued">{when(doc.issuedAt)}</Fact>
              <Fact label="Attempts">{doc.attempts}</Fact>
              <Fact label="Submitted">{when(doc.submittedAt)}</Fact>
              <Fact label="Delivered">{when(doc.deliveredAt)}</Fact>
              <Fact label="PINT AE version">{doc.pintVersion ?? "—"}</Fact>
              <Fact label="Unique identifier"><span className="font-mono text-[11px]">{doc.uuid}</span></Fact>
              <Fact label="Provider reference"><span className="font-mono text-[11px]">{doc.providerRef ?? "—"}</span></Fact>
              <Fact label="XML hash (SHA-256)"><span className="font-mono text-[11px]">{doc.xmlSha256 ?? "not built yet"}</span></Fact>
            </dl>

            <section aria-labelledby="ei-issues">
              <h3 id="ei-issues" className="text-xs font-semibold text-foreground">Issues</h3>
              {doc.issues.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {doc.lastError ? <>No validation issues. Last error: {doc.lastError}</> : "No issues found."}
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-border rounded-xl border border-border text-xs">
                  {doc.issues.map((issue, i) => {
                    const fix = fixLinkFor(issue.field);
                    return (
                      <li key={`${issue.code}-${i}`} className="flex items-start gap-2.5 px-3 py-2.5">
                        {issue.severity === "error" ? (
                          <XCircle aria-label="Error" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        ) : (
                          <AlertTriangle aria-label="Warning" className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground">{issue.message}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{issue.code}{issue.field ? ` · ${issue.field}` : ""}</p>
                        </div>
                        {fix && (
                          <Link href={fix.href} className="shrink-0 text-primary underline-offset-2 hover:underline">Fix in {fix.label}</Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="ei-events">
              <h3 id="ei-events" className="text-xs font-semibold text-foreground">History</h3>
              {doc.events.length === 0 ? (
                <p className="mt-1.5 text-xs text-muted-foreground">Nothing has happened yet.</p>
              ) : (
                <ol className="mt-2 space-y-2 border-l border-border pl-4 text-xs">
                  {doc.events.map((e, i) => (
                    <li key={`${e.at}-${i}`} className="relative">
                      <span aria-hidden className="absolute -left-[1.3rem] top-1 h-2 w-2 rounded-full bg-primary" />
                      <div className="flex flex-wrap items-center gap-2">
                        <EinvoiceStatusBadge status={e.status} className="text-[10px]" />
                        <span className="text-muted-foreground">{when(e.at)}</span>
                      </div>
                      <p className="mt-0.5 text-foreground">{e.message}</p>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" disabled={!doc?.xmlSha256 || busy !== null} onClick={() => void downloadXml()} title={doc?.xmlSha256 ? undefined : "The XML has not been built yet"}>
            <Download className="h-4 w-4" /> {busy === "xml" ? "Downloading…" : "Download XML"}
          </Button>
          <div className="flex flex-wrap gap-2">
            {canRetry && (
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void act("retry")}>
                <RotateCw className="h-4 w-4" /> {busy === "retry" ? "Retrying…" : "Retry"}
              </Button>
            )}
            {canSend && (
              <Button type="button" disabled={busy !== null} onClick={() => void act("send")}>
                <Send className="h-4 w-4" /> {busy === "send" ? "Sending…" : "Send now"}
              </Button>
            )}
            <Button type="button" variant="outline" onClick={onClose}>Close</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
