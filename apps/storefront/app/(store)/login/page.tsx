import type { Metadata } from "next";
import { LoginForm } from "@/components/store/account/auth-forms";
import { safeNext } from "@/lib/format";

export const metadata: Metadata = { title: "Log in", robots: { index: false } };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const raw = (await searchParams).next;
  const next = safeNext(raw, "") || null;

  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-[var(--radius-panel)] border border-galv bg-paper p-6 sm:p-8">
        <h1 className="text-4xl">Log in</h1>
        <p className="mt-1 mb-6 text-steel">See your orders, saved addresses and trade prices.</p>
        <LoginForm next={next} />
      </div>
    </div>
  );
}
