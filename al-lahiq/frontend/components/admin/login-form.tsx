"use client";

import type { Staff } from "@al-lahiq/api-client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormError, TextField } from "@/components/ui/field";
import { adminApi, ApiError, errorMessage } from "@/lib/api-browser";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await adminApi.post<Staff>("/auth/staff/login", { email: email.trim(), password });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && (err.status === 401 || err.code === "INVALID_CREDENTIALS")) {
        setError("That email and password don't match a staff account. Check them and try again.");
      } else if (err instanceof ApiError && err.status === 429) {
        setError("Too many attempts. Wait a minute, then try again.");
      } else {
        setError(errorMessage(err));
      }
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 flex flex-col gap-4" noValidate>
      <FormError message={error} />
      <TextField
        label="Email"
        type="email"
        name="email"
        autoComplete="username"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <TextField
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button type="submit" size="lg" loading={busy} disabled={!email || !password}>
        Log in
      </Button>
    </form>
  );
}
