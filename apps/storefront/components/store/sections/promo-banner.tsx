import type { HomeData } from "@devsfleet/storefront-client";
import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { BadgePercent } from "lucide-react";
import { NavAnchor } from "@/components/store/nav-anchor";
import { buttonClass } from "@/components/ui/button";
import { safeHref } from "@/lib/links";
import { SectionFrame } from "./section-header";

/**
 * The shop's own words win; otherwise the second hero banner from Online
 * Store → Content, which is what this slot showed before it was configurable.
 */
export function PromoBanner({ settings, home }: { settings: HomeSectionSettings["promo_banner"]; home: HomeData }) {
  const banner = home.hero[1];
  const headline = settings.headline?.trim() || banner?.title;
  if (!headline) return null;
  const text = settings.text?.trim() || banner?.subtitle;
  const href = safeHref(settings.ctaHref ?? banner?.linkUrl);
  const label = settings.ctaLabel?.trim() || banner?.ctaLabel || "Find out more";
  return (
    <SectionFrame>
      <section className="blueprint mt-14 grid gap-6 rounded-[var(--radius-panel)] bg-ink p-6 text-white sm:p-10 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:gap-8">
        <span className="hidden size-14 items-center justify-center rounded-[var(--radius-panel)] bg-brass text-ink lg:inline-flex">
          <BadgePercent className="size-7" aria-hidden />
        </span>
        <div>
          <h2 className="text-3xl sm:text-4xl">{headline}</h2>
          {text && <p className="mt-2 max-w-[60ch] text-lg text-white/80">{text}</p>}
        </div>
        {href && (
          <NavAnchor href={href} className={buttonClass("brass", "lg", "justify-self-start")}>
            {label}
          </NavAnchor>
        )}
      </section>
    </SectionFrame>
  );
}
