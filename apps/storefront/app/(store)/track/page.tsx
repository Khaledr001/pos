import { Mail, MessageCircle, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { hasSession } from "@/lib/account-server";
import { getStore } from "@/lib/data";
import { whatsappLink } from "@/lib/format";

export const metadata: Metadata = {
  title: "Track an order",
  description: "Follow your order with the tracking link in your confirmation email or WhatsApp message.",
};

export default async function TrackPage() {
  const [loggedIn, store] = await Promise.all([hasSession(), getStore()]);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-4xl">Track an order</h1>
      <p className="mt-2 text-lg text-steel">Every order has its own tracking page. Here is how to find yours.</p>

      <ul className="mt-6 space-y-3">
        <li className="flex gap-4 rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
          <Mail className="mt-0.5 size-6 shrink-0 text-pipe" aria-hidden />
          <div>
            <h2 className="text-xl">Use the link in your confirmation</h2>
            <p className="mt-1 text-[15px] text-steel">
              When you place an order we send a confirmation by email{store.whatsapp ? " and WhatsApp" : ""}. Open the &ldquo;Track your order&rdquo;
              link in it to see the status, delivery details and tax invoice. No login needed.
            </p>
          </div>
        </li>
        <li className="flex gap-4 rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
          <UserRound className="mt-0.5 size-6 shrink-0 text-pipe" aria-hidden />
          <div>
            <h2 className="text-xl">{loggedIn ? "See all your orders" : "Ordered with an account?"}</h2>
            <p className="mt-1 text-[15px] text-steel">
              {loggedIn
                ? "Every order you placed while logged in is in your account, with invoices and one-click reorder."
                : "Log in to see every order you placed while logged in, with invoices and one-click reorder."}
            </p>
            <ButtonLink href={loggedIn ? "/account/orders" : "/login?next=/account/orders"} variant="secondary" className="mt-3">
              {loggedIn ? "Go to your orders" : "Log in to see your orders"}
            </ButtonLink>
          </div>
        </li>
        <li className="flex gap-4 rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
          <MessageCircle className="mt-0.5 size-6 shrink-0 text-pipe" aria-hidden />
          <div>
            <h2 className="text-xl">Can&apos;t find the link?</h2>
            <p className="mt-1 text-[15px] text-steel">
              Check your spam folder, or send us your order number (it starts with AL-) and we&apos;ll tell you where your order is.
            </p>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[15px]">
              {store.whatsapp && (
                <a href={whatsappLink(store.whatsapp, "Hello, I would like an update on my order AL-")} target="_blank" rel="noopener" className="font-semibold text-pipe hover:underline">
                  WhatsApp us
                </a>
              )}
              {store.phone && (
                <a href={`tel:${store.phone.replace(/\s/g, "")}`} className="font-semibold text-pipe hover:underline">
                  Call {store.phone}
                </a>
              )}
              <Link href="/contact" className="font-semibold text-pipe hover:underline">
                Other ways to reach us
              </Link>
            </p>
          </div>
        </li>
      </ul>
    </div>
  );
}
