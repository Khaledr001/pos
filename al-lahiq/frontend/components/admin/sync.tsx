"use client";

import type { InboundEvent, InboundStatus, OutboxEvent, OutboxStatus, SyncRun, SyncStatus } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { useAdminQuery, useInvalidate } from "./data";
import { prettyJson } from "./helpers";
import { useToast } from "./toast";
import { DataTable, ErrorState, FilterTabs, Loading, Notice, num, PageHeader, Panel } from "./ui";

const OUTBOX_STATUS: Record<OutboxStatus, { label: string; tone: "neutral" | "pipe" | "brass" | "signal"; hint: string }> = {
  PENDING: { label: "Waiting to send", tone: "brass", hint: "Orders and updates waiting to be sent to the POS" },
  FAILED: { label: "Failed, retrying", tone: "brass", hint: "Couldn't reach the POS; the website tries again automatically" },
  DEAD: { label: "Gave up", tone: "signal", hint: "Failed too many times. Check the error, then retry" },
  SENT: { label: "Sent", tone: "pipe", hint: "Delivered to the POS" },
};

const INBOUND_STATUS: Record<InboundStatus, { label: string; tone: "neutral" | "pipe" | "brass" | "signal" }> = {
  RECEIVED: { label: "Being applied", tone: "brass" },
  PROCESSED: { label: "Applied", tone: "pipe" },
  SKIPPED: { label: "Skipped", tone: "neutral" },
  FAILED: { label: "Failed", tone: "signal" },
};

const EVENT_LABEL: Record<string, string> = {
  "order.created": "New order",
  "order.status_changed": "Order status change",
  "order.cancelled": "Order cancelled",
  "refund.created": "Refund",
  "customer.trade_requested": "Trade account application",
  "stock.updated": "Stock update",
  "product.upsert": "Product update",
  "price_list.upserted": "Price list update",
  "price_items.changed": "Price change",
  "customer_price_list.assigned": "Customer price list assigned",
};

const eventLabel = (type: string) => EVENT_LABEL[type] ?? type;

