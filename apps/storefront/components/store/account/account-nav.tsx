"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { useMe, useSessionChanged } from "@/lib/hooks/store";

const LINKS = [
  { href: "/account", label: "Overview" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/quotes", label: "Quotes" },
  { href: "/account/addresses", label: "Addresses" },
  { href: "/account/lists", label: "Lists" },
  { href: "/account/profile", label: "Profile and company" },
  { href: "/account/trade", label: "Trade account" },
];

function isActive(pathname: string, href: string) {
  return href === "/account" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const sessionChanged = useSessionChanged();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await api.post("/auth/logout").catch(() => undefined);
        await sessionChanged();
        router.replace("/");
        router.refresh();
      }}
      className={cn("text-left text-[15px] text-steel hover:text-signal disabled:opacity-50", className)}
    >
      {pending ? "Logging out…" : "Log out"}
    </button>
  );
}

export function AccountNav() {
  const pathname = usePathname();
  const { data: me } = useMe();
  const name = me ? `${me.firstName} ${me.lastName}`.trim() : null;
  return (
    <nav aria-label="Your account" className="lg:sticky lg:top-40">
      <p className="hidden h-7 px-3 pb-2 text-sm text-steel lg:block">
        {name && (
          <>
            Logged in as <span className="font-medium text-ink">{name}</span>
          </>
        )}
      </p>
      <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
        {LINKS.map((l) => {
          const active = isActive(pathname, l.href);
          return (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-10 items-center whitespace-nowrap rounded-[var(--radius-tag)] px-3 text-[15px]",
                  active ? "bg-ink font-semibold text-white" : "border border-galv bg-paper hover:border-steel-light lg:border-0 lg:bg-transparent lg:hover:bg-galv/60",
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
        <li className="flex shrink-0 items-center lg:mt-3 lg:border-t lg:border-galv lg:pt-3">
          <LogoutButton className="h-10 px-3" />
        </li>
      </ul>
    </nav>
  );
}
