"use client";

import type { CategoryNode } from "@devsfleet/storefront-client";
import { ChevronDown, ChevronRight, LayoutGrid, Menu, MessageCircle, Phone, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { alphabetical, busiestFirst, displayName } from "@/lib/format";
import { useMe } from "@/lib/hooks/store";

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
                    "after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:origin-left after:scale-x-0 after:bg-pipe after:transition-transform after:duration-200 hover:after:scale-x-100 motion-reduce:after:transition-none",
                    active && "text-pipe after:scale-x-100",
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
          <Link
            href="/account/trade"
            className="rounded-[var(--radius-tag)] bg-brass-tint px-3 py-1.5 font-semibold text-[#7a5a0c] transition-colors hover:bg-brass hover:text-ink"
          >
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

/**
 * Mobile menu button and drawer.
 *
 * Departments are an accordion — a catalogue with dozens of them, each with
 * sub-categories, is unusable as one long open list on a phone. The department
 * you are in starts expanded. Contact actions sit at the bottom, within thumb reach.
 */
export function MobileMenu({
  categories,
  phone,
  whatsappHref,
}: {
  categories: CategoryNode[];
  phone?: string | null;
  whatsappHref?: string | null;
}) {
  const { data: me } = useMe();
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  const [path, setPath] = useState(pathname);
  if (path !== pathname) {
    setPath(pathname);
    setDrawer(false);
  }

  const all = alphabetical(categories);
  const current = all.find(
    (c) => pathname === `/category/${c.slug}` || c.children.some((sub) => pathname === `/category/${sub.slug}`),
  )?.slug;
  const [expanded, setExpanded] = useState<string | null>(current ?? null);

  const openerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    if (!drawer) return;
    const opener = openerRef.current;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    document.addEventListener("keydown", onKey);
    // The page behind a drawer should not scroll with it.
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [drawer]);

  // Tab stays inside the open drawer instead of wandering into the page behind it.
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = [...panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  };

  const row = "flex min-h-12 items-center gap-3 rounded-[var(--radius-tag)] px-3 text-[17px] active:bg-galv hover:bg-sheet";

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        onClick={() => setDrawer(true)}
        className="inline-flex size-11 cursor-pointer items-center justify-center rounded-[var(--radius-tag)] transition-colors hover:bg-sheet active:bg-galv lg:hidden"
        aria-label="Open departments menu"
        aria-expanded={drawer}
      >
        <Menu className="size-6" aria-hidden />
      </button>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu" onKeyDown={trapTab}>
          <button type="button" aria-label="Close menu" tabIndex={-1} className="drawer-scrim absolute inset-0 bg-ink/50" onClick={() => setDrawer(false)} />
          <div
            ref={panelRef}
            className="drawer-panel absolute inset-y-0 left-0 flex w-[88%] max-w-sm flex-col bg-paper shadow-2xl"
            onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
            onTouchEnd={(e) => {
              // A swipe toward the edge it came from closes it.
              if (touchX.current !== null && e.changedTouches[0].clientX - touchX.current < -70) setDrawer(false);
              touchX.current = null;
            }}
          >
            <div className="flex items-center justify-between bg-ink px-4 py-3 text-white">
              <Link href={me ? "/account" : "/login"} className="flex min-w-0 items-center gap-3">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <UserRound className="size-5" aria-hidden />
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-semibold">{me ? `Hello, ${me.firstName}` : "Log in or register"}</span>
                  <span className="text-sm text-white/70">{me ? "Your account and orders" : "Track orders, reorder fast"}</span>
                </span>
              </Link>
              <button ref={closeRef} type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-tag)] hover:bg-white/10">
                <X className="size-6" aria-hidden />
              </button>
            </div>

            <nav aria-label="Departments" className="flex-1 overflow-y-auto overscroll-contain px-2 py-2">
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wider text-steel">Shop by department</p>
              <ul>
                {all.map((c) => {
                  const isOpen = expanded === c.slug;
                  const hasChildren = c.children.length > 0;
                  const panelId = `m-dept-${c.slug}`;
                  return (
                    <li key={c.slug} className="border-b border-galv/70 last:border-0">
                      <div className="flex items-stretch">
                        <Link
                          href={`/category/${c.slug}`}
                          aria-current={pathname === `/category/${c.slug}` ? "page" : undefined}
                          className={cn(row, "min-w-0 flex-1 justify-between font-medium", current === c.slug && "text-pipe")}
                        >
                          <span className="truncate">{displayName(c.name)}</span>
                          <span className="text-sm tabular-nums text-steel">{c.productCount}</span>
                        </Link>
                        {hasChildren && (
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            aria-label={`${isOpen ? "Hide" : "Show"} ${displayName(c.name)} sub-categories`}
                            onClick={() => setExpanded(isOpen ? null : c.slug)}
                            className="inline-flex w-12 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-tag)] hover:bg-sheet active:bg-galv"
                          >
                            <ChevronDown className={cn("size-5 text-steel transition-transform duration-200", isOpen && "rotate-180")} aria-hidden />
                          </button>
                        )}
                      </div>
                      {hasChildren && isOpen && (
                        <ul id={panelId} className="mb-2 ml-3 border-l-2 border-pipe-tint pl-2">
                          {alphabetical(c.children).map((sub) => (
                            <li key={sub.slug}>
                              <Link
                                href={`/category/${sub.slug}`}
                                aria-current={pathname === `/category/${sub.slug}` ? "page" : undefined}
                                className={cn("flex min-h-11 items-center rounded-[var(--radius-tag)] px-3 text-[16px] text-steel hover:bg-sheet active:bg-galv", pathname === `/category/${sub.slug}` && "font-semibold text-pipe")}
                              >
                                {displayName(sub.name)}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="border-t border-galv bg-sheet px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
              <ul className="grid grid-cols-2 gap-x-1">
                <li><Link href="/brands" className={row}>Brands</Link></li>
                <li><Link href="/branches" className={row}>Branches</Link></li>
                <li><Link href="/track" className={row}>Track order</Link></li>
                <li><Link href="/account/trade" className={cn(row, "font-semibold text-[#7a5a0c]")}>Trade accounts</Link></li>
              </ul>
              {(phone || whatsappHref) && (
                <div className="mt-1 grid grid-cols-2 gap-2 px-1 pb-1">
                  {phone && (
                    <a href={`tel:${phone.replace(/\s/g, "")}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-tag)] border border-ink/20 bg-paper font-semibold active:bg-galv">
                      <Phone className="size-4" aria-hidden /> Call us
                    </a>
                  )}
                  {whatsappHref && (
                    <a href={whatsappHref} target="_blank" rel="noopener" className="inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-tag)] bg-[#1f8f4e] font-semibold text-white active:bg-[#187a42]">
                      <MessageCircle className="size-4" aria-hidden /> WhatsApp
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
