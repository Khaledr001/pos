import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { LeadForm } from "@/components/store/lead-form";
import { getForm } from "@/lib/data";
import { cn } from "@/lib/cn";
import { clean, SecHeading, SectionFrame } from "./section-header";

export async function FormSection({ id, settings, align }: { id: string; settings: HomeSectionSettings["form"]; align?: "left" | "center" }) {
  const slug = clean(settings.formSlug);
  if (!slug) return null;
  const form = await getForm(slug);
  if (!form) return null;
  const heading = `form-${id}`;
  const title = clean(settings.title) ?? form.name;
  const split = settings.layout === "split";
  const intro = (
    <div className={cn(split ? "lg:pt-2" : "mx-auto max-w-2xl", !split && align === "center" && "text-center")}>
      <SecHeading id={heading} title={title} subtitle={clean(settings.subtitle)} centered={!split && align === "center"} />
    </div>
  );
  return (
    <SectionFrame>
      <section className={cn("mt-14", split && "grid gap-8 lg:grid-cols-2")} aria-labelledby={heading}>
        {intro}
        {/* Always a light card: the form's labels are ink on paper whatever band the section sits on. */}
        <div className={cn("rounded-[var(--radius-panel)] border border-galv bg-paper p-5 text-ink sm:p-7", !split && "mx-auto w-full max-w-2xl")}>
          <LeadForm form={form} />
        </div>
      </section>
    </SectionFrame>
  );
}
