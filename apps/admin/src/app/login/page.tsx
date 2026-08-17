"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Store, Lock, Mail, ArrowRight, AlertCircle, CheckCircle2, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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

            {/* ── Demo Credentials ── */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Demo Credentials Pre-filled</span>
              </div>
              <div className="mt-2 flex flex-col gap-1 font-mono text-[11px] text-muted-foreground">
                <span>Email: admin@devsfleet.com</span>
                <span>Pass: ChangeMe123!</span>
              </div>
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
