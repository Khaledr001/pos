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
  SortableTh, Table, TableBody, TableContainer, TableEmpty, TableHead,
  TablePagination, TableSearch, Th,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow, MobileSort, listCard } from "@/components/ui/mobile-list";
import { readListResult, useListData, useListQuery } from "@/lib/use-list-query";
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

  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const PAGE_SIZE = 50;
  const list = useListQuery({ sortBy: "createdAt", sortOrder: "desc", filters: { entityType: "" } });
  const { q, page, sortBy, sortOrder } = list;
  const entityFilter = list.filters.entityType;

  const loadEntries = useCallback(
    async (signal: AbortSignal) =>
      readListResult<AuditEntry>(
        await api.get<unknown>("/audit-log", {
          accessToken: tokens?.accessToken,
          signal,
          query: {
            page,
            pageSize: PAGE_SIZE,
            entityType: entityFilter || undefined,
            q: q.trim() || undefined,
            sortBy,
            sortOrder,
          },
        }),
      ),
    [tokens?.accessToken, page, entityFilter, q, sortBy, sortOrder],
  );
  const { items: entries, total, loading, initialLoading, error, reload } = useListData(
    loadEntries,
    list.ready && Boolean(tokens?.accessToken),
  );

  useEffect(() => {
    if (!tokens?.accessToken) return;
    api
      .get<string[]>("/audit-log/entity-types", { accessToken: tokens.accessToken })
      .then(setEntityTypes)
      .catch(() => undefined);
  }, [tokens]);

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
            onValueChange={(val) => list.setFilter("entityType", val === "all" ? "" : val)}
          >
            <SelectTrigger className="w-45 h-9 text-xs" aria-label="Filter by entity type">
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
          <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
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

      <div className="flex flex-col gap-2 sm:flex-row">
        <TableSearch
          className="flex-1"
          value={list.search}
          onChange={list.setSearch}
          label="Search the audit trail"
          placeholder="Search by action, entity type, or user..."
        />
        <MobileSort
          options={[
            { column: "createdAt", label: "When", firstOrder: "desc" },
            { column: "entityType", label: "Entity" },
            { column: "action", label: "Action" },
          ]}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onChange={list.setSort}
        />
      </div>

      <MobileList
        loading={initialLoading}
        empty={
          <MobileEmpty
            icon={ScrollText}
            title={q || entityFilter ? "No matching entries" : "Nothing recorded yet"}
            description={
              q
                ? `No entries match "${q}".`
                : entityFilter
                  ? "No entries for this entity type."
                  : "Actions across the system will appear here."
            }
          />
        }
      >
        {entries.map((e) => (
          <MobileRow
            key={e.id}
            title={<span className="font-mono text-xs">{e.entityType}</span>}
            subtitle={e.userName ?? "System"}
            badge={<Badge variant={ACTION_TONE[e.action] ?? "outline"} className="text-[10px]">{e.action}</Badge>}
            fields={[
              { label: "When", value: formatWhen(e.createdAt) },
              { label: "By", value: e.userName ?? "System" },
              { label: "Branch", value: e.branchName ?? "—" },
              { label: "Entity ID", value: e.entityId ? <span className="font-mono text-xs">{e.entityId}</span> : "—" },
            ]}
          />
        ))}
      </MobileList>

      <Card className={listCard}>
        <TableContainer className="hidden md:block">
          <Table>
            <TableHead>
              <tr>
                <SortableTh column="createdAt" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort} firstOrder="desc">When</SortableTh>
                <Th>By</Th>
                <Th>Branch</Th>
                <SortableTh column="entityType" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Entity</SortableTh>
                <SortableTh column="action" sortBy={sortBy} sortOrder={sortOrder} onSort={list.toggleSort}>Action</SortableTh>
                <Th>Entity ID</Th>
              </tr>
            </TableHead>
            <TableBody
              columns={6}
              loading={initialLoading}
              empty={
                <TableEmpty
                  columns={6}
                  icon={ScrollText}
                  title={q || entityFilter ? "No matching entries" : "Nothing recorded yet"}
                  description={
                    q
                      ? `No entries match "${q}".`
                      : entityFilter
                        ? "No entries for this entity type."
                        : "Actions across the system will appear here."
                  }
                />
              }
            >
              {entries.map((e) => (
                <tr key={e.id} className={cn("hover:bg-secondary/30 transition-colors", loading && "opacity-60")}>
                  <td className="px-4 py-3.5 whitespace-nowrap tabular-nums text-muted-foreground">
                    {formatWhen(e.createdAt)}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                      <User aria-hidden="true" className="h-3 w-3 text-muted-foreground" />
                      {e.userName ?? "System"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">
                    {e.branchName ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Building2 aria-hidden="true" className="h-3 w-3" /> {e.branchName}
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
                  <td className="px-4 py-3.5 font-mono text-[10px] text-muted-foreground truncate max-w-40" title={e.entityId ?? undefined}>
                    {e.entityId ?? "—"}
                  </td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={list.setPage} noun="entries" />
      </Card>
    </div>
  );
}
