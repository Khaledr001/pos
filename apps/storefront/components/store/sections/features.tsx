import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { cn } from "@/lib/cn";
import { badgeIcon } from "./icons";
import { clean, GRID_COLS, SecHeading, SectionFrame } from "./section-header";

export function Features({ id, settings, align }: { id: string; settings: HomeSectionSettings["features"]; align?: "left" | "center" }) {
  const items = (settings.items ?? []).filter((i) => i.title.trim());
  if (items.length === 0) return null;
  const heading = `features-${id}`;
  const title = clean(settings.title);
  const centered = align === "center";
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={title ? heading : undefined}>
        <SecHeading id={heading} title={title} subtitle={clean(settings.subtitle)} centered={centered} />
        <ul className={cn("grid gap-6", GRID_COLS[settings.columns ?? 3])}>
          {items.map((item) => {
            const Icon = badgeIcon(item.icon);
            return (
              <li key={`${item.icon}-${item.title}`} className={cn("flex gap-4", centered && "flex-col items-center text-center")}>
                <span className="sec-icon inline-flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-panel)]">
                  <Icon className="size-6" aria-hidden />
                </span>
                <span className="min-w-0">
                  <h3 className="font-cond text-xl font-semibold leading-tight">{item.title}</h3>
                  {item.text && <p className="sec-muted mt-1 text-[15px]">{item.text}</p>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </SectionFrame>
  );
}
