"use client";

import React from "react";
import { CalendarRange } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

type Preset = "all" | "this-month" | "last-month" | "this-quarter" | "custom";

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The calendar periods an accountant asks for, on the viewer's own calendar. */
export function presetRange(preset: Exclude<Preset, "custom">, today = new Date()): { from: string; to: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  switch (preset) {
    case "this-month":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "last-month":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "this-quarter": {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
    }
    default:
      return { from: "", to: "" };
  }
}

function presetFor(from: string, to: string): Preset {
  if (!from && !to) return "all";
  for (const p of ["this-month", "last-month", "this-quarter"] as const) {
    const r = presetRange(p);
    if (r.from === from && r.to === to) return p;
  }
  return "custom";
}

const PRESETS: Array<{ value: Preset; label: string }> = [
  { value: "all", label: "All time" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "this-quarter", label: "This quarter" },
  { value: "custom", label: "Custom" },
];

/**
 * From/to with the usual presets. The dates live in the page's URL filters,
 * so a period can be bookmarked or sent to the accountant as a link, and the
 * export downloads exactly the period on screen.
 */
export function DateRangeFilter({
  from,
  to,
  onChange,
  className,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  className?: string;
}) {
  const active = presetFor(from, to);
  const [customOpen, setCustomOpen] = React.useState(active === "custom");
  const showCustom = customOpen || active === "custom";

  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center", className)}>
      <label className="relative flex items-center">
        <span className="sr-only">Period</span>
        <CalendarRange aria-hidden="true" className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground" />
        <select
          value={showCustom ? "custom" : active}
          onChange={(e) => {
            const next = e.target.value as Preset;
            if (next === "custom") {
              setCustomOpen(true);
              return;
            }
            setCustomOpen(false);
            onChange(presetRange(next));
          }}
          className="h-10 w-full cursor-pointer appearance-none rounded-lg border border-input bg-secondary/30 pl-9 pr-8 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-44"
        >
          {PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {showCustom && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onChange({ from: e.target.value, to })}
            aria-label="From date"
            className="h-10 min-w-0 flex-1 sm:w-38 sm:flex-none"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onChange({ from, to: e.target.value })}
            aria-label="To date"
            className="h-10 min-w-0 flex-1 sm:w-38 sm:flex-none"
          />
        </div>
      )}
    </div>
  );
}
