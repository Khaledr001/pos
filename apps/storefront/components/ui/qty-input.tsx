"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { isFractionalUom, uomShort } from "@/lib/format";

/** Quantity stepper. Length/area units accept decimals (2.5 m); others are whole. */
export function QtyInput({
  value,
  onChange,
  uom,
  min,
  label = "Quantity",
  size = "md",
  disabled,
}: {
  value: number;
  onChange: (qty: number) => void;
  uom: string;
  min?: number;
  label?: string;
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const fractional = isFractionalUom(uom);
  const step = 1;
  const lower = min ?? (fractional ? 0.1 : 1);
  const [text, setText] = useState(String(value));
  // Keep the text box in step when the value changes from outside.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }

  const commit = (raw: string) => {
    let n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n) || n < lower) n = lower;
    n = fractional ? Math.round(n * 1000) / 1000 : Math.round(n);
    setText(String(n));
    if (n !== value) onChange(n);
  };

  const h = size === "sm" ? "h-9" : "h-11";
  return (
    <div className={cn("inline-flex items-stretch rounded-[var(--radius-tag)] border border-galv bg-paper", h)}>
      <button
        type="button"
        aria-label="Decrease quantity"
        disabled={disabled || value <= lower}
        onClick={() => onChange(Math.max(lower, fractional ? Math.round((value - step) * 1000) / 1000 : value - step))}
        className="px-2.5 text-steel hover:text-ink disabled:opacity-40"
      >
        <Minus className="size-4" />
      </button>
      <label className="flex items-center gap-1 border-x border-galv px-2">
        <span className="sr-only">{label}</span>
        <input
          inputMode={fractional ? "decimal" : "numeric"}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && commit((e.target as HTMLInputElement).value)}
          className="w-12 bg-transparent text-center font-cond text-lg font-semibold tabular-nums focus:outline-none"
        />
        <span className="text-sm text-steel">{uomShort(uom)}</span>
      </label>
      <button
        type="button"
        aria-label="Increase quantity"
        disabled={disabled}
        onClick={() => onChange(fractional ? Math.round((value + step) * 1000) / 1000 : value + step)}
        className="px-2.5 text-steel hover:text-ink disabled:opacity-40"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
