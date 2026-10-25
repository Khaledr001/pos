"use client";

import Link from "next/link";
import React from "react";
import {
  BADGE_ICONS,
  type BadgeIcon,
  type CardItem,
  type FaqItem,
  type HomeSection,
  type HomeSectionSettings,
  type ImageItem,
  type TrustBadge,
} from "@devsfleet/shared-types";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Field, textareaClass } from "../shared";
import { ImageUrlField, ItemListEditor } from "./item-list-editor";
import { CAPS } from "./section-meta";

export interface Lookups {
  forms: { slug: string; name: string }[];
  categories: { slug: string; name: string }[];
}

const iconOptions = BADGE_ICONS.map((ic) => ({ value: ic, label: ic.replace("-", " ") }));
const columnOptions = [{ value: "2", label: "2 columns" }, { value: "3", label: "3 columns" }, { value: "4", label: "4 columns" }];
const sizeOptions = [{ value: "sm", label: "Small" }, { value: "md", label: "Medium" }, { value: "lg", label: "Large" }];
const clampInt = (raw: string, min: number, max: number) => Math.min(max, Math.max(min, Number(raw) || min));

function BannersNote() {
  return (
    <p className="text-[11px] text-muted-foreground">
      Slides and strip images are managed in <Link href="/online-store/content" className="text-primary hover:underline">Pages &amp; banners</Link>.
    </p>
  );
}

function ButtonFields({ s, onChange, second }: { s: { ctaLabel?: string; ctaHref?: string; secondaryLabel?: string; secondaryHref?: string }; onChange: (p: Record<string, unknown>) => void; second?: boolean }) {
  return (
    <>
      <Field label="Button label"><Input maxLength={40} value={s.ctaLabel ?? ""} onChange={(e) => onChange({ ctaLabel: e.target.value })} /></Field>
      <Field label="Button link" hint="/contact, /category/tools or an https:// address."><Input value={s.ctaHref ?? ""} onChange={(e) => onChange({ ctaHref: e.target.value })} /></Field>
      {second && (
        <>
          <Field label="Second button label"><Input maxLength={40} value={s.secondaryLabel ?? ""} onChange={(e) => onChange({ secondaryLabel: e.target.value })} /></Field>
          <Field label="Second button link"><Input value={s.secondaryHref ?? ""} onChange={(e) => onChange({ secondaryHref: e.target.value })} /></Field>
        </>
      )}
    </>
  );
}

