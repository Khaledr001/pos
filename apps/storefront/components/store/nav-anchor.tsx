import Link from "next/link";
import type { ReactNode } from "react";
import { isExternal, safeHref } from "@/lib/links";

/** A tenant-configured link: next/link for a path on the shop, a plain anchor for an https URL. */
export function NavAnchor({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const safe = safeHref(href);
  if (!safe) return <span className={className}>{children}</span>;
  return isExternal(safe) ? (
    <a href={safe} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  ) : (
    <Link href={safe} className={className}>
      {children}
    </Link>
  );
}
