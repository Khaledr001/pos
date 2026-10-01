"use client";

import { useId, useState } from "react";
import { inputClass } from "@/components/ui/field";
import { Markdown } from "@/components/store/markdown";
import { cn } from "@/lib/cn";

/** Markdown textarea with a "Preview" tab that renders it as the shop will. */
export function MarkdownEditor({
  label,
  value,
  onChange,
  hint,
  rows = 12,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  rows?: number;
  maxLength?: number;
}) {
  const id = useId();
  const [tab, setTab] = useState<"write" | "preview">("write");
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label htmlFor={`${id}-text`} className="text-sm font-medium">
          {label}
        </label>
        <div role="tablist" aria-label={`${label} view`} className="inline-flex rounded-[var(--radius-tag)] border border-galv bg-sheet p-0.5">
          {(["write", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`${id}-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`${id}-panel-${t}`}
              onClick={() => setTab(t)}
              className={cn(
                "h-7 rounded-[3px] px-3 text-[13px] font-medium",
                tab === t ? "bg-paper text-ink shadow-sm" : "text-steel hover:text-ink",
              )}
            >
              {t === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>
      </div>
      <div role="tabpanel" id={`${id}-panel-write`} aria-labelledby={`${id}-tab-write`} hidden={tab !== "write"}>
        <textarea
          id={`${id}-text`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          maxLength={maxLength}
          aria-describedby={`${id}-hint`}
          className={cn(inputClass, "h-auto py-2 font-mono text-[14px] leading-relaxed")}
        />
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel-preview`}
        aria-labelledby={`${id}-tab-preview`}
        hidden={tab !== "preview"}
        className="min-h-40 rounded-[var(--radius-tag)] border border-galv bg-paper px-4 py-3"
      >
        {value.trim() ? <Markdown>{value}</Markdown> : <p className="text-sm text-steel">Nothing written yet.</p>}
      </div>
      <p id={`${id}-hint`} className="text-sm text-steel">
        {hint ?? "Formatting: ## Heading, **bold**, - bullet list, | tables |, [link text](https://…)."}
      </p>
    </div>
  );
}
