import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { cn } from "@/lib/cn";
import { clean, SecHeading, SectionFrame } from "./section-header";

export function Steps({ id, settings, align }: { id: string; settings: HomeSectionSettings["steps"]; align?: "left" | "center" }) {
  const items = (settings.items ?? []).filter((i) => i.title.trim());
  if (items.length === 0) return null;
  const heading = `steps-${id}`;
  const title = clean(settings.title);
  const centered = align === "center";
  return (
    <SectionFrame>
      <section className="mt-14" aria-labelledby={title ? heading : undefined} aria-label={title ? undefined : "How it works"}>
        <SecHeading id={heading} title={title} subtitle={clean(settings.subtitle)} centered={centered} />
        <ol className={cn("grid gap-6 sm:grid-cols-2", items.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
          {items.map((item, i) => (
            <li key={`${item.title}-${i}`} className={cn("flex gap-4 sm:flex-col", centered && "sm:items-center sm:text-center")}>
              <span aria-hidden className="sec-icon inline-flex size-12 shrink-0 items-center justify-center rounded-full font-cond text-2xl font-bold">
                {i + 1}
              </span>
              <span className="min-w-0">
                <h3 className="font-cond text-xl font-semibold leading-tight">
                  <span className="sr-only">Step {i + 1}: </span>
                  {item.title}
                </h3>
                {item.text && <p className="sec-muted mt-1 text-[15px]">{item.text}</p>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </SectionFrame>
  );
}
