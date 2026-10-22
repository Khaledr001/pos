"use client";

import React, { useCallback, useState } from "react";
import Link from "next/link";
import {
  ScrollText,
  Filter,
  ShieldCheck,
  Building2,
  Calendar,
  RefreshCw,
  AlertTriangle,
  UserCheck,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableContainer, TableEmpty, TableHead, TablePagination, Th,
} from "@/components/ui/data-table";
import { cn } from "@/lib/utils";
import { MobileEmpty, MobileList, MobileRow, listCard } from "@/components/ui/mobile-list";
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";

interface AuditLogItem {
  id: string;
  tenantId: string;
  tenantName: string | null;
  tenantSlug: string | null;
  userId: string | null;
  userName: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  changes: Record<string, [unknown, unknown]> | null;
  reason: string | null;
  ipAddress: string | null;
  requestId: string | null;
  createdAt: string;
}

const PAGE_SIZE = 25;

export default function PlatformAuditLogsPage() {
  const list = useListQuery({ sortBy: "createdAt", sortOrder: "desc", filters: { action: "" } });
  const { page } = list;
  const selectedAction = list.filters.action;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLogs = useCallback(
    async (signal: AbortSignal) =>
      readListResult<AuditLogItem>(
        await api.get<unknown>("/admin/audit-logs", {
          signal,
          query: { page, limit: PAGE_SIZE, action: selectedAction || undefined },
        }),
      ),
    [page, selectedAction],
  );
  const { items, total, loading, initialLoading, error, reload } = useListData(loadLogs, list.ready);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const getActionBadgeVariant = (action: string) => {
    switch (action.toLowerCase()) {
      case "suspend":
        return "destructive";
      case "activate":
        return "default";
      case "impersonate":
        return "outline";
      case "create_tenant":
        return "default";
      default:
        return "secondary";
    }
  };

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Platform Audit Trail
            </h1>
            <Badge variant="outline" className="text-xs">
              {total.toLocaleString()} Events Logged
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Immutable chronicle of all platform operator events, tenant lifecycle changes, plan migrations, and support sessions.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={reload}
          disabled={loading}
          className="text-xs h-9"
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh Log
        </Button>
      </div>

      {/* ── Filter Bar ── */}
      <Card className="border-border/60 shadow-2xs">
        <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label htmlFor="audit-action-filter" className="font-semibold text-muted-foreground">Action Filter:</label>
            <select
              id="audit-action-filter"
              value={selectedAction}
              onChange={(e) => list.setFilter("action", e.target.value)}
              className="h-9 rounded-xl border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">All Platform Actions</option>
              <option value="create_tenant">create_tenant</option>
              <option value="update_tenant">update_tenant</option>
              <option value="change_plan">change_plan</option>
              <option value="suspend">suspend</option>
              <option value="activate">activate</option>
              <option value="impersonate">impersonate</option>
            </select>
          </div>

          <div className="text-xs text-muted-foreground">
            Logs are append-only and cryptographically isolated.
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Audit Log Table ── */}
      <MobileList
        loading={initialLoading}
        empty={
          <MobileEmpty
            icon={ScrollText}
            title={selectedAction ? `No "${selectedAction}" events` : "No platform audit events logged yet."}
          />
        }
      >
        {items.map((log) => (
          <MobileRow
            key={log.id}
            title={<span className="text-xs">{log.tenantName ?? `${log.tenantId.slice(0, 8)}…`}</span>}
            badge={
              <Badge variant={getActionBadgeVariant(log.action)} className="font-mono text-[10px] uppercase">
                {log.action}
              </Badge>
            }
            fields={[
              { label: "When", value: new Date(log.createdAt).toLocaleString() },
              { label: "By", value: log.userName || "Platform Operator" },
              { label: "Reason", value: log.reason || "—" },
              { label: "IP address", value: <span className="font-mono text-xs">{log.ipAddress || "Internal"}</span> },
              { label: "Entity", value: <span className="font-mono text-xs">{log.entityType} ({log.entityId || "N/A"})</span> },
              { label: "Request ID", value: <span className="font-mono text-xs">{log.requestId || "N/A"}</span> },
              { label: "Audit ID", value: <span className="font-mono text-xs">{log.id}</span> },
              ...(log.changes && Object.keys(log.changes).length > 0
                ? [{
                    label: "Changes",
                    value: (
                      <pre className="max-w-full overflow-x-auto rounded-lg bg-background/70 p-2 text-left font-mono text-[11px]">
                        {JSON.stringify(log.changes, null, 2)}
                      </pre>
                    ),
                  }]
                : []),
            ]}
            actions={
              log.tenantName ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={`/platform/tenants/${log.tenantId}`}>
                    <Building2 className="h-3.5 w-3.5" />
                    Open business
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ))}
      </MobileList>

      <Card className={cn(listCard, "md:border-border/60 md:shadow-xs")}>
        <TableContainer className="hidden md:block">
          <Table className="border-collapse">
            <TableHead>
              <tr>
                <Th className="w-8"><span className="sr-only">Details</span></Th>
                <Th>Timestamp</Th>
                <Th>Action</Th>
                <Th>Target Business</Th>
                <Th>Actor / Operator</Th>
                <Th>Notes / Reason</Th>
                <Th>IP Address</Th>
              </tr>
            </TableHead>
            <TableBody
              columns={7}
              loading={initialLoading}
              empty={
                <TableEmpty
                  columns={7}
                  icon={ScrollText}
                  title={selectedAction ? `No "${selectedAction}" events` : "No platform audit events logged yet."}
                />
              }
            >
              {items.map((log) => {
                const isExpanded = expandedId === log.id;

                return (
                  <React.Fragment key={log.id}>
                    <tr
                      onClick={() => toggleExpand(log.id)}
                      className={cn("hover:bg-muted/20 cursor-pointer transition-colors", loading && "opacity-60")}
                    >
                      <td className="py-3 px-4 text-muted-foreground">
                        {/* The row click is a mouse shortcut; this button is the control. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpand(log.id);
                          }}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Hide" : "Show"} details for ${log.action}`}
                          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-muted-foreground whitespace-nowrap tabular-nums">
                        {new Date(log.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <Badge
                          variant={getActionBadgeVariant(log.action)}
                          className="font-mono text-[10px] uppercase"
                        >
                          {log.action}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 font-medium text-foreground">
                        {log.tenantName ? (
                          <Link
                            href={`/platform/tenants/${log.tenantId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="hover:text-primary transition-colors flex items-center gap-1.5"
                          >
                            <Building2 className="h-3.5 w-3.5 text-primary shrink-0" />
                            <span>{log.tenantName}</span>
                          </Link>
                        ) : (
                          <span className="text-muted-foreground font-mono text-[11px]">
                            {log.tenantId.slice(0, 8)}…
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-foreground">
                        {log.userName || (
                          <span className="font-mono text-muted-foreground text-[11px]">
                            Platform Operator
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-muted-foreground truncate max-w-50" title={log.reason ?? undefined}>
                        {log.reason || "—"}
                      </td>
                      <td className="py-3 px-4 font-mono text-muted-foreground">
                        {log.ipAddress || "Internal"}
                      </td>
                    </tr>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <tr className="bg-muted/30">
                        <td colSpan={7} className="p-4 border-b border-border/60">
                          <div className="space-y-3 rounded-xl border border-border/50 bg-background p-4 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-muted-foreground">
                              <div>
                                <span className="font-semibold text-foreground">Audit ID: </span>
                                <span className="font-mono text-[11px]">{log.id}</span>
                              </div>
                              <div>
                                <span className="font-semibold text-foreground">Entity: </span>
                                <span className="font-mono text-[11px]">{log.entityType} ({log.entityId || "N/A"})</span>
                              </div>
                              <div>
                                <span className="font-semibold text-foreground">Request ID: </span>
                                <span className="font-mono text-[11px]">{log.requestId || "N/A"}</span>
                              </div>
                            </div>

                            {log.reason && (
                              <div>
                                <span className="font-semibold text-foreground">Reason/Details: </span>
                                <span className="text-foreground">{log.reason}</span>
                              </div>
                            )}

                            {log.changes && Object.keys(log.changes).length > 0 && (
                              <div>
                                <div className="font-semibold text-foreground mb-1">Field Changes:</div>
                                <pre className="p-2.5 rounded-lg bg-muted/60 text-[11px] font-mono overflow-x-auto text-foreground">
                                  {JSON.stringify(log.changes, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun="events" />
      </Card>
    </div>
  );
}
