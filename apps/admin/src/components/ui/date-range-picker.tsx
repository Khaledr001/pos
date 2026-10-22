"use client";

import * as React from "react";
import { CalendarRange, ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * A from/to date range: quick presets on the left, two months on the right,
 * nothing applied until "Apply Range".
 *
 * Dates go in and out as "YYYY-MM-DD" strings on the viewer's own calendar —
 * the same shape the list URLs and the API's `from`/`to` take — so a page
 * never handles a Date object or a timezone. "" means open-ended; both empty
 * is "all time".
 */

export interface DateRange {
  from: string;
  to: string;
}

// ── Date helpers (local calendar, no timezone arithmetic) ───────────────────

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function parse(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const sameDay = (a: Date | null, b: Date | null) => !!a && !!b && iso(a) === iso(b);

const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const DAY_FMT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const DAY_YEAR_FMT = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const FULL_FMT = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/** Weeks start on Monday — the working week here, and the screenshot this was drawn from. */
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Six rows always, so the panel does not change height between months. */
function monthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

// ── Presets ─────────────────────────────────────────────────────────────────

export type PresetKey =
  | "today"
  | "yesterday"
  | "last-7"
  | "last-30"
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "all";

export const PRESETS: Array<{ key: PresetKey; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last-7", label: "Last 7 Days" },
  { key: "last-30", label: "Last 30 Days" },
  { key: "this-month", label: "This Month" },
  { key: "last-month", label: "Last Month" },
  { key: "this-quarter", label: "This Quarter" },
  { key: "all", label: "All Time" },
];

export function presetRange(key: PresetKey, today = new Date()): DateRange {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const y = t.getFullYear();
  const m = t.getMonth();
  switch (key) {
    case "today":
      return { from: iso(t), to: iso(t) };
    case "yesterday":
      return { from: iso(addDays(t, -1)), to: iso(addDays(t, -1)) };
    case "last-7":
      return { from: iso(addDays(t, -6)), to: iso(t) };
    case "last-30":
      return { from: iso(addDays(t, -29)), to: iso(t) };
    case "this-month":
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "last-month":
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "this-quarter": {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
    }
    case "all":
      return { from: "", to: "" };
  }
}

export function matchingPreset(range: DateRange, today = new Date()): PresetKey | null {
  return PRESETS.find((p) => {
    const r = presetRange(p.key, today);
    return r.from === range.from && r.to === range.to;
  })?.key ?? null;
}

/** "1 Oct – 31 Oct 2026", a preset's name, or "All time". */
export function describeRange(range: DateRange, today = new Date()): string {
  const preset = matchingPreset(range, today);
  if (preset) return PRESETS.find((p) => p.key === preset)!.label;
  const from = parse(range.from);
  const to = parse(range.to);
  if (from && to) {
    if (sameDay(from, to)) return DAY_YEAR_FMT.format(from);
    const sameYear = from.getFullYear() === to.getFullYear();
    return `${(sameYear ? DAY_FMT : DAY_YEAR_FMT).format(from)} – ${DAY_YEAR_FMT.format(to)}`;
  }
  if (from) return `From ${DAY_YEAR_FMT.format(from)}`;
  if (to) return `Until ${DAY_YEAR_FMT.format(to)}`;
  return "All time";
}

// ── Placement ───────────────────────────────────────────────────────────────

/** Below this the panel is a bottom sheet: a popover has no room to sit beside anything. */
const SHEET_BELOW = 640;
/** Two months need ~740px of panel; below this one month is shown instead. */
const TWO_MONTHS_FROM = 880;
/** Kept clear between the panel and the edge of the window. */
const EDGE = 8;

type Layout = { mode: "inline" | "sheet" | "popover"; months: 1 | 2 };

interface Placement {
  left: number;
  top: number;
  maxHeight?: number;
}

/**
 * Where a popover of `w`×`h` goes next to `anchor`, inside a `vw`×`vh` window.
 *
 * Horizontally: from the anchor's start edge if it fits, else lined up with
 * its far edge, and clamped inside the window either way — a picker at the
 * right of a filter row opening rightwards ran 340px off screen. Vertically:
 * below, else above, else pinned inside the window with a scrollable height.
 */
export function placePopover(
  anchor: { left: number; right: number; top: number; bottom: number },
  w: number,
  h: number,
  vw: number,
  vh: number,
  align: "start" | "end" = "start",
): Placement {
  let left = align === "end" ? anchor.right - w : anchor.left;
  if (left + w > vw - EDGE) left = anchor.right - w;
  if (left < EDGE) left = anchor.left;
  left = Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - w - EDGE));

  const below = vh - anchor.bottom - EDGE * 2;
  const above = anchor.top - EDGE * 2;
  if (h <= below) return { left, top: anchor.bottom + EDGE };
  if (h <= above) return { left, top: anchor.top - EDGE - h };
  const maxHeight = vh - EDGE * 2;
  return { left, top: Math.max(EDGE, vh - Math.min(h, maxHeight) - EDGE), maxHeight };
}

