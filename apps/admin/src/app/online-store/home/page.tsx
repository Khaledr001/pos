"use client";

import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, RotateCcw, Save, Trash2, Undo2 } from "lucide-react";
import {
  BADGE_ICONS,
  DEFAULT_HOME_SECTIONS,
  HOME_SECTION_LABELS,
  HOME_SECTION_TYPES,
  MAX_HOME_SECTIONS,
  NAV_HREF,
  type BadgeIcon,
  type HomeSection,
  type HomeSectionType,
  type TrustBadge,
} from "@devsfleet/shared-types";
import { usePermission } from "@/lib/require-auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Field, Loading, Notice, PageHeader, textareaClass } from "../shared";
import { StoreTabs } from "../store-nav";
import { useStoreSettings } from "../use-store-settings";

const MAX_BADGES = 6;
const MAX_FAQ = 12;

const newId = (type: HomeSectionType) => `${type}-${Math.random().toString(36).slice(2, 8)}`;

const TYPE_HINTS: Record<HomeSectionType, string> = {
  hero: "The big banner at the top. Slides come from Banners.",
  trust_badges: "Short reasons to buy from you, with icons.",
  categories: "Tiles for your top departments.",
  products: "A row of product cards: best sellers or new arrivals.",
  promo_banner: "A wide call-to-action panel.",
  brands: "Logos of your featured brands.",
  banner_strip: "Smaller promotional banners. They come from Banners.",
  rich_text: "A heading and a paragraph of your own words.",
  faq: "Questions and answers.",
};

function blank(type: HomeSectionType): HomeSection {
  const id = newId(type);
  switch (type) {
    case "hero": return { id, type, enabled: true, settings: { variant: "banner" } };
    case "trust_badges": return { id, type, enabled: true, settings: { items: [{ icon: "truck", title: "Fast delivery", text: "" }] } };
    case "categories": return { id, type, enabled: true, settings: { limit: 8 } };
    case "products": return { id, type, enabled: true, settings: { source: "best_sellers", title: "Best sellers", limit: 8 } };
    case "promo_banner": return { id, type, enabled: true, settings: {} };
    case "brands": return { id, type, enabled: true, settings: {} };
    case "banner_strip": return { id, type, enabled: true, settings: {} };
    case "rich_text": return { id, type, enabled: true, settings: { title: "", body: "" } };
    case "faq": return { id, type, enabled: true, settings: { title: "Frequently asked questions", items: [{ q: "", a: "" }] } };
  }
}

function sectionProblems(s: HomeSection): string[] {
  const out: string[] = [];
  const st = s.settings as Record<string, unknown>;
  for (const key of ["ctaHref"]) {
    const v = st[key];
    if (typeof v === "string" && v && !NAV_HREF.test(v)) out.push("The button link must start with / or https://.");
  }
  if (s.type === "faq") {
    for (const it of (st.items as { q: string; a: string }[] | undefined) ?? []) if (!it.q.trim() || !it.a.trim()) { out.push("Every FAQ needs a question and an answer."); break; }
  }
  if (s.type === "trust_badges") {
    for (const it of (st.items as TrustBadge[] | undefined) ?? []) if (!it.title.trim()) { out.push("Every badge needs a title."); break; }
  }
  if (s.type === "rich_text" && !String(st.body ?? "").trim() && !String(st.title ?? "").trim()) out.push("The text block is empty.");
  return out;
}

