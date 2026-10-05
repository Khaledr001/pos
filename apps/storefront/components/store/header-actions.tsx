"use client";

import { ShoppingCart, UserRound } from "lucide-react";
import Link from "next/link";
import { useCart, useMe } from "@/lib/hooks/store";

export function CartButton() {
  const { data } = useCart();
  const count = data?.itemCount ?? 0;
  return (
    <Link
      href="/cart"
      className="relative ml-1 inline-flex h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-tag)] bg-ink px-3.5 font-medium text-white transition-colors hover:bg-pipe active:bg-pipe-dark sm:px-4"
    >
      <ShoppingCart className="size-5" aria-hidden />
      <span className="hidden sm:inline">Cart</span>
      <span className="sr-only">{`, ${count} ${count === 1 ? "item" : "items"}`}</span>
      {count > 0 && (
        <span
          aria-hidden
          className="min-w-5 rounded-full bg-brass px-1.5 text-center font-cond text-sm font-bold leading-5 text-ink max-sm:absolute max-sm:-right-1.5 max-sm:-top-1.5 max-sm:ring-2 max-sm:ring-paper"
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
      className="inline-flex h-11 min-w-11 cursor-pointer items-center justify-center gap-2 rounded-[var(--radius-tag)] px-2.5 transition-colors hover:bg-sheet active:bg-galv sm:px-3"
    >
      <UserRound className="size-5" aria-hidden />
      <span className="sr-only sm:hidden">{me ? "Your account" : "Log in"}</span>
      <span className="hidden sm:flex flex-col leading-tight">
        <span className="text-xs text-steel">{me ? (me.type === "TRADE" ? "Trade account" : "Hello") : "Account"}</span>
        <span className="font-medium">{me ? me.firstName : "Log in"}</span>
      </span>
    </Link>
  );
}
