"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Save, Trash2, Undo2 } from "lucide-react";
import {
  MAX_FOOTER_COLUMNS,
  MAX_NAV_LINKS,
  NAV_HREF,
  resolveNavigation,
  type FooterColumn,
  type NavLink,
  type StorefrontNavigation,
} from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { Field, Loading, Notice, PageHeader, textareaClass } from "../shared";
import { StoreTabs } from "../store-nav";
import { useStoreSettings } from "../use-store-settings";

interface PageRow { slug: string; title: string; kind: string; isPublished: boolean }

const BUILT_IN: NavLink[] = [
  { label: "All departments", href: "/departments" },
  { label: "All brands", href: "/brands" },
  { label: "Track an order", href: "/track" },
  { label: "Contact us", href: "/contact" },
  { label: "Branches", href: "/branches" },
  { label: "Guides", href: "/blog" },
  { label: "Trade accounts", href: "/account/trade" },
];

const linkProblem = (l: NavLink) => (!l.label.trim() ? "Every link needs a label." : !NAV_HREF.test(l.href) ? `“${l.label || l.href}” must link to a path starting with / or an https:// address.` : null);

export default function NavigationPage() {
  const { tokens } = useAuth();
  const mayWrite = usePermission("storefront:write");
  const { overview, settings, loading, saving, error, success, setError, setSuccess, patch } = useStoreSettings();
  const [draft, setDraft] = useState<StorefrontNavigation | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);

  useEffect(() => {
    if (settings) setDraft(structuredClone(resolveNavigation(settings.navigation)));
  }, [settings]);

  useEffect(() => {
    api.get<PageRow[]>("/storefront-admin/pages", { accessToken: tokens?.accessToken }).then(setPages).catch(() => setPages([]));
  }, [tokens]);

  const suggestions = useMemo<NavLink[]>(
    () => [
      ...BUILT_IN,
      ...pages.filter((p) => p.isPublished).map((p) => ({ label: p.title, href: p.kind === "blog" ? `/blog/${p.slug}` : `/pages/${p.slug}` })),
    ],
    [pages],
  );

  const saved = useMemo(() => (settings ? resolveNavigation(settings.navigation) : null), [settings]);
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(saved);
  const problems = useMemo(() => {
    if (!draft) return [];
    const all = [...draft.header, ...draft.legal, ...draft.footerColumns.flatMap((c) => c.links)];
    const out = [...new Set(all.map(linkProblem).filter((p): p is string => !!p))];
    if (draft.footerColumns.some((c) => !c.title.trim())) out.push("Every footer column needs a title.");
    return out;
  }, [draft]);

  if (loading) return <Loading label="Loading navigation..." />;
  if (!overview?.storefront || !draft) {
    return (
      <div className="space-y-6">
        <PageHeader title="Navigation" description="Menus and footer links." />
        <StoreTabs current="/online-store/navigation" />
        {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
        <Card className="p-6 text-sm text-muted-foreground">Create your online store first, in Store Settings.</Card>
      </div>
    );
  }

  const setCol = (i: number, col: FooterColumn) => setDraft({ ...draft, footerColumns: draft.footerColumns.map((c, j) => (j === i ? col : c)) });
  const moveCol = (i: number, by: -1 | 1) => {
    const next = [...draft.footerColumns];
    const [c] = next.splice(i, 1);
    next.splice(i + by, 0, c!);
    setDraft({ ...draft, footerColumns: next });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Navigation" description="Links in your header and footer. Leave a list empty to keep the built-in links.">
        {mayWrite && (
          <>
            <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => saved && setDraft(structuredClone(saved))}><Undo2 className="h-4 w-4" /> Discard</Button>
            <Button size="sm" disabled={!dirty || saving || problems.length > 0} onClick={() => void patch({ navigation: { ...draft, footerNote: draft.footerNote.trim() } }, "Navigation saved. Shoppers see it within a minute.")}><Save className="h-4 w-4" /> Save navigation</Button>
          </>
        )}
      </PageHeader>
      <StoreTabs current="/online-store/navigation" />

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
      {problems.length > 0 && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          <ul className="list-disc space-y-0.5 pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}

      <fieldset disabled={!mayWrite} className="min-w-0 space-y-6">
        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-semibold">Header links</h2>
          <p className="text-xs text-muted-foreground">Shown beside the department menu. Up to {MAX_NAV_LINKS}.</p>
          <LinkList label="Header" links={draft.header} onChange={(header) => setDraft({ ...draft, header })} suggestions={suggestions} />
        </Card>

        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">Footer columns</h2>
              <p className="text-xs text-muted-foreground">Up to {MAX_FOOTER_COLUMNS} columns of up to {MAX_NAV_LINKS} links. None means the built-in Shop, Help and Company columns.</p>
            </div>
            {mayWrite && (
              <Button size="sm" variant="outline" disabled={draft.footerColumns.length >= MAX_FOOTER_COLUMNS} onClick={() => setDraft({ ...draft, footerColumns: [...draft.footerColumns, { title: "", links: [] }] })}><Plus className="h-4 w-4" /> Add column</Button>
            )}
          </div>
          {draft.footerColumns.map((col, i) => (
            <div key={i} className="space-y-3 rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1"><Field label={`Column ${i + 1} title`}><Input maxLength={40} value={col.title} onChange={(e) => setCol(i, { ...col, title: e.target.value })} /></Field></div>
                {mayWrite && (
                  <>
                    <Button size="icon" variant="ghost" aria-label={`Move column ${i + 1} up`} disabled={i === 0} onClick={() => moveCol(i, -1)}><ChevronUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Move column ${i + 1} down`} disabled={i === draft.footerColumns.length - 1} onClick={() => moveCol(i, 1)}><ChevronDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={`Delete column ${i + 1}`} onClick={() => setDraft({ ...draft, footerColumns: draft.footerColumns.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                  </>
                )}
              </div>
              <LinkList label={`Column ${i + 1}`} links={col.links} onChange={(links) => setCol(i, { ...col, links })} suggestions={suggestions} />
            </div>
          ))}
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-semibold">Legal links</h2>
          <p className="text-xs text-muted-foreground">Small links in the bottom bar, like Privacy and Terms. Empty keeps the built-in two.</p>
          <LinkList label="Legal" links={draft.legal} onChange={(legal) => setDraft({ ...draft, legal })} suggestions={suggestions} />
        </Card>

        <Card className="space-y-3 p-5">
          <h2 className="text-sm font-semibold">Footer note</h2>
          <Field label="Text under your logo" hint={`${draft.footerNote.length}/300`}>
            <textarea rows={3} maxLength={300} className={textareaClass} value={draft.footerNote} onChange={(e) => setDraft({ ...draft, footerNote: e.target.value })} />
          </Field>
        </Card>
      </fieldset>
    </div>
  );
}

function LinkList({ label, links, onChange, suggestions }: { label: string; links: NavLink[]; onChange: (l: NavLink[]) => void; suggestions: NavLink[] }) {
  const [pick, setPick] = useState("");
  const set = (i: number, patchLink: Partial<NavLink>) => onChange(links.map((l, j) => (j === i ? { ...l, ...patchLink } : l)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...links];
    const [l] = next.splice(i, 1);
    next.splice(i + by, 0, l!);
    onChange(next);
  };
  const full = links.length >= MAX_NAV_LINKS;
  return (
    <div className="space-y-2">
      {links.length === 0 && <p className="text-xs text-muted-foreground">No links.</p>}
      {links.map((l, i) => (
        <div key={i} className="grid gap-2 md:grid-cols-[1fr_1.5fr_auto] md:items-center">
          <Input aria-label={`${label} link ${i + 1} label`} placeholder="Label" maxLength={40} value={l.label} onChange={(e) => set(i, { label: e.target.value })} />
          <Input aria-label={`${label} link ${i + 1} address`} placeholder="/pages/about or https://…" aria-invalid={!!l.href && !NAV_HREF.test(l.href)} value={l.href} onChange={(e) => set(i, { href: e.target.value })} />
          <div className="flex items-center">
            <Button size="icon" variant="ghost" aria-label={`Move ${label} link ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label={`Move ${label} link ${i + 1} down`} disabled={i === links.length - 1} onClick={() => move(i, 1)}><ChevronDown className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" aria-label={`Remove ${label} link ${i + 1}`} onClick={() => onChange(links.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-2 pt-1">
        <Button size="sm" variant="outline" disabled={full} onClick={() => onChange([...links, { label: "", href: "" }])}><Plus className="h-4 w-4" /> Add link</Button>
        <div className="w-64">
          <SelectField
            size="sm"
            label={`Add a ${label} link to a page`}
            placeholder="Add a page you already have…"
            value={pick}
            disabled={full}
            onValueChange={(href) => {
              const s = suggestions.find((x) => x.href === href);
              if (s) onChange([...links, s]);
              setPick("");
            }}
            options={suggestions.map((s) => ({ value: s.href, label: `${s.label} (${s.href})` }))}
          />
        </div>
      </div>
    </div>
  );
}
