"use client";

import type { Suggestions } from "@devsfleet/storefront-client";
import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/format";

// What has been typed is shared by every search box on the page, so the one in the
// hero and the one that takes over in the header always show the same text.
let draft = "";
const listeners = new Set<() => void>();
const setDraft = (value: string) => {
  draft = value;
  listeners.forEach((l) => l());
};
const subscribeDraft = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/**
 * Search by product name, brand, SKU or barcode, with instant suggestions.
 *
 * `revealOnScroll`: the home page has its own large search in the hero, so the
 * header's copy stays out of sight until the hero's reaches the header, then
 * takes over and travels with it.
 * `fly`: the header's copy takes over from the hero's and travels with it up the
 * page, easing into its slot in the header. Phones don't get this; see mobile-search.tsx.
 */
export function SearchBox({
  className,
  revealOnScroll,
  fly,
}: {
  className?: string;
  revealOnScroll?: boolean;
  fly?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = useSyncExternalStore(subscribeDraft, () => draft, () => "");
  const setQ = setDraft;
  const urlQuery = params.get("q");
  useEffect(() => {
    // Arriving on a results page shows what was searched for.
    if (urlQuery && !draft) setDraft(urlQuery);
  }, [urlQuery]);
  const [results, setResults] = useState<Suggestions | null>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const boxRef = useRef<HTMLFormElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const onHome = pathname === "/";

  useEffect(() => {
    if (!revealOnScroll || !onHome) return;
    const form = boxRef.current;
    const slot = slotRef.current;
    if (!form || !slot) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let hero: HTMLElement | null = null;

    // How far above its resting place in the hero the search starts to travel.
    const RUN = 220;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const check = () => {
      frame = 0;
      // Looked up on every pass: the hero can hydrate after the header does.
      hero = document.querySelector<HTMLElement>("[data-hero-search]");
      if (!hero) return;

      const to = slot.getBoundingClientRect();
      const from = hero.getBoundingClientRect();
      // Whichever copy is hidden by a breakpoint has no box; the other one is in charge.
      const unavailable = slot.offsetParent === null;
      const distance = from.top - to.top;
      const heroInput = hero.querySelector("input");
      const formInput = form.querySelector("input");

      // A cursor in one box moves to the other as they trade places, caret and all.
      const handOver = (source: HTMLInputElement | null, target: HTMLInputElement | null) => {
        if (!source || !target || document.activeElement !== source) return;
        const { selectionStart, selectionEnd } = source;
        target.focus({ preventScroll: true });
        target.setSelectionRange(selectionStart, selectionEnd);
      };

      // The copy that isn't on screen leaves the hero alone; the other one is driving it.
      if (unavailable) {
        form.inert = true;
        return;
      }

      if (distance > RUN) {
        hero.style.visibility = "";
        form.style.opacity = "0";
        form.style.pointerEvents = "none";
        form.style.transform = "";
        form.style.width = "";
        handOver(formInput, heroInput);
        form.inert = true;
        return;
      }

      // Until it docks, the copy sits exactly over the hero's box and moves with the page;
      // sideways and in width it eases toward its resting place.
      const t = reduceMotion.matches ? (distance <= 0 ? 1 : 0) : Math.min(1, Math.max(0, 1 - distance / RUN));
      const ease = t * t * (3 - 2 * t);
      const x = lerp(from.left, to.left, ease);
      const y = Math.max(from.top, to.top);
      form.inert = false;
      handOver(heroInput, formInput);
      hero.style.visibility = "hidden";
      form.style.opacity = "1";
      form.style.transform = t === 1 ? "" : `translate(${x - to.left}px, ${y - to.top}px)`;
      form.style.width = t === 1 ? "" : `${lerp(from.width, to.width, ease)}px`;
      form.style.pointerEvents = t === 1 ? "auto" : "none";
      form.inert = t !== 1 && !form.contains(document.activeElement);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.addEventListener("load", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("load", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      if (hero) hero.style.visibility = "";
      form.removeAttribute("style");
    };
  }, [revealOnScroll, onHome, fly]);

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
  // The copy that travels is positioned from script, so it opts out of the usual classes.
  const flying = !!fly && !!revealOnScroll;

  const form = (
    <form
      ref={boxRef}
      role="search"
      className={cn(
        flying && "absolute left-0 top-0 w-full will-change-transform",
        flying && onHome && "pointer-events-none opacity-0",
        !flying && cn("relative", className),
      )}
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
        className="h-11 w-full rounded-[var(--radius-tag)] border-2 border-ink/80 bg-paper pl-3.5 pr-12 text-[15px] text-ink placeholder:text-steel-light focus:border-pipe focus:outline-none"
      />
      <button
        type="submit"
        aria-label="Search"
        className="absolute right-1 top-1 bottom-1 inline-flex w-9 items-center justify-center rounded-[3px] bg-ink text-white hover:bg-pipe"
      >
        <Search className="size-[18px]" aria-hidden />
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
                  {displayName(c.name)}
                </Link>
              ))}
              {data.brands.map((b) => (
                <Link key={b.slug} href={`/brand/${b.slug}`} onClick={() => setOpen(false)} className="rounded-full bg-sheet px-3 py-1 text-sm font-medium hover:bg-galv">
                  {displayName(b.name)}
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
                    <span className="block truncate font-medium">{displayName(p.name)}</span>
                    {p.brand && <span className="text-sm text-steel">{displayName(p.brand.name)}</span>}
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

  if (!flying) return form;
  return (
    <div ref={slotRef} className={cn("relative h-11", className)}>
      {form}
    </div>
  );
}
