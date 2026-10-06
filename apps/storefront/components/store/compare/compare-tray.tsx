"use client";

import { X } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ButtonLink } from "@/components/ui/button";
import { useCompare } from "@/lib/hooks/compare";

/**
 * Bottom bar on phones, a floating card at the bottom-left on larger screens.
 * The WhatsApp button owns the bottom-right corner, so the bar keeps clear of it.
 */
export function CompareTray() {
  const { items, remove } = useCompare();
  const pathname = usePathname();
  if (items.length === 0 || pathname === "/compare") return null;
  return (
    <>
      {/* Keeps the footer reachable behind the fixed bar on phones. */}
      <div aria-hidden className="h-20 sm:hidden" />
      <section
        aria-label="Products to compare"
        className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-galv bg-paper py-2 pl-4 pr-20 shadow-lg sm:inset-x-auto sm:bottom-4 sm:left-4 sm:rounded-[var(--radius-panel)] sm:border sm:py-2 sm:pr-3"
      >
        <ul className="flex gap-2">
          {items.map((p) => (
            <li key={p.slug}>
              <button
                type="button"
                onClick={() => remove(p.slug)}
                aria-label={`Remove ${p.name} from comparison`}
                className="group relative block size-11 overflow-hidden rounded-[var(--radius-tag)] border border-galv bg-sheet"
              >
                {p.image && <Image src={p.image.url} alt="" fill sizes="44px" className="object-contain p-0.5" />}
                <span className="absolute inset-0 flex items-center justify-center bg-ink/60 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none">
                  <X className="size-4" aria-hidden />
                </span>
                {!p.image && <X className="absolute inset-0 m-auto size-4 text-steel" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
        <ButtonLink href="/compare" size="lg" className="h-11 min-w-0 px-4">
          Compare ({items.length})
        </ButtonLink>
      </section>
    </>
  );
}