/** The settings form of one section, switched on its type. `onChange` merges into `settings`. */
export function SectionForm({ section, onChange, lookups }: { section: HomeSection; onChange: (p: Record<string, unknown>) => void; lookups: Lookups }) {
  switch (section.type) {
    case "hero": {
      const st = section.settings;
      const variant = st.variant ?? "banner";
      return (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Headline" hint="Empty uses your shop's tagline."><Input maxLength={120} value={st.headline ?? ""} onChange={(e) => onChange({ headline: e.target.value })} /></Field>
            <Field label="Sub-headline"><Input maxLength={240} value={st.subheadline ?? ""} onChange={(e) => onChange({ subheadline: e.target.value })} /></Field>
            <ButtonFields s={st} onChange={onChange} second />
            <Field label="Style">
              <SelectField size="sm" label="Hero style" value={variant} onValueChange={(v) => onChange({ variant: v })} options={[
                { value: "image", label: "Photo background" },
                { value: "banner", label: "Banner slides (from Banners)" },
                { value: "split", label: "Split (text and image)" },
                { value: "minimal", label: "Minimal (text only)" },
              ]} />
            </Field>
            <Field label="Text alignment">
              <SelectField size="sm" label="Hero alignment" value={st.align ?? "left"} onValueChange={(v) => onChange({ align: v })} options={[{ value: "left", label: "Left" }, { value: "center", label: "Centred" }]} />
            </Field>
            <Field label="Height"><SelectField size="sm" label="Hero height" value={st.height ?? "md"} onValueChange={(v) => onChange({ height: v })} options={sizeOptions} /></Field>
            {(variant === "image" || variant === "split") && <ImageUrlField label="Hero image" value={st.imageUrl} onChange={(v) => onChange({ imageUrl: v })} />}
          </div>
          {variant === "banner" && <BannersNote />}
        </div>
      );
    }
    case "banner_strip":
      return <BannersNote />;
    case "trust_badges":
      return (
        <ItemListEditor<TrustBadge>
          noun="badge" max={CAPS.badges} items={section.settings.items ?? []} onChange={(items) => onChange({ items })} blank={() => ({ icon: "badge-check", title: "", text: "" })}
          renderItem={(b, up, i) => (
            <div className="grid gap-2 md:grid-cols-[10rem_1fr_2fr]">
              <Field label="Icon"><SelectField size="sm" label={`Badge ${i + 1} icon`} value={b.icon} onValueChange={(v) => up({ icon: v as BadgeIcon })} options={iconOptions} /></Field>
              <Field label="Title"><Input maxLength={40} value={b.title} onChange={(e) => up({ title: e.target.value })} /></Field>
              <Field label="Text"><Input maxLength={120} value={b.text} onChange={(e) => up({ text: e.target.value })} /></Field>
            </div>
          )}
        />
      );
    case "categories":
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Heading" hint="Empty uses “Shop by department”."><Input maxLength={80} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <Field label="How many departments"><Input type="number" min={1} max={24} value={section.settings.limit ?? 8} onChange={(e) => onChange({ limit: clampInt(e.target.value, 1, 24) })} /></Field>
        </div>
      );
    case "products": {
      const st = section.settings;
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Show">
            <SelectField size="sm" label="Product source" value={st.source ?? "best_sellers"} onValueChange={(v) => onChange({ source: v })} options={[
              { value: "best_sellers", label: "Best sellers" },
              { value: "new_arrivals", label: "New arrivals" },
              { value: "category", label: "A category" },
            ]} />
          </Field>
          {st.source === "category" && (
            <Field label="Category">
              <SelectField size="sm" label="Category" value={st.categorySlug ?? ""} placeholder="Choose a category" onValueChange={(v) => onChange({ categorySlug: v })} options={lookups.categories.map((c) => ({ value: c.slug, label: c.name }))} />
            </Field>
          )}
          <Field label="Heading"><Input maxLength={80} value={st.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <Field label="How many (up to 12)"><Input type="number" min={1} max={12} value={st.limit ?? 8} onChange={(e) => onChange({ limit: clampInt(e.target.value, 1, 12) })} /></Field>
        </div>
      );
    }
    case "promo_banner": {
      const st = section.settings;
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Headline"><Input maxLength={120} value={st.headline ?? ""} onChange={(e) => onChange({ headline: e.target.value })} /></Field>
          <Field label="Text"><Input maxLength={240} value={st.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} /></Field>
          <ButtonFields s={st} onChange={onChange} />
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
    case "faq":
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input maxLength={120} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <ItemListEditor<FaqItem>
            noun="question" max={CAPS.faq} items={section.settings.items ?? []} onChange={(items) => onChange({ items })} blank={() => ({ q: "", a: "" })}
            renderItem={(it, up) => (
              <div className="grid gap-2 md:grid-cols-[1fr_2fr]">
                <Field label="Question"><Input maxLength={200} value={it.q} onChange={(e) => up({ q: e.target.value })} /></Field>
                <Field label="Answer"><Input maxLength={1000} value={it.a} onChange={(e) => up({ a: e.target.value })} /></Field>
              </div>
            )}
          />
        </div>
      );
    case "image_text": {
      const st = section.settings;
      const bullets = st.bullets ?? [];
      return (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Heading"><Input maxLength={120} value={st.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
            <Field label="Picture side"><SelectField size="sm" label="Picture side" value={st.imageSide ?? "right"} onValueChange={(v) => onChange({ imageSide: v })} options={[{ value: "right", label: "Right" }, { value: "left", label: "Left" }]} /></Field>
            <ImageUrlField label="Picture" value={st.imageUrl} onChange={(v) => onChange({ imageUrl: v })} />
            <Field label="Picture description" hint="Read aloud by screen readers."><Input maxLength={160} value={st.imageAlt ?? ""} onChange={(e) => onChange({ imageAlt: e.target.value })} /></Field>
            <ButtonFields s={st} onChange={onChange} />
          </div>
          <Field label="Text" hint="Markdown: **bold**, *italic*, [link](https://…)."><textarea rows={5} maxLength={4000} className={textareaClass} value={st.body ?? ""} onChange={(e) => onChange({ body: e.target.value })} /></Field>
          <Field label="Bullet points (one per line, optional)" hint={`Up to ${CAPS.bullets}.`}>
            <textarea rows={3} className={textareaClass} value={bullets.join("\n")} onChange={(e) => onChange({ bullets: e.target.value.split("\n").slice(0, CAPS.bullets).map((l) => l.slice(0, 160)) })} onBlur={(e) => onChange({ bullets: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, CAPS.bullets) })} />
          </Field>
        </div>
      );
    }
    case "features": {
      const st = section.settings;
      return (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Heading"><Input maxLength={120} value={st.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
            <Field label="Sub-heading"><Input maxLength={240} value={st.subtitle ?? ""} onChange={(e) => onChange({ subtitle: e.target.value })} /></Field>
            <Field label="Columns"><SelectField size="sm" label="Columns" value={String(st.columns ?? 3)} onValueChange={(v) => onChange({ columns: Number(v) })} options={columnOptions} /></Field>
          </div>
          <ItemListEditor<{ icon: BadgeIcon; title: string; text: string }>
            noun="feature" max={CAPS.features} items={st.items ?? []} onChange={(items) => onChange({ items })} blank={() => ({ icon: "badge-check", title: "", text: "" })}
            renderItem={(b, up, i) => (
              <div className="grid gap-2 md:grid-cols-[10rem_1fr_2fr]">
                <Field label="Icon"><SelectField size="sm" label={`Feature ${i + 1} icon`} value={b.icon} onValueChange={(v) => up({ icon: v as BadgeIcon })} options={iconOptions} /></Field>
                <Field label="Title"><Input maxLength={60} value={b.title} onChange={(e) => up({ title: e.target.value })} /></Field>
                <Field label="Text"><Input maxLength={240} value={b.text} onChange={(e) => up({ text: e.target.value })} /></Field>
              </div>
            )}
          />
        </div>
      );
    }
    case "cards": {
      const st = section.settings;
      return (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-4">
            <Field label="Heading"><Input maxLength={120} value={st.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
            <Field label="Sub-heading"><Input maxLength={240} value={st.subtitle ?? ""} onChange={(e) => onChange({ subtitle: e.target.value })} /></Field>
            <Field label="Look"><SelectField size="sm" label="Card look" value={st.variant ?? "card"} onValueChange={(v) => onChange({ variant: v })} options={[
              { value: "card", label: "Card with picture" },
              { value: "plain", label: "Plain (no frame)" },
              { value: "overlay", label: "Text over picture" },
              { value: "person", label: "Person (round photo)" },
            ]} /></Field>
            <Field label="Columns"><SelectField size="sm" label="Columns" value={String(st.columns ?? 3)} onValueChange={(v) => onChange({ columns: Number(v) })} options={columnOptions} /></Field>
          </div>
          <ItemListEditor<CardItem>
            noun="card" max={CAPS.cards} items={st.items ?? []} onChange={(items) => onChange({ items })} blank={() => ({ title: "" })}
            renderItem={(c, up) => (
              <div className="grid gap-2 md:grid-cols-2">
                <Field label="Title"><Input maxLength={80} value={c.title} onChange={(e) => up({ title: e.target.value })} /></Field>
                <ImageUrlField label="Picture" value={c.imageUrl} onChange={(v) => up({ imageUrl: v || undefined })} />
                <Field label="Text"><Input maxLength={300} value={c.text ?? ""} onChange={(e) => up({ text: e.target.value })} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Link"><Input value={c.href ?? ""} onChange={(e) => up({ href: e.target.value })} /></Field>
                  <Field label="Link text"><Input maxLength={40} value={c.label ?? ""} onChange={(e) => up({ label: e.target.value })} /></Field>
                </div>
              </div>
            )}
          />
        </div>
      );
    }
    case "stats":
      return (
        <div className="space-y-3">
          <Field label="Heading (optional)"><Input maxLength={120} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <ItemListEditor<{ value: string; label: string }>
            noun="number" max={CAPS.stats} items={section.settings.items ?? []} onChange={(items) => onChange({ items })} blank={() => ({ value: "", label: "" })}
            renderItem={(it, up) => (
              <div className="grid gap-2 md:grid-cols-[10rem_1fr]">
                <Field label="Value" hint="e.g. 25+ or 1,200"><Input maxLength={16} value={it.value} onChange={(e) => up({ value: e.target.value })} /></Field>
                <Field label="Label"><Input maxLength={60} value={it.label} onChange={(e) => up({ label: e.target.value })} /></Field>
              </div>
            )}
          />
        </div>
      );
    case "gallery":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Heading (optional)"><Input maxLength={120} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
            <Field label="Columns"><SelectField size="sm" label="Columns" value={String(section.settings.columns ?? 3)} onValueChange={(v) => onChange({ columns: Number(v) })} options={columnOptions} /></Field>
          </div>
          <ItemListEditor<ImageItem>
            noun="picture" max={CAPS.gallery} items={section.settings.items ?? []} onChange={(items) => onChange({ items })} blank={() => ({ imageUrl: "" })}
            renderItem={(img, up) => (
              <div className="grid gap-2 md:grid-cols-3">
                <ImageUrlField label="Picture" value={img.imageUrl} onChange={(v) => up({ imageUrl: v })} />
                <Field label="Description" hint="For screen readers."><Input maxLength={160} value={img.alt ?? ""} onChange={(e) => up({ alt: e.target.value })} /></Field>
                <Field label="Caption (optional)"><Input maxLength={160} value={img.caption ?? ""} onChange={(e) => up({ caption: e.target.value })} /></Field>
              </div>
            )}
          />
        </div>
      );
    case "testimonials":
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input maxLength={120} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <ItemListEditor<{ quote: string; name: string; role?: string; avatarUrl?: string }>
            noun="testimonial" max={CAPS.testimonials} items={section.settings.items ?? []} onChange={(items) => onChange({ items })} blank={() => ({ quote: "", name: "" })}
            renderItem={(t, up) => (
              <div className="grid gap-2 md:grid-cols-2">
                <div className="md:col-span-2"><Field label="Quote"><textarea rows={2} maxLength={600} className={textareaClass} value={t.quote} onChange={(e) => up({ quote: e.target.value })} /></Field></div>
                <Field label="Name"><Input maxLength={80} value={t.name} onChange={(e) => up({ name: e.target.value })} /></Field>
                <Field label="Role or company"><Input maxLength={80} value={t.role ?? ""} onChange={(e) => up({ role: e.target.value })} /></Field>
                <ImageUrlField label="Photo (optional)" value={t.avatarUrl} onChange={(v) => up({ avatarUrl: v || undefined })} />
              </div>
            )}
          />
        </div>
      );
    case "logos":
      return (
        <div className="space-y-3">
          <Field label="Heading (optional)"><Input maxLength={120} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <ItemListEditor<{ imageUrl: string; name: string; href?: string }>
            noun="logo" max={CAPS.logos} items={section.settings.items ?? []} onChange={(items) => onChange({ items })} blank={() => ({ imageUrl: "", name: "" })}
            renderItem={(l, up) => (
              <div className="grid gap-2 md:grid-cols-3">
                <ImageUrlField label="Logo" value={l.imageUrl} onChange={(v) => up({ imageUrl: v })} />
                <Field label="Name"><Input maxLength={80} value={l.name} onChange={(e) => up({ name: e.target.value })} /></Field>
                <Field label="Link (optional)"><Input value={l.href ?? ""} onChange={(e) => up({ href: e.target.value })} /></Field>
              </div>
            )}
          />
        </div>
      );
    case "steps":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Heading"><Input maxLength={120} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
            <Field label="Sub-heading"><Input maxLength={240} value={section.settings.subtitle ?? ""} onChange={(e) => onChange({ subtitle: e.target.value })} /></Field>
          </div>
          <ItemListEditor<{ title: string; text: string }>
            noun="step" max={CAPS.steps} items={section.settings.items ?? []} onChange={(items) => onChange({ items })} blank={() => ({ title: "", text: "" })}
            renderItem={(s, up) => (
              <div className="grid gap-2 md:grid-cols-[1fr_2fr]">
                <Field label="Title"><Input maxLength={80} value={s.title} onChange={(e) => up({ title: e.target.value })} /></Field>
                <Field label="Text"><Input maxLength={300} value={s.text} onChange={(e) => up({ text: e.target.value })} /></Field>
              </div>
            )}
          />
        </div>
      );
    case "cta_banner": {
      const st = section.settings;
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Headline"><Input maxLength={120} value={st.headline ?? ""} onChange={(e) => onChange({ headline: e.target.value })} /></Field>
          <Field label="Text"><Input maxLength={240} value={st.text ?? ""} onChange={(e) => onChange({ text: e.target.value })} /></Field>
          <ButtonFields s={st} onChange={onChange} second />
          <label className="flex items-center gap-2 self-end text-xs font-medium"><input type="checkbox" className="h-4 w-4" checked={!!st.showWhatsapp} onChange={(e) => onChange({ showWhatsapp: e.target.checked })} /> Also show a WhatsApp button</label>
        </div>
      );
    }
    case "video":
      return (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Heading (optional)"><Input maxLength={120} value={section.settings.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <Field label="YouTube or Vimeo address" hint="e.g. https://www.youtube.com/watch?v=…"><Input inputMode="url" value={section.settings.url ?? ""} onChange={(e) => onChange({ url: e.target.value })} /></Field>
          <Field label="Caption (optional)"><Input maxLength={200} value={section.settings.caption ?? ""} onChange={(e) => onChange({ caption: e.target.value })} /></Field>
        </div>
      );
    case "map": {
      const st = section.settings;
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Heading (optional)"><Input maxLength={120} value={st.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <Field label="Show"><SelectField size="sm" label="Map source" value={st.mode ?? "branches"} onValueChange={(v) => onChange({ mode: v })} options={[{ value: "branches", label: "My branches" }, { value: "embed", label: "An embedded map" }]} /></Field>
          {st.mode === "embed" && (
            <Field label="Embed address" hint="In Google Maps: Share → Embed a map → copy the src address."><Input inputMode="url" value={st.embedUrl ?? ""} onChange={(e) => onChange({ embedUrl: e.target.value })} /></Field>
          )}
          <Field label="Height"><SelectField size="sm" label="Map height" value={st.height ?? "md"} onValueChange={(v) => onChange({ height: v })} options={sizeOptions} /></Field>
        </div>
      );
    }
    case "contact_info": {
      const st = section.settings;
      return (
        <div className="space-y-3">
          <Field label="Heading"><Input maxLength={120} value={st.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <div className="flex flex-wrap gap-4 text-xs font-medium">
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={st.showBranches ?? true} onChange={(e) => onChange({ showBranches: e.target.checked })} /> Branch addresses</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={st.showHours ?? true} onChange={(e) => onChange({ showHours: e.target.checked })} /> Opening hours</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" checked={st.showSocial ?? true} onChange={(e) => onChange({ showSocial: e.target.checked })} /> Social links</label>
          </div>
          <p className="text-[11px] text-muted-foreground">Phone, email and address come from your business settings; branches and hours from Store Settings.</p>
        </div>
      );
    }
    case "form": {
      const st = section.settings;
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Heading"><Input maxLength={120} value={st.title ?? ""} onChange={(e) => onChange({ title: e.target.value })} /></Field>
          <Field label="Sub-heading"><Input maxLength={240} value={st.subtitle ?? ""} onChange={(e) => onChange({ subtitle: e.target.value })} /></Field>
          <Field label="Form" hint="Build and edit forms in Forms.">
            <SelectField size="sm" label="Form" value={st.formSlug ?? ""} placeholder={lookups.forms.length ? "Choose a form" : "No forms yet"} onValueChange={(v) => onChange({ formSlug: v })} options={lookups.forms.map((f) => ({ value: f.slug, label: f.name }))} />
          </Field>
          <Field label="Layout"><SelectField size="sm" label="Form layout" value={st.layout ?? "stacked"} onValueChange={(v) => onChange({ layout: v })} options={[{ value: "stacked", label: "Stacked (heading above)" }, { value: "split", label: "Split (heading beside)" }]} /></Field>
        </div>
      );
    }
    case "spacer":
      return (
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-44"><Field label="Height"><SelectField size="sm" label="Spacer height" value={section.settings.height ?? "md"} onValueChange={(v) => onChange({ height: v })} options={sizeOptions} /></Field></div>
          <label className="flex items-center gap-2 pb-2 text-xs font-medium"><input type="checkbox" className="h-4 w-4" checked={!!section.settings.divider} onChange={(e) => onChange({ divider: e.target.checked })} /> Draw a divider line</label>
        </div>
      );
  }
}

export type SettingsOf<T extends HomeSection["type"]> = HomeSectionSettings[T];
