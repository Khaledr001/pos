"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, Save, Undo2 } from "lucide-react";
import {
  NAV_HREF,
  SITE_TEMPLATES,
  SITE_TEMPLATE_ORDER,
  resolveSite,
  resolveSiteFeatures,
  type FormDef,
  type SiteFeatures,
  type SiteMode,
  type SiteSettings,
  type SiteTemplateId,
} from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Field, Loading, Notice, PageHeader, errorText } from "../shared";
import { OptionCards } from "../option-cards";
import { setKnownSiteMode } from "../site-mode";
import { StoreTabs } from "../store-nav";
import { useStoreSettings } from "../use-store-settings";

const MODE_COPY: Record<SiteMode, { title: string; text: string }> = {
  shop: { title: "Online shop", text: "Visitors browse, add to a cart, check out and pay. Accounts, order tracking, promo codes and stock alerts are on." },
  catalogue: { title: "Catalogue + enquiry", text: "Visitors browse products but cannot buy. “Add to cart” becomes an enquiry. No cart, checkout or accounts. Prices can be shown or hidden." },
  showcase: { title: "No products", text: "A company or landing site built from pages and sections. No product pages, search, cart or accounts." },
};
const MODE_LABEL: Record<SiteMode, string> = { shop: "Shop", catalogue: "Catalogue", showcase: "No products" };

const FEATURE_CHIPS: { key: keyof SiteFeatures; label: string }[] = [
  { key: "products", label: "Product pages" },
  { key: "prices", label: "Prices" },
  { key: "cart", label: "Cart" },
  { key: "checkout", label: "Checkout" },
  { key: "accounts", label: "Customer accounts" },
  { key: "search", label: "Search" },
  { key: "enquiries", label: "Enquiries" },
];

function problemsOf(d: SiteSettings): string[] {
  const out: string[] = [];
  if (d.mode === "catalogue") {
    if (!d.enquiry.form && !d.enquiry.whatsapp && !d.enquiry.call) out.push("Choose at least one way for visitors to enquire.");
    if (d.enquiry.form && !d.enquiry.formSlug) out.push("Choose the form behind the Enquire button.");
  }
  if (d.headerCta) {
    if (!d.headerCta.label.trim()) out.push("The header button needs a label.");
    if (!NAV_HREF.test(d.headerCta.href)) out.push("The header button link must start with / or https://.");
  }
  return out;
}

interface ApplyOptions {
  applyContent: boolean;
  applyTheme: boolean;
  createPages: boolean;
  createForms: boolean;
  overwritePages: boolean;
}
const DEFAULT_APPLY: ApplyOptions = { applyContent: true, applyTheme: true, createPages: true, createForms: true, overwritePages: false };

