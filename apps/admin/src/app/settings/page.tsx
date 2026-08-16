"use client";

import React, { useState } from "react";
import {
  Settings,
  ShieldCheck,
  Coins,
  Server,
  Save,
  CheckCircle2,
} from "lucide-react";
import { DEFAULT_TENANT_SETTINGS } from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";

export default function SettingsPage() {
  const { user } = useAuth();
  const [saved, setSaved] = useState(false);

  const [companyName, setCompanyName] = useState(user?.tenantName || "DevsFleet Retail LLC");
  const [currency, setCurrency] = useState(DEFAULT_TENANT_SETTINGS.currency.base);
  const [taxRate, setTaxRate] = useState(DEFAULT_TENANT_SETTINGS.tax.defaultRate);
  const [trn, setTrn] = useState("100234567800003");
  const [apiUrl, setApiUrl] = useState(process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1");

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[--color-fg]">
          Tenant Settings
        </h1>
        <p className="mt-1 text-xs text-[--color-muted]">
          Configure your business profile, taxation, currency, and API endpoints.
        </p>
      </div>

      {saved && (
        <div className="flex items-center gap-2 rounded-lg border border-[--color-success]/30 bg-[--color-success]/10 p-3 text-xs text-[--color-success]">
          <CheckCircle2 className="h-4 w-4" />
          <span>Settings saved successfully!</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        {/* Business Profile */}
        <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-[--color-border] pb-3 text-sm font-semibold text-[--color-fg]">
            <ShieldCheck className="h-4 w-4 text-[--color-brand]" />
            <span>Business & Tenant Profile</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-[--color-fg] mb-1">
                Company Legal Name
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full rounded-lg border border-[--color-border] bg-[--color-bg] p-2 text-xs text-[--color-fg] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[--color-fg] mb-1">
                UAE Tax Registration Number (TRN)
              </label>
              <input
                type="text"
                value={trn}
                onChange={(e) => setTrn(e.target.value)}
                className="w-full font-mono rounded-lg border border-[--color-border] bg-[--color-bg] p-2 text-xs text-[--color-fg] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
              />
            </div>
          </div>
        </div>

        {/* Currency & Taxation */}
        <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-[--color-border] pb-3 text-sm font-semibold text-[--color-fg]">
            <Coins className="h-4 w-4 text-[--color-brand]" />
            <span>Currency & Taxation Rules</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-[--color-fg] mb-1">
                Base Currency (ISO 4217)
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as any)}
                className="w-full rounded-lg border border-[--color-border] bg-[--color-bg] p-2 text-xs text-[--color-fg] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
              >
                <option value="AED">AED (United Arab Emirates Dirham)</option>
                <option value="SAR">SAR (Saudi Riyal)</option>
                <option value="USD">USD (US Dollar)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[--color-fg] mb-1">
                Default VAT Rate (%)
              </label>
              <input
                type="number"
                value={taxRate}
                onChange={(e) => setTaxRate(Number(e.target.value))}
                className="w-full rounded-lg border border-[--color-border] bg-[--color-bg] p-2 text-xs text-[--color-fg] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
              />
            </div>
          </div>
        </div>

        {/* Server & Deployment Endpoints */}
        <div className="rounded-xl border border-[--color-border] bg-[--color-surface] p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 border-b border-[--color-border] pb-3 text-sm font-semibold text-[--color-fg]">
            <Server className="h-4 w-4 text-[--color-brand]" />
            <span>Backend Server Connectivity</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-[--color-fg] mb-1">
              Central API Endpoint
            </label>
            <input
              type="text"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              className="w-full font-mono rounded-lg border border-[--color-border] bg-[--color-bg] p-2 text-xs text-[--color-fg] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
            />
            <p className="mt-1 text-[11px] text-[--color-muted]">
              Change when deploying backend API to a remote VPS (e.g. <code className="font-mono">https://api.devsfleet.com/api/v1</code>).
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            className="flex items-center gap-2 rounded-lg bg-[--color-brand] px-5 py-2.5 text-xs font-semibold text-white shadow hover:opacity-90 transition-opacity cursor-pointer"
          >
            <Save className="h-4 w-4" />
            <span>Save Settings</span>
          </button>
        </div>
      </form>
    </div>
  );
}
