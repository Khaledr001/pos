import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { Check } from "lucide-react";
import { Markdown } from "@/components/store/markdown";
import { NavAnchor } from "@/components/store/nav-anchor";
import { buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { safeHref, safeImageSrc } from "@/lib/links";
import { clean, SectionFrame } from "./section-header";

export function ImageText({ id, settings, align }: { id: string; settings: HomeSectionSettings["image_text"]; align?: "left" | "center" }) {
  const title = clean(settings.title);
  const body = clean(settings.body);
  const image = safeImageSrc(settings.imageUrl);
  const bullets = (settings.bullets ?? []).map((b) => b.trim()).filter(Boolean);
  const cta = safeHref(settings.ctaHref);
  if (!title && !body && !image && bullets.length === 0) return null;
  const heading = `image-text-${id}`;
  const imageLeft = settings.imageSide === "left";
  return (
    <SectionFrame>
      <section className={cn("mt-14 grid gap-8 lg:items-center", image && "lg:grid-cols-2")} aria-labelledby={title ? heading : undefined}>
        <div className={cn(imageLeft && image && "lg:order-2", align === "center" && !image && "mx-auto max-w-3xl text-center")}>
          {title && (
            <h2 id={heading} className="text-3xl sm:text-4xl">
              {title}
            </h2>
          )}
          {body && (
            <div className="mt-3">
              <Markdown>{body}</Markdown>
            </div>
          )}
          {bullets.length > 0 && (
            <ul className="mt-4 space-y-2">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-left">
                  <span className="sec-icon mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full">
                    <Check className="size-3.5" strokeWidth={3} aria-hidden />
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          {cta && (
            <NavAnchor href={cta} className={buttonClass("primary", "lg", "mt-6")}>
              {clean(settings.ctaLabel) ?? "Learn more"}
            </NavAnchor>
          )}
        </div>
        {image && (
          // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded image of unknown size
          <img src={image} alt={settings.imageAlt?.trim() ?? ""} loading="lazy" className="aspect-[4/3] w-full rounded-[var(--radius-panel)] object-cover" />
        )}
      </section>
    </SectionFrame>
  );
}
