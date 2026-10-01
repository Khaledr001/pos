"use client";

import type { CategoryNode } from "@al-lahiq/api-client";
import { ChevronDown, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";

/** Desktop department row with a dropdown of sub-categories. */
export function DeptNav({ categories }: { categories: CategoryNode[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const pathname = usePathname();
  const [path, setPath] = useState(pathname);
  if (path !== pathname) {
    setPath(pathname);
    setOpen(null);
  }

  return (
    <nav aria-label="Departments" className="hidden lg:block border-t border-galv">
        <ul className="mx-auto flex max-w-7xl items-stretch px-4">
          {categories.map((c) => (
            <li
              key={c.slug}
              className="relative"
              onMouseEnter={() => setOpen(c.slug)}
              onMouseLeave={() => setOpen(null)}
            >
              <div className="flex items-center">
                <Link
                  href={`/category/${c.slug}`}
                  className={cn(
                    "flex h-11 items-center px-3 font-medium hover:text-pipe",
                    pathname === `/category/${c.slug}` && "text-pipe",
                  )}
                >
                  {c.name}
                </Link>
                {c.children.length > 0 && (
                  <button
                    type="button"
                    aria-label={`Show ${c.name} categories`}
                    aria-expanded={open === c.slug}
                    onClick={() => setOpen(open === c.slug ? null : c.slug)}
                    className="-ml-2 p-1 text-steel"
                  >
                    <ChevronDown className="size-4" />
                  </button>
                )}
              </div>
              {open === c.slug && c.children.length > 0 && (
                <div className="absolute left-0 top-full z-40 min-w-64 rounded-b-[var(--radius-panel)] border border-galv bg-paper p-2 shadow-lg">
                  {c.children.map((sub) => (
                    <Link key={sub.slug} href={`/category/${sub.slug}`} className="block rounded-[var(--radius-tag)] px-3 py-2 hover:bg-sheet">
                      {sub.name}
                    </Link>
                  ))}
                </div>
              )}
            </li>
          ))}
          <li className="ml-auto flex items-center gap-4 text-sm">
            <Link href="/brands" className="hover:text-pipe">
              Brands
            </Link>
            <Link href="/account/trade" className="font-semibold text-[#7a5a0c] hover:text-ink">
              Trade accounts
            </Link>
          </li>
        </ul>
      </nav>

  );
}

/** Mobile menu button and drawer. */
export function MobileMenu({ categories }: { categories: CategoryNode[] }) {
  const [drawer, setDrawer] = useState(false);
  const pathname = usePathname();
  const [path, setPath] = useState(pathname);
  if (path !== pathname) {
    setPath(pathname);
    setDrawer(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setDrawer(true)}
        className="lg:hidden inline-flex h-12 items-center gap-2 rounded-[var(--radius-tag)] px-3 hover:bg-galv/60"
        aria-label="Open departments menu"
      >
        <Menu className="size-6" />
      </button>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Departments">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[86%] max-w-sm overflow-y-auto bg-paper p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-cond text-xl font-semibold">Departments</span>
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close menu" className="p-2">
                <X className="size-6" />
              </button>
            </div>
            <ul className="divide-y divide-galv">
              {categories.map((c) => (
                <li key={c.slug} className="py-3">
                  <Link href={`/category/${c.slug}`} className="font-cond text-lg font-semibold">
                    {c.name}
                  </Link>
                  <ul className="mt-1 grid grid-cols-2 gap-x-3">
                    {c.children.map((sub) => (
                      <li key={sub.slug}>
                        <Link href={`/category/${sub.slug}`} className="block py-1 text-[15px] text-steel">
                          {sub.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              <li className="py-3 flex flex-col gap-2">
                <Link href="/brands">Brands</Link>
                <Link href="/account/trade" className="font-semibold">
                  Trade accounts
                </Link>
                <Link href="/branches">Branches &amp; opening hours</Link>
              </li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
