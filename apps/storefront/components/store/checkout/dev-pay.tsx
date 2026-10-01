"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { api, errorMessage } from "@/lib/api-browser";

export function DevPay({ reference, order }: { reference: string; order: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"success" | "fail" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const complete = async (outcome: "success" | "fail") => {
    setBusy(outcome);
    setError(null);
    try {
      await api.post(`/payments/dev/${reference}/complete`, { outcome });
      router.push(outcome === "success" ? `/checkout/success?order=${order}` : `/checkout?cancelled=${order}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-[var(--radius-panel)] border-2 border-dashed border-brass bg-paper p-6">
        <h1 className="text-3xl">Test payment</h1>
        <p className="mt-2 text-steel">
          This page stands in for the card gateway while online payments are not set up. No money moves.
        </p>
        <div className="mt-6 flex gap-3">
          <Button onClick={() => complete("success")} loading={busy === "success"} disabled={!!busy}>
            Pay now
          </Button>
          <Button variant="secondary" onClick={() => complete("fail")} loading={busy === "fail"} disabled={!!busy}>
            Decline payment
          </Button>
        </div>
        <div className="mt-4">
          <FormError message={error} />
        </div>
      </div>
    </div>
  );
}
