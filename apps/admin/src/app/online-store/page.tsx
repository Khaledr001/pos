"use client";

import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";
import { Copy, CreditCard, ExternalLink, Globe, Plus, Save, Trash2 } from "lucide-react";
import {
  MAX_HEADLESS_ORIGINS,
  REGION_PRESETS,
  ZONE_CODE,
  type HeadlessSettings,
  type StorefrontRegion,
} from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api, getApiOrigin } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { useTenantSettings } from "@/lib/tenant-settings";
import { Field, Loading, Notice, PageHeader, errorText, humanize, textareaClass } from "./shared";
import { ShopAddressPicker, type PlatformDomain, type ShopAddress } from "./shop-address";

/** A currency's usual country, to pre-select a region for a new store. */
const COUNTRY_BY_CURRENCY: Record<string, string> = { AED: "AE", SAR: "SA", PKR: "PK", BDT: "BD" };

const NEW_ZONE_RATE = { baseFee: "20.00", baseWeightKg: 5, perKgFee: "2.00", freeOver: null, maxWeightKg: 30, etaDays: 2, active: false };

/** "Al Ain" -> "AL_AIN": the stored zone code, stable once an address or order uses it. */
const zoneCodeFor = (name: string) => name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);

const isHttpsOrigin = (v: string) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.origin === v;
  } catch {
    return false;
  }
};

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
  tagline?: string;
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
  region: StorefrontRegion;
  headless: HeadlessSettings;
}

interface Overview {
  planAllows: boolean;
  planAllowsHeadless?: boolean;
  platform?: PlatformDomain;
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

  const tenantSettings = useTenantSettings();
  const taxLabel = tenantSettings.tax.label;
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

  const [setupName, setSetupName] = useState("");
  const [setupAddress, setSetupAddress] = useState<ShopAddress>(null);
  const [newAddress, setNewAddress] = useState<ShopAddress>(null);
  // Bumped after a domain is added, so the picker remounts empty.
  const [pickerKey, setPickerKey] = useState(0);
  const [stripe, setStripe] = useState({ secretKey: "", webhookSecret: "" });
  const [setupCountry, setSetupCountry] = useState<string | null>(null);
  const [newZone, setNewZone] = useState("");
  const [originsText, setOriginsText] = useState("");
  const [zoneNote, setZoneNote] = useState<string | null>(null);

