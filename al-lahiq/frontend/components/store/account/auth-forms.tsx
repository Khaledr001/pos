"use client";

import type { Customer } from "@al-lahiq/api-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormError, TextField } from "@/components/ui/field";
import { api, ApiError } from "@/lib/api-browser";
import { useMe, useSessionChanged } from "@/lib/hooks/store";
import { friendlyError } from "./session";

const loginHref = (next: string | null) => (next ? `/login?next=${encodeURIComponent(next)}` : "/login");
const registerHref = (next: string | null) => (next ? `/register?next=${encodeURIComponent(next)}` : "/register");

/** Someone who is already logged in doesn't need this page: send them on. */
function useLeaveIfLoggedIn(next: string | null) {
  const router = useRouter();
  const { data: me } = useMe();
  useEffect(() => {
    if (me) router.replace(next ?? "/account");
  }, [me, next, router]);
}

/** `next` has already been checked to be a path on this site. */
export function LoginForm({ next }: { next: string | null }) {
  useLeaveIfLoggedIn(next);
  const router = useRouter();
  const sessionChanged = useSessionChanged();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.post<Customer>("/auth/login", { email: email.trim(), password });
      await sessionChanged();
      router.replace(next ?? "/account");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "INVALID_CREDENTIALS"
          ? "Email or password is incorrect. Check them and try again."
          : err instanceof ApiError && err.status === 429
            ? "Too many attempts. Wait a minute and try again."
            : friendlyError(err),
      );
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <TextField
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <div aria-live="polite">
        <FormError message={error} />
      </div>
      <Button type="submit" size="lg" className="w-full" loading={pending} disabled={!email || !password}>
        Log in
      </Button>
      <p className="text-center text-[15px] text-steel">
        New to Al-Lahiq?{" "}
        <Link href={registerHref(next)} className="font-semibold text-pipe hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm({ next }: { next: string | null }) {
  useLeaveIfLoggedIn(next);
  const router = useRouter();
  const sessionChanged = useSessionChanged();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const shortPassword = form.password.length > 0 && form.password.length < 8;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setEmailTaken(false);
    if (form.password.length < 8) {
      setError("Use a password of at least 8 characters.");
      return;
    }
    const phone = form.phone.replace(/[\s-]/g, "");
    setPending(true);
    try {
      await api.post<Customer>("/auth/register", {
        email: form.email.trim(),
        password: form.password,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        ...(phone ? { phone } : {}),
      });
      await sessionChanged();
      router.replace(next ?? "/account");
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_TAKEN") setEmailTaken(true);
      else setError(friendlyError(err));
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="First name" autoComplete="given-name" value={form.firstName} onChange={set("firstName")} required maxLength={60} />
        <TextField label="Last name" autoComplete="family-name" value={form.lastName} onChange={set("lastName")} required maxLength={60} />
      </div>
      <TextField label="Email" type="email" autoComplete="email" value={form.email} onChange={set("email")} required />
      <TextField
        label="Mobile (optional)"
        type="tel"
        autoComplete="tel"
        placeholder="+971 50 123 4567"
        value={form.phone}
        onChange={set("phone")}
        hint="A UAE mobile number, for delivery and order updates"
      />
      <TextField
        label="Password"
        type="password"
        autoComplete="new-password"
        value={form.password}
        onChange={set("password")}
        required
        minLength={8}
        hint="At least 8 characters"
        error={shortPassword ? "At least 8 characters" : null}
      />
      <div aria-live="polite">
        {emailTaken && (
          <div role="alert" className="rounded-[var(--radius-tag)] border border-brass/40 bg-brass-tint px-3 py-2 text-sm text-[#7a5a0c]">
            There is already an account with this email.{" "}
            <Link href={loginHref(next)} className="font-semibold underline">
              Log in instead
            </Link>
          </div>
        )}
        <FormError message={error} />
      </div>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        loading={pending}
        disabled={!form.firstName || !form.lastName || !form.email || !form.password}
      >
        Create account
      </Button>
      <p className="text-center text-[15px] text-steel">
        Already have an account?{" "}
        <Link href={loginHref(next)} className="font-semibold text-pipe hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
