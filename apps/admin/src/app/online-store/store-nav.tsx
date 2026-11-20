"use client";

import {
  Bell,
  ClipboardList,
  FileText,
  Inbox,
  LayoutTemplate,
  ListTree,
  Palette,
  Settings,
  Shapes,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The screens that shape the website, as tabs under the one "Website" entry in
 * the sidebar. `exact` keeps "Settings" (the section's landing page) from
 * lighting up on every other tab.
 */
const TABS: readonly { href: string; label: string; icon: LucideIcon; exact?: boolean }[] = [
  { href: "/online-store", label: "Settings", icon: Settings, exact: true },
  { href: "/online-store/site", label: "Site type", icon: Shapes },
  { href: "/online-store/appearance", label: "Appearance", icon: Palette },
  { href: "/online-store/home", label: "Home page", icon: LayoutTemplate },
  { href: "/online-store/navigation", label: "Navigation", icon: ListTree },
  { href: "/online-store/content", label: "Pages & banners", icon: FileText },
  { href: "/online-store/forms", label: "Forms", icon: ClipboardList },
  { href: "/online-store/leads", label: "Leads", icon: Inbox },
  { href: "/online-store/notifications", label: "Notifications", icon: Bell },
];

const isActive = (pathname: string, tab: (typeof TABS)[number]) =>
  tab.exact ? pathname === tab.href : pathname === tab.href || pathname.startsWith(`${tab.href}/`);

/** Width of the soft edge that tells you there are more tabs off-screen. */
const FADE = 28;

/**
 * The tab bar for website configuration. Rendered once, by the section layout,
 * so no screen has to remember it and none is a dead end. It shows only on the
 * configuration screens — orders, listings, promo codes and the other day-to-day
 * store screens have their own sidebar entries and no tabs.
 *
 * Nine tabs do not fit a phone, so the bar scrolls sideways. Three things keep
 * that honest: the scrollbar is hidden but the strip still scrolls by touch,
 * wheel and keyboard focus; a fade on whichever edge has more tabs beyond it
 * says "there is more"; and the current tab is scrolled into view on arrival, so
 * you never land on a page whose tab is out of sight.
 */
export function WebsiteTabs() {
  const pathname = usePathname();
  const scroller = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // Logical scrollLeft is negative in RTL; the absolute value works for both directions.
    const offset = Math.abs(el.scrollLeft);
    setEdges({ start: offset > 1, end: offset + el.clientWidth < el.scrollWidth - 1 });
  }, []);

  const visible = TABS.some((t) => isActive(pathname, t));

  useEffect(() => {
    const el = scroller.current;
    if (!el || !visible) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, visible]);

  useEffect(() => {
    if (!visible) return;
    const current = scroller.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // `inline: nearest` only moves the strip when the tab is actually clipped.
    current?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [pathname, visible]);

  if (!visible) return null;

  const mask = `linear-gradient(to right, transparent 0, #000 ${edges.start ? FADE : 0}px, #000 calc(100% - ${edges.end ? FADE : 0}px), transparent 100%)`;

  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Website</p>
      {/* The baseline lives on the wrapper so the edge fade never fades the line itself. */}
      <div className="border-b border-border">
        <nav
          ref={scroller}
          aria-label="Website settings"
          onScroll={measure}
          style={{ maskImage: mask, WebkitMaskImage: mask }}
          className="overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <ul className="flex min-w-max gap-0.5">
            {TABS.map((t) => {
              const active = isActive(pathname, t);
              const Icon = t.icon;
              return (
                <li key={t.href}>
                  <Link
                    href={t.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      // 44px tall on touch screens, 40px with a mouse; a gap either side keeps neighbours from being mis-tapped.
                      "group relative inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-t-md border-b-2 px-3.5 text-sm md:min-h-10",
                      "touch-manipulation transition-colors duration-150 motion-reduce:transition-none",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      active
                        ? "border-primary bg-primary/[0.07] font-semibold text-primary"
                        : "border-transparent font-medium text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/70",
                    )}
                  >
                    <Icon
                      aria-hidden="true"
                      className={cn("size-4 shrink-0 transition-colors motion-reduce:transition-none", active ? "text-primary" : "text-muted-foreground/80 group-hover:text-foreground")}
                    />
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
