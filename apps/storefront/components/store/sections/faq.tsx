import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { ChevronDown } from "lucide-react";
import { JsonLd } from "@/components/store/json-ld";
import { SectionFrame } from "./section-header";

export function Faq({ id, settings }: { id: string; settings: HomeSectionSettings["faq"] }) {
  const items = (settings.items ?? []).filter((i) => i.q.trim() && i.a.trim());
  if (items.length === 0) return null;
  const heading = `faq-${id}`;
  return (
    <SectionFrame>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: items.map((i) => ({
            "@type": "Question",
            name: i.q,
            acceptedAnswer: { "@type": "Answer", text: i.a },
          })),
        }}
      />
      <section className="mt-14" aria-labelledby={heading}>
        <h2 id={heading} className="mb-4 text-3xl">
          {settings.title?.trim() || "Frequently asked questions"}
        </h2>
        <div className="divide-y divide-galv rounded-[var(--radius-panel)] border border-galv bg-paper">
          {items.map((item) => (
            <details key={item.q} className="group px-4">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold [&::-webkit-details-marker]:hidden">
                {item.q}
                <ChevronDown className="size-5 shrink-0 text-steel transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <p className="pb-4 text-[15px] text-steel">{item.a}</p>
            </details>
          ))}
        </div>
      </section>
    </SectionFrame>
  );
}
