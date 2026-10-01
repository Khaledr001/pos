"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import { CreditCard, ExternalLink, Globe, Plus, Save, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api, getApiOrigin } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, Loading, Notice, PageHeader, errorText, humanize, selectClass, textareaClass } from "./shared";

const EMIRATES = ["ABU_DHABI", "DUBAI", "SHARJAH", "AJMAN", "UMM_AL_QUWAIN", "RAS_AL_KHAIMAH", "FUJAIRAH"];

interface ShippingRate {
  emirate: string;
  baseFee: string;
  baseWeightKg: number;
  perKgFee: string;
  freeOver: string | null;
  maxWeightKg: number;
  etaDays: number;
  active: boolean;
}

interface OnlineBranch {
  branchId: string;
  emirate: string;
  lat: number | null;
  lng: number | null;
  openingHours: Record<string, string> | null;
  pickupEnabled: boolean;
}

interface Settings {
  displayName?: string;
  whatsapp?: string;
  siteUrl?: string;
  revalidateUrl?: string;
  checkout: {
    cod: { enabled: boolean; maxTotal: string };
    card: { enabled: boolean };
    stockSafetyBuffer: number;
    fulfilmentBranchId: string | null;
    deliveryVariantId: string | null;
  };
  shipping: { rates: ShippingRate[] };
  pickup: { slotMinutes: number; leadTimeHours: number; daysAhead: number; opensAt: string; closesAt: string };
  branches: OnlineBranch[];
  search: { synonyms: string[][] };
}

interface Overview {
  planAllows: boolean;
  storefront: { id: string; name: string; isActive: boolean } | null;
  settings?: Settings;
  domains?: { id: string; domain: string; isPrimary: boolean }[];
  paymentAccount?: { provider: string; isActive: boolean; keyHint: string; webhookPath: string } | null;
}

interface Branch { id: string; name: string; code: string }