  const apply = (o: Overview) => {
    setOverview(o);
    if (o.settings) {
      setDraft(o.settings);
      setSynonyms(o.settings.search.synonyms.map((g) => g.join(", ")).join("\n"));
      setOriginsText(o.settings.headless.allowedOrigins.join("\n"));
      setZoneNote(null);
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
        // All of them: pickup settings are the whole store's, and this page
        // saves the full list back — a scoped subset would drop the rest.
        api.get<Branch[]>("/branches", { ...auth, query: { limit: 100, includeOtherBranches: true } }).catch(() => [] as Branch[]),
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

  /** True when the change went through — so a caller only clears its form on success. */
  async function run(action: () => Promise<Overview>, done: string): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      apply(await action());
      setSuccess(done);
      return true;
    } catch (err) {
      setError(errorText(err, "That change was refused."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const origins = originsText.split("\n").map((o) => o.trim()).filter(Boolean);
  const originProblem = origins.length > MAX_HEADLESS_ORIGINS ? `At most ${MAX_HEADLESS_ORIGINS} origins.` : origins.find((o) => !isHttpsOrigin(o)) ? "Each origin must be exact, like https://shop.example.com (https, no path, no trailing slash)." : null;
  const regionProblem = !draft
    ? null
    : !/^\d{1,4}$/.test(draft.region.callingCode)
      ? "The calling code is digits only, like 971."
      : !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(draft.region.formatLocale)
        ? "The number format must be a language tag like en-AE."
        : !draft.region.zoneLabel.trim() || !draft.region.taxLabel.trim() || !draft.region.taxIdLabel.trim()
          ? "Fill in every region label."
          : null;

  /**
   * Swap the zone list and keep everything that points at a zone consistent:
   * rates for removed zones go, new zones get a (switched-off) rate row, and a
   * branch left in a removed zone moves to the first zone. The API refuses a
   * save that would leave any of them dangling.
   */
  const applyRegion = (region: StorefrontRegion) => {
    if (!draft) return;
    const codes = new Set(region.zones.map((z) => z.code));
    const kept = draft.shipping.rates.filter((r) => codes.has(r.emirate));
    const have = new Set(kept.map((r) => r.emirate));
    const added = region.zones.filter((z) => !have.has(z.code)).map((z) => ({ emirate: z.code, ...NEW_ZONE_RATE }));
    const moved = draft.branches.filter((b) => !codes.has(b.emirate)).length;
    const dropped = draft.shipping.rates.length - kept.length;
    setDraft({
      ...draft,
      region,
      shipping: { rates: [...kept, ...added] },
      branches: draft.branches.map((b) => (codes.has(b.emirate) ? b : { ...b, emirate: region.zones[0]!.code })),
    });
    const notes = [
      dropped ? `${dropped} courier rate${dropped > 1 ? "s" : ""} for removed ${region.zoneLabel.toLowerCase()}s will be deleted` : "",
      added.length ? `${added.length} new ${region.zoneLabel.toLowerCase()}${added.length > 1 ? "s" : ""} added to courier rates, switched off until you price them` : "",
      moved ? `${moved} branch${moved > 1 ? "es" : ""} moved to ${region.zones[0]!.name}` : "",
    ].filter(Boolean);
    setZoneNote(notes.length ? `${notes.join(". ")}. Save to apply.` : null);
  };

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
            ...(draft.tagline ? { tagline: draft.tagline } : {}),
            ...(draft.whatsapp ? { whatsapp: draft.whatsapp } : {}),
            ...(draft.siteUrl ? { siteUrl: draft.siteUrl } : {}),
            ...(draft.revalidateUrl ? { revalidateUrl: draft.revalidateUrl } : {}),
            checkout,
            shipping: draft.shipping,
            pickup: draft.pickup,
            branches: draft.branches,
            region: draft.region,
            headless: { enabled: draft.headless.enabled, allowedOrigins: origins },
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
              <Field label="Store name"><Input value={setupName} onChange={(e) => setSetupName(e.target.value)} /></Field>
              <Field label="Country" hint="Sets delivery zones, phone format and tax labels. You can change them later.">
                <SelectField
                  size="sm"
                  label="Country"
                  value={setupCountry ?? COUNTRY_BY_CURRENCY[tenantSettings.currency.base] ?? "AE"}
                  onValueChange={setSetupCountry}
                  options={Object.entries(REGION_PRESETS).map(([code, r]) => ({ value: code, label: r.label }))}
                />
              </Field>
              <ShopAddressPicker platform={overview.platform} accessToken={tokens?.accessToken} onChange={setSetupAddress} idPrefix="setup-address" />
              <Button
                disabled={!mayWrite || !maySettings || saving || !setupName.trim() || !setupAddress}
                onClick={() =>
                  setupAddress &&
                  void run(
                    () => api.post<Overview>("/storefront-admin/settings/setup", { name: setupName.trim(), domain: setupAddress.domain, region: setupCountry ?? COUNTRY_BY_CURRENCY[tenantSettings.currency.base] ?? "AE" }, auth),
                    `Online store created at ${setupAddress.domain}.`,
                  )
                }
              >
                <Globe className="h-4 w-4" /> Create online store
              </Button>
            </>
          )}
        </Card>
      </div>
    );
  }

  const primaryDomain = overview.domains?.find((d) => d.isPrimary)?.domain ?? overview.domains?.[0]?.domain ?? "shop.example.com";
  const headlessSnippet = `curl -H "x-storefront-host: ${primaryDomain}" \\\n  ${getApiOrigin()}/api/v1/storefront/content/store`;
  const shown = new Map((draft?.branches ?? []).map((b) => [b.branchId, b]));
  const presetMatch =
    Object.entries(REGION_PRESETS).find(([, { label: _label, ...preset }]) => draft && JSON.stringify(preset) === JSON.stringify(draft.region))?.[0] ?? "custom";
  const zoneLabel = draft?.region.zoneLabel ?? "Emirate";
  const zoneName = (code: string) => draft?.region.zones.find((z) => z.code === code)?.name ?? humanize(code);
  const setBranch = (branchId: string, patch: Partial<OnlineBranch> | null) => {
    if (!draft) return;
    const rest = draft.branches.filter((b) => b.branchId !== branchId);
    const current = shown.get(branchId) ?? { branchId, emirate: draft.region.zones[0]!.code, lat: null, lng: null, openingHours: null, pickupEnabled: true };
    setDraft({ ...draft, branches: patch === null ? rest : [...rest, { ...current, ...patch }] });
  };
  const setRate = (emirate: string, patch: Partial<ShippingRate>) =>
    draft && setDraft({ ...draft, shipping: { rates: draft.shipping.rates.map((r) => (r.emirate === emirate ? { ...r, ...patch } : r)) } });

