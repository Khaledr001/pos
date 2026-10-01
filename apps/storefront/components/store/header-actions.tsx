"use client";

import { ShoppingCart, UserRound } from "lucide-react";
import Link from "next/link";
import { useCart, useMe } from "@/lib/hooks/store";

export function CartButton() {
  const { data } = useCart();
  const count = data?.itemCount ?? 0;
  return (
    <Link href="/cart" className="relative inline-flex h-12 items-center gap-2 rounded-[var(--radius-tag)] px-3 hover:bg-galv/60">
      <ShoppingCart className="size-6" aria-hidden />
      <span className="hidden sm:inline font-medium">Cart</span>
      <span className="sr-only">{`, ${count} ${count === 1 ? "item" : "items"}`}</span>
      {count > 0 && (
        <span
          aria-hidden
          className="absolute left-6 top-1.5 min-w-5 rounded-full bg-brass px-1 text-center font-cond text-sm font-bold leading-5 text-ink"
        >
          {count}
        </span>
      )}
    </Link>
  );
}

export function AccountButton() {
  const { data: me } = useMe();
  return (
    <Link
      href={me ? "/account" : "/login"}
      className="inline-flex h-12 items-center gap-2 rounded-[var(--radius-tag)] px-3 hover:bg-galv/60"
    >
      <UserRound className="size-6" aria-hidden />
      <span className="hidden sm:flex flex-col leading-tight">
        <span className="text-xs text-steel">{me ? (me.type === "TRADE" ? "Trade account" : "Hello") : "Account"}</span>
        <span className="font-medium">{me ? me.firstName : "Log in"}</span>
      </span>
    </Link>
  );
}