export default function OnlineStorePage() {
  const { tokens } = useAuth();
  const mayWrite = usePermission("storefront:write");
  const maySettings = usePermission("settings:write");
  const auth = { accessToken: tokens?.accessToken };

  const [overview, setOverview] = useState<Overview | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [name, setName] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [synonyms, setSynonyms] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [setup, setSetup] = useState({ name: "", domain: "" });
  const [newDomain, setNewDomain] = useState("");
  const [stripe, setStripe] = useState({ secretKey: "", webhookSecret: "" });

  const apply = (o: Overview) => {
    setOverview(o);
    if (o.settings) {
      setDraft(o.settings);
      setSynonyms(o.settings.search.synonyms.map((g) => g.join(", ")).join("\n"));
    }
    if (o.storefront) {
      setName(o.storefront.name);
      setIsActive(o.storefront.isActive);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, b] = await Promise.all([
        api.get<Overview>("/storefront-admin/settings", auth),
        api.get<Branch[]>("/branches", { ...auth, query: { limit: 100 } }).catch(() => [] as Branch[]),
      ]);
      apply(o);
      setBranches(b);
    } catch (err) {
      setError(errorText(err, "Failed to load the online store."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<Overview>, done: string) {
    setSaving(true);
    setError(null);
    try {
      apply(await action());
      setSuccess(done);
    } catch (err) {
      setError(errorText(err, "That change was refused."));
    } finally {
      setSaving(false);
    }
  }

  const save = () => {
    if (!draft) return;
    const { deliveryVariantId: _fixed, ...checkout } = draft.checkout;
    return run(
      () =>
        api.patch<Overview>(
          "/storefront-admin/settings",
          {
            name,
            isActive,
            ...(draft.displayName ? { displayName: draft.displayName } : {}),
            ...(draft.whatsapp ? { whatsapp: draft.whatsapp } : {}),
            ...(draft.siteUrl ? { siteUrl: draft.siteUrl } : {}),
            ...(draft.revalidateUrl ? { revalidateUrl: draft.revalidateUrl } : {}),
            checkout,
            shipping: draft.shipping,
            pickup: draft.pickup,
            branches: draft.branches,
            search: {
              synonyms: synonyms
                .split("\n")
                .map((line) => line.split(",").map((w) => w.trim()).filter(Boolean))
                .filter((group) => group.length >= 2),
            },
          },
          auth,
        ),
      "Online store settings saved.",
    );
  };

  if (loading) return <Loading label="Loading the online store..." />;

  if (!overview?.storefront) {
    return (
      <div className="space-y-6">
        <PageHeader title="Online Store" description="Sell your catalogue on your own website, from the same stock and prices as the counter." />
        {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
        <Card className="max-w-lg space-y-4 p-6">
          {!overview?.planAllows ? (
            <p className="text-sm text-muted-foreground">Your plan does not include an online store. Upgrade to Pro to add one.</p>
          ) : (
            <>
              <Field label="Store name"><Input value={setup.name} onChange={(e) => setSetup({ ...setup, name: e.target.value })} /></Field>
              <Field label="Website address" hint="The hostname shoppers will type, e.g. shop.yourbusiness.ae. Point its DNS at the storefront.">
                <Input value={setup.domain} onChange={(e) => setSetup({ ...setup, domain: e.target.value })} />
              </Field>
              <Button
                disabled={!mayWrite || !maySettings || saving || !setup.name || !setup.domain}
                onClick={() => void run(() => api.post<Overview>("/storefront-admin/settings/setup", setup, auth), "Online store created.")}
              >
                <Globe className="h-4 w-4" /> Create online store
              </Button>
            </>
          )}
        </Card>
      </div>
    );
  }

  const shown = new Map((draft?.branches ?? []).map((b) => [b.branchId, b]));
  const setBranch = (branchId: string, patch: Partial<OnlineBranch> | null) => {
    if (!draft) return;
    const rest = draft.branches.filter((b) => b.branchId !== branchId);
    const current = shown.get(branchId) ?? { branchId, emirate: "DUBAI", lat: null, lng: null, openingHours: null, pickupEnabled: true };
    setDraft({ ...draft, branches: patch === null ? rest : [...rest, { ...current, ...patch }] });
  };
  const setRate = (emirate: string, patch: Partial<ShippingRate>) =>
    draft && setDraft({ ...draft, shipping: { rates: draft.shipping.rates.map((r) => (r.emirate === emirate ? { ...r, ...patch } : r)) } });

  return (
    <div className="space-y-6">
      <PageHeader title="Online Store" description="Your website's settings. Products, prices and stock are the POS's own.">
        <Link href="/online-store/orders"><Button variant="outline" size="sm">Orders</Button></Link>
        <Link href="/online-store/listings"><Button variant="outline" size="sm">Listings</Button></Link>
        <Link href="/online-store/content"><Button variant="outline" size="sm">Content</Button></Link>
        <Link href="/online-store/coupons"><Button variant="outline" size="sm">Promo codes</Button></Link>
        {mayWrite && <Button size="sm" disabled={saving} onClick={() => void save()}><Save className="h-4 w-4" /> Save settings</Button>}
      </PageHeader>

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}

      {draft && (
        <>
          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Store</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Store name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Shown as"><Input value={draft.displayName ?? ""} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} placeholder={name} /></Field>
              <Field label="WhatsApp number"><Input value={draft.whatsapp ?? ""} onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })} placeholder="+9715…" /></Field>
              <Field label="Public site address" hint="Where card payments return to. Leave empty to use https:// + the domain."><Input value={draft.siteUrl ?? ""} onChange={(e) => setDraft({ ...draft, siteUrl: e.target.value })} /></Field>
              <Field label="Cache refresh URL" hint="The website's /api/revalidate. Price and stock changes refresh pages within a minute."><Input value={draft.revalidateUrl ?? ""} onChange={(e) => setDraft({ ...draft, revalidateUrl: e.target.value })} /></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium"><input type="checkbox" className="h-4 w-4" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Website open to shoppers</label>
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">Domains</h2>
            {overview.domains?.map((d) => (
              <div key={d.id} className="flex items-center gap-3 text-xs">
                <span className="font-mono">{d.domain}</span>
                {d.isPrimary && <Badge>Primary</Badge>}
                {mayWrite && maySettings && (overview.domains?.length ?? 0) > 1 && (
                  <button className="cursor-pointer text-muted-foreground hover:text-destructive" aria-label="Remove" onClick={() => void run(() => api.delete<Overview>(`/storefront-admin/settings/domains/${d.id}`, auth), "Domain removed.")}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {mayWrite && maySettings && (
              <div className="flex max-w-md gap-2">
                <Input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="www.yourbusiness.ae" />
                <Button size="sm" variant="outline" disabled={!newDomain || saving} onClick={() => void run(() => api.post<Overview>("/storefront-admin/settings/domains", { domain: newDomain }, auth), "Domain added.").then(() => setNewDomain(""))}>
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>
            )}
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Checkout</h2>
            <div className="grid gap-4 md:grid-cols-4">
              <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" className="h-4 w-4" checked={draft.checkout.cod.enabled} onChange={(e) => setDraft({ ...draft, checkout: { ...draft.checkout, cod: { ...draft.checkout.cod, enabled: e.target.checked } } })} /> Cash on delivery</label>
              <Field label="Cash on delivery up to (incl. VAT)"><Input inputMode="decimal" value={draft.checkout.cod.maxTotal} onChange={(e) => setDraft({ ...draft, checkout: { ...draft.checkout, cod: { ...draft.checkout.cod, maxTotal: e.target.value } } })} /></Field>
              <Field label="Stock held back from the website" hint="Units per branch the counter keeps, so both cannot sell the last one."><Input type="number" min={0} value={draft.checkout.stockSafetyBuffer} onChange={(e) => setDraft({ ...draft, checkout: { ...draft.checkout, stockSafetyBuffer: Number(e.target.value) } })} /></Field>
              <Field label="Courier orders ship from">
                <select className={selectClass} value={draft.checkout.fulfilmentBranchId ?? ""} onChange={(e) => setDraft({ ...draft, checkout: { ...draft.checkout, fulfilmentBranchId: e.target.value || null } })}>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <div className="flex items-center gap-2"><CreditCard className="h-4 w-4" /><h2 className="text-sm font-semibold">Card payments (Stripe)</h2></div>
            <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" className="h-4 w-4" checked={draft.checkout.card.enabled} onChange={(e) => setDraft({ ...draft, checkout: { ...draft.checkout, card: { enabled: e.target.checked } } })} /> Offer card, Apple Pay and Google Pay</label>
            {overview.paymentAccount?.isActive ? (
              <div className="space-y-2 text-xs">
                <div>Connected: <span className="font-mono">{overview.paymentAccount.keyHint}</span></div>
                <Field label="Webhook URL" hint="In Stripe → Developers → Webhooks, send checkout.session.* events here.">
                  <Input readOnly value={`${getApiOrigin()}/api/v1${overview.paymentAccount.webhookPath}`} onFocus={(e) => e.currentTarget.select()} />
                </Field>
                {mayWrite && maySettings && (
                  <Button size="sm" variant="outline" onClick={() => void run(() => api.delete<Overview>("/storefront-admin/settings/payment-account", auth), "Stripe disconnected.")}>Disconnect</Button>
                )}
              </div>
            ) : (
              mayWrite && maySettings && (
                <div className="grid max-w-2xl gap-3 md:grid-cols-3">
                  <Input type="password" placeholder="sk_live_…" value={stripe.secretKey} onChange={(e) => setStripe({ ...stripe, secretKey: e.target.value })} />
                  <Input type="password" placeholder="whsec_…" value={stripe.webhookSecret} onChange={(e) => setStripe({ ...stripe, webhookSecret: e.target.value })} />
                  <Button size="sm" disabled={!stripe.secretKey || !stripe.webhookSecret || saving} onClick={() => void run(() => api.put<Overview>("/storefront-admin/settings/payment-account", stripe, auth), "Stripe connected.").then(() => setStripe({ secretKey: "", webhookSecret: "" }))}>
                    Connect Stripe
                  </Button>
                </div>
              )
            )}
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">Courier rates (net of VAT)</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-muted-foreground"><tr><th className="py-2">Emirate</th><th>Delivers</th><th>Base fee</th><th>Up to kg</th><th>Per extra kg</th><th>Free over</th><th>Max kg</th><th>Days</th></tr></thead>
                <tbody>
                  {draft.shipping.rates.map((r) => (
                    <tr key={r.emirate}>
                      <td className="py-1.5 pr-2">{humanize(r.emirate)}</td>
                      <td><input type="checkbox" className="h-4 w-4" checked={r.active} onChange={(e) => setRate(r.emirate, { active: e.target.checked })} /></td>
                      <td className="pr-2"><Input className="h-8 w-20" value={r.baseFee} onChange={(e) => setRate(r.emirate, { baseFee: e.target.value })} /></td>
                      <td className="pr-2"><Input className="h-8 w-16" type="number" value={r.baseWeightKg} onChange={(e) => setRate(r.emirate, { baseWeightKg: Number(e.target.value) })} /></td>
                      <td className="pr-2"><Input className="h-8 w-20" value={r.perKgFee} onChange={(e) => setRate(r.emirate, { perKgFee: e.target.value })} /></td>
                      <td className="pr-2"><Input className="h-8 w-24" value={r.freeOver ?? ""} placeholder="Never" onChange={(e) => setRate(r.emirate, { freeOver: e.target.value || null })} /></td>
                      <td className="pr-2"><Input className="h-8 w-16" type="number" value={r.maxWeightKg} onChange={(e) => setRate(r.emirate, { maxWeightKg: Number(e.target.value) })} /></td>
                      <td><Input className="h-8 w-14" type="number" value={r.etaDays} onChange={(e) => setRate(r.emirate, { etaDays: Number(e.target.value) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Branches on the website</h2>
            <div className="grid gap-4 md:grid-cols-5">
              <Field label="Pickup slot (minutes)"><Input type="number" value={draft.pickup.slotMinutes} onChange={(e) => setDraft({ ...draft, pickup: { ...draft.pickup, slotMinutes: Number(e.target.value) } })} /></Field>
              <Field label="Earliest pickup (hours from now)"><Input type="number" value={draft.pickup.leadTimeHours} onChange={(e) => setDraft({ ...draft, pickup: { ...draft.pickup, leadTimeHours: Number(e.target.value) } })} /></Field>
              <Field label="Days offered"><Input type="number" value={draft.pickup.daysAhead} onChange={(e) => setDraft({ ...draft, pickup: { ...draft.pickup, daysAhead: Number(e.target.value) } })} /></Field>
              <Field label="Opens"><Input type="time" value={draft.pickup.opensAt} onChange={(e) => setDraft({ ...draft, pickup: { ...draft.pickup, opensAt: e.target.value } })} /></Field>
              <Field label="Closes"><Input type="time" value={draft.pickup.closesAt} onChange={(e) => setDraft({ ...draft, pickup: { ...draft.pickup, closesAt: e.target.value } })} /></Field>
            </div>
            <table className="w-full text-left text-xs">
              <thead className="text-muted-foreground"><tr><th className="py-2">Branch</th><th>Shown</th><th>Emirate</th><th>Pickup</th></tr></thead>
              <tbody>
                {branches.map((b) => {
                  const online = shown.get(b.id);
                  return (
                    <tr key={b.id}>
                      <td className="py-1.5">{b.name} <span className="font-mono text-muted-foreground">{b.code}</span></td>
                      <td><input type="checkbox" className="h-4 w-4" checked={!!online} onChange={(e) => setBranch(b.id, e.target.checked ? {} : null)} /></td>
                      <td>
                        {online && (
                          <select className={`${selectClass} h-8 w-40`} value={online.emirate} onChange={(e) => setBranch(b.id, { emirate: e.target.value })}>
                            {EMIRATES.map((em) => <option key={em} value={em}>{humanize(em)}</option>)}
                          </select>
                        )}
                      </td>
                      <td>{online && <input type="checkbox" className="h-4 w-4" checked={online.pickupEnabled} onChange={(e) => setBranch(b.id, { pickupEnabled: e.target.checked })} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">Search synonyms</h2>
            <Field label="One group of interchangeable words per line" hint="e.g. tap, faucet, mixer — a search for any finds all.">
              <textarea rows={5} className={textareaClass} value={synonyms} onChange={(e) => setSynonyms(e.target.value)} />
            </Field>
          </Card>

          <p className="text-xs text-muted-foreground">
            <ExternalLink className="mr-1 inline h-3 w-3" />
            Shoppers see changes within a minute: settings are cached briefly by the API.
          </p>
        </>
      )}
    </div>
  );
}
