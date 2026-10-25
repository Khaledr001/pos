import type { HomeSectionSettings } from "@devsfleet/shared-types";
import { badgeIcon } from "./icons";

export function TrustBadges({ settings }: { settings: HomeSectionSettings["trust_badges"] }) {
  const items = (settings.items ?? []).filter((i) => i.title.trim());
  if (items.length === 0) return null;
  return (
    <section aria-label="Why buy here" className="border-b border-galv bg-paper">
      <ul className="mx-auto grid max-w-7xl grid-cols-2 gap-x-6 gap-y-4 px-4 py-5 lg:grid-cols-4">
        {items.map((item) => {
          const Icon = badgeIcon(item.icon);
          return (
            <li key={`${item.icon}-${item.title}`} className="flex items-center gap-3">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-pipe-tint text-pipe">
                <Icon className="size-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold leading-tight">{item.title}</span>
                {item.text && <span className="block text-sm text-steel">{item.text}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
