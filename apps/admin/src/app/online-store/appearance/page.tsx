"use client";

import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Save, Undo2 } from "lucide-react";
import {
  FONT_PAIR_IDS,
  CONTAINER_WIDTHS,
  FOOTER_LAYOUTS,
  HEADER_LAYOUTS,
  HEX_COLOR,
  NAV_HREF,
  PRODUCT_CARD_LAYOUTS,
  RADIUS_STYLES,
  SOCIAL_NETWORKS,
  THEME_PRESET_IDS,
  THEME_PRESETS,
  resolveTheme,
  type FontPairId,
  type StorefrontTheme,
  type ThemeColors,
  type ThemePresetId,
} from "@devsfleet/shared-types";
import { usePermission } from "@/lib/require-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, Loading, Notice, PageHeader } from "../shared";
import { OptionCards } from "../option-cards";
import { StoreTabs } from "../store-nav";
import { useStoreSettings } from "../use-store-settings";
import { ThemePreview } from "./theme-preview";

const COLOR_FIELDS: { key: keyof ThemeColors; label: string; hint: string }[] = [
  { key: "ink", label: "Text & dark panels", hint: "Headings, the top bar, the hero." },
  { key: "accent", label: "Primary action", hint: "Buttons, links, “in stock”." },
  { key: "highlight", label: "Highlight", hint: "Offers and trade prices." },
  { key: "background", label: "Page background", hint: "Behind the cards." },
  { key: "surface", label: "Cards & panels", hint: "Product cards, header." },
];

const FONT_LABELS: Record<FontPairId, { title: string; text: string }> = {
  barlow: { title: "Barlow", text: "Condensed headings. Trade and industrial." },
  inter: { title: "Inter", text: "Neutral and modern. Works anywhere." },
  poppins: { title: "Poppins", text: "Rounded and friendly." },
  serif: { title: "Playfair + Inter", text: "Serif headings. Elegant, editorial." },
};
const RADIUS_LABELS = { sharp: "Sharp", soft: "Soft", round: "Round" } as const;
const HEADER_LABELS = {
  classic: ["Classic", "Logo left, wide search, department bar. For shops."],
  centered: ["Centered", "Logo centred, links underneath."],
  compact: ["Compact", "One slim row. More room for products."],
  simple: ["Simple", "Logo, menu links and one button. No search or cart: company sites."],
} as const;
const CARD_LABELS = { standard: ["Standard", "Soft shadow around image and details."], minimal: ["Minimal", "No frame; just image, name and price."], bordered: ["Bordered", "Thin outline, flat."] } as const;
const FOOTER_LABELS = {
  dark: ["Dark", "Uses the text colour as background."],
  light: ["Light", "Matches the card colour."],
  minimal: ["Minimal", "A single row: name, legal links and social icons."],
} as const;
const CONTAINER_LABELS = { boxed: ["Boxed", "Content in a centred column. Easy to read."], wide: ["Wide", "Content runs closer to the screen edges."] } as const;
const SOCIAL_LABELS: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", x: "X (Twitter)", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn", snapchat: "Snapchat" };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two six-digit hex colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const isHttps = (v: string) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

