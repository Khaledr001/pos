import type { StorefrontTheme } from "@devsfleet/shared-types";
import { NavAnchor } from "./nav-anchor";
import { safeHref } from "@/lib/links";

/** The shop's one-line notice above the header: a sale, a holiday closure, a delivery cut-off. */
export function AnnouncementBar({ announcement }: { announcement: StorefrontTheme["announcement"] }) {
  const text = announcement.text.trim();
  if (!announcement.enabled || !text) return null;
  const href = safeHref(announcement.href);
  const inner = <span className="block truncate">{text}</span>;
  return (
    <div role="region" aria-label="Announcement" className="bg-pipe text-sm font-medium text-white">
      <div className="mx-auto max-w-7xl px-4 py-2 text-center">
        {href ? (
          <NavAnchor href={href} className="block hover:underline">
            {inner}
          </NavAnchor>
        ) : (
          inner
        )}
      </div>
    </div>
  );
}
