"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Store, Lock, Mail, ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Where to land after signing in.
 *
 * Read from `window.location` rather than `useSearchParams`, which forces the
 * page into a Suspense boundary at build time for a value only ever needed
 * inside a click handler.
 *
 * Relative paths only. Accepting an absolute URL here would make the login page
 * an open redirect — the classic phishing primitive, because the link that
 * lands the victim on a real login form is the one they trust.
 */
function nextPath(): string {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next");
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();

  /**
   * Empty, and no demo panel below.
   *
   * This page shipped with the seeded administrator's real email and password
   * pre-filled AND printed on screen under "Demo Credentials". The seed is what
   * a first install actually runs, and `ChangeMe123!` is what a great many of
   * them will still be using — so every deployment of this panel published a
   * working credential for its own tenant to anyone who loaded the login page.
   */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email, password);
      router.push(nextPath());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to authenticate. Please check your credentials.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12 overflow-hidden bg-background">
      {/* ── Animated Background ── */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/4 w-[800px] h-[800px] rounded-full bg-primary/5 blur-3xl animate-float" />
        <div className="absolute -bottom-1/3 -right-1/4 w-[600px] h-[600px] rounded-full bg-violet-500/5 blur-3xl animate-float" style={{ animationDelay: "3s" }} />
        <div className="absolute top-1/4 right-1/3 w-[400px] h-[400px] rounded-full bg-emerald-500/5 blur-3xl animate-float" style={{ animationDelay: "1.5s" }} />
      </div>

      <div className="relative w-full max-w-md animate-fade-in-up">
        <Card className="border-border/50 shadow-2xl shadow-primary/5 backdrop-blur-sm">
          <CardContent className="p-8 space-y-6">
            {/* ── Header ── */}
            <div className="text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl gradient-brand text-white shadow-lg shadow-primary/30">
                <Store className="h-7 w-7" />
              </div>
              <h2 className="mt-5 text-2xl font-bold tracking-tight text-foreground">
                Sign in to DevsFleet
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Multi-Tenant Business Platform · Admin Console
              </p>
            </div>

            {/* ── Error ── */}
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* ── Form ── */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@devsfleet.com"
                    className="pl-10 h-10"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="pl-10 h-10"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 text-sm font-semibold gradient-brand border-0 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all duration-300"
              >
                <span>{loading ? "Authenticating..." : "Sign In to Admin"}</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>

            <div className="text-center text-[11px] text-muted-foreground">
              Connected to API at{" "}
              <code className="font-mono rounded bg-secondary px-1.5 py-0.5">
                localhost:3001/api/v1
              </code>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
