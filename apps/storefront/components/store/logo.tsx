import Link from "next/link";

/**
 * The shop's mark and name. A tenant's own logo when it has one; otherwise
 * the hex-nut mark beside the store's name — the same storefront serves
 * every tenant, so nothing here names one.
 */
export function Logo({
  name,
  tagline,
  logoUrl,
  inverted = false,
}: {
  name: string;
  tagline?: string | null;
  logoUrl?: string | null;
  inverted?: boolean;
}) {
  const ink = inverted ? "#ffffff" : "var(--color-ink)";
  return (
    <Link href="/" className="inline-flex items-center gap-2" aria-label={`${name}, home`}>
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="h-8 w-auto max-w-32 shrink-0 object-contain" />
      ) : (
        <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
          <path d="M16 2 28.1 9v14L16 30 3.9 23V9z" fill="var(--color-pipe)" />
          <circle cx="16" cy="16" r="5.5" fill="none" stroke="#fff" strokeWidth="3" />
        </svg>
      )}
      <span className="flex flex-col leading-none">
        <span className="font-cond text-[22px] font-bold tracking-wide" style={{ color: ink }}>
          {name}
        </span>
        {tagline && <span className={inverted ? "text-[11px] text-white/70" : "text-[11px] text-steel"}>{tagline}</span>}
      </span>
    </Link>
  );
}
