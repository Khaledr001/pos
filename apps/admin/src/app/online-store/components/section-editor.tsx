"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";
import {
  HOME_SECTION_LABELS,
  MAX_PAGE_SECTIONS,
  SECTION_BACKGROUNDS,
  SECTION_SPACING,
  type HomeSection,
  type HomeSectionType,
  type SectionStyle,
  type SiteMode,
} from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Field } from "../shared";
import { SectionForm, type Lookups } from "./section-forms";
import { CONTENT_TYPES, SHOP_TYPES, TYPE_HINTS, blankSection, isCommerce, listProblems, summarize } from "./section-meta";

export { listProblems } from "./section-meta";

interface Category { slug: string; name: string; depth?: number; children?: Category[] }

function flatten(rows: Category[], depth = 0): { slug: string; name: string }[] {
  return rows.flatMap((c) => [{ slug: c.slug, name: `${"— ".repeat(depth)}${c.name}` }, ...flatten(c.children ?? [], depth + 1)]);
}

/**
 * Forms and categories the section settings pick from. A failed fetch leaves a
 * list empty rather than breaking the editor: the pickers just have nothing to offer.
 */
export function useSectionLookups(): Lookups {
  const { tokens } = useAuth();
  const [lookups, setLookups] = useState<Lookups>({ forms: [], categories: [] });
  useEffect(() => {
    const auth = { accessToken: tokens?.accessToken };
    let live = true;
    void Promise.all([
      api.get<{ slug: string; name: string }[]>("/storefront-admin/forms", auth).catch(() => []),
      api.get<Category[]>("/categories", { ...auth, query: { includeInactive: "false" } }).catch(() => []),
    ]).then(([forms, cats]) => {
      if (live) setLookups({ forms: forms ?? [], categories: flatten(cats ?? []) });
    });
    return () => {
      live = false;
    };
  }, [tokens]);
  return lookups;
}

const BG_LABELS: Record<string, string> = { none: "Page background", surface: "Card colour", tint: "Soft tint", accent: "Accent colour", dark: "Dark" };
const SPACE_LABELS: Record<string, string> = { none: "None", sm: "Small", md: "Medium", lg: "Large" };

function StylePanel({ style, onChange }: { style: SectionStyle | undefined; onChange: (s: SectionStyle | undefined) => void }) {
  const st = style ?? {};
  const set = (patch: Partial<SectionStyle>) => {
    const next: Record<string, unknown> = { ...st, ...patch };
    // An unset option is absent, not an empty string, so the page falls back to the section's own default.
    for (const k of Object.keys(next)) if (next[k] === "" || next[k] === undefined || next[k] === false) delete next[k];
    onChange(Object.keys(next).length ? (next as SectionStyle) : undefined);
  };
  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-foreground">Style &amp; spacing</summary>
      <div className="grid gap-3 border-t border-border p-3 md:grid-cols-3">
        <Field label="Background">
          <SelectField size="sm" label="Section background" value={st.background ?? ""} onValueChange={(v) => set({ background: (v || undefined) as SectionStyle["background"] })} options={[{ value: "", label: "Default" }, ...SECTION_BACKGROUNDS.map((b) => ({ value: b, label: BG_LABELS[b] ?? b }))]} />
        </Field>
        <Field label="Space above and below">
          <SelectField size="sm" label="Section spacing" value={st.paddingY ?? ""} onValueChange={(v) => set({ paddingY: (v || undefined) as SectionStyle["paddingY"] })} options={[{ value: "", label: "Default" }, ...SECTION_SPACING.map((b) => ({ value: b, label: SPACE_LABELS[b] ?? b }))]} />
        </Field>
        <Field label="Width">
          <SelectField size="sm" label="Section width" value={st.width ?? ""} onValueChange={(v) => set({ width: (v || undefined) as SectionStyle["width"] })} options={[{ value: "", label: "Default" }, { value: "contained", label: "Inside the page column" }, { value: "full", label: "Edge to edge" }]} />
        </Field>
        <Field label="Text alignment">
          <SelectField size="sm" label="Section alignment" value={st.align ?? ""} onValueChange={(v) => set({ align: (v || undefined) as SectionStyle["align"] })} options={[{ value: "", label: "Default" }, { value: "left", label: "Left" }, { value: "center", label: "Centred" }]} />
        </Field>
        <Field label="Anchor" hint="A menu link to #name jumps here. Lowercase letters, digits, hyphens.">
          <Input maxLength={40} placeholder="services" value={st.anchor ?? ""} onChange={(e) => set({ anchor: e.target.value.toLowerCase() })} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium"><input type="checkbox" className="h-4 w-4" checked={!!st.hideOnMobile} onChange={(e) => set({ hideOnMobile: e.target.checked })} /> Hide on phones</label>
      </div>
    </details>
  );
}

/**
 * The section list shared by the home page and every custom page: add, reorder,
 * duplicate, hide and configure sections. State lives with the caller, which
 * owns saving; this component only edits the list it is given.
 */
