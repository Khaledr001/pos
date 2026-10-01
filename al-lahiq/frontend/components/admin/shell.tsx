"use client";

import type { Staff } from "@al-lahiq/api-client";
import { useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Cable,
  ExternalLink,
  FileText,
  FolderTree,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  Tag,
  TicketPercent,
  Truck,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { adminApi } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { areaForPath, can, ROLE_LABEL, type Area } from "./roles";
import { StaffProvider } from "./staff-context";
import { ToastProvider } from "./toast";

type NavItem = { href: string; label: string; icon: LucideIcon; area: Area | null; exact?: boolean };

const NAV: { heading: string | null; items: NavItem[] }[] = [
  { heading: null, items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard, area: null, exact: true }] },
  {
    heading: "Sales",
    items: [
      { href: "/admin/orders", label: "Orders", icon: ShoppingBag, area: "orders" },
      { href: "/admin/customers", label: "Customers", icon: Users, area: "customers" },
      { href: "/admin/promotions", label: "Promotions", icon: TicketPercent, area: "promotions" },
    ],
  },
  {
    heading: "Catalogue",
    items: [
      { href: "/admin/products", label: "Products", icon: Boxes, area: "catalog" },
      { href: "/admin/categories", label: "Categories", icon: FolderTree, area: "catalog" },
      { href: "/admin/brands", label: "Brands", icon: Tag, area: "catalog" },
      { href: "/admin/attributes", label: "Filter attributes", icon: SlidersHorizontal, area: "catalog" },
    ],
  },
  {
    heading: "Website",
    items: [{ href: "/admin/content", label: "Pages and banners", icon: FileText, area: "content" }],
  },
  {
    heading: "Store setup",
    items: [
      { href: "/admin/settings", label: "Settings", icon: Settings, area: "settings", exact: true },
      { href: "/admin/settings/delivery", label: "Delivery rates", icon: Truck, area: "settings" },
      { href: "/admin/settings/branches", label: "Branches", icon: Store, area: "settings" },
      { href: "/admin/sync", label: "POS connection", icon: Cable, area: "sync" },
      { href: "/admin/staff", label: "Staff accounts", icon: UserCog, area: "staff" },
    ],
  },
];

function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AdminShell({ staff, children }: { staff: Staff; children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the phone menu whenever the page changes.
  const [shownPath, setShownPath] = useState(pathname);
  if (shownPath !== pathname) {
    setShownPath(pathname);
    setMenuOpen(false);
  }

  const area = areaForPath(pathname);
  const allowed = area === null || can(staff.role, area);

  return (
    <StaffProvider staff={staff}>
      <ToastProvider>
        <a href="#admin-main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[80] focus:bg-paper focus:p-3">
          Skip to content
        </a>
        <div className="flex min-h-dvh flex-1">
          <aside className="hidden w-60 shrink-0 lg:block print:hidden">
            <div className="fixed inset-y-0 left-0 w-60 overflow-y-auto bg-ink">
              <Sidebar staff={staff} pathname={pathname} />
            </div>
          </aside>

          {menuOpen && (
            <div className="fixed inset-0 z-50 lg:hidden print:hidden">
              <button type="button" className="absolute inset-0 bg-ink/50" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
              <div id="admin-mobile-nav" className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-ink shadow-2xl">
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Close menu"
                  className="absolute right-2 top-3 rounded-[var(--radius-tag)] p-2 text-white/80 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-5" />
                </button>
                <Sidebar staff={staff} pathname={pathname} />
              </div>
            </div>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar staff={staff} onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />
            <main id="admin-main" className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-5 sm:px-6 sm:py-6 print:max-w-none print:p-0">
              {allowed ? children : <NoAccess />}
            </main>
          </div>
        </div>
      </ToastProvider>
    </StaffProvider>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
      <path d="M16 2 28.1 9v14L16 30 3.9 23V9z" fill="var(--color-pipe)" />
      <circle cx="16" cy="16" r="5.5" fill="none" stroke="#fff" strokeWidth="3" />
    </svg>
  );
}

function Sidebar({ staff, pathname }: { staff: Staff; pathname: string }) {
  return (
    <nav aria-label="Admin" className="flex min-h-full flex-col px-3 pb-4 text-white/80">
      <Link href="/admin" className="flex items-center gap-2 px-2 pb-4 pt-4">
        <Mark />
        <span className="flex flex-col leading-none">
          <span className="font-cond text-[22px] font-bold tracking-wide text-white">Al-Lahiq</span>
          <span className="text-[12px] text-white/60">Staff admin</span>
        </span>
      </Link>
      <div className="flex flex-col gap-4">
        {NAV.map((group, gi) => {
          const items = group.items.filter((i) => i.area === null || can(staff.role, i.area));
          if (!items.length) return null;
          return (
            <div key={gi}>
              {group.heading && <p className="px-2 pb-1 text-[12px] font-semibold text-white/45">{group.heading}</p>}
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const active = isActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-[var(--radius-tag)] px-2 py-1.5 text-[15px] font-medium focus-visible:outline-white",
                          active ? "bg-white/12 text-white shadow-[inset_3px_0_0_var(--color-brass)]" : "hover:bg-white/6 hover:text-white",
                        )}
                      >
                        <Icon className={cn("size-[18px] shrink-0", active ? "text-brass" : "text-white/55")} aria-hidden />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="mt-auto pt-6">
        <Link
          href="/"
          target="_blank"
          rel="noopener"
          className="flex items-center gap-2.5 rounded-[var(--radius-tag)] px-2 py-1.5 text-sm text-white/60 hover:bg-white/6 hover:text-white"
        >
          <ExternalLink className="size-4" aria-hidden />
          Open the shop
        </Link>
      </div>
    </nav>
  );
}

function TopBar({ staff, onMenu, menuOpen }: { staff: Staff; onMenu: () => void; menuOpen: boolean }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [leaving, setLeaving] = useState(false);

  const logout = async () => {
    setLeaving(true);
    try {
      await adminApi.post("/auth/staff/logout");
    } catch {
      // Cookies are cleared server-side when possible; go to the login page either way.
    }
    qc.clear();
    router.replace("/admin/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-galv bg-paper px-3 sm:px-6 print:hidden">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        aria-expanded={menuOpen}
        aria-controls="admin-mobile-nav"
        className="rounded-[var(--radius-tag)] p-2 text-ink hover:bg-galv/60 lg:hidden"
      >
        <Menu className="size-5" />
      </button>
      <Link href="/admin" className="flex items-center gap-2 lg:hidden">
        <span className="font-cond text-xl font-bold">Al-Lahiq</span>
        <span className="sr-only">admin dashboard</span>
      </Link>
      <div className="ml-auto flex min-w-0 items-center gap-3">
        <div className="hidden min-w-0 text-right leading-tight sm:block">
          <p className="truncate text-sm font-semibold">{staff.name}</p>
          <p className="text-[13px] text-steel">{ROLE_LABEL[staff.role]}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={logout} loading={leaving}>
          {!leaving && <LogOut className="size-4" aria-hidden />}
          Log out
        </Button>
      </div>
    </header>
  );
}

function NoAccess() {
  return (
    <div className="mx-auto max-w-lg rounded-[var(--radius-panel)] border border-galv bg-paper px-6 py-10 text-center">
      <h1 className="text-2xl">You don&apos;t have access to this page</h1>
      <p className="mt-2 text-steel">Your staff role doesn&apos;t include this part of the admin. Ask the store owner if you need it.</p>
      <Link href="/admin" className="mt-5 inline-block font-semibold text-pipe underline underline-offset-2">
        Go to the dashboard
      </Link>
    </div>
  );
}
