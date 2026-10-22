"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SortOrder } from "@/lib/use-list-query";

/**
 * The parts every list page in the admin panel is built from. Pages still
 * write their own `<tr>`s — the rows differ too much to configure — but the
 * search box, the headers, loading, empty and paging behave the same
 * everywhere, so a fix to one of them is a fix to all of them.
 */

// ── Search ──────────────────────────────────────────────────────────────────

export function TableSearch({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Read out by screen readers; the placeholder vanishes once you type. */
  label: string;
  className?: string;
}) {
  return (
    <div role="search" className={cn("relative", className)}>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={label}
        className="h-10 bg-secondary/30 pl-10 pr-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Table shell ─────────────────────────────────────────────────────────────

/**
 * Scrolls on its own, both ways, so the header row can stick: a sticky
 * `<thead>` inside an `overflow-x-auto` wrapper sticks to that wrapper, not to
 * the page, and a wrapper that never scrolls vertically means it never sticks.
 */
export function TableContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-h-[calc(100dvh-14rem)] min-h-0 overflow-auto", className)}>
      {children}
    </div>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full text-left text-xs", className)} {...props} />;
}

export function TableHead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        // Opaque, not the translucent tint the rows show through elsewhere —
        // rows scrolling underneath a see-through header read as overlapping text.
        "sticky top-0 z-10 border-b border-border bg-secondary text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

type Align = "left" | "right" | "center";
const alignClass: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

export function Th({
  align = "left",
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th
      scope="col"
      className={cn("whitespace-nowrap px-4 py-3.5 font-medium", alignClass[align], className)}
      {...props}
    />
  );
}

/**
 * A header that sorts. The button is the control and `aria-sort` on the cell
 * is what a screen reader announces — "Total, sorted descending".
 */
export function SortableTh({
  column,
  sortBy,
  sortOrder,
  onSort,
  firstOrder = "asc",
  align = "left",
  className,
  children,
}: {
  column: string;
  sortBy: string;
  sortOrder: SortOrder;
  onSort: (column: string, firstOrder?: SortOrder) => void;
  /** Amounts and dates are usually wanted biggest/newest first. */
  firstOrder?: SortOrder;
  align?: Align;
  className?: string;
  children: React.ReactNode;
}) {
  const active = sortBy === column;
  const Icon = !active ? ArrowUpDown : sortOrder === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
      className={cn("whitespace-nowrap px-2 py-2 font-medium", alignClass[align], className)}
    >
      <button
        type="button"
        onClick={() => onSort(column, firstOrder)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          align === "right" && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {children}
        <Icon aria-hidden="true" className={cn("h-3 w-3 shrink-0", !active && "opacity-40")} />
      </button>
    </th>
  );
}

/** Right-aligned, fixed-width digits, so a column of amounts lines up on the decimal point. */
export const numericCell = "text-right font-mono tabular-nums";

// ── Loading and empty ───────────────────────────────────────────────────────

/**
 * Placeholder rows the shape of the real ones. A spinner in place of the
 * table collapsed it to a line of text and back on every page turn.
 */
export function TableSkeletonRows({ rows = 8, columns }: { rows?: number; columns: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className="px-4 py-4">
              <div
                className="h-3 animate-pulse rounded bg-secondary motion-reduce:animate-none"
                style={{ width: `${45 + ((r * 7 + c * 13) % 45)}%` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function TableEmpty({
  columns,
  icon: Icon,
  title,
  description,
  action,
}: {
  columns: number;
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={columns} className="px-4 py-16 text-center">
        <Icon aria-hidden="true" className="mx-auto h-12 w-12 text-muted-foreground/30" />
        <p className="mt-4 text-sm font-semibold text-foreground">{title}</p>
        {description && <p className="mt-1.5 text-xs text-muted-foreground">{description}</p>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </td>
    </tr>
  );
}

/**
 * The tbody for the usual three states. Pass the rows as children; they are
 * only rendered once there is something to show.
 */
export function TableBody({
  columns,
  loading,
  empty,
  children,
}: {
  columns: number;
  /** True only while there is nothing loaded yet — a refresh keeps the old rows visible. */
  loading: boolean;
  empty: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasRows = React.Children.toArray(children).length > 0;
  return (
    <tbody className="divide-y divide-border" aria-busy={loading || undefined}>
      {loading ? <TableSkeletonRows columns={columns} /> : hasRows ? children : empty}
    </tbody>
  );
}

// ── Paging ──────────────────────────────────────────────────────────────────

/** Page numbers with gaps: [1, "…", 4, 5, 6, "…", 42]. */
export function paginationRange(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages: (number | "ellipsis")[] = [1];
  if (current > 3) pages.push("ellipsis");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
  }
  if (current < total - 2) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  noun = "results",
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** "invoices", "customers" — what the count is of. */
  noun?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // A delete, a filter or a stale link can leave the page past the end; land
  // on the last real page rather than an empty table that says "nothing found".
  React.useEffect(() => {
    if (total > 0 && page > totalPages) onPageChange(totalPages);
  }, [page, total, totalPages, onPageChange]);

  if (total === 0) return null;

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {noun}
      </span>
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => onPageChange(1)} aria-label="First page">
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          {paginationRange(page, totalPages).map((p, i) =>
            p === "ellipsis" ? (
              <span key={`e-${i}`} aria-hidden="true" className="px-1.5 text-xs text-muted-foreground">…</span>
            ) : (
              <Button
                key={p}
                variant={p === page ? "default" : "outline"}
                size="sm"
                className="min-w-8 px-0 font-mono tabular-nums"
                onClick={() => onPageChange(p)}
                aria-label={`Page ${p}`}
                aria-current={p === page ? "page" : undefined}
              >
                {p}
              </Button>
            ),
          )}
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)} aria-label="Last page">
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </nav>
  );
}
