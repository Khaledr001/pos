import type { StockLabel } from "@devsfleet/storefront-client";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { STOCK_LABEL } from "@/lib/format";

type Tone = "neutral" | "pipe" | "brass" | "signal" | "ink";

const tones: Record<Tone, string> = {
  neutral: "bg-galv text-ink",
  pipe: "bg-pipe-tint text-pipe-dark",
  brass: "bg-brass-tint text-[#7a5a0c]",
  signal: "bg-signal-tint text-signal",
  ink: "bg-ink text-white",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-xs font-semibold", tones[tone], className)}>
      {children}
    </span>
  );
}

export function StockBadge({ label, className }: { label: StockLabel; className?: string }) {
  const tone: Tone = label === "IN_STOCK" ? "pipe" : label === "LOW_STOCK" ? "brass" : "signal";
  return (
    <Badge tone={tone} className={className}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {STOCK_LABEL[label]}
    </Badge>
  );
}