// ── Component ───────────────────────────────────────────────────────────────

export function DateRangePicker({
  value,
  onChange,
  label = "Date range",
  placeholder = "All time",
  align = "start",
  inline = false,
  className,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  /** Read out with the trigger; the visible text is the range itself. */
  label?: string;
  placeholder?: string;
  /** Which edge of the trigger the panel lines up with on wide screens. */
  align?: "start" | "end";
  /**
   * Open in place, pushing content down, with one month — for use inside a
   * dialog. A popover there is clipped by the dialog's own box, and a portal
   * out of it lands behind the dialog's click-blocking overlay.
   */
  inline?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<{ start: Date | null; end: Date | null }>({ start: null, end: null });
  const [hover, setHover] = React.useState<Date | null>(null);
  const [month, setMonth] = React.useState(() => startOfMonth(new Date()));
  const [focused, setFocused] = React.useState<Date>(() => new Date());
  const rootRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const gridRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const panelId = React.useId();

  /**
   * Decided from the window, not CSS breakpoints: whether two months fit
   * depends on the room actually there, and a popover's position has to be
   * measured anyway to keep it on screen.
   */
  const chooseLayout = React.useCallback((): Layout => {
    if (inline) return { mode: "inline", months: 1 };
    const vw = window.innerWidth;
    if (vw < SHEET_BELOW) return { mode: "sheet", months: 1 };
    return { mode: "popover", months: vw >= TWO_MONTHS_FROM ? 2 : 1 };
  }, [inline]);
  const [layout, setLayout] = React.useState<Layout>({ mode: inline ? "inline" : "popover", months: 1 });
  const [placement, setPlacement] = React.useState<Placement | null>(null);

  const place = React.useCallback(() => {
    const panel = panelRef.current;
    const anchor = rootRef.current;
    if (!panel || !anchor) return;
    setPlacement(
      placePopover(
        anchor.getBoundingClientRect(),
        panel.offsetWidth,
        panel.scrollHeight,
        window.innerWidth,
        window.innerHeight,
        align,
      ),
    );
  }, [align]);

  const today = new Date();
  const hasValue = Boolean(value.from || value.to);

  function openPanel() {
    const start = parse(value.from);
    const end = parse(value.to);
    setDraft({ start, end });
    setHover(null);
    // Show the start of the range on the left, so the selection is in view.
    const anchor = start ?? end ?? new Date();
    setMonth(startOfMonth(anchor));
    setFocused(anchor);
    setLayout(chooseLayout());
    setPlacement(null);
    setOpen(true);
  }

  function close(returnFocus = true) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  // Outside click and Escape close without applying, like Cancel.
  React.useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Measured after render and before paint, so the panel never flashes in the
  // wrong place; re-measured when the month count or the window changes.
  React.useLayoutEffect(() => {
    if (open && layout.mode === "popover") place();
  }, [open, layout, month, place]);

  React.useEffect(() => {
    if (!open || layout.mode === "inline") return;
    const onResize = () => setLayout(chooseLayout());
    // Capture, so a scrolling container anywhere above moves the panel too.
    const onScroll = () => layout.mode === "popover" && place();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, layout.mode, chooseLayout, place]);

  // Keyboard focus follows `focused` once the panel is open.
  React.useEffect(() => {
    if (!open) return;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-date="${iso(focused)}"]`)
      ?.focus({ preventScroll: true });
  }, [open, focused, month]);

  function pick(day: Date) {
    setFocused(day);
    // A first click, or a click after a finished range, starts a new range.
    if (!draft.start || draft.end) {
      setDraft({ start: day, end: null });
      return;
    }
    // Clicking before the start makes it the start: nobody means a backwards range.
    setDraft(day < draft.start ? { start: day, end: draft.start } : { start: draft.start, end: day });
  }

  function applyPreset(key: PresetKey) {
    onChange(presetRange(key));
    close();
  }

  function apply() {
    if (!draft.start) return;
    const end = draft.end ?? draft.start;
    onChange({ from: iso(draft.start), to: iso(end) });
    close();
  }

  function onGridKey(e: React.KeyboardEvent) {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in moves) {
      e.preventDefault();
      const next = addDays(focused, moves[e.key]!);
      setFocused(next);
      // Keep the focused day on screen, paging a month at a time.
      const lastShown = addMonths(month, layout.months - 1);
      if (next < month) setMonth(startOfMonth(next));
      else if (next >= addMonths(lastShown, 1)) setMonth(addMonths(startOfMonth(next), -1));
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const delta = e.key === "PageUp" ? -1 : 1;
      setMonth((m) => addMonths(m, delta));
      setFocused((f) => new Date(f.getFullYear(), f.getMonth() + delta, f.getDate()));
    }
  }

  // The range drawn on the calendar: what is chosen, or what would be chosen
  // if the hovered day were clicked now.
  const rangeEnd = draft.end ?? (draft.start && hover ? hover : null);
  const [lo, hi] =
    draft.start && rangeEnd
      ? draft.start <= rangeEnd
        ? [draft.start, rangeEnd]
        : [rangeEnd, draft.start]
      : [draft.start, draft.start];

  const activePreset = matchingPreset(value);

  return (
    // min-w-0: inside a grid or flex parent (a dialog is one) the chip row's
    // natural width would otherwise widen the parent instead of scrolling.
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <div className="flex h-10 items-stretch rounded-lg border border-input bg-secondary/30 shadow-xs focus-within:ring-2 focus-within:ring-ring">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (open ? close() : openPanel())}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          aria-label={`${label}: ${hasValue ? describeRange(value) : placeholder}`}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg pl-3 pr-2 text-left text-sm focus-visible:outline-none"
        >
          <CalendarRange aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className={cn("truncate", !hasValue && "text-muted-foreground")}>
            {hasValue ? describeRange(value) : placeholder}
          </span>
        </button>
        {hasValue && (
          <button
            type="button"
            onClick={() => onChange({ from: "", to: "" })}
            aria-label={`Clear ${label.toLowerCase()}`}
            className="mr-1 flex w-7 shrink-0 cursor-pointer items-center justify-center self-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && (
        <>
          {layout.mode === "sheet" && (
            <div aria-hidden="true" className="fixed inset-0 z-40 bg-black/30" onClick={() => close()} />
          )}
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-modal="false"
            aria-label={label}
            style={
              layout.mode === "popover"
                ? {
                    position: "fixed",
                    left: placement?.left ?? 0,
                    top: placement?.top ?? 0,
                    maxHeight: placement?.maxHeight,
                    // Hidden for the one render before it is measured.
                    visibility: placement ? "visible" : "hidden",
                  }
                : undefined
            }
            className={cn(
              "flex border border-border bg-card text-card-foreground",
              layout.mode === "inline" && "mt-2 w-full min-w-0 flex-col overflow-hidden rounded-xl",
              layout.mode === "sheet" &&
                "fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] flex-col overflow-hidden rounded-t-2xl shadow-2xl",
              layout.mode === "popover" && "z-50 overflow-y-auto rounded-2xl shadow-2xl",
            )}
          >
            {/* Quick select — a column beside the calendar, or a row of chips above it. */}
            <div
              className={cn(
                "shrink-0 border-border bg-secondary/40",
                layout.mode === "popover" ? "w-40 border-r py-4" : "border-b",
              )}
            >
              {layout.mode === "popover" && (
                <p className="px-4 pb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Quick select
                </p>
              )}
              <ul
                className={cn(
                  "flex gap-1.5",
                  layout.mode === "popover" && "flex-col gap-0.5 px-2",
                  // In a sheet the chips scroll sideways; inline they wrap,
                  // because a scrolling row's full width still counts toward
                  // its parents' minimum and widened the dialog around it.
                  layout.mode === "sheet" && "overflow-x-auto p-3",
                  layout.mode === "inline" && "flex-wrap p-3",
                )}
              >
                {PRESETS.map((p) => (
                  <li key={p.key} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => applyPreset(p.key)}
                      aria-pressed={activePreset === p.key}
                      className={cn(
                        "w-full cursor-pointer whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        layout.mode !== "popover" && "border border-border bg-card",
                        activePreset === p.key
                          ? "border-primary/40 bg-primary/10 font-semibold text-primary"
                          : "text-foreground hover:bg-secondary",
                      )}
                    >
                      {p.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Calendars */}
            <div
              className={cn(
                "flex min-w-0 flex-col p-4",
                layout.mode === "sheet" && "overflow-y-auto",
                layout.mode === "popover" && "p-5",
              )}
            >
              <div ref={gridRef} onKeyDown={onGridKey} className="flex gap-6">
                {[0, 1].map((offset) => {
                  const shown = addMonths(month, offset);
                  return (
                    <div
                      key={offset}
                      className={cn(
                        "w-full",
                        layout.mode === "popover" && "w-64",
                        offset === 1 && (layout.months === 2 ? "border-l border-border pl-6" : "hidden"),
                      )}
                    >
                      <div className="mb-3 flex h-8 items-center justify-between">
                        <button
                          type="button"
                          onClick={() => setMonth((m) => addMonths(m, -1))}
                          aria-label="Previous month"
                          className={cn(
                            "flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            offset === 1 && "invisible",
                          )}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <h3 className="text-sm font-bold" aria-live="polite">
                          {MONTH_FMT.format(shown)}
                        </h3>
                        <button
                          type="button"
                          onClick={() => setMonth((m) => addMonths(m, 1))}
                          aria-label="Next month"
                          className={cn(
                            "flex size-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            // With two months the arrow belongs to the second;
                            // with one the first carries both.
                            offset === 0 && layout.months === 2 && "invisible",
                          )}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>

                      <div role="grid" aria-label={MONTH_FMT.format(shown)} className="grid grid-cols-7 gap-y-1">
                        {WEEKDAYS.map((d) => (
                          <div
                            key={d}
                            role="columnheader"
                            aria-label={d}
                            className="pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground"
                          >
                            {d}
                          </div>
                        ))}
                        {monthGrid(shown).map((day) => {
                          const inMonth = day.getMonth() === shown.getMonth();
                          const isStart = sameDay(day, lo);
                          const isEnd = sameDay(day, hi);
                          const inRange = !!lo && !!hi && day > lo && day < hi;
                          const isToday = sameDay(day, today);
                          const isFocused = sameDay(day, focused) && inMonth;
                          return (
                            <div
                              key={iso(day)}
                              role="gridcell"
                              className={cn(
                                "flex h-9 items-center justify-center",
                                inMonth && inRange && "bg-primary/10",
                                inMonth && isStart && hi && !isEnd && "rounded-l-full bg-primary/10",
                                inMonth && isEnd && lo && !isStart && "rounded-r-full bg-primary/10",
                              )}
                            >
                              {inMonth ? (
                                <button
                                  type="button"
                                  data-date={iso(day)}
                                  tabIndex={isFocused ? 0 : -1}
                                  onClick={() => pick(day)}
                                  onMouseEnter={() => setHover(day)}
                                  onFocus={() => setFocused(day)}
                                  aria-label={FULL_FMT.format(day)}
                                  aria-pressed={isStart || isEnd}
                                  aria-current={isToday ? "date" : undefined}
                                  className={cn(
                                    "flex size-9 cursor-pointer items-center justify-center rounded-full text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    isStart || isEnd
                                      ? "bg-primary font-semibold text-primary-foreground"
                                      : "text-foreground hover:bg-secondary",
                                    isToday && !(isStart || isEnd) && "font-bold underline decoration-2 underline-offset-4",
                                  )}
                                >
                                  {day.getDate()}
                                </button>
                              ) : (
                                // Days of the neighbouring months are shown, faded, so
                                // every week reads as a full week — but they are not
                                // choosable here; the arrows go to their month.
                                <span aria-hidden="true" className="text-sm tabular-nums text-muted-foreground/40">
                                  {day.getDate()}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
                <p className="min-w-0 truncate text-xs text-muted-foreground" aria-live="polite">
                  {draft.start
                    ? describeRange({ from: iso(draft.start), to: iso(draft.end ?? draft.start) })
                    : "Pick a start date"}
                  {draft.start && !draft.end && " · pick an end date"}
                </p>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="ghost" onClick={() => close()}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={apply} disabled={!draft.start}>
                    Apply Range
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
