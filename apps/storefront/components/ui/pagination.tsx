import Link from "next/link";
import { cn } from "@/lib/cn";

/** Link-based pagination that keeps the other query parameters. */
export function Pagination({
  page,
  pageSize,
  total,
  href,
}: {
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
}) {
  const pages = Math.ceil(total / pageSize);
  if (pages <= 1) return null;
  const window = [...new Set([1, page - 1, page, page + 1, pages].filter((p) => p >= 1 && p <= pages))].sort((a, b) => a - b);
  return (
    <nav aria-label="Pagination" className="flex items-center gap-1">
      {page > 1 && (
        <Link href={href(page - 1)} className="h-9 px-3 inline-flex items-center rounded-[var(--radius-tag)] hover:bg-galv/60">
          Previous
        </Link>
      )}
      {window.map((p, i) => (
        <span key={p} className="flex items-center">
          {i > 0 && window[i - 1] !== p - 1 && <span className="px-1 text-steel">…</span>}
          <Link
            href={href(p)}
            aria-current={p === page ? "page" : undefined}
            className={cn(
              "h-9 min-w-9 px-2 inline-flex items-center justify-center rounded-[var(--radius-tag)] font-cond text-lg font-semibold",
              p === page ? "bg-ink text-white" : "hover:bg-galv/60",
            )}
          >
            {p}
          </Link>
        </span>
      ))}
      {page < pages && (
        <Link href={href(page + 1)} className="h-9 px-3 inline-flex items-center rounded-[var(--radius-tag)] hover:bg-galv/60">
          Next
        </Link>
      )}
    </nav>
  );
}
