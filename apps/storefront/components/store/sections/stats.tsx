import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { cn } from "@/lib/cn";
import { clean, SecHeading, SectionFrame } from "./section-header";

const COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-2 md:grid-cols-3", 4: "grid-cols-2 md:grid-cols-4", 5: "grid-cols-2 md:grid-cols-3 lg:grid-cols-5", 6: "grid-cols-2 md:grid-cols-3 lg:grid-cols-6" };

export function Stats({ id, settings, align }: { id: string; settings: HomeSectionSettings["stats"]; align?: "left" | "center" }) {
  const items = (settings.items ?? []).filter((i) => i.value.trim() && i.label.trim());
  if (items.length === 0) return null;
  const heading = `stats-${id}`;
  const title = clean(settings.title);
  const centered = align !== "left";
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={title ? heading : undefined}>
        <SecHeading id={heading} title={title} centered={centered} />
        <dl className={cn("grid gap-6", COLS[Math.min(items.length, 6)])}>
          {items.map((item) => (
            <div key={`${item.value}-${item.label}`} className={cn("flex flex-col-reverse gap-1", centered && "items-center text-center")}>
              <dt className="sec-muted text-[15px]">{item.label}</dt>
              <dd className="sec-accent font-cond text-5xl font-bold leading-none sm:text-6xl">{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </SectionFrame>
  );
}
