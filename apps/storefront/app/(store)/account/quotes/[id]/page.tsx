import { ApiError, type QuoteView } from "@devsfleet/storefront-client";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QuoteActions } from "@/components/store/account/quote-actions";
import { QuoteDetail } from "@/components/store/account/quote-detail";
import { accountGet, requireSession } from "@/lib/account-server";

export const metadata: Metadata = { title: "Quote details", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function QuotePage({ params }: PageProps<"/account/quotes/[id]">) {
  const { id } = await params;
  const path = `/account/quotes/${id}`;
  await requireSession(path);
  if (!UUID.test(id)) notFound();
  const quote = await accountGet<QuoteView>(`/quotes/${id}`, path).catch((err) => {
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) return null;
    throw err;
  });
  if (!quote) notFound();

  return (
    <QuoteDetail
      quote={quote}
      back={
        <Link href="/account/quotes" className="mb-3 inline-flex items-center gap-1 text-sm text-steel hover:text-ink">
          <ChevronLeft className="size-4" aria-hidden /> All quotes
        </Link>
      }
      actions={quote.status === "QUOTED" ? <QuoteActions id={quote.id} /> : undefined}
    />
  );
}