export function SectionEditor({
  sections,
  onChange,
  mayWrite,
  siteMode,
  lookups,
  max = MAX_PAGE_SECTIONS,
}: {
  sections: HomeSection[];
  onChange: (next: HomeSection[]) => void;
  mayWrite: boolean;
  siteMode: SiteMode | null;
  lookups: Lookups;
  max?: number;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const problems = useMemo(() => listProblems(sections, siteMode), [sections, siteMode]);
  const showcase = siteMode === "showcase";

  const toggleOpen = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const update = (id: string, fn: (s: HomeSection) => HomeSection) => onChange(sections.map((s) => (s.id === id ? fn(s) : s)));
  const setSettings = (id: string, patch: Record<string, unknown>) => update(id, (s) => ({ ...s, settings: { ...s.settings, ...patch } }) as HomeSection);
  const move = (index: number, by: -1 | 1) => {
    const next = [...sections];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item!);
    onChange(next);
  };
  const add = (type: HomeSectionType) => {
    const section = blankSection(type, sections.map((s) => s.id));
    onChange([...sections, section]);
    setOpen((prev) => new Set(prev).add(section.id));
  };
  const duplicate = (index: number) => {
    const src = sections[index]!;
    const copy = structuredClone(src);
    copy.id = blankSection(src.type, sections.map((s) => s.id)).id;
    // An anchor names ONE place on the page.
    if (copy.style?.anchor) {
      const { anchor: _drop, ...rest } = copy.style;
      copy.style = Object.keys(rest).length ? rest : undefined;
    }
    const next = [...sections];
    next.splice(index + 1, 0, copy);
    onChange(next);
    setOpen((prev) => new Set(prev).add(copy.id));
  };

  const picker = (title: string, types: readonly HomeSectionType[]) => (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-foreground">{title}</h3>
      <div className="flex flex-wrap gap-2">
        {types.map((t) => {
          const blocked = showcase && isCommerce(t);
          return (
            <Button key={t} type="button" size="sm" variant="outline" disabled={sections.length >= max || blocked} title={blocked ? "This site has no products, so this section would be empty." : TYPE_HINTS[t]} onClick={() => add(t)}>
              <Plus className="h-3.5 w-3.5" /> {HOME_SECTION_LABELS[t]}
            </Button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {problems.length > 0 && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <ul className="list-disc space-y-0.5 pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      {sections.length > 1 && (
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(new Set(sections.map((s) => s.id)))}>Expand all</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(new Set())}>Collapse all</Button>
        </div>
      )}

      <ol className="space-y-3">
        {sections.map((s, i) => {
          const isOpen = open.has(s.id);
          const label = HOME_SECTION_LABELS[s.type];
          const hiddenBySite = showcase && isCommerce(s.type);
          return (
            <li key={s.id}>
              <Card className={`p-4 ${s.enabled && !hiddenBySite ? "" : "opacity-70"}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-6 text-center text-xs font-semibold text-muted-foreground" aria-hidden="true">{i + 1}</span>
                  <button type="button" aria-expanded={isOpen} aria-controls={`section-${s.id}`} onClick={() => toggleOpen(s.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        {label} {!s.enabled && <Badge variant="secondary">Hidden</Badge>} {hiddenBySite && <Badge variant="warning">Not shown: no products on this site</Badge>}
                      </span>
                      {!isOpen && <span className="block truncate text-[11px] text-muted-foreground">{summarize(s)}</span>}
                    </span>
                  </button>
                  {mayWrite && (
                    <div className="flex items-center gap-1">
                      <label className="mr-2 flex items-center gap-1.5 text-xs"><input type="checkbox" className="h-4 w-4" checked={s.enabled} onChange={(e) => update(s.id, (x) => ({ ...x, enabled: e.target.checked }))} /> Shown</label>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp className="h-4 w-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Move ${label} down`} disabled={i === sections.length - 1} onClick={() => move(i, 1)}><ChevronDown className="h-4 w-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Duplicate ${label}`} disabled={sections.length >= max} onClick={() => duplicate(i)}><Copy className="h-4 w-4" /></Button>
                      <Button type="button" size="icon" variant="ghost" aria-label={`Delete ${label}`} onClick={() => onChange(sections.filter((x) => x.id !== s.id))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )}
                </div>
                {isOpen && (
                  <fieldset id={`section-${s.id}`} disabled={!mayWrite} className="mt-4 min-w-0 space-y-4">
                    <p className="text-[11px] text-muted-foreground">{TYPE_HINTS[s.type]}</p>
                    <SectionForm section={s} lookups={lookups} onChange={(p) => setSettings(s.id, p)} />
                    <StylePanel style={s.style} onChange={(style) => update(s.id, (x) => ({ ...x, style }) as HomeSection)} />
                  </fieldset>
                )}
              </Card>
            </li>
          );
        })}
        {sections.length === 0 && <li className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">No sections yet. Add one below.</li>}
      </ol>

      {mayWrite && (
        <Card className="space-y-4 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Add a section</h2>
            <span className="text-[11px] text-muted-foreground">{sections.length} of {max} used</span>
          </div>
          {picker("Shop", SHOP_TYPES)}
          {showcase && <p className="-mt-2 text-[11px] text-muted-foreground">Shop sections need products, which this site does not have. Change the site type to use them.</p>}
          {picker("Content", CONTENT_TYPES)}
        </Card>
      )}
    </div>
  );
}
