import { Ghost } from "lucide-react";
import type { ReactNode } from "react";
import { SOCIAL_NETWORKS, type SocialLinks } from "@devsfleet/shared-types";
import { cn } from "@/lib/cn";
import { safeHref } from "@/lib/links";

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);

// lucide-react no longer ships brand marks, so these are drawn here.
const ICONS: Record<(typeof SOCIAL_NETWORKS)[number], { label: string; icon: ReactNode }> = {
  instagram: {
    label: "Instagram",
    icon: svg(
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
      </>,
    ),
  },
  facebook: { label: "Facebook", icon: svg(<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />) },
  x: { label: "X", icon: svg(<path d="M4 4l16 16M20 4L4 20" />) },
  tiktok: {
    label: "TikTok",
    icon: svg(
      <>
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </>,
    ),
  },
  youtube: {
    label: "YouTube",
    icon: svg(
      <>
        <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
        <path d="m10 15 5-3-5-3z" />
      </>,
    ),
  },
  linkedin: {
    label: "LinkedIn",
    icon: svg(
      <>
        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
        <rect x="2" y="9" width="4" height="12" />
        <circle cx="4" cy="4" r="2" />
      </>,
    ),
  },
  snapchat: { label: "Snapchat", icon: <Ghost className="size-5" aria-hidden /> },
};

/** The shop's social profiles as icon links. Renders nothing when none are set. */
export function SocialLinkList({ social, className }: { social: SocialLinks; className?: string }) {
  const items = SOCIAL_NETWORKS.flatMap((network) => {
    const href = safeHref(social[network]);
    return href && href.startsWith("https://") ? [{ network, href }] : [];
  });
  if (items.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {items.map(({ network, href }) => (
        <li key={network}>
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={ICONS[network].label}
            className="inline-flex size-9 items-center justify-center rounded-full border border-current/25 transition-colors hover:border-current hover:bg-current/10"
          >
            {ICONS[network].icon}
          </a>
        </li>
      ))}
    </ul>
  );
}
