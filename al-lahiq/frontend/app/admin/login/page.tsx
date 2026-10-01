import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/components/admin/helpers";
import { LoginForm } from "@/components/admin/login-form";
import { getStaffSession } from "@/components/admin/session";

export const metadata: Metadata = { title: "Staff login" };

export default async function StaffLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const { next } = await searchParams;
  const target = safeNext(typeof next === "string" ? next : null);

  // Already logged in: skip the form.
  const staff = await getStaffSession().catch(() => null);
  if (staff && staff !== "busy") redirect(target);

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center bg-sheet px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <svg viewBox="0 0 32 32" className="size-9 shrink-0" aria-hidden>
            <path d="M16 2 28.1 9v14L16 30 3.9 23V9z" fill="var(--color-pipe)" />
            <circle cx="16" cy="16" r="5.5" fill="none" stroke="#fff" strokeWidth="3" />
          </svg>
          <span className="flex flex-col leading-none">
            <span className="font-cond text-[26px] font-bold tracking-wide">Al-Lahiq</span>
            <span className="text-[12px] text-steel">Staff admin</span>
          </span>
        </div>
        <div className="rounded-[var(--radius-panel)] border border-galv bg-paper p-6 shadow-sm">
          <h1 className="text-[28px]">Log in to the admin</h1>
          <p className="mt-1 text-sm text-steel">Use the staff email and password the store owner gave you.</p>
          <LoginForm next={target} />
        </div>
        <p className="mt-4 text-center text-sm text-steel">
          Forgot your password? Ask the store owner to reset it from Staff accounts.
        </p>
      </div>
    </main>
  );
}
