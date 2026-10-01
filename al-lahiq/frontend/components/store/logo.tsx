import Link from "next/link";

/** Hex-nut mark + condensed wordmark. */
export function Logo({ inverted = false }: { inverted?: boolean }) {
  const ink = inverted ? "#ffffff" : "var(--color-ink)";
  return (
    <Link href="/" className="inline-flex items-center gap-2" aria-label="Al-Lahiq Building Materials, home">
      <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
        <path d="M16 2 28.1 9v14L16 30 3.9 23V9z" fill="var(--color-pipe)" />
        <circle cx="16" cy="16" r="5.5" fill="none" stroke="#fff" strokeWidth="3" />
      </svg>
      <span className="flex flex-col leading-none">
        <span className="font-cond text-[22px] font-bold tracking-wide" style={{ color: ink }}>
          Al-Lahiq
        </span>
        <span className={inverted ? "text-[11px] text-white/70" : "text-[11px] text-steel"}>Building Materials</span>
      </span>
    </Link>
  );
}
