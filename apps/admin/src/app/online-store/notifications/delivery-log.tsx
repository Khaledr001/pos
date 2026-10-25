"use client";

import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, RotateCw } from "lucide-react";
import {
  NOTIFICATION_CHANNELS,
  ANY_EVENT_LABELS,
  NOTIFICATION_STATUSES,
  type NotificationLogPage,
  type NotificationLogRow,
  type NotificationStatus,
} from "@devsfleet/shared-types";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField } from "@/components/ui/select";
import { Table, TableBody, TableContainer, TableEmpty, TableHead, TablePagination, Th } from "@/components/ui/data-table";
import { Mail } from "lucide-react";
import { Notice, errorText } from "../shared";

const PAGE_SIZE = 25;

const TONE: Record<NotificationStatus, "success" | "warning" | "destructive" | "secondary"> = {
  sent: "success",
  queued: "warning",
  sending: "warning",
  failed: "destructive",
  skipped: "secondary",
};

/** "sara@gmail.com" -> "s***@gmail.com", "+971501234567" -> "+971•••••4567": enough to recognise, not to harvest. */
export function maskRecipient(value: string): string {
  const at = value.indexOf("@");
  if (at > 0) return `${value[0]}***${value.slice(at)}`;
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 6) return "•••";
  return `${value.startsWith("+") ? "+" : ""}${digits.slice(0, 3)}•••••${digits.slice(-4)}`;
}

export function DeliveryLog({ auth, mayWrite }: { auth: { accessToken: string | undefined }; mayWrite: boolean }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [data, setData] = useState<NotificationLogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page) });
      if (status) qs.set("status", status);
      if (channel) qs.set("channel", channel);
      setData(await api.get<NotificationLogPage>(`/storefront-admin/notifications/log?${qs}`, auth));
    } catch (err) {
      setError(errorText(err, "Failed to load the delivery log."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, status, channel, auth.accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = async (row: NotificationLogRow) => {
    setRetrying(row.id);
    try {
      await api.post<{ queued: true }>(`/storefront-admin/notifications/log/${row.id}/retry`, {}, auth);
      setData((d) => (d ? { ...d, items: d.items.map((r) => (r.id === row.id ? { ...r, status: "queued", error: null } : r)) } : d));
    } catch (err) {
      setError(errorText(err, "Could not retry that message."));
    } finally {
      setRetrying(null);
    }
  };

  const items = data?.items ?? [];

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
        <div>
          <h2 className="text-sm font-semibold">Delivery log</h2>
          <p className="mt-1 text-xs text-muted-foreground">Every message the shop tried to send, and why one was skipped or failed.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-36">
            <SelectField size="sm" label="Status" value={status} onValueChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "", label: "All statuses" }, ...NOTIFICATION_STATUSES.map((s) => ({ value: s, label: s }))]} />
          </div>
          <div className="w-36">
            <SelectField size="sm" label="Channel" value={channel} onValueChange={(v) => { setChannel(v); setPage(1); }} options={[{ value: "", label: "All channels" }, ...NOTIFICATION_CHANNELS.map((c) => ({ value: c, label: c }))]} />
          </div>
          <Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh</Button>
        </div>
      </div>
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
      <TableContainer>
        <Table>
          <TableHead>
            <tr>
              <Th>When</Th>
              <Th>Event</Th>
              <Th>Channel</Th>
              <Th>Recipient</Th>
              <Th>About</Th>
              <Th>Status</Th>
              <Th align="right">Tries</Th>
              <Th>Detail</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </tr>
          </TableHead>
          <TableBody columns={9} loading={loading && items.length === 0} empty={<TableEmpty columns={9} icon={Mail} title="No messages yet" />}>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-border/60 text-xs last:border-0">
                <td className="whitespace-nowrap px-4 py-2.5">{new Date(r.sentAt ?? r.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2.5">{ANY_EVENT_LABELS[r.event] ?? r.event}</td>
                <td className="px-4 py-2.5 capitalize">{r.channel}</td>
                <td className="px-4 py-2.5 font-mono">{maskRecipient(r.recipient)}</td>
                <td className="px-4 py-2.5">{r.subject}</td>
                <td className="px-4 py-2.5"><Badge variant={TONE[r.status]}>{r.status}</Badge></td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{r.attempts}</td>
                <td className="max-w-64 px-4 py-2.5 text-muted-foreground">{r.error ?? ""}</td>
                <td className="px-4 py-2.5 text-right">
                  {mayWrite && (r.status === "failed" || r.status === "skipped") && (
                    <Button type="button" size="sm" variant="outline" disabled={retrying === r.id} onClick={() => void retry(r)}><RotateCw className="h-3.5 w-3.5" /> Retry</Button>
                  )}
                </td>
              </tr>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} noun="messages" />
    </Card>
  );
}
