"use client";

import React, { useEffect, useState, useCallback } from "react";
import { ScrollText, RefreshCw, User, Building2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  userName: string | null;
  branchName: string | null;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: string;
}

const ACTION_TONE: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
  create: "success",
  update: "secondary",
  delete: "destructive",
  void: "destructive",
  approve: "success",
  login: "secondary",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AuditLogPage() {
  const { tokens } = useAuth();

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ items: AuditEntry[]; total: number }>("/audit-log", {
        accessToken: tokens?.accessToken,
        query: {
          page,
          pageSize: PAGE_SIZE,
          entityType: entityFilter || undefined,
        },
      });
      setEntries(res.items ?? []);
      setTotal(res.total ?? 0);
    } catch (err: any) {
      setError(err?.message || "Failed to load the audit trail from the API.");
    } finally {
      setLoading(false);
    }
  }, [tokens, page, entityFilter]);

  useEffect(() => {
    if (!tokens?.accessToken) return;
    api
      .get<string[]>("/audit-log/entity-types", { accessToken: tokens.accessToken })
      .then(setEntityTypes)
      .catch(() => undefined);
  }, [tokens]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Audit Trail</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Who did what, to which record, and when. Append-only — nothing here can be edited.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Select
            value={entityFilter || "all"}
            onValueChange={(val) => {
              setEntityFilter(val === "all" ? "" : val);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[180px] h-9 text-xs">
              <SelectValue placeholder="All entity types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All entity types</SelectItem>
              {entityTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={fetchEntries} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <Card className="overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            Loading the trail...
          </div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center">
            <ScrollText className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">Nothing recorded yet</h3>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {entityFilter ? "No entries for this entity type." : "Actions across the system will appear here."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3.5 font-medium">When</th>
                  <th className="px-4 py-3.5 font-medium">By</th>
                  <th className="px-4 py-3.5 font-medium">Branch</th>
                  <th className="px-4 py-3.5 font-medium">Entity</th>
                  <th className="px-4 py-3.5 font-medium">Action</th>
                  <th className="px-4 py-3.5 font-medium">Entity ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="px-4 py-3.5 whitespace-nowrap text-muted-foreground">
                      {formatWhen(e.createdAt)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                        <User className="h-3 w-3 text-muted-foreground" />
                        {e.userName ?? "System"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {e.branchName ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Building2 className="h-3 w-3" /> {e.branchName}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[11px] text-foreground">{e.entityType}</td>
                    <td className="px-4 py-3.5">
                      <Badge variant={ACTION_TONE[e.action] ?? "outline"} className="text-[10px]">
                        {e.action}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[10px] text-muted-foreground truncate max-w-[160px]">
                      {e.entityId ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3">
            <span className="text-xs text-muted-foreground">
              Showing {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
