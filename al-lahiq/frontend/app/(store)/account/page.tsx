import type { OrderSummary, Paged } from "@al-lahiq/api-client";
import { ListChecks, MapPin, Package, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { OrderStatusBadge } from "@/components/store/account/order-status";
import { AccountWelcome } from "@/components/store/account/welcome";
import { ButtonLink } from "@/components/ui/button";
import { accountGet, requireSession } from "@/lib/account-server";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

const QUICK_LINKS = [
  { href: "/account/orders", label: "Orders", text: "Track, reorder and download invoices", icon: Package },
  { href: "/account/addresses", label: "Addresses", text: "Homes, offices and site addresses", icon: MapPin },
  { href: "/account/lists", label: "Lists", text: "Wishlist and project lists", icon: ListChecks },
  { href: "/account/profile", label: "Profile and company", text: "Name, mobile, company and TRN", icon: UserRound },
];

export default async function AccountPage() {
  await requireSession("/account");
  const orders = await accountGet<Paged<OrderSummary>>("/me/orders?page=1", "/account");
  const recent = orders.items.slice(0, 3);

  return (
    <div className="space-y-6">
      <AccountWelcome />

      <section aria-labelledby="recent" className="rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="recent" className="text-2xl">
            Recent orders
          </h2>
          {orders.total > 0 && (
            <Link href="/account/orders" className="text-sm font-semibold text-pipe hover:underline">
              All orders ({orders.total})
            </Link>
          )}
        </div>
        {recent.length ? (
          <ul className="divide-y divide-galv">
            {recent.map((o) => (
              <li key={o.id}>
                <Link href={`/account/orders/${o.id}`} className="-mx-2 grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-[var(--radius-tag)] px-2 py-3 hover:bg-sheet sm:grid-cols-[1fr_auto_auto]">
                  <span>
                    <span className="font-cond text-xl font-semibold">{o.orderNumber}</span>
                    <span className="block text-sm text-steel">
                      {formatDate(o.placedAt)}, {o.itemCount === 1 ? "1 item" : `${o.itemCount} items`}
                    </span>
                  </span>
                  <OrderStatusBadge status={o.status} className="justify-self-end sm:justify-self-start" />
                  <span className="tag-price col-span-2 text-xl sm:col-span-1 sm:text-right">{o.total.formatted}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="py-4">
            <p className="text-steel">You haven&apos;t placed an order yet. Your orders and tax invoices will show up here.</p>
            <ButtonLink href="/" variant="secondary" className="mt-4">
              Start shopping
            </ButtonLink>
          </div>
        )}
      </section>

      <nav aria-label="Account sections">
        <ul className="grid gap-3 sm:grid-cols-2">
          {QUICK_LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="flex h-full items-start gap-3 rounded-[var(--radius-panel)] border border-galv bg-paper p-4 hover:border-steel-light">
                <l.icon className="mt-0.5 size-5 shrink-0 text-pipe" aria-hidden />
                <span>
                  <span className="block font-cond text-xl font-semibold">{l.label}</span>
                  <span className="text-sm text-steel">{l.text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
