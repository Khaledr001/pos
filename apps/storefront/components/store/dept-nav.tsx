"use client";

import type { CategoryNode } from "@devsfleet/storefront-client";
import { ChevronDown, ChevronRight, LayoutGrid, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { alphabetical, busiestFirst, displayName } from "@/lib/format";

/**
 * Desktop department bar.
 *
 * A catalogue imported from a price list can have dozens of flat departments,
 * so they are never all printed in a row: "All departments" opens the full,
 * alphabetical list, and the row beside it shows as many of the busiest
 * departments as fit on one line — the rest are dropped, never wrapped.
 */
export function DeptNav({ categories }: { categories: CategoryNode[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [path, setPath] = useState(pathname);
  if (path !== pathname) {
    setPath(pathname);
    setOpen(false);
  }

  const navRef = useRef<HTMLElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLUListElement>(null);

  // Escape or a click elsewhere closes the panel; focus goes back to its button.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!navRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // Departments that wrapped past the first line are clipped from view; make
  // them inert too, so Tab never lands on a link nobody can see.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const fit = () => {
      const items = [...row.children] as HTMLElement[];
      const top = items[0]?.offsetTop ?? 0;
      for (const item of items) {
        const hidden = item.offsetTop > top;
        item.inert = hidden;
        item.setAttribute("aria-hidden", String(hidden));
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [categories]);

  const quick = busiestFirst(categories);
  const all = alphabetical(categories);

  return (
    <nav ref={navRef} aria-label="Departments" className="relative hidden border-t border-galv lg:block">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4">
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls="all-departments"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "my-1.5 inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-[var(--radius-tag)] px-3 font-semibold transition-colors",
            open ? "bg-ink text-white" : "bg-sheet text-ink hover:bg-galv",
          )}
        >
          <LayoutGrid className="size-4" aria-hidden />
          All departments
          <ChevronDown className={cn("size-4 transition-transform duration-200", open && "rotate-180")} aria-hidden />
        </button>

        <ul ref={rowRef} className="flex h-12 min-w-0 flex-1 flex-wrap items-stretch overflow-hidden">
          {quick.map((c) => {
            const active = pathname === `/category/${c.slug}`;
            return (
              <li key={c.slug} className="flex">
                <Link
                  href={`/category/${c.slug}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-12 items-center whitespace-nowrap px-3 text-[15px] font-medium transition-colors hover:text-pipe",
                    active && "text-pipe after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-pipe",
                  )}
                >
                  {displayName(c.name)}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex shrink-0 items-center gap-4 text-sm">
          <Link href="/brands" className="font-medium hover:text-pipe">
            Brands
          </Link>
          <Link href="/account/trade" className="font-semibold text-[#7a5a0c] hover:text-ink">
            Trade accounts
          </Link>
        </div>
      </div>

      {open && (
        <div id="all-departments" className="absolute inset-x-0 top-full z-40 border-t border-galv bg-paper shadow-[0_16px_32px_-12px_rgb(28_37_48/0.25)]">
          <div className="mx-auto max-h-[70vh] max-w-7xl overflow-y-auto px-4 py-6">
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 className="text-2xl">All departments</h2>
              <Link href="/departments" className="inline-flex items-center gap-1 text-sm font-semibold text-pipe hover:underline">
                Browse departments <ChevronRight className="size-4" aria-hidden />
              </Link>
            </div>
            <ul className="columns-3 gap-8 xl:columns-4">
              {all.map((c) => (
                <li key={c.slug} className="break-inside-avoid pb-1">
                  <Link
                    href={`/category/${c.slug}`}
                    className="flex items-baseline justify-between gap-3 rounded-[var(--radius-tag)] px-2 py-1.5 hover:bg-sheet hover:text-pipe"
                  >
                    <span className="font-medium">{displayName(c.name)}</span>
                    <span className="text-sm tabular-nums text-steel">{c.productCount}</span>
                  </Link>
                  {c.children.length > 0 && (
                    <ul className="mb-1 ml-2 border-l border-galv pl-2">
                      {alphabetical(c.children).map((sub) => (
                        <li key={sub.slug}>
                          <Link href={`/category/${sub.slug}`} className="block rounded-[var(--radius-tag)] px-2 py-1 text-[15px] text-steel hover:bg-sheet hover:text-ink">
                            {displayName(sub.name)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </nav>
  );
}

/** Mobile menu button and drawer: every department, alphabetical, with sub-categories inline. */
export function MobileMenu({ categories }: { categories: CategoryNode[] }) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  const [path, setPath] = useState(pathname);
  if (path !== pathname) {
    setPath(pathname);
    setDrawer(false);
  }

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    // The page behind a drawer should not scroll with it.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [drawer]);

  return (
    <>
      <button
        type="button"
        onClick={() => setDrawer(true)}
        className="inline-flex size-12 cursor-pointer items-center justify-center rounded-[var(--radius-tag)] hover:bg-galv/60 lg:hidden"
        aria-label="Open departments menu"
        aria-expanded={drawer}
      >
        <Menu className="size-6" />
      </button>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Departments">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-sm flex-col bg-paper">
            <div className="flex items-center justify-between border-b border-galv px-4 py-3">
              <span className="font-cond text-xl font-semibold">Departments</span>
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="inline-flex size-11 cursor-pointer items-center justify-center rounded-[var(--radius-tag)] hover:bg-sheet">
                <X className="size-6" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              <ul>
                {alphabetical(categories).map((c) => (
                  <li key={c.slug}>
                    <Link href={`/category/${c.slug}`} className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-tag)] px-3 py-2 hover:bg-sheet">
                      <span className="font-medium">{displayName(c.name)}</span>
                      <span className="text-sm tabular-nums text-steel">{c.productCount}</span>
                    </Link>
                    {c.children.length > 0 && (
                      <ul className="mb-1 ml-4 border-l border-galv pl-2">
                        {alphabetical(c.children).map((sub) => (
                          <li key={sub.slug}>
                            <Link href={`/category/${sub.slug}`} className="flex min-h-10 items-center rounded-[var(--radius-tag)] px-3 text-[15px] text-steel hover:bg-sheet">
                              {displayName(sub.name)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col gap-1 border-t border-galv px-2 py-2">
              <Link href="/brands" className="flex min-h-11 items-center rounded-[var(--radius-tag)] px-3 hover:bg-sheet">Brands</Link>
              <Link href="/account/trade" className="flex min-h-11 items-center rounded-[var(--radius-tag)] px-3 font-semibold hover:bg-sheet">Trade accounts</Link>
              <Link href="/branches" className="flex min-h-11 items-center rounded-[var(--radius-tag)] px-3 hover:bg-sheet">Branches &amp; opening hours</Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
