"use client";

import React, { useEffect, useState } from "react";
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

interface PaginatedAuditLogs {
  items: AuditLogItem[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export default function PlatformAuditLogsPage() {
  const [data, setData] = useState<PaginatedAuditLogs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<string>("");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<any>("/admin/audit-logs", {
        query: {
          page,
          limit: 25,
          action: selectedAction || undefined,
        },
      });
      const items = Array.isArray(res) ? res : (res?.items ?? []);
      const meta = res?.meta ?? {
        page,
        limit: 25,
        total: items.length,
        totalPages: Math.max(1, Math.ceil(items.length / 25)),
        hasNext: false,
        hasPrev: page > 1,
      };
      setData({ items, meta });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [page, selectedAction]);

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
              {data?.meta?.total || 0} Events Logged
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Immutable chronicle of all platform operator events, tenant lifecycle changes, plan migrations, and support sessions.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={fetchLogs}
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
            <span className="font-semibold text-muted-foreground">Action Filter:</span>
            <select
              value={selectedAction}
              onChange={(e) => {
                setSelectedAction(e.target.value);
                setPage(1);
              }}
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
      <Card className="border-border/60 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-muted-foreground font-semibold">
                <th className="py-3 px-4 w-8"></th>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Target Business</th>
                <th className="py-3 px-4">Actor / Operator</th>
                <th className="py-3 px-4">Notes / Reason</th>
                <th className="py-3 px-4">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <div className="inline-flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin text-primary" />
                      <span>Reading audit log ledger…</span>
                    </div>
                  </td>
                </tr>
              ) : data?.items && data.items.length > 0 ? (
                data.items.map((log) => {
                  const isExpanded = expandedId === log.id;

                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => toggleExpand(log.id)}
                        className="hover:bg-muted/20 cursor-pointer transition-colors"
                      >
                        <td className="py-3 px-4 text-muted-foreground">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                        </td>
                        <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">
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
                        <td className="py-3 px-4 text-muted-foreground truncate max-w-[200px]">
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
                })
              ) : (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    No platform audit events logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination bar */}
        {data && data?.meta?.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20 text-xs">
            <div className="text-muted-foreground">
              Showing page <strong>{data?.meta?.page}</strong> of{" "}
              <strong>{data?.meta?.totalPages}</strong> ({data?.meta?.total} total)
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!data?.meta?.hasPrev}
                className="h-8 text-xs"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => p + 1)}
                disabled={!data?.meta?.hasNext}
                className="h-8 text-xs"
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
