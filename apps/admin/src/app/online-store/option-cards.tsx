"use client";

import React from "react";
import { cn } from "@/lib/utils";

/** A row of selectable cards: one choice among a few, each with a line of explanation. */
export function OptionCards<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; title: string; text?: string; swatch?: React.ReactNode }[];
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-3">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "cursor-pointer rounded-xl border p-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
              on ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-accent",
            )}
          >
            {o.swatch && <div className="mb-2">{o.swatch}</div>}
            <div className="font-semibold text-foreground">{o.title}</div>
            {o.text && <div className="mt-0.5 text-[11px] text-muted-foreground">{o.text}</div>}
          </button>
        );
      })}
    </div>
  );
}
