import type { Branch } from "@al-lahiq/api-client";
import { Camera, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/store/listing";
import { buttonClass } from "@/components/ui/button";
import { cached, publicApi, tags } from "@/lib/api-server";
import { getStore } from "@/lib/data";
import { emirateName, whatsappLink } from "@/lib/format";

export const metadata: Metadata = {
  title: "Contact us",
  description: "Call, email or WhatsApp Al-Lahiq Building Materials. Can't find a product? Send us the part name, size or a photo and we'll source it.",
  alternates: { canonical: "/contact" },
};

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-3">
      <span className="mt-0.5 text-steel">{icon}</span>
      <div>
        <dt className="text-sm text-steel">{label}</dt>
        <dd className="text-[15px]">{children}</dd>
      </div>
    </div>
  );
}

export default async function ContactPage() {
  const [store, branches] = await Promise.all([
    getStore(),
    publicApi.get<Branch[]>("/content/branches", cached([tags.content])).catch(() => [] as Branch[]),
  ]);
  const wa = store.whatsapp ? whatsappLink(store.whatsapp) : null;
  const sourcing = store.whatsapp
    ? whatsappLink(store.whatsapp, "Hello, I'm looking for a part I couldn't find on the website: ")
    : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Breadcrumbs items={[{ href: "/contact", label: "Contact us" }]} />
      <h1 className="mt-3 text-4xl">Contact us</h1>
      <p className="mt-1 text-steel">Questions about a product, an order or a trade account? We&apos;re happy to help.</p>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_1fr]">
        <section aria-labelledby="reach" className="rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
          <h2 id="reach" className="text-2xl">
            {store.name}
          </h2>
          <dl className="mt-2 divide-y divide-galv">
            {store.phone && (
              <Row icon={<Phone className="size-5" aria-hidden />} label="Phone">
                <a href={`tel:${store.phone.replace(/\s/g, "")}`} className="font-medium text-pipe hover:underline">
                  {store.phone}
                </a>
              </Row>
            )}
            {wa && (
              <Row icon={<MessageCircle className="size-5" aria-hidden />} label="WhatsApp">
                <a href={wa} target="_blank" rel="noopener" className="font-medium text-pipe hover:underline">
                  Message us on WhatsApp
                </a>
              </Row>
            )}
            {store.email && (
              <Row icon={<Mail className="size-5" aria-hidden />} label="Email">
                <a href={`mailto:${store.email}`} className="font-medium text-pipe hover:underline">
                  {store.email}
                </a>
              </Row>
            )}
            <Row icon={<MapPin className="size-5" aria-hidden />} label="Head office">
              {store.address}
            </Row>
          </dl>
          {store.trn && (
            <p className="mt-2 text-sm text-steel">
              {store.legalName}, TRN {store.trn}
            </p>
          )}
        </section>

        <section aria-labelledby="source" className="flex flex-col rounded-[var(--radius-panel)] border border-brass/40 bg-brass-tint p-5">
          <Camera className="size-7 text-[#7a5a0c]" aria-hidden />
          <h2 id="source" className="mt-2 text-2xl">
            Can&apos;t find a product?
          </h2>
          <p className="mt-1 text-[15px]">
            Send us the part name, size or a photo on WhatsApp and we&apos;ll source it. Contractors can send a whole materials list for a quote.
          </p>
          {sourcing && (
            <a href={sourcing} target="_blank" rel="noopener" className={buttonClass("primary", "md", "mt-4 self-start")}>
              <MessageCircle className="size-4" aria-hidden /> Send it on WhatsApp
            </a>
          )}
        </section>
      </div>

      {branches.length > 0 && (
        <section aria-labelledby="branches" className="mt-6 rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="branches" className="text-2xl">
              Our branches
            </h2>
            <Link href="/branches" className="text-sm font-semibold text-pipe hover:underline">
              Opening hours and directions
            </Link>
          </div>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {branches.map((b) => (
              <li key={b.code} className="text-[15px]">
                <p className="font-medium">{b.name}</p>
                <p className="text-steel">{emirateName(b.emirate)}</p>
                {b.phone && (
                  <a href={`tel:${b.phone.replace(/\s/g, "")}`} className="text-pipe hover:underline">
                    {b.phone}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-6 text-[15px] text-steel">
        Looking for an order? <Link href="/track" className="text-pipe underline">Track it here</Link>, or see{" "}
        <Link href="/pages/delivery-returns" className="text-pipe underline">delivery and returns</Link> and our{" "}
        <Link href="/pages/faq" className="text-pipe underline">FAQ</Link>.
      </p>
    </div>
  );
}
