import type { Banner, HomeData } from "@devsfleet/storefront-client";
import { NavAnchor } from "@/components/store/nav-anchor";
import { safeHref } from "@/lib/links";
import { SectionFrame } from "./section-header";

function BannerCard({ banner }: { banner: Banner }) {
  const href = safeHref(banner.linkUrl);
  const body = (
    <>
      {banner.imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded banner of unknown size
        <img src={banner.imageUrl} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
      )}
      <span className={banner.imageUrl ? "absolute inset-0 bg-gradient-to-t from-ink/80 to-transparent" : "hidden"} aria-hidden />
      <span className="relative flex min-h-32 flex-col justify-end gap-1 p-5 text-white">
        <span className="font-cond text-2xl font-semibold leading-tight">{banner.title}</span>
        {banner.subtitle && <span className="text-sm text-white/85">{banner.subtitle}</span>}
        {href && banner.ctaLabel && <span className="mt-1 text-sm font-semibold underline underline-offset-2">{banner.ctaLabel}</span>}
      </span>
    </>
  );
  const className = "relative block overflow-hidden rounded-[var(--radius-panel)] bg-ink";
  return href ? (
    <NavAnchor href={href} className={className}>
      {body}
    </NavAnchor>
  ) : (
    <div className={className}>{body}</div>
  );
}

export function BannerStrip({ home }: { home: HomeData }) {
  if (home.strip.length === 0) return null;
  return (
    <SectionFrame>
      <section aria-label="Offers" className="mt-12">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {home.strip.map((b) => (
            <li key={b.id}>
              <BannerCard banner={b} />
            </li>
          ))}
        </ul>
      </section>
    </SectionFrame>
  );
}
