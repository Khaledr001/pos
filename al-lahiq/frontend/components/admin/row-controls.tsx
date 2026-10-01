"use client";

import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { useEffect } from "react";

export function move<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

/** Move up / move down / remove buttons for a row in an editable list. */
export function RowControls({
  index,
  count,
  onMove,
  onRemove,
  label,
}: {
  index: number;
  count: number;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  /** What the row is, for screen readers ("photo 2"). */
  label: string;
}) {
  const btn = "rounded-[var(--radius-tag)] p-1.5 text-steel hover:bg-galv/70 hover:text-ink disabled:opacity-30 disabled:pointer-events-none";
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button type="button" className={btn} onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${label} up`}>
        <ChevronUp className="size-4" />
      </button>
      <button type="button" className={btn} onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${label} down`}>
        <ChevronDown className="size-4" />
      </button>
      <button type="button" className={`${btn} hover:!bg-signal-tint hover:!text-signal`} onClick={onRemove} aria-label={`Remove ${label}`}>
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

/** Ask before leaving the page with unsaved edits. */
export function useUnsavedWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);
}
