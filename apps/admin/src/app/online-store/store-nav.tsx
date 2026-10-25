import Link from "next/link";
import { Button } from "@/components/ui/button";

const TABS = [
  { href: "/online-store", label: "Settings" },
  { href: "/online-store/appearance", label: "Appearance" },
  { href: "/online-store/home", label: "Home page" },
  { href: "/online-store/navigation", label: "Navigation" },
  { href: "/online-store/content", label: "Pages & banners" },
] as const;

/** Links between the screens that shape the website, so none is a dead end. */
export function StoreTabs({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Online store" className="flex flex-wrap gap-2">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === current ? "page" : undefined}>
          <Button size="sm" variant={t.href === current ? "default" : "outline"}>{t.label}</Button>
        </Link>
      ))}
    </nav>
  );
}
