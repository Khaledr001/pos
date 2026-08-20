"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ShieldCheck, Coins, Server, Save, CheckCircle2, Activity, AlertCircle, Receipt } from "lucide-react";
import type { TenantSettings } from "@devsfleet/shared-types";
import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api, getApiBaseUrlOverride, setApiBaseUrlOverride } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface TenantResponse {
  id: string;
  name: string;
  slug: string;
  settings: TenantSettings;
}

export default function SettingsPage() {
  const { tokens } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testingApi, setTestingApi] = useState(false);
  const [apiStatus, setApiStatus] = useState<"idle" | "connected" | "failed">("idle");

  const [tenantName, setTenantName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("");
  const [currencyBase, setCurrencyBase] = useState(DEFAULT_TENANT_SETTINGS.currency.base);

  const [legalName, setLegalName] = useState("");
  const [trn, setTrn] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [taxEnabled, setTaxEnabled] = useState(DEFAULT_TENANT_SETTINGS.tax.enabled);
  const [taxLabel, setTaxLabel] = useState(DEFAULT_TENANT_SETTINGS.tax.label);
  const [taxRate, setTaxRate] = useState(DEFAULT_TENANT_SETTINGS.tax.defaultRate);

  const [enforceCreditLimit, setEnforceCreditLimit] = useState(
    DEFAULT_TENANT_SETTINGS.sales.enforceCreditLimit,
  );
  const [enforceFloorPrice, setEnforceFloorPrice] = useState(
    DEFAULT_TENANT_SETTINGS.sales.enforceFloorPrice,
  );
  const [maxDiscountPercent, setMaxDiscountPercent] = useState(
    DEFAULT_TENANT_SETTINGS.sales.maxDiscountPercent,
  );
  const [quotationValidityDays, setQuotationValidityDays] = useState(
    DEFAULT_TENANT_SETTINGS.sales.quotationValidityDays,
  );

  const [apiUrl, setApiUrl] = useState("");

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const tenant = await api.get<TenantResponse>("/tenant", { accessToken: tokens?.accessToken });
      setTenantName(tenant.name);
      setTenantSlug(tenant.slug);
      setCurrencyBase(tenant.settings.currency.base);
      setLegalName(tenant.settings.legalName ?? "");
      setTrn(tenant.settings.trn ?? "");
      setPhone(tenant.settings.phone ?? "");
      setEmail(tenant.settings.email ?? "");
      setTaxEnabled(tenant.settings.tax.enabled);
      setTaxLabel(tenant.settings.tax.label);
      setTaxRate(tenant.settings.tax.defaultRate);
      setEnforceCreditLimit(tenant.settings.sales.enforceCreditLimit);
      setEnforceFloorPrice(tenant.settings.sales.enforceFloorPrice);
      setMaxDiscountPercent(tenant.settings.sales.maxDiscountPercent);
      setQuotationValidityDays(tenant.settings.sales.quotationValidityDays);
    } catch (err: any) {
      setError(err?.message || "Failed to load settings from the API.");
    } finally {
      setLoading(false);
    }
  }, [tokens]);

  useEffect(() => {
    void fetchSettings();
    setApiUrl(getApiBaseUrlOverride());
  }, [fetchSettings]);

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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // The API endpoint an already-built admin bundle talks to is a local
      // connection setting, not tenant data — it lives in this browser only.
      setApiBaseUrlOverride(apiUrl);

      await api.patch(
        "/tenant/settings",
        {
          legalName: legalName || undefined,
          trn: trn || undefined,
          phone: phone || undefined,
          email: email || undefined,
          tax: { enabled: taxEnabled, label: taxLabel, defaultRate: taxRate },
          sales: {
            enforceCreditLimit,
            enforceFloorPrice,
            maxDiscountPercent,
            quotationValidityDays,
          },
        },
        { accessToken: tokens?.accessToken },
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err: any) {
      setError(err?.message || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Tenant Settings</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Configure your business profile, taxation, and sales policy.
        </p>
      </div>

      {saved && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-600 dark:text-emerald-400 animate-fade-in-up">
          <CheckCircle2 className="h-4 w-4" />
          <span>Settings saved.</span>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          <div className="h-6 w-6 mx-auto mb-3 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          Loading settings...
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm">Business & Tenant Profile</CardTitle>
                  <CardDescription className="text-[11px]">
                    {tenantName} · <span className="font-mono">{tenantSlug}</span>
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Legal Name (shown on invoices)
                  </label>
                  <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Tax Registration Number (TRN)
                  </label>
                  <Input value={trn} onChange={(e) => setTrn(e.target.value)} className="font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Phone</label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">Email</label>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

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
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Base Currency
                  </label>
                  <Input value={currencyBase} disabled className="font-mono bg-secondary/50" />
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Set once, at signup — every stored amount is already in this currency.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Tax Label
                  </label>
                  <Input value={taxLabel} onChange={(e) => setTaxLabel(e.target.value)} placeholder="VAT" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Default Rate (%)
                  </label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={taxRate}
                    onChange={(e) => setTaxRate(Number(e.target.value))}
                  />
                </div>
                <div className="flex items-center gap-2 pt-6">
                  <input
                    id="tax-enabled"
                    type="checkbox"
                    checked={taxEnabled}
                    onChange={(e) => setTaxEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <label htmlFor="tax-enabled" className="text-xs text-foreground">
                    Tax is charged on sales
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                  <Receipt className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm">Sales Policy</CardTitle>
                  <CardDescription className="text-[11px]">
                    Enforced server-side, not just at the till
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Max discount without approval (%)
                  </label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={maxDiscountPercent}
                    onChange={(e) => setMaxDiscountPercent(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    Quotation validity (days)
                  </label>
                  <Input
                    type="number"
                    min="1"
                    max="365"
                    value={quotationValidityDays}
                    onChange={(e) => setQuotationValidityDays(Number(e.target.value))}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="enforce-credit"
                    type="checkbox"
                    checked={enforceCreditLimit}
                    onChange={(e) => setEnforceCreditLimit(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <label htmlFor="enforce-credit" className="text-xs text-foreground">
                    Block a sale past a customer&apos;s credit limit
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="enforce-floor"
                    type="checkbox"
                    checked={enforceFloorPrice}
                    onChange={(e) => setEnforceFloorPrice(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <label htmlFor="enforce-floor" className="text-xs text-foreground">
                    Block selling below floor price without approval
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                  <Server className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm">Backend Server Connectivity</CardTitle>
                  <CardDescription className="text-[11px]">
                    This browser only — not a tenant setting
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">
                  Central API Endpoint
                </label>
                <Input
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder={process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1"}
                  className="font-mono"
                />
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Leave blank to use the build default. Change when pointing this same admin
                  build at a different backend (e.g.{" "}
                  <code className="font-mono rounded bg-secondary px-1.5 py-0.5">
                    https://api.devsfleet.com/api/v1
                  </code>
                  ) — saved to this browser, applies after Save.
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
            <Button type="submit" disabled={saving} className="gradient-brand border-0 shadow-lg shadow-primary/20">
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save Settings"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
