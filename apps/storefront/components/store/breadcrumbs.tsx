import type { Crumb } from "@devsfleet/storefront-client";
import Link from "next/link";
import { displayName } from "@/lib/format";

// Kept apart from listing.tsx, which reads server-only data: client components
// (the compare page) need breadcrumbs without dragging that module in.

export function Breadcrumbs({ items }: { items: { href: string; label: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-steel">
      <ol className="flex flex-wrap items-center gap-1.5">
        <li>
          <Link href="/" className="hover:text-ink">
            Home
          </Link>
        </li>
        {items.map((c, i) => (
          <li key={c.href} className="flex items-center gap-1.5">
            <span aria-hidden>/</span>
            {i === items.length - 1 ? (
              <span aria-current="page" className="text-ink">
                {c.label}
              </span>
            ) : (
              <Link href={c.href} className="hover:text-ink">
                {c.label}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function crumbsFrom(trail: Crumb[]) {
  return trail.map((c) => ({ href: `/category/${c.slug}`, label: displayName(c.name) }));
}
