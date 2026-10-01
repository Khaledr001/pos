"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { cn } from "@/lib/cn";

/** List filters live in the URL, so a filtered list can be bookmarked or shared. */
export function useListParams() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const get = (key: string) => sp.get(key) ?? "";
  const page = Math.max(1, Number(sp.get("page")) || 1);

  const build = (updates: Record<string, string | number | null | undefined>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === undefined || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    if (!("page" in updates)) next.delete("page");
    if (next.get("page") === "1") next.delete("page");
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  };

  const set = (updates: Record<string, string | number | null | undefined>) => router.replace(build(updates), { scroll: false });
  const pageHref = (p: number) => build({ page: p });

  return { get, set, page, pageHref };
}

export function SearchInput({
  value,
  onSearch,
  label,
  placeholder,
  className,
}: {
  value: string;
  onSearch: (q: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const [text, setText] = useState(value);
  // Follow the URL when it changes elsewhere (e.g. "Clear filters").
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(value);
  }
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSearch(text.trim());
  };
  return (
    <form role="search" onSubmit={submit} className={cn("flex min-w-0 gap-2", className)}>
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-steel-light" aria-hidden />
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          className={cn(inputClass, "h-10 pl-9")}
        />
      </label>
      <Button type="submit" variant="secondary" className="h-10">
        Search
      </Button>
    </form>
  );
}

/** Compact select for toolbars (label kept for screen readers). */
export function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <label className={cn("flex items-center gap-2 text-sm", className)}>
      <span className="shrink-0 text-steel">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={cn(inputClass, "h-10 w-auto min-w-36 pr-8")}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
