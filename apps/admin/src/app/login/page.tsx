"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Store, Lock, Mail, ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [email, setEmail] = useState("admin@devsfleet.com");
  const [password, setPassword] = useState("ChangeMe123!");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email, password);
      router.push("/");
    } catch (err: any) {
      setError(
        err?.message || "Failed to authenticate. Please check your credentials.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[--color-bg] px-4 py-12">
      <div className="w-full max-w-md space-y-8 rounded-2xl border border-[--color-border] bg-[--color-surface] p-8 shadow-xl">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-[--color-brand] text-white shadow-md">
            <Store className="h-7 w-7" />
          </div>
          <h2 className="mt-4 text-2xl font-bold tracking-tight text-[--color-fg]">
            Sign in to DevsFleet
          </h2>
          <p className="mt-1 text-xs text-[--color-muted]">
            Multi-Tenant Business Platform · Admin Console
          </p>
        </div>

        {/* Demo Credentials Pill */}
        <div className="rounded-lg border border-[--color-brand]/30 bg-[--color-brand]/5 p-3 text-xs text-[--color-fg]">
          <div className="flex items-center gap-1.5 font-semibold text-[--color-brand]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Seeded Platform Admin Credentials:</span>
          </div>
          <div className="mt-1 flex flex-col gap-0.5 font-mono text-[11px] text-[--color-muted]">
            <span>Email: admin@devsfleet.com</span>
            <span>Pass: ChangeMe123!</span>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-[--color-danger]/30 bg-[--color-danger]/10 p-3 text-xs text-[--color-danger]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[--color-fg] mb-1">
              Email Address
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[--color-muted]" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@devsfleet.com"
                className="w-full rounded-lg border border-[--color-border] bg-[--color-bg] py-2 pl-9 pr-3 text-sm text-[--color-fg] placeholder-[--color-muted] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[--color-fg] mb-1">
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[--color-muted]" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full rounded-lg border border-[--color-border] bg-[--color-bg] py-2 pl-9 pr-3 text-sm text-[--color-fg] placeholder-[--color-muted] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[--color-brand] py-2.5 text-sm font-semibold text-white shadow hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer"
          >
            <span>{loading ? "Authenticating..." : "Sign In to Admin"}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <div className="text-center text-[11px] text-[--color-muted]">
          Connected to API at <code className="font-mono">localhost:3001/api/v1</code>
        </div>
      </div>
    </div>
  );
}
