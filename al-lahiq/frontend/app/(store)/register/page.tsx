import type { Metadata } from "next";
import { RegisterForm } from "@/components/store/account/auth-forms";
import { safeNext } from "@/lib/format";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

export default async function RegisterPage({ searchParams }: PageProps<"/register">) {
  const next = safeNext((await searchParams).next, "") || null;

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <div className="rounded-[var(--radius-panel)] border border-galv bg-paper p-6 sm:p-8">
        <h1 className="text-4xl">Create an account</h1>
        <p className="mt-1 mb-6 text-steel">
          Keep your order history and saved addresses, reorder in one click, and get trade prices once your business is approved.
        </p>
        <RegisterForm next={next} />
      </div>
    </div>
  );
}
