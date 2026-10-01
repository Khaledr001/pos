"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function StoreError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div role="alert" className="rounded-[var(--radius-panel)] border border-galv bg-paper p-6 sm:p-8">
        <h1 className="text-4xl">This page didn&apos;t load</h1>
        <p className="mt-2 text-steel">
          Something went wrong on our side, or your connection dropped. Your cart is safe. Try again, and if it keeps happening, contact us.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button onClick={() => retry()}>Try again</Button>
          <Link href="/" className="inline-flex h-10 items-center px-3 text-steel hover:text-ink">
            Go to the home page
          </Link>
          <Link href="/contact" className="inline-flex h-10 items-center px-3 text-steel hover:text-ink">
            Contact us
          </Link>
        </div>
        {error.digest && <p className="mt-6 text-xs text-steel-light">Reference {error.digest}</p>}
      </div>
    </div>
  );
}