export default function HomeSectionsPage() {
  const mayWrite = usePermission("storefront:write");
  const { overview, settings, loading, saving, error, success, setError, setSuccess, patch } = useStoreSettings();
  const [draft, setDraft] = useState<HomeSection[] | null>(null);
  const [adding, setAdding] = useState<HomeSectionType>("rich_text");

  useEffect(() => {
    if (settings) setDraft(structuredClone(settings.homeSections));
  }, [settings]);

  const dirty = useMemo(() => !!draft && !!settings && JSON.stringify(draft) !== JSON.stringify(settings.homeSections), [draft, settings]);
  const problems = useMemo(() => (draft ?? []).flatMap((s, i) => sectionProblems(s).map((p) => `${i + 1}. ${HOME_SECTION_LABELS[s.type]}: ${p}`)), [draft]);

  if (loading) return <Loading label="Loading the home page..." />;
  if (!overview?.storefront || !draft) {
    return (
      <div className="space-y-6">
        <PageHeader title="Home page" description="Choose and order the sections of your home page." />
        <StoreTabs current="/online-store/home" />
        {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
        <Card className="p-6 text-sm text-muted-foreground">Create your online store first, in Store Settings.</Card>
      </div>
    );
  }

  const update = (id: string, fn: (s: HomeSection) => HomeSection) => setDraft(draft.map((s) => (s.id === id ? fn(s) : s)));
  const setSettings = (id: string, patchSettings: Record<string, unknown>) =>
    update(id, (s) => ({ ...s, settings: { ...s.settings, ...patchSettings } }) as HomeSection);
  const move = (index: number, by: -1 | 1) => {
    const next = [...draft];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    setDraft(next);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Home page" description="Turn sections on or off, reorder them and edit their wording. Products, departments and brands fill in from your catalogue.">
        {mayWrite && (
          <>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => setDraft(structuredClone(DEFAULT_HOME_SECTIONS))}><RotateCcw className="h-4 w-4" /> Reset to default</Button>
            <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => settings && setDraft(structuredClone(settings.homeSections))}><Undo2 className="h-4 w-4" /> Discard</Button>
            <Button size="sm" disabled={!dirty || saving || problems.length > 0 || draft.length === 0} onClick={() => void patch({ homeSections: draft }, "Home page saved. Shoppers see it within a minute.")}><Save className="h-4 w-4" /> Save home page</Button>
          </>
        )}
      </PageHeader>
      <StoreTabs current="/online-store/home" />

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
      {problems.length > 0 && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <ul className="list-disc space-y-0.5 pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <ol className="space-y-3">
        {draft.map((s, i) => (
          <li key={s.id}>
            <Card className={`space-y-4 p-4 ${s.enabled ? "" : "opacity-70"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-center text-xs font-semibold text-muted-foreground" aria-hidden="true">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold">{HOME_SECTION_LABELS[s.type]} {!s.enabled && <Badge variant="secondary">Hidden</Badge>}</h2>
                  <p className="text-[11px] text-muted-foreground">{TYPE_HINTS[s.type]}</p>
                </div>
                {mayWrite && (
                  <div className="flex items-center gap-1">
                    <label className="mr-2 flex items-center gap-1.5 text-xs"><input type="checkbox" className="h-4 w-4" checked={s.enabled} onChange={(e) => update(s.id, (x) => ({ ...x, enabled: e.target.checked }))} /> Shown</label>
                    <Button size="icon" variant="ghost" aria-label={`Move ${HOME_SECTION_LABELS[s.type]} up`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Move ${HOME_SECTION_LABELS[s.type]} down`} disabled={i === draft.length - 1} onClick={() => move(i, 1)}><ChevronDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete ${HOME_SECTION_LABELS[s.type]}`} onClick={() => setDraft(draft.filter((x) => x.id !== s.id))}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                )}
              </div>
              <fieldset disabled={!mayWrite} className="min-w-0">
                <SectionForm section={s} onChange={(p) => setSettings(s.id, p)} />
              </fieldset>
            </Card>
          </li>
        ))}
        {draft.length === 0 && <li className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">No sections. Add one below, or reset to the default.</li>}
      </ol>

      {mayWrite && (
        <Card className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-56">
            <Field label="Add a section" hint={`${draft.length} of ${MAX_HOME_SECTIONS} used.`}>
              <SelectField size="sm" label="Section type" value={adding} onValueChange={(v) => setAdding(v as HomeSectionType)} options={HOME_SECTION_TYPES.map((t) => ({ value: t, label: HOME_SECTION_LABELS[t] }))} />
            </Field>
          </div>
          <Button size="sm" disabled={draft.length >= MAX_HOME_SECTIONS} onClick={() => setDraft([...draft, blank(adding)])}><Plus className="h-4 w-4" /> Add section</Button>
        </Card>
      )}
    </div>
  );
}

function SectionForm({ section, onChange }: { section: HomeSection; onChange: (p: Record<string, unknown>) => void }) {
  const idp = section.id;
  switch (section.type) {
    case "hero": {
      const st = section.settings;
      return (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Headline" hint="Empty uses your shop's tagline."><Input maxLength={120} value={st.headline ?? ""} onChange={(e) => onChange({ headline: e.target.value })} /></Field>
            <Field label="Sub-headline"><Input maxLength={240} value={st.subheadline ?? ""} onChange={(e) => onChange({ subheadline: e.target.value })} /></Field>
            <Field label="Button label"><Input maxLength={40} value={st.ctaLabel ?? ""} onChange={(e) => onChange({ ctaLabel: e.target.value })} /></Field>
            <Field label="Button link" hint="/category/tools or an https:// address."><Input value={st.ctaHref ?? ""} onChange={(e) => onChange({ ctaHref: e.target.value })} /></Field>
            <Field label="Style">
              <SelectField size="sm" label="Hero style" value={st.variant ?? "banner"} onValueChange={(v) => onChange({ variant: v })} options={[{ value: "banner", label: "Banner (full width)" }, { value: "split", label: "Split (text and image)" }, { value: "minimal", label: "Minimal (text only)" }]} />
            </Field>
          </div>
          <BannersNote />
        </div>
      );
    }
    case "banner_strip":
      return <BannersNote />;
    case "trust_badges": {
      const items = section.settings.items ?? [];
      const set = (next: TrustBadge[]) => onChange({ items: next });
      return (
        <div className="space-y-3">
          {items.map((b, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[10rem_1fr_2fr_auto] md:items-end">
              <Field label="Icon"><SelectField size="sm" label={`Badge ${i + 1} icon`} value={b.icon} onValueChange={(v) => set(items.map((x, j) => (j === i ? { ...x, icon: v as BadgeIcon } : x)))} options={BADGE_ICONS.map((ic) => ({ value: ic, label: ic.replace("-", " ") }))} /></Field>
              <Field label="Title"><Input maxLength={40} value={b.title} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /></Field>
              <Field label="Text"><Input maxLength={120} value={b.text} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} /></Field>
              <Button size="icon" variant="ghost" aria-label={`Remove badge ${i + 1}`} onClick={() => set(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" disabled={items.length >= MAX_BADGES} onClick={() => set([...items, { icon: "badge-check", title: "", text: "" }])}><Plus className="h-4 w-4" /> Add badge</Button>
        </div>
      );
    }
    case "categories":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Heading" hint="Empty uses “Shop by department”."><Input maxLength={80} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <Field label="How many departments"><Input id={`${idp}-limit`} type="number" min={1} max={24} value={section.settings.limit ?? 8} onChange={(e) => onChange({ limit: Math.min(24, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
        </div>
      );
    case "products":
      return (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Show"><SelectField size="sm" label="Product source" value={section.settings.source ?? "best_sellers"} onValueChange={(v) => onChange({ source: v })} options={[{ value: "best_sellers", label: "Best sellers" }, { value: "new_arrivals", label: "New arrivals" }]} /></Field>
          <Field label="Heading"><Input maxLength={80} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <Field label="How many (up to 12)"><Input type="number" min={1} max={12} value={section.settings.limit ?? 8} onChange={(e) => onChange({ limit: Math.min(12, Math.max(1, Number(e.target.value) || 1)) })} /></Field>
        </div>
      );
    case "promo_banner": {
      const st = section.settings;
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Headline"><Input maxLength={120} value={st.headline ?? ""} onChange={(e) => onChange({ headline: e.target.value })} /></Field>
          <Field label="Text"><Input maxLength={240} value={st.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} /></Field>
          <Field label="Button label"><Input maxLength={40} value={st.ctaLabel ?? ""} onChange={(e) => onChange({ ctaLabel: e.target.value })} /></Field>
          <Field label="Button link"><Input value={st.ctaHref ?? ""} onChange={(e) => onChange({ ctaHref: e.target.value })} /></Field>
        </div>
      );
    }
    case "brands":
      return <Field label="Heading" hint="Empty uses “Shop by brand”. Brands marked featured appear here."><Input maxLength={80} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>;
    case "rich_text":
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input maxLength={120} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <Field label="Text" hint="Markdown: **bold**, *italic*, [link](https://…), - lists."><textarea rows={5} maxLength={4000} className={textareaClass} value={section.settings.body ?? ""} onChange={(e) => onChange({ body: e.target.value })} /></Field>
        </div>
      );
    case "faq": {
      const items = section.settings.items ?? [];
      const set = (next: { q: string; a: string }[]) => onChange({ items: next });
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input maxLength={120} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          {items.map((it, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_2fr_auto] md:items-end">
              <Field label="Question"><Input maxLength={200} value={it.q} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} /></Field>
              <Field label="Answer"><Input maxLength={1000} value={it.a} onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, a: e.target.value } : x)))} /></Field>
              <Button size="icon" variant="ghost" aria-label={`Remove question ${i + 1}`} onClick={() => set(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button size="sm" variant="outline" disabled={items.length >= MAX_FAQ} onClick={() => set([...items, { q: "", a: "" }])}><Plus className="h-4 w-4" /> Add question</Button>
        </div>
      );
    }
  }
}

function BannersNote() {
  return (
    <p className="text-[11px] text-muted-foreground">
      Slides and strip images are managed in <Link href="/online-store/content" className="text-primary hover:underline">Pages &amp; banners</Link>.
    </p>
  );
}