export default function AppearancePage() {
  const mayWrite = usePermission("storefront:write");
  const { overview, settings, loading, saving, error, success, setError, setSuccess, patch } = useStoreSettings();
  const [draft, setDraft] = useState<StorefrontTheme | null>(null);

  useEffect(() => {
    if (settings) setDraft(resolveTheme(settings.theme));
  }, [settings]);

  const saved = useMemo(() => (settings ? resolveTheme(settings.theme) : null), [settings]);
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);

  const problems = useMemo(() => {
    const out: string[] = [];
    if (!draft) return out;
    for (const f of COLOR_FIELDS) if (!HEX_COLOR.test(draft.colors[f.key])) out.push(`${f.label} must be a hex colour like #0e6b53.`);
    if (draft.faviconUrl && !isHttps(draft.faviconUrl)) out.push("The favicon must be an https:// address.");
    if (draft.shareImageUrl && !isHttps(draft.shareImageUrl)) out.push("The share image must be an https:// address.");
    if (draft.announcement.enabled && !draft.announcement.text.trim()) out.push("The announcement bar is on but has no text.");
    if (draft.announcement.href && !NAV_HREF.test(draft.announcement.href)) out.push("The announcement link must start with / or https://.");
    for (const [k, v] of Object.entries(draft.social)) if (v && !isHttps(v)) out.push(`${SOCIAL_LABELS[k] ?? k} must be an https:// address.`);
    return out;
  }, [draft]);

  const warnings = useMemo(() => {
    const out: string[] = [];
    if (!draft) return out;
    const { accent, ink, background } = draft.colors;
    if (HEX_COLOR.test(accent) && contrast(accent, "#ffffff") < 4.5)
      out.push(`White text on the primary action colour has a contrast of ${contrast(accent, "#ffffff").toFixed(1)}:1; buttons will be hard to read. Aim for 4.5:1 or more.`);
    if (HEX_COLOR.test(ink) && HEX_COLOR.test(background) && contrast(ink, background) < 4.5)
      out.push(`Text on the page background has a contrast of ${contrast(ink, background).toFixed(1)}:1. Aim for 4.5:1 or more.`);
    return out;
  }, [draft]);

  if (loading) return <Loading label="Loading appearance..." />;
  if (!overview?.storefront || !draft) {
    return (
      <div className="space-y-6">
        <PageHeader title="Appearance" description="Colours, fonts and layout of your website." />
        <StoreTabs current="/online-store/appearance" />
        {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
        <Card className="p-6 text-sm text-muted-foreground">Create your online store first, in Store Settings.</Card>
      </div>
    );
  }

  const set = (patchTheme: Partial<StorefrontTheme>) => setDraft({ ...draft, ...patchTheme });
  const applyPreset = (id: ThemePresetId) => {
    const p = THEME_PRESETS[id];
    // Brand assets, announcement and social links belong to the shop, not the look.
    setDraft({ ...draft, preset: id, colors: { ...p.colors }, font: p.font, radius: p.radius, layout: { ...p.layout } });
  };
  const setColor = (key: keyof ThemeColors, value: string) => set({ colors: { ...draft.colors, [key]: value } });
  const shopName = overview.storefront.name;

  const save = () =>
    void patch(
      {
        theme: {
          ...draft,
          colors: Object.fromEntries(Object.entries(draft.colors).map(([k, v]) => [k, v.toLowerCase()])) as unknown as ThemeColors,
          faviconUrl: draft.faviconUrl?.trim() || null,
          shareImageUrl: draft.shareImageUrl?.trim() || null,
          announcement: { ...draft.announcement, href: draft.announcement.href?.trim() || null },
          social: Object.fromEntries(Object.entries(draft.social).filter(([, v]) => v?.trim())),
        },
      },
      "Appearance saved. Shoppers see it within a minute.",
    );

  return (
    <div className="space-y-6">
      <PageHeader title="Appearance" description="Choose how your website looks. Changes show in the preview straight away and go live when you save.">
        {mayWrite && (
          <>
            <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => saved && setDraft(saved)}><Undo2 className="h-4 w-4" /> Discard</Button>
            <Button size="sm" disabled={!dirty || saving || problems.length > 0} onClick={save}><Save className="h-4 w-4" /> Save appearance</Button>
          </>
        )}
      </PageHeader>
      <StoreTabs current="/online-store/appearance" />

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
      {problems.length > 0 && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <ul className="list-disc space-y-0.5 pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {warnings.map((w) => (
        <div key={w} className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {w}
        </div>
      ))}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <fieldset disabled={!mayWrite} className="min-w-0 space-y-6">
          <Card className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">Preset</h2>
            <p className="text-xs text-muted-foreground">A starting point. Choosing one replaces the colours, font, shape and layout below; you can still change each.</p>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {THEME_PRESET_IDS.map((id) => {
                const p = THEME_PRESETS[id];
                const on = draft.preset === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => applyPreset(id)}
                    className={`cursor-pointer rounded-xl border p-3 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-accent"}`}
                  >
                    <div className="mb-2 flex h-6 overflow-hidden rounded-md border border-border" aria-hidden="true">
                      {[p.colors.ink, p.colors.accent, p.colors.highlight, p.colors.background, p.colors.surface].map((c) => <span key={c} className="flex-1" style={{ background: c }} />)}
                    </div>
                    <div className="font-semibold">{p.label}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{p.blurb}</div>
                  </button>
                );
              })}
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Colours</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {COLOR_FIELDS.map((f) => {
                const value = draft.colors[f.key];
                const valid = HEX_COLOR.test(value);
                return (
                  <Field key={f.key} label={f.label} hint={f.hint}>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        aria-label={`${f.label} colour picker`}
                        className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-input bg-transparent p-1"
                        value={valid ? value : "#000000"}
                        onChange={(e) => setColor(f.key, e.target.value)}
                      />
                      <Input aria-label={`${f.label} hex value`} aria-invalid={!valid} className="font-mono" maxLength={7} value={value} onChange={(e) => setColor(f.key, e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`)} />
                    </div>
                  </Field>
                );
              })}
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Typography &amp; shape</h2>
            <OptionCards label="Font" value={draft.font} onChange={(font) => set({ font })} options={FONT_PAIR_IDS.map((id) => ({ value: id, title: FONT_LABELS[id].title, text: FONT_LABELS[id].text }))} />
            <OptionCards
              label="Corner style"
              value={draft.radius}
              onChange={(radius) => set({ radius })}
              options={RADIUS_STYLES.map((r) => ({
                value: r,
                title: RADIUS_LABELS[r],
                swatch: <span aria-hidden="true" className="block h-6 w-12 border-2 border-primary" style={{ borderRadius: r === "sharp" ? 2 : r === "soft" ? 8 : 14 }} />,
              }))}
            />
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Layout</h2>
            <Field label="Header"><OptionCards label="Header layout" value={draft.layout.header} onChange={(header) => set({ layout: { ...draft.layout, header } })} options={HEADER_LAYOUTS.map((v) => ({ value: v, title: HEADER_LABELS[v][0], text: HEADER_LABELS[v][1] }))} /></Field>
            <Field label="Product cards"><OptionCards label="Product card layout" value={draft.layout.productCard} onChange={(productCard) => set({ layout: { ...draft.layout, productCard } })} options={PRODUCT_CARD_LAYOUTS.map((v) => ({ value: v, title: CARD_LABELS[v][0], text: CARD_LABELS[v][1] }))} /></Field>
            <Field label="Footer"><OptionCards label="Footer layout" value={draft.layout.footer} onChange={(footer) => set({ layout: { ...draft.layout, footer } })} options={FOOTER_LAYOUTS.map((v) => ({ value: v, title: FOOTER_LABELS[v][0], text: FOOTER_LABELS[v][1] }))} /></Field>
            <Field label="Page width"><OptionCards label="Page width" value={draft.layout.container} onChange={(container) => set({ layout: { ...draft.layout, container } })} options={CONTAINER_WIDTHS.map((v) => ({ value: v, title: CONTAINER_LABELS[v][0], text: CONTAINER_LABELS[v][1] }))} /></Field>
            <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" className="h-4 w-4" checked={draft.layout.stickyHeader} onChange={(e) => set({ layout: { ...draft.layout, stickyHeader: e.target.checked } })} /> Keep the header visible while scrolling</label>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Brand assets</h2>
            <p className="text-xs text-muted-foreground">Paste the https:// address of each image. Your logo is set in business settings.</p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Favicon" hint="Square PNG or SVG, shown in the browser tab."><Input inputMode="url" placeholder="https://…" value={draft.faviconUrl ?? ""} onChange={(e) => set({ faviconUrl: e.target.value })} /></Field>
              <Field label="Share image" hint="1200×630. Shown when a link to your shop is shared."><Input inputMode="url" placeholder="https://…" value={draft.shareImageUrl ?? ""} onChange={(e) => set({ shareImageUrl: e.target.value })} /></Field>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Announcement bar</h2>
            <label className="flex items-center gap-2 text-xs font-medium"><input type="checkbox" className="h-4 w-4" checked={draft.announcement.enabled} onChange={(e) => set({ announcement: { ...draft.announcement, enabled: e.target.checked } })} /> Show a bar above the header</label>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Message" hint={`${draft.announcement.text.length}/160`}><Input maxLength={160} value={draft.announcement.text} onChange={(e) => set({ announcement: { ...draft.announcement, text: e.target.value } })} placeholder="Free delivery over 300" /></Field>
              <Field label="Link (optional)" hint="A page on your shop (/pages/delivery) or an https:// address."><Input value={draft.announcement.href ?? ""} onChange={(e) => set({ announcement: { ...draft.announcement, href: e.target.value } })} /></Field>
            </div>
          </Card>

          <Card className="space-y-4 p-5">
            <h2 className="text-sm font-semibold">Social links</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {SOCIAL_NETWORKS.map((n) => (
                <Field key={n} label={SOCIAL_LABELS[n] ?? n}>
                  <Input inputMode="url" placeholder="https://…" value={draft.social[n] ?? ""} onChange={(e) => set({ social: { ...draft.social, [n]: e.target.value } })} />
                </Field>
              ))}
            </div>
          </Card>
        </fieldset>

        <aside aria-label="Live preview" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
          <Card className="space-y-3 p-4">
            <h2 className="text-sm font-semibold">Preview</h2>
            <ThemePreview theme={draft} name={shopName} />
            <p className="text-[11px] text-muted-foreground">A simplified sketch. Your real pages use the same colours, font, corners and layout.</p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