export default function SiteTypePage() {
  const { tokens } = useAuth();
  const mayWrite = usePermission("storefront:write");
  const auth = useMemo(() => ({ accessToken: tokens?.accessToken }), [tokens]);
  const { overview, settings, loading, saving, error, success, setError, setSuccess, patch, reload } = useStoreSettings();
  const [draft, setDraft] = useState<SiteSettings | null>(null);
  const [forms, setForms] = useState<{ slug: string; name: string }[]>([]);
  const [applying, setApplying] = useState<SiteTemplateId | null>(null);
  const [options, setOptions] = useState<ApplyOptions>(DEFAULT_APPLY);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setDraft(structuredClone(resolveSite(settings.site)));
  }, [settings]);

  useEffect(() => {
    api.get<FormDef[]>("/storefront-admin/forms", auth).then((f) => setForms((f ?? []).map((x) => ({ slug: x.slug, name: x.name })))).catch(() => setForms([]));
  }, [auth]);

  const saved = useMemo(() => (settings ? resolveSite(settings.site) : null), [settings]);
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const problems = useMemo(() => (draft ? problemsOf(draft) : []), [draft]);
  const features = useMemo(() => (draft ? resolveSiteFeatures(draft) : null), [draft]);

  if (loading) return <Loading label="Loading site type..." />;
  if (!overview?.storefront || !draft || !features || !settings) {
    return (
      <div className="space-y-6">
        <PageHeader title="Site type" description="What kind of website you run." />
        <StoreTabs current="/online-store/site" />
        {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
        <Card className="p-6 text-sm text-muted-foreground">Create your online store first, in Store Settings.</Card>
      </div>
    );
  }

  const set = (p: Partial<SiteSettings>) => setDraft({ ...draft, ...p });
  const currentTemplate = settings.site.template;

  const save = async () => {
    const body: SiteSettings = {
      ...draft,
      headerCta: draft.headerCta ? { label: draft.headerCta.label.trim(), href: draft.headerCta.href.trim() } : null,
    };
    if (await patch({ site: body }, "Site type saved. Visitors see it within a minute.")) setKnownSiteMode(body.mode);
  };

  const template = applying ? SITE_TEMPLATES[applying] : null;

  async function apply() {
    if (!applying) return;
    setApplyBusy(true);
    setApplyError(null);
    try {
      await api.post("/storefront-admin/site/apply-template", { template: applying, ...options }, auth);
      setKnownSiteMode(SITE_TEMPLATES[applying].mode);
      setSuccess(`“${SITE_TEMPLATES[applying].label}” applied.`);
      setApplying(null);
      await reload();
    } catch (err) {
      setApplyError(errorText(err, "The template could not be applied."));
    } finally {
      setApplyBusy(false);
    }
  }

  const cta = draft.headerCta;
  const accountsIrrelevant = draft.mode !== "shop";
  const searchIrrelevant = draft.mode === "showcase";

  return (
    <div className="space-y-6">
      <PageHeader title="Site type" description="Choose what kind of website you run, then adjust what it offers. You can reconfigure everything afterwards.">
        {mayWrite && (
          <>
            <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => saved && setDraft(structuredClone(saved))}><Undo2 className="h-4 w-4" /> Discard</Button>
            <Button size="sm" disabled={!dirty || saving || problems.length > 0} onClick={() => void save()}><Save className="h-4 w-4" /> Save site type</Button>
          </>
        )}
      </PageHeader>
      <StoreTabs current="/online-store/site" />

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
      {problems.length > 0 && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <ul className="list-disc space-y-0.5 pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <Card className="space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold">Start from a template</h2>
          <p className="mt-1 text-xs text-muted-foreground">A template fills in the layout, menu, home page, pages and forms for a kind of business. It is only a starting point: nothing stays linked to it.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SITE_TEMPLATE_ORDER.map((id) => {
            const t = SITE_TEMPLATES[id];
            const current = currentTemplate === id;
            return (
              <div key={id} className={`flex flex-col rounded-xl border p-4 text-xs ${current ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"}`}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold">{t.label}</h3>
                  <Badge variant="outline">{MODE_LABEL[t.mode]}</Badge>
                </div>
                <p className="mt-1.5 text-muted-foreground">{t.blurb}</p>
                <p className="mt-2 text-[11px] text-muted-foreground"><span className="font-medium text-foreground">Best for:</span> {t.bestFor}</p>
                <div className="mt-auto pt-3">
                  {current && <p className="mb-2 flex items-center gap-1 text-[11px] font-medium text-primary"><Check className="h-3.5 w-3.5" /> Started from this</p>}
                  {mayWrite && <Button type="button" size="sm" variant={current ? "outline" : "default"} onClick={() => { setOptions(DEFAULT_APPLY); setApplyError(null); setApplying(id); }}>{current ? "Re-apply…" : "Use this template…"}</Button>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <fieldset disabled={!mayWrite} className="min-w-0 space-y-6">
        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">What your website does</h2>
          <OptionCards label="Site mode" value={draft.mode} onChange={(mode) => set({ mode })} options={(["shop", "catalogue", "showcase"] as const).map((m) => ({ value: m, title: MODE_COPY[m].title, text: MODE_COPY[m].text }))} />

          <div aria-label="What this turns on" className="flex flex-wrap gap-2">
            {FEATURE_CHIPS.map((c) => (
              <Badge key={c.key} variant={features[c.key] ? "success" : "secondary"} title={features[c.key] ? "On" : "Off"}>
                {features[c.key] ? "✓" : "—"} {c.label}
              </Badge>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">This is what visitors get with the settings above. It changes as you edit, and takes effect when you save. Existing orders and customers are never deleted.</p>
        </Card>

        {draft.mode === "catalogue" && (
          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Catalogue settings</h2>
            <label className="flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" className="h-4 w-4" checked={draft.showPrices} onChange={(e) => set({ showPrices: e.target.checked })} /> Show prices
            </label>
            <p className="-mt-2 text-[11px] text-muted-foreground">{draft.showPrices ? "Visitors see prices but cannot order." : "Prices are hidden and never sent to visitors' browsers: they ask you for a price instead."}</p>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-foreground">How visitors enquire about a product</legend>
              <div className="flex flex-wrap gap-5 text-xs font-medium">
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={draft.enquiry.form} onChange={(e) => set({ enquiry: { ...draft.enquiry, form: e.target.checked } })} /> Enquiry form</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={draft.enquiry.whatsapp} onChange={(e) => set({ enquiry: { ...draft.enquiry, whatsapp: e.target.checked } })} /> WhatsApp</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={draft.enquiry.call} onChange={(e) => set({ enquiry: { ...draft.enquiry, call: e.target.checked } })} /> Call us</label>
              </div>
            </fieldset>
            {draft.enquiry.form && (
              <div className="max-w-sm">
                <Field label="Enquiry form" hint="Edit its fields in Forms. Each enquiry arrives in Leads.">
                  <SelectField size="sm" label="Enquiry form" value={draft.enquiry.formSlug} placeholder={forms.length ? "Choose a form" : "No forms yet"} onValueChange={(v) => set({ enquiry: { ...draft.enquiry, formSlug: v } })} options={forms.map((f) => ({ value: f.slug, label: f.name }))} />
                </Field>
              </div>
            )}
          </Card>
        )}

        <Card className="space-y-4 p-5">
          <h2 className="text-sm font-semibold">Header</h2>
          <div className="flex flex-wrap gap-5 text-xs font-medium">
            <label className={`flex items-center gap-2 ${searchIrrelevant ? "opacity-60" : ""}`}><input type="checkbox" className="h-4 w-4" disabled={searchIrrelevant} checked={searchIrrelevant ? false : draft.features.search} onChange={(e) => set({ features: { ...draft.features, search: e.target.checked } })} /> Product search</label>
            <label className={`flex items-center gap-2 ${accountsIrrelevant ? "opacity-60" : ""}`}><input type="checkbox" className="h-4 w-4" disabled={accountsIrrelevant} checked={accountsIrrelevant ? false : draft.features.account} onChange={(e) => set({ features: { ...draft.features, account: e.target.checked } })} /> Customer accounts</label>
          </div>
          {(searchIrrelevant || accountsIrrelevant) && (
            <p className="-mt-2 text-[11px] text-muted-foreground">
              {searchIrrelevant ? "A site without products has no search. " : ""}
              {accountsIrrelevant ? "Customer accounts only exist on an online shop." : ""}
            </p>
          )}
          <div className="space-y-3 border-t border-border pt-4">
            <label className="flex items-center gap-2 text-xs font-medium">
              <input type="checkbox" className="h-4 w-4" checked={!!cta} onChange={(e) => set({ headerCta: e.target.checked ? { label: "Get a quote", href: "/contact" } : null })} /> Show a button in the header
            </label>
            {cta && (
              <div className="grid max-w-2xl gap-3 md:grid-cols-2">
                <Field label="Button label" hint={`${cta.label.length}/30`}><Input maxLength={30} value={cta.label} onChange={(e) => set({ headerCta: { ...cta, label: e.target.value } })} /></Field>
                <Field label="Button link" hint="/contact or an https:// address."><Input value={cta.href} aria-invalid={!NAV_HREF.test(cta.href)} onChange={(e) => set({ headerCta: { ...cta, href: e.target.value } })} /></Field>
              </div>
            )}
          </div>
        </Card>
      </fieldset>

      <Dialog open={!!applying} onOpenChange={(o) => !o && !applyBusy && setApplying(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          {template && (
            <>
              <DialogHeader>
                <DialogTitle>Use “{template.label}”?</DialogTitle>
                <DialogDescription>Choose what the template may write. Products, orders and customers are never touched.</DialogDescription>
              </DialogHeader>
              {applyError && <Notice kind="error" message={applyError} onClose={() => setApplyError(null)} />}
              <div className="space-y-3 text-xs">
                <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={options.applyContent} onChange={(e) => setOptions({ ...options, applyContent: e.target.checked })} /><span><span className="font-medium">Layout, navigation &amp; home page</span><span className="block text-muted-foreground">Also switches the site to “{MODE_LABEL[template.mode]}”.</span></span></label>
                <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={options.applyTheme} onChange={(e) => setOptions({ ...options, applyTheme: e.target.checked })} /><span><span className="font-medium">Colours &amp; fonts</span><span className="block text-muted-foreground">The template's look. Your logo, announcement and social links stay.</span></span></label>
                <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={options.createPages} onChange={(e) => setOptions({ ...options, createPages: e.target.checked })} /><span><span className="font-medium">Create its pages</span><span className="block text-muted-foreground">{template.pages.length ? template.pages.map((p) => p.title).join(", ") : "This template has no extra pages."}</span></span></label>
                <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={options.createForms} onChange={(e) => setOptions({ ...options, createForms: e.target.checked })} /><span><span className="font-medium">Create its forms</span><span className="block text-muted-foreground">{template.forms.length ? template.forms.map((f) => f.name).join(", ") : "This template has no forms."}</span></span></label>
                <label className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={options.overwritePages} disabled={!options.createPages && !options.createForms} onChange={(e) => setOptions({ ...options, overwritePages: e.target.checked })} /><span><span className="font-medium text-destructive">Replace existing pages and forms with the same address</span><span className="block text-muted-foreground">Off by default: a page or form you already have is left alone. Turn on to overwrite it with the template's version. This cannot be undone.</span></span></label>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-xs">
                <div className="mb-1 font-medium">What will change</div>
                <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {options.applyContent && <li>Your header, footer, menu links and home page sections are <span className="font-medium text-foreground">replaced</span>.</li>}
                  {options.applyContent && template.mode !== draft.mode && <li>The site type changes from “{MODE_LABEL[draft.mode]}” to “{MODE_LABEL[template.mode]}”.{template.mode !== "shop" ? " The cart, checkout and accounts are switched off." : ""}</li>}
                  {options.applyTheme && <li>Colours, font, corners and layout presets are <span className="font-medium text-foreground">replaced</span>.</li>}
                  {options.createPages && <li>Missing pages are created{options.overwritePages ? "; existing ones at the same address are overwritten" : "; existing ones are left alone"}.</li>}
                  {options.createForms && <li>Missing forms are created{options.overwritePages ? "; existing ones at the same address are overwritten" : "; existing ones are left alone"}.</li>}
                  {!options.applyContent && !options.applyTheme && !options.createPages && !options.createForms && <li>Nothing. Tick at least one option.</li>}
                </ul>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={applyBusy} onClick={() => setApplying(null)}>Cancel</Button>
                <Button type="button" disabled={applyBusy || !(options.applyContent || options.applyTheme || options.createPages || options.createForms)} onClick={() => void apply()}>{applyBusy ? "Applying..." : "Apply template"}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
