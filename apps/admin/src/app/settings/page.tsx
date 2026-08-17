"use client";

import React, { useEffect, useState } from "react";
import { ShieldCheck, Coins, Server, Save, CheckCircle2, Activity, AlertCircle } from "lucide-react";
import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SETTINGS_KEY = "devsfleet_tenant_settings";

export default function SettingsPage() {
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);
  const [testingApi, setTestingApi] = useState(false);
  const [apiStatus, setApiStatus] = useState<"idle" | "connected" | "failed">("idle");

  const [companyName, setCompanyName] = useState(user?.tenantName || "DevsFleet Retail LLC");
  const [currency, setCurrency] = useState(DEFAULT_TENANT_SETTINGS.currency.base);
  const [taxRate, setTaxRate] = useState(DEFAULT_TENANT_SETTINGS.tax.defaultRate);
  const [trn, setTrn] = useState("100234567800003");
  const [apiUrl, setApiUrl] = useState(process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.companyName) setCompanyName(parsed.companyName);
        if (parsed.currency) setCurrency(parsed.currency);
        if (parsed.taxRate !== undefined) setTaxRate(parsed.taxRate);
        if (parsed.trn) setTrn(parsed.trn);
        if (parsed.apiUrl) setApiUrl(parsed.apiUrl);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleTestApi = async () => {
    setTestingApi(true);
    setApiStatus("idle");
    try {
      await api.get("/health");
      setApiStatus("connected");
    } catch {
      setApiStatus("failed");
    } finally {
      setTestingApi(false);
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          companyName,
          currency,
          taxRate,
          trn,
          apiUrl,
        })
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Tenant Settings</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Configure your business profile, taxation, currency, and API endpoints.</p>
      </div>

      {saved && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400 animate-fade-in-up">
          <CheckCircle2 className="h-4 w-4" />
          <span>Settings saved successfully!</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* ── Business Profile ── */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Business & Tenant Profile</CardTitle>
                <CardDescription className="text-[11px]">Legal entity information</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Company Legal Name</label>
                <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">UAE Tax Registration Number (TRN)</label>
                <Input value={trn} onChange={(e) => setTrn(e.target.value)} className="font-mono" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Currency & Taxation ── */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white">
                <Coins className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Currency & Taxation Rules</CardTitle>
                <CardDescription className="text-[11px]">Financial configuration</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Base Currency (ISO 4217)</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as any)}
                  className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="AED">AED (United Arab Emirates Dirham)</option>
                  <option value="SAR">SAR (Saudi Riyal)</option>
                  <option value="USD">USD (US Dollar)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">Default VAT Rate (%)</label>
                <Input type="number" value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Server Connectivity ── */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                <Server className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Backend Server Connectivity</CardTitle>
                <CardDescription className="text-[11px]">API endpoint configuration</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">Central API Endpoint</label>
              <Input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} className="font-mono" />
              <p className="mt-2 text-[11px] text-muted-foreground">
                Change when deploying backend API to a remote VPS (e.g.{" "}
                <code className="font-mono rounded bg-secondary px-1.5 py-0.5">https://api.devsfleet.com/api/v1</code>
                ).
              </p>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestApi}
                disabled={testingApi}
                className="text-xs"
              >
                <Activity className="h-3.5 w-3.5" />
                {testingApi ? "Testing..." : "Test Connection"}
              </Button>
              {apiStatus === "connected" && (
                <Badge variant="success" className="text-xs gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  API is reachable & healthy
                </Badge>
              )}
              {apiStatus === "failed" && (
                <Badge variant="destructive" className="text-xs gap-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  Could not reach API endpoint
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" className="gradient-brand border-0 shadow-lg shadow-primary/20">
            <Save className="h-4 w-4" />
            Save Settings
          </Button>
        </div>
      </form>
    </div>
  );
}
