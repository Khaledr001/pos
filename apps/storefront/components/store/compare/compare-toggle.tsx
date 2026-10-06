"use client";

import { Check, GitCompareArrows } from "lucide-react";
import { cn } from "@/lib/cn";
import type { SavedProduct } from "@/lib/hooks/local-list";
import { COMPARE_MAX, useCompare } from "@/lib/hooks/compare";

export function CompareToggle({ product, className }: { product: SavedProduct; className?: string }) {
  const { has, full, toggle } = useCompare();
  const on = has(product.slug);
  const blocked = !on && full;
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={blocked}
      title={blocked ? `You can compare up to ${COMPARE_MAX} products` : undefined}
      onClick={() => toggle(product)}
      className={cn(
        "relative z-10 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-tag)] px-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        on ? "text-pipe" : "text-steel hover:text-ink",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-flex size-5 items-center justify-center rounded-[3px] border",
          on ? "border-pipe bg-pipe text-white" : "border-steel-light bg-paper",
        )}
      >
        {on ? <Check className="size-3.5" strokeWidth={3} /> : <GitCompareArrows className="size-3.5" />}
      </span>
      Compare
    </button>
  );
}