  return (
    <div className="space-y-6">
      <PageHeader title="Online Store" description="Your website's settings. Products, prices and stock are the POS's own.">
        <Link href="/online-store/orders"><Button variant="outline" size="sm">Orders</Button></Link>
        <Link href="/online-store/listings"><Button variant="outline" size="sm">Listings</Button></Link>
        <Link href="/online-store/appearance"><Button variant="outline" size="sm">Appearance</Button></Link>
        <Link href="/online-store/home"><Button variant="outline" size="sm">Home page</Button></Link>
        <Link href="/online-store/navigation"><Button variant="outline" size="sm">Navigation</Button></Link>
        <Link href="/online-store/content"><Button variant="outline" size="sm">Content</Button></Link>
        <Link href="/online-store/coupons"><Button variant="outline" size="sm">Promo codes</Button></Link>
        {mayWrite && <Button size="sm" disabled={saving || !!originProblem || !!regionProblem} onClick={() => void save()}><Save className="h-4 w-4" /> Save settings</Button>}
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
              <Field label="Tagline" hint="Under the name in the website header."><Input value={draft.tagline ?? ""} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} placeholder="Building Materials" /></Field>
              <Field label="WhatsApp number"><Input value={draft.whatsapp ?? ""} onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })} placeholder="+9715…" /></Field>
              <Field label="Public site address" hint="Where card payments return to. Leave empty to use https:// + the domain."><Input value={draft.siteUrl ?? ""} onChange={(e) => setDraft({ ...draft, siteUrl: e.target.value })} /></Field>
              <Field label="Cache refresh URL" hint="The website's /api/revalidate. Price and stock changes refresh pages within a minute."><Input value={draft.revalidateUrl ?? ""} onChange={(e) => setDraft({ ...draft, revalidateUrl: e.target.value })} /></Field>
              <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium"><input type="checkbox" className="h-4 w-4" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> Website open to shoppers</label>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Region &amp; language</h2>
            <p className="text-xs text-muted-foreground">Where you deliver, how phone numbers and prices are formatted, and what tax is called. Currency comes from your business settings ({tenantSettings.currency.base}).</p>
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Country preset" hint="Replaces the zones and labels below.">
                <SelectField
                  size="sm"
                  label="Country preset"
                  value={presetMatch}
                  disabled={!mayWrite}
                  onValueChange={(code) => {
                    if (code === "custom") return;
                    const { label: _label, ...preset } = REGION_PRESETS[code]!;
                    applyRegion(preset);
                  }}
                  options={[...Object.entries(REGION_PRESETS).map(([code, r]) => ({ value: code, label: r.label })), { value: "custom", label: "Custom (edit below)" }]}
                />
              </Field>
              <Field label="Country code (ISO)" hint="Two letters, e.g. AE."><Input maxLength={2} value={draft.region.country} onChange={(e) => setDraft({ ...draft, region: { ...draft.region, country: e.target.value.toUpperCase() } })} /></Field>
              <Field label="Phone calling code" hint="Digits only, no +."><Input inputMode="numeric" value={draft.region.callingCode} onChange={(e) => setDraft({ ...draft, region: { ...draft.region, callingCode: e.target.value.replace(/\D/g, "") } })} /></Field>
              <Field label="What a delivery zone is called" hint="Emirate, Region, Governorate…"><Input maxLength={30} value={draft.region.zoneLabel} onChange={(e) => setDraft({ ...draft, region: { ...draft.region, zoneLabel: e.target.value } })} /></Field>
              <Field label="Tax name"><Input maxLength={20} value={draft.region.taxLabel} onChange={(e) => setDraft({ ...draft, region: { ...draft.region, taxLabel: e.target.value } })} /></Field>
              <Field label="Tax registration label" hint="TRN, VAT No., GSTIN…"><Input maxLength={20} value={draft.region.taxIdLabel} onChange={(e) => setDraft({ ...draft, region: { ...draft.region, taxIdLabel: e.target.value } })} /></Field>
              <Field label="Number & date format" hint="A language tag like en-AE or ar-SA."><Input value={draft.region.formatLocale} onChange={(e) => setDraft({ ...draft, region: { ...draft.region, formatLocale: e.target.value } })} /></Field>
            </div>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold">Delivery {zoneLabel.toLowerCase()}s</h3>
              <ul className="grid gap-2 md:grid-cols-2">
                {draft.region.zones.map((z, i) => (
                  <li key={z.code} className="flex items-center gap-2">
                    <Input aria-label={`${zoneLabel} ${i + 1} name`} value={z.name} onChange={(e) => setDraft({ ...draft, region: { ...draft.region, zones: draft.region.zones.map((x) => (x.code === z.code ? { ...x, name: e.target.value } : x)) } })} />
                    <span className="w-32 shrink-0 truncate font-mono text-[11px] text-muted-foreground" title="Stored on addresses and orders; fixed once created">{z.code}</span>
                    {mayWrite && <button type="button" className="cursor-pointer text-muted-foreground hover:text-destructive disabled:opacity-40" disabled={draft.region.zones.length <= 1} aria-label={`Remove ${z.name}`} onClick={() => applyRegion({ ...draft.region, zones: draft.region.zones.filter((x) => x.code !== z.code) })}><Trash2 className="h-3.5 w-3.5" /></button>}
                  </li>
                ))}
              </ul>
              {mayWrite && (
                <div className="flex max-w-md items-center gap-2">
                  <Input aria-label={`New ${zoneLabel.toLowerCase()} name`} placeholder={`New ${zoneLabel.toLowerCase()}`} value={newZone} onChange={(e) => setNewZone(e.target.value)} />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!zoneCodeFor(newZone)}
                    onClick={() => {
                      const base = zoneCodeFor(newZone);
                      let code = base;
                      for (let n = 2; draft.region.zones.some((z) => z.code === code); n++) code = `${base.slice(0, 17)}_${n}`;
                      if (!ZONE_CODE.test(code)) return setError("That name cannot be turned into a zone code. Use letters and numbers.");
                      applyRegion({ ...draft.region, zones: [...draft.region.zones, { code, name: newZone.trim() }] });
                      setNewZone("");
                    }}
                  >
                    <Plus className="h-4 w-4" /> Add
                  </Button>
                </div>
              )}
              {zoneNote && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">{zoneNote}</p>}
              <p className="text-[11px] text-muted-foreground">Removing a zone deletes its courier rate and moves branches in it to the first zone. The server refuses a save that would leave a rate or branch pointing at a zone that no longer exists.</p>
            </div>
            {regionProblem && <p role="alert" className="text-xs text-destructive">{regionProblem}</p>}
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Developer access (headless)</h2>
            <p className="text-xs text-muted-foreground">Build your own front end, or a mobile app, on the same catalogue, prices and stock. Needs a plan with API access; if yours does not have it, saving this is refused with a message.</p>
            <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" className="h-4 w-4" disabled={!mayWrite || !overview?.planAllowsHeadless} checked={draft.headless.enabled} onChange={(e) => setDraft({ ...draft, headless: { ...draft.headless, enabled: e.target.checked } })} /> Allow browser access from my own sites</label>
            <Field label="Allowed origins" hint="One per line, exact: https://shop.example.com. No wildcards.">
              <textarea rows={3} className={textareaClass} disabled={!mayWrite || !draft.headless.enabled} value={originsText} onChange={(e) => setOriginsText(e.target.value)} placeholder="https://shop.example.com" />
            </Field>
            {originProblem && <p role="alert" className="text-xs text-destructive">{originProblem}</p>}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold">Try it</h3>
                <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(headlessSnippet).then(() => setSuccess("Snippet copied."))}><Copy className="h-4 w-4" /> Copy</Button>
              </div>
              <pre className="overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px]">{headlessSnippet}</pre>
              <p className="text-[11px] text-muted-foreground">Server-to-server calls send your shop's domain in <code>x-storefront-host</code>. Shopper sign-in uses first-party cookies, so a custom front end should proxy through its own server. See docs/HEADLESS.md in the repository for the full guide.</p>
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">Domains</h2>
            {overview.domains?.map((d) => (
              <div key={d.id} className="flex min-w-0 flex-wrap items-center gap-3 text-xs">
                <a
                  href={`https://${d.domain}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 font-mono text-primary hover:underline [overflow-wrap:anywhere]"
                >
                  {d.domain}
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="sr-only">(opens the shop in a new tab)</span>
                </a>
                {d.isPrimary && <Badge>Primary</Badge>}
                {mayWrite && maySettings && (overview.domains?.length ?? 0) > 1 && (
                  <button className="cursor-pointer text-muted-foreground hover:text-destructive" aria-label="Remove" onClick={() => void run(() => api.delete<Overview>(`/storefront-admin/settings/domains/${d.id}`, auth), "Domain removed.")}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
            {mayWrite && maySettings && (
              <div className="max-w-xl space-y-3 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground">Add another address</p>
                <ShopAddressPicker key={pickerKey} platform={overview.platform} accessToken={tokens?.accessToken} onChange={setNewAddress} idPrefix="add-address" />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!newAddress || saving}
                  onClick={() =>
                    newAddress &&
                    void run(() => api.post<Overview>("/storefront-admin/settings/domains", { domain: newAddress.domain }, auth), `${newAddress.domain} added.`).then((ok) => {
                      if (!ok) return;
                      setNewAddress(null);
                      setPickerKey((k) => k + 1);
                    })
                  }
                >
                  <Plus className="h-4 w-4" /> Add address
                </Button>
              </div>
            )}
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Checkout</h2>
            <div className="grid gap-4 md:grid-cols-4">
              <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" className="h-4 w-4" checked={draft.checkout.cod.enabled} onChange={(e) => setDraft({ ...draft, checkout: { ...draft.checkout, cod: { ...draft.checkout.cod, enabled: e.target.checked } } })} /> Cash on delivery</label>
              <Field label={`Cash on delivery up to (incl. ${taxLabel})`}><Input inputMode="decimal" value={draft.checkout.cod.maxTotal} onChange={(e) => setDraft({ ...draft, checkout: { ...draft.checkout, cod: { ...draft.checkout.cod, maxTotal: e.target.value } } })} /></Field>
              <Field label="Stock held back from the website" hint="Units per branch the counter keeps, so both cannot sell the last one."><Input type="number" min={0} value={draft.checkout.stockSafetyBuffer} onChange={(e) => setDraft({ ...draft, checkout: { ...draft.checkout, stockSafetyBuffer: Number(e.target.value) } })} /></Field>
              <Field label="Courier orders ship from">
                {/* With none set, the placeholder says so — the native select showed
                    the first branch as if it were chosen while saving null. */}
                <SelectField
                  size="sm"
                  label="Courier orders ship from"
                  placeholder="Choose a branch"
                  value={draft.checkout.fulfilmentBranchId ?? ""}
                  onValueChange={(v) => setDraft({ ...draft, checkout: { ...draft.checkout, fulfilmentBranchId: v || null } })}
                  options={branches.map((b) => ({ value: b.id, label: b.name }))}
                />
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

          {/* min-w-0: a wide table inside would otherwise stretch the card,
              and the page with it, instead of scrolling inside. */}
          <Card className="min-w-0 space-y-3 p-5">
            <h2 className="text-sm font-semibold">Courier rates (net of {taxLabel})</h2>
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-160 whitespace-nowrap text-left text-xs">
                <thead className="text-muted-foreground"><tr><th scope="col" className="py-2">{zoneLabel}</th><th scope="col">Delivers</th><th scope="col">Base fee</th><th scope="col">Up to kg</th><th scope="col">Per extra kg</th><th scope="col">Free over</th><th scope="col">Max kg</th><th scope="col">Days</th></tr></thead>
                <tbody>
                  {draft.shipping.rates.map((r) => (
                    <tr key={r.emirate}>
                      <td className="py-1.5 pr-2">{zoneName(r.emirate)}</td>
                      <td><input aria-label={`${zoneName(r.emirate)} delivers`} type="checkbox" className="h-4 w-4" checked={r.active} onChange={(e) => setRate(r.emirate, { active: e.target.checked })} /></td>
                      <td className="pr-2"><Input aria-label={`${zoneName(r.emirate)} base fee`} className="h-8 w-20" value={r.baseFee} onChange={(e) => setRate(r.emirate, { baseFee: e.target.value })} /></td>
                      <td className="pr-2"><Input aria-label={`${zoneName(r.emirate)} weight included (kg)`} className="h-8 w-16" type="number" value={r.baseWeightKg} onChange={(e) => setRate(r.emirate, { baseWeightKg: Number(e.target.value) })} /></td>
                      <td className="pr-2"><Input aria-label={`${zoneName(r.emirate)} fee per extra kg`} className="h-8 w-20" value={r.perKgFee} onChange={(e) => setRate(r.emirate, { perKgFee: e.target.value })} /></td>
                      <td className="pr-2"><Input aria-label={`${zoneName(r.emirate)} free delivery over`} className="h-8 w-24" value={r.freeOver ?? ""} placeholder="Never" onChange={(e) => setRate(r.emirate, { freeOver: e.target.value || null })} /></td>
                      <td className="pr-2"><Input aria-label={`${zoneName(r.emirate)} max weight (kg)`} className="h-8 w-16" type="number" value={r.maxWeightKg} onChange={(e) => setRate(r.emirate, { maxWeightKg: Number(e.target.value) })} /></td>
                      <td><Input aria-label={`${zoneName(r.emirate)} delivery days`} className="h-8 w-14" type="number" value={r.etaDays} onChange={(e) => setRate(r.emirate, { etaDays: Number(e.target.value) })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="min-w-0 space-y-4 p-5">
            <h2 className="text-sm font-semibold">Branches on the website</h2>
            <div className="grid gap-4 md:grid-cols-5">
              <Field label="Pickup slot (minutes)"><Input type="number" value={draft.pickup.slotMinutes} onChange={(e) => setDraft({ ...draft, pickup: { ...draft.pickup, slotMinutes: Number(e.target.value) } })} /></Field>
              <Field label="Earliest pickup (hours from now)"><Input type="number" value={draft.pickup.leadTimeHours} onChange={(e) => setDraft({ ...draft, pickup: { ...draft.pickup, leadTimeHours: Number(e.target.value) } })} /></Field>
              <Field label="Days offered"><Input type="number" value={draft.pickup.daysAhead} onChange={(e) => setDraft({ ...draft, pickup: { ...draft.pickup, daysAhead: Number(e.target.value) } })} /></Field>
              <Field label="Opens"><Input type="time" value={draft.pickup.opensAt} onChange={(e) => setDraft({ ...draft, pickup: { ...draft.pickup, opensAt: e.target.value } })} /></Field>
              <Field label="Closes"><Input type="time" value={draft.pickup.closesAt} onChange={(e) => setDraft({ ...draft, pickup: { ...draft.pickup, closesAt: e.target.value } })} /></Field>
            </div>
            <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-120 whitespace-nowrap text-left text-xs">
              <thead className="text-muted-foreground"><tr><th scope="col" className="py-2">Branch</th><th scope="col">Shown</th><th scope="col">{zoneLabel}</th><th scope="col">Pickup</th></tr></thead>
              <tbody>
                {branches.map((b) => {
                  const online = shown.get(b.id);
                  return (
                    <tr key={b.id}>
                      <td className="py-1.5">{b.name} <span className="font-mono text-muted-foreground">{b.code}</span></td>
                      <td><input type="checkbox" aria-label={`Show ${b.name} on the website`} className="h-4 w-4" checked={!!online} onChange={(e) => setBranch(b.id, e.target.checked ? {} : null)} /></td>
                      <td>
                        {online && (
                          <SelectField
                            size="sm"
                            label={`${b.name} ${zoneLabel.toLowerCase()}`}
                            className="h-8 w-40"
                            value={online.emirate}
                            onValueChange={(v) => setBranch(b.id, { emirate: v })}
                            options={draft.region.zones.map((z) => ({ value: z.code, label: z.name }))}
                          />
                        )}
                      </td>
                      <td>{online && <input type="checkbox" aria-label={`${b.name} offers pickup`} className="h-4 w-4" checked={online.pickupEnabled} onChange={(e) => setBranch(b.id, { pickupEnabled: e.target.checked })} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
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
