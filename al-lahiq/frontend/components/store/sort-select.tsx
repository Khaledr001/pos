"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const OPTIONS = [
  { value: "", label: "Recommended" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "newest", label: "Newest" },
  { value: "name", label: "Name A–Z" },
];

export function SortSelect({ hasQuery }: { hasQuery: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <span className="text-steel">Sort by</span>
      <select
        value={params.get("sort") ?? ""}
        onChange={(e) => {
          const sp = new URLSearchParams(params.toString());
          if (e.target.value) sp.set("sort", e.target.value);
          else sp.delete("sort");
          sp.delete("page");
          router.push(`${pathname}${sp.size ? `?${sp}` : ""}`);
        }}
        className="h-9 rounded-[var(--radius-tag)] border border-galv bg-paper px-2"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value === "" && hasQuery ? "Best match" : o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
