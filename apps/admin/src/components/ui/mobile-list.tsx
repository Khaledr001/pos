"use client";

import * as React from "react";
import { ArrowDownUp, ChevronDown, type LucideIcon } from "lucide-react";
import { SelectField } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SortOrder } from "@/lib/use-list-query";

/**
 * The phone layout of a list page: one card per row, tapped open for the rest
 * of its fields. A ten-column table at 375px is either a sideways scroll or
 * columns squeezed to one word each; a card keeps the three things you scan
 * for in sight and puts everything else one tap away.
 *
 * Pages render this beside their table — `MobileList` shows below `md`, the
 * table's container takes `hidden md:block` — rather than one component
 * guessing a card from table columns. Which field is the headline differs by
 * page, and only the page knows.
 */

/**
 * For the Card that wraps a list's table and pager. Below md the table is
 * hidden and the cards stand on their own, so the frame comes off and only
 * the pager is left, flush under the last card.
 */
export const listCard =
  "overflow-hidden max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:shadow-none";

export function MobileList({
  loading,
  empty,
  children,
  className,
}: {
  /** True only while nothing is loaded yet, as for `TableBody`. */
  loading: boolean;
  empty: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const hasRows = React.Children.toArray(children).length > 0;
  return (
    <div className={cn("space-y-2.5 md:hidden", className)} aria-busy={loading || undefined}>
      {loading ? (
        Array.from({ length: 6 }, (_, i) => (
          <div key={i} aria-hidden="true" className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-4">
            <div className="h-4 w-24 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
            <div className="h-3 flex-1 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
            <div className="h-5 w-14 animate-pulse rounded-md bg-secondary motion-reduce:animate-none" />
          </div>
        ))
      ) : hasRows ? (
        children
      ) : (
        empty
      )}
    </div>
  );
}

export function MobileEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center">
      <Icon aria-hidden="true" className="mx-auto h-10 w-10 text-muted-foreground/30" />
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export interface MobileField {
  label: string;
  value: React.ReactNode;
  /** Amounts and counts: fixed-width digits so a column of cards lines up. */
  numeric?: boolean;
}

export function MobileRow({
  title,
  subtitle,
  badge,
  fields,
  actions,
  defaultOpen = false,
  className,
}: {
  /** The identifier you scan for: an invoice number, a SKU, a name. */
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Usually a status `Badge`. */
  badge?: React.ReactNode;
  /** What the table shows in its other columns, label beside value. */
  fields: MobileField[];
  /** Buttons under the details. Put them here rather than on the card face: a tap on the card is the expand. */
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const panelId = React.useId();

  return (
    <div className={cn("overflow-hidden rounded-xl border border-border bg-card shadow-xs", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {/* The title may truncate, but only after the subtitle has given way —
            and never so far that it pushes the badge and chevron off the card. */}
        <span className="min-w-0 max-w-[60%] shrink truncate text-sm font-bold text-primary">{title}</span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground">{subtitle}</span>
        {badge && <span className="shrink-0">{badge}</span>}
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Kept mounted and hidden rather than conditionally rendered, so
          aria-controls always points at something. */}
      <div id={panelId} hidden={!open}>
        {fields.length > 0 && (
          <dl className="divide-y divide-border/60 bg-secondary/60 px-4">
            {fields.map((f) => (
              <div key={f.label} className="flex items-start justify-between gap-4 py-2.5">
                <dt className="shrink-0 pt-px text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {f.label}
                </dt>
                <dd
                  className={cn(
                    "min-w-0 text-right text-sm text-foreground [overflow-wrap:anywhere]",
                    f.numeric && "font-mono tabular-nums",
                  )}
                >
                  {f.value ?? "—"}
                </dd>
              </div>
            ))}
          </dl>
        )}
        {actions && (
          // One row of equal buttons, until a fourth would squeeze them to
          // icons; from four on they go two to a row.
          <div className="grid auto-cols-fr grid-flow-col gap-2 p-3 has-[>:nth-child(4)]:grid-flow-row has-[>:nth-child(4)]:grid-cols-2 [&>*]:h-10 [&>*]:w-full">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The phone stand-in for sortable headers, which are hidden with the table.
 * One select over "column · direction" pairs: two separate controls for a
 * thumb is one too many.
 */
export function MobileSort({
  options,
  sortBy,
  sortOrder,
  onChange,
  className,
}: {
  options: { column: string; label: string; firstOrder?: SortOrder }[];
  sortBy: string;
  sortOrder: SortOrder;
  onChange: (sortBy: string, sortOrder: SortOrder) => void;
  className?: string;
}) {
  const value = `${sortBy}:${sortOrder}`;
  return (
    <div className={cn("relative md:hidden", className)}>
      <ArrowDownUp
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
      />
      <SelectField
        value={value}
        onValueChange={(next) => {
          const [column, order] = next.split(":") as [string, SortOrder];
          onChange(column, order);
        }}
        label="Sort by"
        className="bg-secondary/30 pl-9"
        options={options.flatMap((o) => {
          const first = o.firstOrder ?? "asc";
          const second: SortOrder = first === "asc" ? "desc" : "asc";
          const word = (d: SortOrder) => (d === "asc" ? "ascending" : "descending");
          return [first, second].map((d) => ({ value: `${o.column}:${d}`, label: `${o.label} · ${word(d)}` }));
        })}
      />
    </div>
  );
}
