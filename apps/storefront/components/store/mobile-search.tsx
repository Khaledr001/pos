"use client";

import { Search } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { SearchBox } from "./search-box";

/**
 * Search on phones, on every page. A search icon sits in the header, and tapping
 * it drops the search bar down from under the header — no backdrop, just the box.
 * On the home page the hero has its own large search, so the icon only fades in
 * once that has scrolled up under the header.
 */
export function MobileSearch() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const onHome = pathname === "/";
  const [passed, setPassed] = useState(false);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      // Looked up on every pass: the hero can hydrate after the header does.
      const hero = document.querySelector("[data-hero-search]");
      const header = buttonRef.current?.closest("header");
      if (!header) return;
      if (!hero) {
        // Anywhere but the home page there is no hero search to wait for.
        setPassed(!onHome);
        return;
      }
      setPassed(hero.getBoundingClientRect().bottom < header.getBoundingClientRect().bottom);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      setPassed(false);
      // Going anywhere, or searching again, leaves the bar nothing to do.
      setOpen(false);
    };
  }, [onHome, pathname, search]);

  // Back at the hero, its own search is on screen again; the dropped-down bar has nothing left to do.
  if (!passed && open) setOpen(false);

  useEffect(() => {
    if (!open) return;
    barRef.current?.querySelector("input")?.focus({ preventScroll: true });
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      buttonRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!barRef.current?.contains(target) && !buttonRef.current?.contains(target)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <>
      {/* The slot is always there so the icon appearing never nudges its neighbours. */}
      <button
        ref={buttonRef}
        type="button"
        aria-label="Search products"
        aria-expanded={open}
        aria-controls="mobile-search-bar"
        inert={!passed}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex size-11 cursor-pointer items-center justify-center rounded-[var(--radius-tag)] transition-[opacity,transform,background-color] duration-200 ease-out active:bg-galv motion-reduce:transition-none md:hidden",
          open && "bg-sheet",
          passed ? "scale-100 opacity-100" : "pointer-events-none scale-75 opacity-0",
        )}
      >
        <Search className="size-5" aria-hidden />
      </button>

      {/* Anchored to the sticky header; the wrapper lets clicks through so only the box itself is in the way. */}
      <div
        id="mobile-search-bar"
        ref={barRef}
        inert={!open}
        className={cn(
          "pointer-events-none absolute inset-x-0 top-full px-4 py-2 transition-[opacity,transform] ease-out motion-reduce:transition-none md:hidden",
          open ? "translate-y-0 opacity-100 duration-200" : "-translate-y-2 opacity-0 duration-150",
        )}
      >
        <div className="pointer-events-auto">
          <SearchBox />
        </div>
      </div>
    </>
  );
}
