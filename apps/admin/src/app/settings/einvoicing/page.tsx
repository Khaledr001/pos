"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, Info, Plug, Save, ShieldCheck, XCircle } from "lucide-react";
import {
  DEFAULT_EINVOICE_SETTINGS,
  EAS_UAE_TIN,
  EINVOICE_MODES,
  UAE_SUBDIVISIONS,
  UAE_SUBDIVISION_LABELS,
  isValidTrn,
  tinFromTrn,
  type EinvoiceMode,
  type EinvoiceProvider,
  type EinvoiceProviderView,
  type EinvoiceReadiness,
  type EinvoiceSettings,
  type EinvoiceSettingsView,
  type PartyAddress,
  type TenantSettings,
} from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api, getApiOrigin } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { invalidateTenantSettings } from "@/lib/tenant-settings";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Field, Loading, Notice, PageHeader, errorText } from "@/app/online-store/shared";

interface TenantResponse {
  name: string;
  settings: TenantSettings;
}

/** Suggested values for the legal-registration "type" — free text, since the specification does not close the list. */
const LEGAL_TYPES = ["TL", "EID", "PAS", "CD"];

const EMPTY_ADDRESS = { line1: "", line2: "", city: "", subdivision: "", postalCode: "", countryCode: "AE" };
type AddressDraft = typeof EMPTY_ADDRESS;

function addressFrom(a: PartyAddress | undefined): AddressDraft {
  return a
    ? {
        line1: a.line1 ?? "",
        line2: a.line2 ?? "",
        city: a.city ?? "",
        subdivision: a.subdivision ?? "",
        postalCode: a.postalCode ?? "",
        countryCode: a.countryCode || "AE",
      }
    : { ...EMPTY_ADDRESS };
}

const addressTouched = (a: AddressDraft) => !!(a.line1 || a.line2 || a.city || a.subdivision || a.postalCode);

/** Where a readiness check is fixed. Keys are the API's; anything unrecognised just has no link. */
function fixTarget(key: string): { href: string; label: string } | null {
  if (/trn|seller|address|legal|endpoint|peppol|licen|identity/i.test(key)) return { href: "#seller", label: "Seller details" };
  if (/provider|asp|gateway|credential|callback/i.test(key)) return { href: "#provider", label: "Service provider" };
  if (/customer/i.test(key)) return { href: "/customers", label: "Customers" };
  if (/product|categor|tax/i.test(key)) return { href: "/products", label: "Products" };
  if (/unit/i.test(key)) return { href: "/units", label: "Units" };
  return null;
}

/** The ASP calls this. The API may give the path with or without the `/api/v1` prefix. */
function callbackUrl(path: string): string {
  const origin = getApiOrigin();
  if (path.startsWith("/api/")) return `${origin}${path}`;
  return `${origin}/api/v1${path.startsWith("/") ? path : `/${path}`}`;
}

