"use client";

import type { Suggestions } from "@devsfleet/storefront-client";
import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api-browser";
import { cn } from "@/lib/cn";

/** Search by product name, brand, SKU or barcode, with instant suggestions. */
/** `hideOnHome`: the home page has its own large search. */
export function SearchBox({ className, hideOnHome }: { className?: string; hideOnHome?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [results, setResults] = useState<Suggestions | null>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const boxRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api
        .get<Suggestions>(`/catalog/suggest?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then(setResults)
        .catch(() => undefined);
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const data = q.trim().length >= 2 ? results : null;
  const hasResults = !!data && (data.products.length > 0 || data.categories.length > 0 || data.brands.length > 0);
  if (hideOnHome && pathname === "/") return <div className={className} />;

  return (
    <form
      ref={boxRef}
      role="search"
      className={cn("relative", className)}
      onSubmit={(e) => {
        e.preventDefault();
        setOpen(false);
        if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <label className="sr-only" htmlFor={`${listId}-input`}>
        Search products
      </label>
      <input
        id={`${listId}-input`}
        type="search"
        value={q}
        autoComplete="off"
        placeholder="Search by product, brand or SKU — e.g. 20 mm PPR pipe"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        role="combobox"
        aria-expanded={open && hasResults}
        aria-controls={listId}
        className="h-12 w-full rounded-[var(--radius-tag)] border-2 border-ink/80 bg-paper pl-4 pr-14 text-[15px] placeholder:text-steel-light focus:border-pipe focus:outline-none"
      />
      <button
        type="submit"
        aria-label="Search"
        className="absolute right-1 top-1 bottom-1 inline-flex w-11 items-center justify-center rounded-[3px] bg-ink text-white hover:bg-pipe"
      >
        <Search className="size-5" />
      </button>

      {open && hasResults && (
        <div
          id={listId}
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-[var(--radius-panel)] border border-galv bg-paper shadow-lg"
        >
          {(data.categories.length > 0 || data.brands.length > 0) && (
            <div className="flex flex-wrap gap-2 border-b border-galv p-3">
              {data.categories.map((c) => (
                <Link key={c.slug} href={`/category/${c.slug}`} onClick={() => setOpen(false)} className="rounded-full bg-sheet px-3 py-1 text-sm hover:bg-galv">
                  {c.name}
                </Link>
              ))}
              {data.brands.map((b) => (
                <Link key={b.slug} href={`/brand/${b.slug}`} onClick={() => setOpen(false)} className="rounded-full bg-sheet px-3 py-1 text-sm font-medium hover:bg-galv">
                  {b.name}
                </Link>
              ))}
            </div>
          )}
          <ul>
            {data.products.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/product/${p.slug}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between gap-4 px-3 py-2.5 hover:bg-sheet"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{p.name}</span>
                    {p.brand && <span className="text-sm text-steel">{p.brand.name}</span>}
                  </span>
                  {p.fromPrice && <span className="tag-price shrink-0 text-lg">{p.fromPrice.formatted}</span>}
                </Link>
              </li>
            ))}
          </ul>
          <button
            type="submit"
            className="block w-full border-t border-galv px-3 py-2.5 text-left text-sm font-semibold text-pipe hover:bg-sheet"
          >
            See all results for “{q.trim()}”
          </button>
        </div>
      )}
    </form>
  );
}
