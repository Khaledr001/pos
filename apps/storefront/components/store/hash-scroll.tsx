"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * Makes `/#section` links land on their section.
 *
 * The browser handles a hash on a full page load, but not on a client-side
 * navigation to a page whose content streams in behind a Suspense boundary:
 * the target does not exist yet when the router tries to scroll to it, and
 * the attempt is simply dropped. So: after every navigation, and after a click
 * on a link to this same page, look for the target for up to two seconds and
 * scroll to it. The page's `scroll-padding-top` (globals.css) keeps the
 * target clear of the sticky header.
 */
export function HashScroll() {
  const pathname = usePathname();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const scrollTo = (hash: string) => {
      const id = decodeURIComponent(hash.replace(/^#/, ""));
      if (!id) return;
      let tries = 0;
      const look = () => {
        const target = document.getElementById(id);
        if (target) target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
        else if (++tries < 40) timer = setTimeout(look, 50);
      };
      clearTimeout(timer);
      look();
    };

    scrollTo(window.location.hash);

    // A link to this page's own #section: the router has nothing to navigate to, so it will not scroll.
    const onClick = (event: MouseEvent) => {
      // Not `defaultPrevented`: next/link prevents the browser's own jump, which is why this exists.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href*='#']");
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.hash) scrollTo(url.hash);
    };
    document.addEventListener("click", onClick);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", onClick);
    };
  }, [pathname]);

  return null;
}
