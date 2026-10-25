import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { Quote } from "lucide-react";
import { safeImageSrc } from "@/lib/links";
import { clean, SecHeading, SectionFrame } from "./section-header";

export function Testimonials({ id, settings, align }: { id: string; settings: HomeSectionSettings["testimonials"]; align?: "left" | "center" }) {
  const items = (settings.items ?? []).filter((i) => i.quote.trim() && i.name.trim());
  if (items.length === 0) return null;
  const heading = `testimonials-${id}`;
  const title = clean(settings.title);
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={title ? heading : undefined} aria-label={title ? undefined : "Testimonials"}>
        <SecHeading id={heading} title={title} centered={align === "center"} />
        <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item, i) => {
            const avatar = safeImageSrc(item.avatarUrl);
            return (
              <li key={`${item.name}-${i}`}>
              <figure className="sec-card flex h-full flex-col p-6">
                <Quote className="sec-accent size-7 shrink-0" aria-hidden />
                <blockquote className="mt-3 flex-1 text-[17px] leading-relaxed">{item.quote}</blockquote>
                <figcaption className="mt-5 flex items-center gap-3">
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded image of unknown size
                    <img src={avatar} alt="" loading="lazy" className="size-11 rounded-full object-cover" />
                  ) : (
                    <span aria-hidden className="sec-icon inline-flex size-11 items-center justify-center rounded-full font-cond text-lg font-semibold">
                      {item.name.trim().slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="leading-tight">
                    <span className="block font-semibold">{item.name}</span>
                    {item.role && <span className="sec-muted block text-sm">{item.role}</span>}
                  </span>
                </figcaption>
              </figure>
              </li>
            );
          })}
        </ul>
      </section>
    </SectionFrame>
  );
}
