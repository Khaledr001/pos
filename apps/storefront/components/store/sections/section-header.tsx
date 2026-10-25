import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export function SectionHeader({
  id,
  eyebrow,
  title,
  href,
  link,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  href?: string;
  link?: string;
}) {
  // An eyebrow that repeats the heading ("Best sellers" over "Best sellers") is noise.
  const showEyebrow = eyebrow && eyebrow.trim().toLowerCase() !== title.trim().toLowerCase();
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div>
        {showEyebrow && <p className="text-sm font-semibold uppercase tracking-wider text-pipe">{eyebrow}</p>}
        <h2 id={id} className="mt-1 text-3xl">
          {title}
        </h2>
      </div>
      {href && link && (
        <Link href={href} className="inline-flex min-h-10 items-center gap-1 text-sm font-semibold text-pipe hover:underline">
          {link} <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** Every content section sits in the same page-width column. */
export function SectionFrame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-7xl px-4">{children}</div>;
}

/** Heading block of the content sections: title, optional intro, aligned as the section is. */
export function SecHeading({ id, title, subtitle, centered }: { id: string; title?: string; subtitle?: string; centered?: boolean }) {
  if (!title && !subtitle) return null;
  return (
    <div className={cn("mb-6 max-w-3xl", centered && "mx-auto text-center")}>
      {title && (
        <h2 id={id} className="text-3xl sm:text-4xl">
          {title}
        </h2>
      )}
      {subtitle && <p className="sec-muted mt-2 text-lg">{subtitle}</p>}
    </div>
  );
}

/** Trimmed, or undefined when blank, so `a ?? b` falls through on an empty field. */
export const clean = (value: string | undefined | null) => value?.trim() || undefined;

/** Tailwind needs whole class names, so the column counts are spelled out. */
export const GRID_COLS: Record<2 | 3 | 4, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};
