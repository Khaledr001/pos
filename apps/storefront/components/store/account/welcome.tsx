"use client";

import { BadgePercent, Clock } from "lucide-react";
import Link from "next/link";
import { useMe } from "@/lib/hooks/store";

/** Greeting and trade status banner on the account overview. */
export function AccountWelcome() {
  const { data: me } = useMe();
  return (
    <>
      <div>
        <h1 className="text-4xl">{me ? `Hello, ${me.firstName}` : "Your account"}</h1>
        <p className="mt-1 text-steel">
          {me?.type === "TRADE"
            ? `Trade account${me.companyName ? ` for ${me.companyName}` : ""}.`
            : "Your orders, addresses and lists in one place."}
        </p>
      </div>

      {me?.tradeStatus === "PENDING" && (
        <p className="flex items-start gap-2 rounded-[var(--radius-panel)] border border-brass/40 bg-brass-tint px-4 py-3 text-[15px] text-[#7a5a0c]">
          <Clock className="mt-0.5 size-5 shrink-0" aria-hidden />
          <span>
            We&apos;re reviewing your trade application. We&apos;ll email you when your trade prices are ready.{" "}
            <Link href="/account/trade" className="font-semibold underline">
              See details
            </Link>
          </span>
        </p>
      )}
      {me?.tradeStatus === "APPROVED" && (
        <p className="flex items-start gap-2 rounded-[var(--radius-panel)] border border-pipe/30 bg-pipe-tint px-4 py-3 text-[15px] text-pipe-dark">
          <BadgePercent className="mt-0.5 size-5 shrink-0" aria-hidden />
          Your trade prices are active. You see them across the store while you&apos;re logged in.
        </p>
      )}
      {me?.tradeStatus === "REJECTED" && (
        <p className="rounded-[var(--radius-panel)] border border-signal/30 bg-signal-tint px-4 py-3 text-[15px] text-signal">
          We couldn&apos;t approve your trade application.{" "}
          <Link href="/account/trade" className="font-semibold underline">
            Check your details and apply again
          </Link>
        </p>
      )}
      {me?.tradeStatus === "NONE" && (
        <p className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-galv bg-paper px-4 py-3 text-[15px]">
          <span>Buying for a business? Get project pricing and invoices with your TRN.</span>
          <Link href="/account/trade" className="font-semibold text-pipe hover:underline">
            Apply for a trade account
          </Link>
        </p>
      )}
    </>
  );
}