const HTTPS_URL = /^https:\/\/[^\s/$.?#][^\s]*$/i;

export default function EinvoicingSettingsPage() {
  const { tokens } = useAuth();
  const mayWrite = usePermission("settings:write");
  const auth = useMemo(() => ({ accessToken: tokens?.accessToken }), [tokens]);

  const [view, setView] = useState<EinvoiceSettingsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Seller identity
  const [legalName, setLegalName] = useState("");
  const [trn, setTrn] = useState("");
  const [address, setAddress] = useState<AddressDraft>({ ...EMPTY_ADDRESS });
  const [endpointScheme, setEndpointScheme] = useState("");
  const [endpointId, setEndpointId] = useState("");
  const [regId, setRegId] = useState("");
  const [regType, setRegType] = useState("");
  const [regAuthority, setRegAuthority] = useState("");
  const [sellerBusy, setSellerBusy] = useState(false);
  const [sellerError, setSellerError] = useState<string | null>(null);

  // Provider
  const [provider, setProvider] = useState<EinvoiceProvider>("sandbox");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [credentials, setCredentials] = useState("");
  const [replacingCredentials, setReplacingCredentials] = useState(false);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Switches
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<EinvoiceMode>("sandbox");
  const [startDate, setStartDate] = useState("");
  const [autoSubmit, setAutoSubmit] = useState(true);
  const [switchBusy, setSwitchBusy] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);

  const [readinessBusy, setReadinessBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [v, tenant] = await Promise.all([
        api.get<EinvoiceSettingsView>("/einvoice/settings", auth),
        api.get<TenantResponse>("/tenant", auth),
      ]);
      setView(v);
      const s = v.settings;
      setLegalName(tenant.settings.legalName ?? "");
      setTrn(tenant.settings.trn ?? "");
      setAddress(addressFrom(tenant.settings.legalAddress));
      setEndpointScheme(s.endpoint?.scheme ?? "");
      setEndpointId(s.endpoint?.id ?? "");
      setRegId(s.legalRegistration?.id ?? "");
      setRegType(s.legalRegistration?.type ?? "");
      setRegAuthority(s.legalRegistration?.authority ?? "");
      setEnabled(s.enabled);
      setMode(s.mode);
      setStartDate(s.startDate ?? "");
      setAutoSubmit(s.autoSubmit);
      setProvider(v.provider?.provider ?? "sandbox");
      setEndpointUrl(v.provider?.endpointUrl ?? "");
      setCredentials("");
      setReplacingCredentials(false);
      setError(null);
    } catch (err) {
      setError(errorText(err, "Failed to load the e-invoicing settings."));
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    void load();
  }, [load]);

  const saved: EinvoiceSettings = view?.settings ?? DEFAULT_EINVOICE_SETTINGS;
  const providerView: EinvoiceProviderView | null = view?.provider ?? null;

  const trnFilled = trn.trim().length > 0;
  const trnValid = isValidTrn(trn);
  const tin = trnValid ? tinFromTrn(trn) : null;

  async function refreshReadiness() {
    setReadinessBusy(true);
    try {
      const readiness = await api.get<EinvoiceReadiness>("/einvoice/readiness", auth);
      setView((v) => (v ? { ...v, readiness } : v));
    } catch (err) {
      setError(errorText(err, "Could not re-check readiness."));
    } finally {
      setReadinessBusy(false);
    }
  }

  // ── Seller ─────────────────────────────────────────────────────────────

  function sellerProblem(): string | null {
    if (trnFilled && !trnValid) return "The TRN must be 15 digits starting with 100.";
    if (addressTouched(address)) {
      if (!address.line1.trim()) return "The legal address needs a first line.";
      if (!address.city.trim()) return "The legal address needs a city.";
      if (!address.subdivision.trim()) return `The legal address needs ${address.countryCode.toUpperCase() === "AE" ? "an emirate" : "a region"}.`;
      if (!/^[A-Za-z]{2}$/.test(address.countryCode.trim())) return "The country is a two-letter ISO code, e.g. AE.";
    }
    if (!!endpointScheme.trim() !== !!endpointId.trim()) return "A Peppol address needs both a scheme and an identifier, or neither.";
    if (regId.trim() && (!regType.trim() || !regAuthority.trim())) return "A legal registration needs its number, type and issuing authority.";
    return null;
  }

  async function saveSeller(e: React.FormEvent) {
    e.preventDefault();
    const problem = sellerProblem();
    if (problem) {
      setSellerError(problem);
      return;
    }
    setSellerBusy(true);
    setSellerError(null);
    try {
      await api.patch(
        "/tenant/settings",
        {
          legalName: legalName.trim() || undefined,
          trn: trn.trim() ? trn.trim() : undefined,
          ...(addressTouched(address)
            ? {
                legalAddress: {
                  line1: address.line1.trim(),
                  ...(address.line2.trim() ? { line2: address.line2.trim() } : {}),
                  city: address.city.trim(),
                  subdivision: address.subdivision.trim(),
                  ...(address.postalCode.trim() ? { postalCode: address.postalCode.trim() } : {}),
                  countryCode: address.countryCode.trim().toUpperCase(),
                } satisfies PartyAddress,
              }
            : {}),
        },
        auth,
      );
      invalidateTenantSettings();
      const next: EinvoiceSettings = {
        ...saved,
        endpoint: endpointScheme.trim() && endpointId.trim() ? { scheme: endpointScheme.trim(), id: endpointId.trim() } : null,
        legalRegistration: regId.trim() ? { id: regId.trim(), type: regType.trim(), authority: regAuthority.trim() } : null,
      };
      await api.put("/einvoice/settings", next, auth);
      setSuccess("Seller details saved.");
      await load();
    } catch (err) {
      setSellerError(errorText(err, "The seller details were not saved."));
    } finally {
      setSellerBusy(false);
    }
  }

  // ── Provider ───────────────────────────────────────────────────────────

  const gateway = provider === "gateway";
  const urlProblem = gateway && !HTTPS_URL.test(endpointUrl.trim()) ? "Enter the provider's https:// address." : null;
  const needsCredentials = gateway && !providerView?.hasCredentials;
  const showCredentialInput = gateway && (!providerView?.hasCredentials || replacingCredentials);

  async function saveProvider(e: React.FormEvent) {
    e.preventDefault();
    if (urlProblem) {
      setProviderError(urlProblem);
      return;
    }
    if (needsCredentials && !credentials.trim()) {
      setProviderError("Enter the credentials your provider gave you.");
      return;
    }
    setProviderBusy(true);
    setProviderError(null);
    try {
      await api.put<EinvoiceProviderView>(
        "/einvoice/provider",
        {
          provider,
          ...(gateway ? { endpointUrl: endpointUrl.trim() } : {}),
          // Write-only: omitted unless the person typed a new one, so "keep" is the default.
          ...(gateway && credentials.trim() ? { credentials: credentials.trim() } : {}),
        },
        auth,
      );
      setSuccess("Service provider saved.");
      setTestResult(null);
      await load();
    } catch (err) {
      setProviderError(errorText(err, "The service provider was not saved."));
    } finally {
      setProviderBusy(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.post<{ ok: boolean; message: string }>("/einvoice/provider/test", {}, auth));
      await load();
    } catch (err) {
      setTestResult({ ok: false, message: errorText(err, "The connection test failed.") });
    } finally {
      setTesting(false);
    }
  }

  async function copyCallback() {
    if (!providerView) return;
    try {
      await navigator.clipboard.writeText(callbackUrl(providerView.callbackPath));
      setSuccess("Callback address copied.");
    } catch {
      setError("Could not copy — select the address and copy it by hand.");
    }
  }

  // ── Switches ───────────────────────────────────────────────────────────

  const switchesDirty =
    enabled !== saved.enabled || mode !== saved.mode || (startDate || null) !== saved.startDate || autoSubmit !== saved.autoSubmit;
  const goingLive = enabled && mode === "live" && !(saved.enabled && saved.mode === "live");

  async function saveSwitches() {
    setSwitchBusy(true);
    setSwitchError(null);
    try {
      const next: EinvoiceSettings = { ...saved, enabled, mode, startDate: startDate || null, autoSubmit };
      await api.put("/einvoice/settings", next, auth);
      setSuccess(enabled ? (mode === "live" ? "E-invoicing is live." : "E-invoicing is on in sandbox mode.") : "E-invoicing is off.");
      setConfirmLive(false);
      await load();
    } catch (err) {
      // The server says exactly what is missing (for example, no TRN or legal address).
      setSwitchError(errorText(err, "That change was refused."));
      setConfirmLive(false);
    } finally {
      setSwitchBusy(false);
    }
  }

  function onSaveSwitches() {
    if (goingLive) setConfirmLive(true);
    else void saveSwitches();
  }

  if (loading && !view) return <Loading label="Loading e-invoicing…" />;

  const readiness = view?.readiness;

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="E-invoicing"
        description="Report B2B tax invoices and credit notes to the UAE e-invoicing network through an accredited service provider."
      >
        <Link href="/einvoicing"><Button size="sm" variant="outline">E-invoice register</Button></Link>
      </PageHeader>

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}

      <Card>
        <CardContent className="space-y-3 pt-6 text-sm text-muted-foreground">
          <p>
            The UAE is moving business-to-business tax invoices onto a national e-invoicing network. Your invoices are
            converted to the PINT AE format and sent through an <strong className="text-foreground">accredited service provider (ASP)</strong> you
            appoint. Sales to consumers (B2C) are <strong className="text-foreground">not in scope yet</strong> — only invoices and credit notes to
            businesses with a TRN are sent.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            <li>Businesses with revenue of AED 50 million or more: appoint an ASP by 30 October 2026, e-invoicing mandatory from 1 January 2027.</li>
            <li>All other businesses: appoint an ASP by 31 March 2027, mandatory from 1 July 2027.</li>
            <li>Government entities: mandatory from 1 October 2027.</li>
          </ul>
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>These dates reflect rules published in 2026 and can change. Confirm them with the Federal Tax Authority or the Ministry of Finance, and with your tax adviser, before relying on them.</span>
          </p>
        </CardContent>
      </Card>

      {/* ── Readiness ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-emerald-500 to-teal-600 text-white">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Readiness</CardTitle>
                <CardDescription className="text-[11px]">What must be in place before you can switch e-invoicing on.</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {readiness && (
                <Badge variant={readiness.ready ? "success" : "warning"}>{readiness.ready ? "Ready" : "Not ready yet"}</Badge>
              )}
              <Button size="sm" variant="outline" disabled={readinessBusy} onClick={() => void refreshReadiness()}>
                {readinessBusy ? "Checking…" : "Re-check"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!readiness ? (
            <p className="text-xs text-muted-foreground">Readiness is not available.</p>
          ) : (
            <>
              <ul className="divide-y divide-border rounded-xl border border-border text-xs">
                {readiness.checks.map((c) => {
                  const fix = !c.ok ? fixTarget(c.key) : null;
                  return (
                    <li key={c.key} className="flex items-start gap-2.5 px-3 py-2.5">
                      {c.ok ? (
                        <CheckCircle2 aria-label="Done" className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle aria-label="Not done" className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-foreground">{c.label}</p>
                        {c.detail && <p className="mt-0.5 text-muted-foreground">{c.detail}</p>}
                      </div>
                      {fix &&
                        (fix.href.startsWith("#") ? (
                          <a href={fix.href} className="shrink-0 text-primary underline-offset-2 hover:underline">Fix in {fix.label}</a>
                        ) : (
                          <Link href={fix.href} className="shrink-0 text-primary underline-offset-2 hover:underline">Open {fix.label}</Link>
                        ))}
                    </li>
                  );
                })}
              </ul>

              <div>
                <h3 className="text-xs font-semibold text-foreground">
                  Customers that cannot be invoiced yet{readiness.customerIssueTotal > 0 && <span className="ml-1.5 font-mono text-muted-foreground">({readiness.customerIssueTotal})</span>}
                </h3>
                {readiness.customerIssues.length === 0 ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">Every business customer with a TRN has what an e-invoice needs.</p>
                ) : (
                  <>
                    <ul className="mt-2 divide-y divide-border rounded-xl border border-border text-xs">
                      {readiness.customerIssues.map((c) => (
                        <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5">
                          <div className="min-w-0">
                            <Link href={`/customers/${c.id}`} className="font-medium text-foreground hover:text-primary hover:underline">{c.name}</Link>
                            <ul className="mt-0.5 list-disc pl-4 text-muted-foreground">
                              {c.problems.map((p) => <li key={p}>{p}</li>)}
                            </ul>
                          </div>
                          <Link href={`/customers/${c.id}`} className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline">
                            Fix <ExternalLink className="h-3 w-3" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {readiness.customerIssueTotal > readiness.customerIssues.length && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        Showing {readiness.customerIssues.length} of {readiness.customerIssueTotal}. <Link href="/customers" className="text-primary hover:underline">Open all customers</Link>.
                      </p>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Seller identity ───────────────────────────────────────────── */}
      <form id="seller" onSubmit={saveSeller} className="scroll-mt-20">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Seller details</CardTitle>
            <CardDescription className="text-[11px]">Who the invoices come from. This is printed on every electronic invoice.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sellerError && <Notice kind="error" message={sellerError} onClose={() => setSellerError(null)} />}
            <fieldset disabled={!mayWrite || sellerBusy} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Legal name">
                  <Input value={legalName} maxLength={255} onChange={(e) => setLegalName(e.target.value)} />
                </Field>
                <div>
                  <label htmlFor="ei-trn" className="block text-xs font-medium text-foreground mb-1.5">Tax Registration Number (TRN)</label>
                  <Input
                    id="ei-trn"
                    value={trn}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={trnFilled && !trnValid}
                    aria-describedby="ei-trn-hint"
                    onChange={(e) => setTrn(e.target.value)}
                    placeholder="100234567800003"
                    className="font-mono"
                  />
                  <p id="ei-trn-hint" className={cn("mt-1 text-[11px]", trnFilled && !trnValid ? "text-destructive" : "text-muted-foreground")}>
                    {!trnFilled
                      ? "15 digits starting with 100."
                      : trnValid
                        ? <>TIN <span className="font-mono">{tin}</span> · your Peppol address <span className="font-mono">{EAS_UAE_TIN}:{tin}</span></>
                        : "A UAE TRN is 15 digits starting with 100."}
                  </p>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Legal address</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Field label="Address line 1">
                      <Input value={address.line1} maxLength={200} onChange={(e) => setAddress({ ...address, line1: e.target.value })} placeholder="Shop 4, Al Wahda Street" />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field label="Address line 2">
                      <Input value={address.line2} maxLength={200} onChange={(e) => setAddress({ ...address, line2: e.target.value })} placeholder="Optional" />
                    </Field>
                  </div>
                  <Field label="City">
                    <Input value={address.city} maxLength={100} onChange={(e) => setAddress({ ...address, city: e.target.value })} placeholder="Sharjah" />
                  </Field>
                  <div>
                    <label htmlFor="ei-sub" className="block text-xs font-medium text-foreground mb-1.5">
                      {address.countryCode.toUpperCase() === "AE" ? "Emirate" : "Region / state"}
                    </label>
                    {address.countryCode.toUpperCase() === "AE" ? (
                      <SelectField
                        id="ei-sub"
                        size="sm"
                        label="Emirate"
                        placeholder="— Select emirate —"
                        value={address.subdivision}
                        onValueChange={(v) => setAddress({ ...address, subdivision: v })}
                        options={UAE_SUBDIVISIONS.map((s) => ({ value: s, label: `${UAE_SUBDIVISION_LABELS[s]} (${s})` }))}
                      />
                    ) : (
                      <Input id="ei-sub" value={address.subdivision} maxLength={20} onChange={(e) => setAddress({ ...address, subdivision: e.target.value })} />
                    )}
                  </div>
                  <Field label="Postal code">
                    <Input value={address.postalCode} maxLength={20} onChange={(e) => setAddress({ ...address, postalCode: e.target.value })} placeholder="Optional" />
                  </Field>
                  <Field label="Country (ISO code)">
                    <Input value={address.countryCode} maxLength={2} onChange={(e) => setAddress({ ...address, countryCode: e.target.value.toUpperCase() })} className="font-mono uppercase" />
                  </Field>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Peppol address (optional override)</p>
                <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                  <Field label="Scheme">
                    <Input value={endpointScheme} maxLength={4} onChange={(e) => setEndpointScheme(e.target.value)} placeholder={EAS_UAE_TIN} className="font-mono" />
                  </Field>
                  <Field label="Identifier" hint={`Leave both blank to use your TIN (scheme ${EAS_UAE_TIN}), taken from the TRN.`}>
                    <Input value={endpointId} maxLength={100} onChange={(e) => setEndpointId(e.target.value)} className="font-mono" />
                  </Field>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Legal registration (trade licence)</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Number">
                    <Input value={regId} maxLength={60} onChange={(e) => setRegId(e.target.value)} className="font-mono" />
                  </Field>
                  <Field label="Type" hint="TL trade licence, EID Emirates ID, PAS passport, CD cabinet decision.">
                    <Input value={regType} maxLength={10} list="ei-legal-types" onChange={(e) => setRegType(e.target.value.toUpperCase())} placeholder="TL" className="font-mono" />
                    <datalist id="ei-legal-types">{LEGAL_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
                  </Field>
                  <Field label="Issuing authority">
                    <Input value={regAuthority} maxLength={120} onChange={(e) => setRegAuthority(e.target.value)} placeholder="e.g. Sharjah Economic Development Department" />
                  </Field>
                </div>
              </div>
            </fieldset>
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!mayWrite || sellerBusy}>
                <Save className="h-4 w-4" /> {sellerBusy ? "Saving…" : "Save seller details"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* ── Service provider ──────────────────────────────────────────── */}
      <form id="provider" onSubmit={saveProvider} className="scroll-mt-20">
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-blue-500 to-indigo-600 text-white">
                <Plug className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-sm">Service provider</CardTitle>
                <CardDescription className="text-[11px]">The accredited provider that sends your invoices to the network.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {providerError && <Notice kind="error" message={providerError} onClose={() => setProviderError(null)} />}
            <fieldset disabled={!mayWrite || providerBusy} className="space-y-4">
              <Field label="Provider">
                <SelectField
                  size="sm"
                  label="Provider"
                  value={provider}
                  onValueChange={(v) => {
                    setProvider(v as EinvoiceProvider);
                    setProviderError(null);
                  }}
                  options={[
                    { value: "sandbox", label: "Sandbox — nothing is sent anywhere" },
                    { value: "gateway", label: "Gateway — your accredited service provider" },
                  ]}
                />
              </Field>

              {provider === "sandbox" ? (
                <p className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
                  The sandbox builds and validates every document but sends it nowhere, and pretends to deliver it. Use it to check your data
                  before you appoint a provider.
                </p>
              ) : (
                <>
                  <Field label="Provider address (https)">
                    <Input
                      type="url"
                      value={endpointUrl}
                      maxLength={500}
                      aria-invalid={!!urlProblem && endpointUrl.length > 0}
                      onChange={(e) => setEndpointUrl(e.target.value)}
                      placeholder="https://api.provider.example/einvoice"
                    />
                  </Field>

                  <div>
                    <label htmlFor="ei-credentials" className="block text-xs font-medium text-foreground mb-1.5">Credentials</label>
                    {showCredentialInput ? (
                      <Input
                        id="ei-credentials"
                        type="password"
                        autoComplete="off"
                        value={credentials}
                        onChange={(e) => setCredentials(e.target.value)}
                        placeholder={providerView?.hasCredentials ? "Enter the new credentials" : "API key or token from your provider"}
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="success">Saved</Badge>
                        <span className="text-muted-foreground">Stored encrypted. They are never shown again.</span>
                        <Button type="button" size="sm" variant="outline" onClick={() => setReplacingCredentials(true)}>Replace</Button>
                      </div>
                    )}
                    <p className="mt-1 text-[11px] text-muted-foreground">Write-only. Leave blank to keep what is saved.</p>
                  </div>
                </>
              )}
            </fieldset>

            {providerView && (
              <div className="space-y-1.5 rounded-xl border border-border p-3 text-xs">
                <p className="font-medium text-foreground">Callback address</p>
                <p className="text-muted-foreground">Give this to your provider so it can report each document&rsquo;s status back.</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-secondary px-2 py-1.5 font-mono text-[11px]" title={callbackUrl(providerView.callbackPath)}>
                    {callbackUrl(providerView.callbackPath)}
                  </code>
                  <Button type="button" size="sm" variant="outline" onClick={() => void copyCallback()}><Copy className="h-3.5 w-3.5" /> Copy</Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Button type="button" size="sm" variant="outline" disabled={!mayWrite || testing || !providerView} onClick={() => void testConnection()}>
                  {testing ? "Testing…" : "Test connection"}
                </Button>
                {testResult && (
                  <span role="status" className={cn("inline-flex items-center gap-1", testResult.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                    {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                    {testResult.message}
                  </span>
                )}
                {!testResult && providerView?.lastTestAt && (
                  <span className="text-muted-foreground">
                    Last test {new Date(providerView.lastTestAt).toLocaleString()} — {providerView.lastTestOk ? "passed" : "failed"}
                  </span>
                )}
                {!providerView && <span className="text-muted-foreground">Save the provider first, then test it.</span>}
              </div>
              <Button type="submit" size="sm" disabled={!mayWrite || providerBusy}>
                <Save className="h-4 w-4" /> {providerBusy ? "Saving…" : "Save provider"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* ── Switches ──────────────────────────────────────────────────── */}
      <Card id="switches" className="scroll-mt-20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Turn it on</CardTitle>
          <CardDescription className="text-[11px]">Only invoices and credit notes issued after the start date are sent.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {switchError && <Notice kind="error" message={switchError} onClose={() => setSwitchError(null)} />}
          <fieldset disabled={!mayWrite || switchBusy} className="space-y-4">
            <label className="flex items-center gap-2 text-xs font-medium text-foreground">
              <input type="checkbox" className="h-4 w-4 rounded border-input" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              E-invoicing enabled
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mode" hint={mode === "live" ? "Live: documents are reported to the tax authority's network." : "Sandbox: documents are built and checked but never reported."}>
                <SelectField
                  size="sm"
                  label="Mode"
                  value={mode}
                  onValueChange={(v) => setMode(v as EinvoiceMode)}
                  options={EINVOICE_MODES.map((m) => ({ value: m, label: m === "live" ? "Live" : "Sandbox" }))}
                />
              </Field>
              <Field label="Start date" hint="Documents issued on or after this date (in your timezone). Leave blank to start immediately.">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
            </div>

            <label className="flex items-start gap-2 text-xs text-foreground">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-input" checked={autoSubmit} onChange={(e) => setAutoSubmit(e.target.checked)} />
              <span>
                <span className="font-medium">Send automatically</span>
                <span className="block text-muted-foreground">Off means each document waits in the register until someone sends it.</span>
              </span>
            </label>
          </fieldset>

          {mode === "live" && enabled && (
            <p className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Live mode reports documents to the tax authority&rsquo;s network. A sent invoice cannot be edited or voided — only corrected with a credit note.</span>
            </p>
          )}

          <div className="flex justify-end">
            <Button size="sm" disabled={!mayWrite || switchBusy || !switchesDirty} onClick={onSaveSwitches}>
              <Save className="h-4 w-4" /> {switchBusy ? "Saving…" : "Save"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={confirmLive} onOpenChange={(o) => !o && !switchBusy && setConfirmLive(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Go live with e-invoicing?
            </DialogTitle>
            <DialogDescription>
              From {startDate ? new Date(`${startDate}T00:00:00`).toLocaleDateString() : "now"}, every invoice and credit note to a business customer will be
              reported to the tax authority&rsquo;s network through your provider.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
            <li>· A sent invoice cannot be edited or voided. It is corrected with a credit note.</li>
            <li>· Check the readiness list above and your customers&rsquo; details first.</li>
            <li>· You can switch back to sandbox, but documents already reported stay reported.</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" disabled={switchBusy} onClick={() => setConfirmLive(false)}>Cancel</Button>
            <Button variant="destructive" disabled={switchBusy} onClick={() => void saveSwitches()}>
              {switchBusy ? "Saving…" : "Go live"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