function relative(iso: string | null, now: number) {
  if (!iso) return "never";
  const mins = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function SyncView() {
  const toast = useToast();
  const invalidate = useInvalidate();
  const [resyncAt, setResyncAt] = useState<number | null>(null);

  const status = useAdminQuery<SyncStatus>("/admin/sync/status", undefined, {
    refetchInterval: (q) => {
      if (!resyncAt) return false;
      const latest = q.state.data?.reconciliation.find((r) => new Date(r.startedAt).getTime() >= resyncAt - 15_000);
      if (latest && latest.status !== "RUNNING") return false;
      if (Date.now() - resyncAt > 180_000) return false;
      return 2500;
    },
  });

  const resync = useMutation({
    mutationFn: () => adminApi.post("/admin/sync/reconcile"),
    onSuccess: () => {
      setResyncAt(Date.now());
      toast("Resync started. It runs in the background and can take a few minutes.");
      setTimeout(() => void status.refetch(), 800);
    },
  });

  const data = status.data;
  const now = status.dataUpdatedAt;
  const latestRun = resyncAt && data ? data.reconciliation.find((r) => new Date(r.startedAt).getTime() >= resyncAt - 15_000) : undefined;
  const running = !!data?.reconciliation.some((r) => r.status === "RUNNING") || (!!resyncAt && (!latestRun || latestRun.status === "RUNNING") && now - resyncAt < 180_000);

  // When a resync finishes, refresh the event tables once.
  const finishedRunId = latestRun && latestRun.status !== "RUNNING" ? latestRun.id : null;
  useEffect(() => {
    if (finishedRunId) void invalidate("/admin/sync/outbox", "/admin/sync/inbound");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per finished resync
  }, [finishedRunId]);

  return (
    <>
      <PageHeader
        title="POS connection"
        description="The POS is the master for products, prices, stock and trade price lists. It sends changes here as they happen, and the website sends new orders back. This page shows whether that is working."
        actions={
          <>
            <Button variant="secondary" onClick={() => void invalidate("/admin/sync/status", "/admin/sync/outbox", "/admin/sync/inbound")}>
              Refresh
            </Button>
            <Button onClick={() => resync.mutate()} loading={resync.isPending || running} disabled={running}>
              {!(resync.isPending || running) && <RefreshCw className="size-4" aria-hidden />}
              {running ? "Resync running" : "Resync now"}
            </Button>
          </>
        }
      />
      {resync.error && <ErrorState error={resync.error} />}
      {status.error ? (
        <ErrorState error={status.error} onRetry={() => status.refetch()} />
      ) : !data ? (
        <Loading label="Checking the POS connection" />
      ) : (
        <div className="flex flex-col gap-4">
          <Health data={data} now={now} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="From the website to the POS" description="New orders, status changes and refunds the POS needs to know about.">
              <CountGrid
                items={(Object.keys(OUTBOX_STATUS) as OutboxStatus[]).map((s) => ({
                  label: OUTBOX_STATUS[s].hint,
                  value: data.outbox[s] ?? 0,
                  tone: s === "DEAD" && data.outbox[s] ? "signal" : s === "FAILED" && data.outbox[s] ? "brass" : "neutral",
                }))}
              />
            </Panel>
            <Panel title="From the POS to the website, last 24 hours" description="Stock, price and product updates received.">
              <CountGrid
                items={[
                  { label: "Applied to the shop", value: data.inboundLast24h.PROCESSED ?? 0, tone: "neutral" },
                  { label: "Skipped (already up to date)", value: data.inboundLast24h.SKIPPED ?? 0, tone: "neutral" },
                  { label: "Failed to apply", value: data.inboundLast24h.FAILED ?? 0, tone: data.inboundLast24h.FAILED ? "signal" : "neutral" },
                  { label: "Being applied now", value: data.inboundLast24h.RECEIVED ?? 0, tone: "neutral" },
                ]}
              />
            </Panel>
          </div>
          {data.recentInboundFailures.length > 0 && <InboundFailures failures={data.recentInboundFailures} />}
          <Runs runs={data.reconciliation} />
          <OutboxTable />
          <InboundTable />
        </div>
      )}
    </>
  );
}

function Health({ data, now }: { data: SyncStatus; now: number }) {
  const ageMin = data.lastEventAt ? (now - new Date(data.lastEventAt).getTime()) / 60_000 : Infinity;
  const stuck = (data.outbox.DEAD ?? 0) > 0;
  const retrying = data.outbox.FAILED ?? 0;
  const waiting = (data.outbox.PENDING ?? 0) + retrying;
  const tone = stuck ? "danger" : ageMin > 24 * 60 || retrying > 0 ? "warning" : "success";
  const title = stuck
    ? "Some orders or updates couldn't be sent to the POS"
    : ageMin === Infinity
      ? "No updates received from the POS yet"
      : ageMin > 24 * 60
        ? "No updates from the POS for over a day"
        : "The POS connection looks healthy";
  return (
    <Notice tone={tone} title={title}>
      Last update received from the POS: <strong>{relative(data.lastEventAt, now)}</strong>
      {data.lastEventAt && ` (${formatDateTime(data.lastEventAt)})`}.{" "}
      {stuck
        ? "Check the errors under “Sent to the POS” below, fix the cause, then press Retry."
        : ageMin > 24 * 60
          ? "If stock or prices look out of date, check the POS is online and press “Resync now”."
          : "Stock and prices update automatically."}
      {waiting > 0 && (
        <>
          {" "}
          {waiting === 1 ? "1 order or update is" : `${waiting} orders or updates are`} waiting to be sent to the POS
          {retrying > 0 ? ", and some couldn't reach it yet. The website keeps trying." : "."}
        </>
      )}
    </Notice>
  );
}

function CountGrid({ items }: { items: { label: string; value: number; tone: "neutral" | "brass" | "signal" }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3">
      {items.map((i) => (
        <div
          key={i.label}
          className={cn(
            "rounded-[var(--radius-tag)] border px-3 py-2",
            i.tone === "signal" ? "border-signal/30 bg-signal-tint" : i.tone === "brass" ? "border-brass/40 bg-brass-tint" : "border-galv bg-sheet/60",
          )}
        >
          <dt className="text-[13px] leading-snug text-steel">{i.label}</dt>
          <dd className="font-cond text-[26px] font-bold leading-tight tabular-nums">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RetryButton({ path, label, onDone }: { path: string; label: string; onDone?: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const retry = useMutation({
    mutationFn: () => adminApi.post(path),
    onSuccess: () => {
      toast("Queued to try again");
      void invalidate("/admin/sync/status", "/admin/sync/outbox", "/admin/sync/inbound");
      onDone?.();
    },
    onError: (err) => toast(errorMessage(err), "error"),
  });
  return (
    <Button size="sm" variant="secondary" onClick={() => retry.mutate()} loading={retry.isPending} aria-label={label}>
      Retry
    </Button>
  );
}

function Payload({ value }: { value: unknown }) {
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer text-steel hover:text-ink">Show details</summary>
      <pre className="mt-1 max-h-72 max-w-xl overflow-auto rounded-[var(--radius-tag)] bg-ink p-2 font-mono text-[12px] leading-relaxed text-white/90">
        {prettyJson(value)}
      </pre>
    </details>
  );
}

function InboundFailures({ failures }: { failures: SyncStatus["recentInboundFailures"] }) {
  return (
    <Panel title="Updates from the POS that failed" description="The shop may show old stock or prices for these until they are applied." flush className="border-signal/30">
      <DataTable minWidth={680}>
        <thead>
          <tr>
            <th scope="col">Update</th>
            <th scope="col">Error</th>
            <th scope="col" className="!text-right">
              Tries
            </th>
            <th scope="col">Received</th>
            <th scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {failures.map((f) => (
            <tr key={f.id}>
              <th scope="row">
                <p className="font-medium">{eventLabel(f.type)}</p>
                <p className="font-mono text-[12px] text-steel">{f.eventId}</p>
              </th>
              <td className="max-w-80 text-[13px] text-signal">{f.error ?? "Unknown error"}</td>
              <td className={num}>{f.attempts}</td>
              <td className="whitespace-nowrap">{formatDateTime(f.receivedAt)}</td>
              <td>
                <RetryButton path={`/admin/sync/inbound/${f.id}/retry`} label={`Retry ${eventLabel(f.type)} ${f.eventId}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Panel>
  );
}

function summaryLines(summary: unknown): ReactNode[] {
  if (!summary || typeof summary !== "object") return [];
  return Object.entries(summary as Record<string, unknown>).map(([k, v]) => {
    const label = k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
    const cap = label.charAt(0).toUpperCase() + label.slice(1);
    const text =
      v && typeof v === "object"
        ? Object.entries(v as Record<string, unknown>)
            .map(([kk, vv]) => `${String(vv)} ${kk.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}`)
            .join(", ")
        : String(v);
    return (
      <div key={k} className="contents">
        <dt className="text-steel">{cap}</dt>
        <dd>{text}</dd>
      </div>
    );
  });
}

const RUN_STATUS: Record<SyncRun["status"], { label: string; tone: "brass" | "pipe" | "signal" }> = {
  RUNNING: { label: "Running", tone: "brass" },
  SUCCEEDED: { label: "Finished", tone: "pipe" },
  FAILED: { label: "Failed", tone: "signal" },
};

function Runs({ runs }: { runs: SyncRun[] }) {
  return (
    <Panel
      title="Full resyncs"
      description="A full resync compares every product, price and stock level with the POS and fixes anything that was missed. It runs every night, or when you press “Resync now”."
      flush
    >
      {runs.length ? (
        <DataTable minWidth={640}>
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Started</th>
              <th scope="col">Finished</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>
                  <Badge tone={RUN_STATUS[r.status].tone}>{RUN_STATUS[r.status].label}</Badge>
                </td>
                <td className="whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
                <td className="whitespace-nowrap">{r.finishedAt ? formatDateTime(r.finishedAt) : "Still running"}</td>
                <td className="text-[13px]">
                  {r.error && <p className="mb-1 text-signal">{r.error}</p>}
                  {summaryLines(r.summary).length > 0 ? (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">{summaryLines(r.summary)}</dl>
                  ) : (
                    !r.error && <span className="text-steel">No details</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <p className="p-4 text-sm text-steel">No resync has run yet. Press “Resync now” to run the first one.</p>
      )}
    </Panel>
  );
}

function OutboxTable() {
  const [status, setStatus] = useState<OutboxStatus | "">("");
  const { data, error, isPending, refetch } = useAdminQuery<OutboxEvent[]>("/admin/sync/outbox", { status });
  return (
    <Panel title="Sent to the POS" description="The latest 100 messages from the website to the POS." flush>
      <div className="px-3 pt-1">
        <FilterTabs
          label="Message status"
          value={status}
          onChange={setStatus}
          items={[
            { value: "", label: "All" },
            { value: "PENDING", label: "Waiting to send" },
            { value: "FAILED", label: "Failed, retrying" },
            { value: "DEAD", label: "Gave up" },
            { value: "SENT", label: "Sent" },
          ]}
        />
      </div>
      {error ? (
        <div className="p-3">
          <ErrorState error={error} onRetry={() => refetch()} />
        </div>
      ) : isPending ? (
        <Loading />
      ) : !data.length ? (
        <p className="border-t border-galv p-4 text-sm text-steel">Nothing here.</p>
      ) : (
        <div className="border-t border-galv">
          <DataTable minWidth={880}>
            <thead>
              <tr>
                <th scope="col">Message</th>
                <th scope="col">Status</th>
                <th scope="col" className="!text-right">
                  Tries
                </th>
                <th scope="col">Last error</th>
                <th scope="col">Created</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => {
                const orderNumber = (e.payload as { orderNumber?: string } | null)?.orderNumber;
                return (
                  <tr key={e.id}>
                    <th scope="row">
                      <p className="font-medium">
                        {eventLabel(e.type)}
                        {orderNumber && <span className="font-cond text-[15px] font-semibold"> {orderNumber}</span>}
                      </p>
                      <Payload value={e.payload} />
                    </th>
                    <td>
                      <Badge tone={OUTBOX_STATUS[e.status].tone}>{OUTBOX_STATUS[e.status].label}</Badge>
                      {e.status === "SENT" && e.sentAt && <p className="mt-0.5 text-[12px] text-steel">{formatDateTime(e.sentAt)}</p>}
                      {(e.status === "PENDING" || e.status === "FAILED") && (
                        <p className="mt-0.5 text-[12px] text-steel">Next try {formatDateTime(e.nextAttemptAt)}</p>
                      )}
                    </td>
                    <td className={num}>{e.attempts}</td>
                    <td className="max-w-72 text-[13px] text-signal">{e.lastError ?? <span className="text-steel-light">None</span>}</td>
                    <td className="whitespace-nowrap">{formatDateTime(e.createdAt)}</td>
                    <td>
                      {(e.status === "DEAD" || e.status === "FAILED") && (
                        <RetryButton path={`/admin/sync/outbox/${e.id}/retry`} label={`Retry ${eventLabel(e.type)}${orderNumber ? ` ${orderNumber}` : ""}`} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </div>
      )}
    </Panel>
  );
}

function InboundTable() {
  const [status, setStatus] = useState<InboundStatus | "">("");
  const { data, error, isPending, refetch } = useAdminQuery<InboundEvent[]>("/admin/sync/inbound", { status });
  return (
    <Panel title="Received from the POS" description="The latest 100 updates the POS sent to the website." flush>
      <div className="px-3 pt-1">
        <FilterTabs
          label="Update status"
          value={status}
          onChange={setStatus}
          items={[
            { value: "", label: "All" },
            { value: "PROCESSED", label: "Applied" },
            { value: "SKIPPED", label: "Skipped" },
            { value: "FAILED", label: "Failed" },
            { value: "RECEIVED", label: "Being applied" },
          ]}
        />
      </div>
      {error ? (
        <div className="p-3">
          <ErrorState error={error} onRetry={() => refetch()} />
        </div>
      ) : isPending ? (
        <Loading />
      ) : !data.length ? (
        <p className="border-t border-galv p-4 text-sm text-steel">Nothing here.</p>
      ) : (
        <div className="border-t border-galv">
          <DataTable minWidth={820}>
            <thead>
              <tr>
                <th scope="col">Update</th>
                <th scope="col">Status</th>
                <th scope="col" className="!text-right">
                  Tries
                </th>
                <th scope="col">Error</th>
                <th scope="col">Received</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((e) => (
                <tr key={e.id}>
                  <th scope="row">
                    <p className="font-medium">{eventLabel(e.type)}</p>
                    <p className="font-mono text-[12px] text-steel">{e.eventId}</p>
                    <Payload value={e.payload} />
                  </th>
                  <td>
                    <Badge tone={INBOUND_STATUS[e.status].tone}>{INBOUND_STATUS[e.status].label}</Badge>
                  </td>
                  <td className={num}>{e.attempts}</td>
                  <td className="max-w-72 text-[13px] text-signal">{e.error ?? <span className="text-steel-light">None</span>}</td>
                  <td className="whitespace-nowrap">{formatDateTime(e.receivedAt)}</td>
                  <td>{e.status === "FAILED" && <RetryButton path={`/admin/sync/inbound/${e.id}/retry`} label={`Retry ${eventLabel(e.type)} ${e.eventId}`} />}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      )}
    </Panel>
  );
}
