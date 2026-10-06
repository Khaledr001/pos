"use client";

import { quotesApi } from "@devsfleet/storefront-client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { api } from "@/lib/api-browser";
import { friendlyError } from "./session";

/**
 * Accept or decline a quoted quote. The page only shows this for QUOTED; the
 * API is the control — it refuses an answer to anything else, and the prices
 * accepted are the ones staff set, which this request cannot carry.
 */
export function QuoteActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answer = async (kind: "accept" | "decline") => {
    setError(null);
    setPending(kind);
    try {
      await quotesApi(api)[kind](id);
      router.refresh();
    } catch (err) {
      setError(friendlyError(err));
      setPending(null);
      // A stale page (the quote lapsed or was withdrawn): show what it is now.
      router.refresh();
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={() => answer("accept")} loading={pending === "accept"} disabled={pending !== null}>
          Accept this quote
        </Button>
        {confirmDecline ? (
          <span className="flex items-center gap-2">
            <Button variant="danger" onClick={() => answer("decline")} loading={pending === "decline"} disabled={pending !== null}>
              Yes, decline
            </Button>
            <Button variant="ghost" onClick={() => setConfirmDecline(false)} disabled={pending !== null}>
              Keep it open
            </Button>
          </span>
        ) : (
          <Button variant="secondary" size="lg" onClick={() => setConfirmDecline(true)} disabled={pending !== null}>
            Decline
          </Button>
        )}
      </div>
      <div aria-live="polite">
        <FormError message={error} />
      </div>
    </div>
  );
}
