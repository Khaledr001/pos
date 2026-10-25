import type { CardItem, HomeSectionSettings } from "@devsfleet/shared-types";
import { ArrowRight } from "lucide-react";
import { NavAnchor } from "@/components/store/nav-anchor";
import { cn } from "@/lib/cn";
import { safeHref, safeImageSrc } from "@/lib/links";
import { clean, GRID_COLS, SecHeading, SectionFrame } from "./section-header";

type Variant = NonNullable<HomeSectionSettings["cards"]["variant"]>;

function Title({ item, className }: { item: CardItem; className: string }) {
  const href = safeHref(item.href);
  // The title's link stretches over the whole card, so the card is one target, not three.
  return href ? (
    <NavAnchor href={href} className={cn(className, "after:absolute after:inset-0")}>
      {item.title}
    </NavAnchor>
  ) : (
    <span className={className}>{item.title}</span>
  );
}

function Card({ item, variant }: { item: CardItem; variant: Variant }) {
  const image = safeImageSrc(item.imageUrl);
  const linked = !!safeHref(item.href);
  const more = linked && (
    <span className="mt-2 inline-flex items-center gap-1 text-sm font-semibold sec-accent">
      {clean(item.label) ?? "Learn more"} <ArrowRight className="size-4" aria-hidden />
    </span>
  );

  if (variant === "overlay") {
    return (
      <div className="group relative isolate flex aspect-[4/3] items-end overflow-hidden rounded-[var(--radius-panel)] bg-ink text-white">
        {image && (
          // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded image of unknown size
          <img src={image} alt="" loading="lazy" className="absolute inset-0 -z-10 size-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none" />
        )}
        <span aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-ink/85 via-ink/30 to-transparent" />
        <div className="p-5">
          <h3 className="font-cond text-2xl font-semibold leading-tight">
            <Title item={item} className="" />
          </h3>
          {item.text && <p className="mt-1 text-sm text-white/85">{item.text}</p>}
        </div>
      </div>
    );
  }

  if (variant === "person") {
    return (
      <div className="relative flex flex-col items-center text-center">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded image of unknown size
          <img src={image} alt="" loading="lazy" className="size-32 rounded-full object-cover" />
        ) : (
          <span aria-hidden className="sec-icon inline-flex size-32 items-center justify-center rounded-full font-cond text-4xl font-semibold">
            {item.title.trim().slice(0, 1).toUpperCase()}
          </span>
        )}
        <h3 className="mt-3 font-cond text-xl font-semibold leading-tight">
          <Title item={item} className="" />
        </h3>
        {item.text && <p className="sec-muted mt-1 text-[15px]">{item.text}</p>}
        {more}
      </div>
    );
  }

  const boxed = variant === "card";
  return (
    <div className={cn("relative flex h-full flex-col overflow-hidden", boxed && "sec-card")}>
      {image && (
        // eslint-disable-next-line @next/next/no-img-element -- tenant-uploaded image of unknown size
        <img src={image} alt="" loading="lazy" className={cn("aspect-[4/3] w-full object-cover", !boxed && "rounded-[var(--radius-panel)]")} />
      )}
      <div className={cn("flex flex-1 flex-col", boxed ? "p-5" : "pt-3")}>
        <h3 className="font-cond text-xl font-semibold leading-tight">
          <Title item={item} className="" />
        </h3>
        {item.text && <p className="sec-muted mt-1.5 text-[15px]">{item.text}</p>}
        {more}
      </div>
    </div>
  );
}

export function Cards({ id, settings, align }: { id: string; settings: HomeSectionSettings["cards"]; align?: "left" | "center" }) {
  const items = (settings.items ?? []).filter((i) => i.title.trim());
  if (items.length === 0) return null;
  const heading = `cards-${id}`;
  const title = clean(settings.title);
  const variant = settings.variant ?? "card";
  const columns = settings.columns ?? (variant === "person" ? 4 : 3);
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={title ? heading : undefined}>
        <SecHeading id={heading} title={title} subtitle={clean(settings.subtitle)} centered={align === "center"} />
        <ul className={cn("grid gap-5", GRID_COLS[columns])}>
          {items.map((item, i) => (
            <li key={`${item.title}-${i}`}>
              <Card item={item} variant={variant} />
            </li>
          ))}
        </ul>
      </section>
    </SectionFrame>
  );
}
