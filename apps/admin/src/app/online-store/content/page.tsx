"use client";

import React, { useCallback, useEffect, useState } from "react";
import { FileText, Image as ImageIcon, Pencil, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { usePermission } from "@/lib/require-auth";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table, TableBody, TableContainer, TableEmpty, TableHead, Th, numericCell,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow } from "@/components/ui/mobile-list";
import { SelectField } from "@/components/ui/select";
import { Field, Notice, PageHeader, errorText, humanize, textareaClass } from "../shared";

interface PageRow {
  id: string;
  slug: string;
  title: string;
  kind: string;
  isPublished: boolean;
  updatedAt: string;
}

interface PageFull extends PageRow {
  body: string;
  excerpt: string | null;
  coverImageUrl: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

interface Banner {
  id: string;
  placement: string;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  linkUrl: string | null;
  ctaLabel: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

const EMPTY_PAGE = { slug: "", title: "", body: "", kind: "page", excerpt: "", coverImageUrl: "", isPublished: false, seoTitle: "", seoDescription: "" };
const EMPTY_BANNER = { placement: "home_hero", title: "", subtitle: "", imageUrl: "", linkUrl: "", ctaLabel: "", sortOrder: 0, isActive: true };

const orNull = (v: string) => (v.trim() ? v.trim() : null);

export default function ContentPage() {
  const { tokens } = useAuth();
  const mayWrite = usePermission("storefront:write");
  const auth = { accessToken: tokens?.accessToken };

  const [tab, setTab] = useState<"pages" | "banners">("pages");
  const [pages, setPages] = useState<PageRow[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [pageForm, setPageForm] = useState<(typeof EMPTY_PAGE & { id?: string }) | null>(null);
  const [bannerForm, setBannerForm] = useState<(typeof EMPTY_BANNER & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, b] = await Promise.all([
        api.get<PageRow[]>("/storefront-admin/pages", auth),
        api.get<Banner[]>("/storefront-admin/banners", auth),
      ]);
      setPages(p);
      setBanners(b);
    } catch (err) {
      setError(errorText(err, "Failed to load content."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  useEffect(() => {
    void load();
  }, [load]);

  async function editPage(id: string) {
    try {
      const p = await api.get<PageFull>(`/storefront-admin/pages/${id}`, auth);
      setPageForm({
        id: p.id,
        slug: p.slug,
        title: p.title,
        body: p.body,
        kind: p.kind,
        excerpt: p.excerpt ?? "",
        coverImageUrl: p.coverImageUrl ?? "",
        isPublished: p.isPublished,
        seoTitle: p.seoTitle ?? "",
        seoDescription: p.seoDescription ?? "",
      });
    } catch (err) {
      setError(errorText(err, "Failed to load the page."));
    }
  }

  async function savePage(e: React.FormEvent) {
    e.preventDefault();
    if (!pageForm) return;
    setSaving(true);
    setError(null);
    const { id, ...f } = pageForm;
    const body = {
      ...f,
      excerpt: orNull(f.excerpt),
      coverImageUrl: orNull(f.coverImageUrl),
      seoTitle: orNull(f.seoTitle),
      seoDescription: orNull(f.seoDescription),
    };
    try {
      if (id) await api.patch(`/storefront-admin/pages/${id}`, body, auth);
      else await api.post("/storefront-admin/pages", body, auth);
      setSuccess(`"${f.title}" saved.`);
      setPageForm(null);
      void load();
    } catch (err) {
      setError(errorText(err, "Could not save the page."));
    } finally {
      setSaving(false);
    }
  }

  async function saveBanner(e: React.FormEvent) {
    e.preventDefault();
    if (!bannerForm) return;
    setSaving(true);
    setError(null);
    const { id, ...f } = bannerForm;
    const body = { ...f, subtitle: orNull(f.subtitle), imageUrl: orNull(f.imageUrl), linkUrl: orNull(f.linkUrl), ctaLabel: orNull(f.ctaLabel) };
    try {
      if (id) await api.patch(`/storefront-admin/banners/${id}`, body, auth);
      else await api.post("/storefront-admin/banners", body, auth);
      setSuccess(`"${f.title}" saved.`);
      setBannerForm(null);
      void load();
    } catch (err) {
      setError(errorText(err, "Could not save the banner."));
    } finally {
      setSaving(false);
    }
  }

  async function remove(kind: "pages" | "banners", id: string, title: string) {
    if (!window.confirm(`Delete "${title}"?`)) return;
    try {
      await api.delete(`/storefront-admin/${kind}/${id}`, auth);
      void load();
    } catch (err) {
      setError(errorText(err, "Delete failed."));
    }
  }

  const editBanner = (b: Banner) =>
    setBannerForm({
      id: b.id,
      placement: b.placement,
      title: b.title,
      subtitle: b.subtitle ?? "",
      imageUrl: b.imageUrl ?? "",
      linkUrl: b.linkUrl ?? "",
      ctaLabel: b.ctaLabel ?? "",
      sortOrder: b.sortOrder,
      isActive: b.isActive,
    });

  return (
    <div className="space-y-6">
      <PageHeader title="Website Content" description="Pages, guides and the home page banners.">
        {mayWrite && (
          <Button size="sm" onClick={() => (tab === "pages" ? setPageForm({ ...EMPTY_PAGE }) : setBannerForm({ ...EMPTY_BANNER }))}>
            <Plus className="h-4 w-4" /> {tab === "pages" ? "New page" : "New banner"}
          </Button>
        )}
      </PageHeader>

      {success && <Notice kind="success" message={success} onClose={() => setSuccess(null)} />}
      {error && !pageForm && !bannerForm && <Notice kind="error" message={error} onClose={() => setError(null)} />}

      <div className="flex gap-2" role="group" aria-label="Content type">
        {(["pages", "banners"] as const).map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
            className={cn("rounded-full border px-3 py-1 text-xs cursor-pointer", tab === t ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}
          >
            {t === "pages" ? "Pages & guides" : "Banners"}
          </button>
        ))}
      </div>

      {tab === "pages" ? (
        <MobileList loading={loading && pages.length === 0} empty={<MobileEmpty icon={FileText} title="No pages yet" />}>
          {pages.map((p) => (
            <MobileRow
              key={p.id}
              title={p.title}
              subtitle={p.kind === "blog" ? "Guide" : "Page"}
              badge={<Badge variant={p.isPublished ? "success" : "secondary"}>{p.isPublished ? "Published" : "Draft"}</Badge>}
              fields={[{ label: "Address", value: <span className="font-mono">{p.kind === "blog" ? `/blog/${p.slug}` : `/pages/${p.slug}`}</span> }]}
              actions={
                mayWrite ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => void editPage(p.id)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => void remove("pages", p.id, p.title)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                  </>
                ) : undefined
              }
            />
          ))}
        </MobileList>
      ) : (
        <MobileList loading={loading && banners.length === 0} empty={<MobileEmpty icon={ImageIcon} title="No banners yet" />}>
          {banners.map((b) => (
            <MobileRow
              key={b.id}
              title={b.title}
              subtitle={humanize(b.placement)}
              badge={<Badge variant={b.isActive ? "success" : "secondary"}>{b.isActive ? "Showing" : "Off"}</Badge>}
              fields={[
                { label: "Subtitle", value: b.subtitle || "—" },
                { label: "Where", value: humanize(b.placement) },
                { label: "Order", value: b.sortOrder, numeric: true },
              ]}
              actions={
                mayWrite ? (
                  <>
                    <Button variant="outline" size="sm" onClick={() => editBanner(b)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => void remove("banners", b.id, b.title)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button>
                  </>
                ) : undefined
              }
            />
          ))}
        </MobileList>
      )}

      <Card className="hidden overflow-hidden md:block">
        <TableContainer>
          {tab === "pages" ? (
            <Table>
              <TableHead>
                <tr>
                  <Th>Title</Th>
                  <Th>Address</Th>
                  <Th>Kind</Th>
                  <Th>Status</Th>
                  <Th align="right"><span className="sr-only">Actions</span></Th>
                </tr>
              </TableHead>
              <TableBody
                columns={5}
                loading={loading && pages.length === 0}
                empty={<TableEmpty columns={5} icon={FileText} title="No pages yet" />}
              >
                {pages.map((p) => (
                  <tr key={p.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-3.5 font-medium text-foreground">{p.title}</td>
                    <td className="px-4 py-3.5 font-mono text-muted-foreground">{p.kind === "blog" ? `/blog/${p.slug}` : `/pages/${p.slug}`}</td>
                    <td className="px-4 py-3.5">{p.kind === "blog" ? "Guide" : "Page"}</td>
                    <td className="px-4 py-3.5"><Badge variant={p.isPublished ? "success" : "secondary"}>{p.isPublished ? "Published" : "Draft"}</Badge></td>
                    <td className="px-4 py-3.5 text-right space-x-3">
                      {mayWrite && <button type="button" className="cursor-pointer text-muted-foreground hover:text-foreground" onClick={() => void editPage(p.id)} aria-label={`Edit ${p.title}`}><Pencil className="h-3.5 w-3.5" /></button>}
                      {mayWrite && <button type="button" className="cursor-pointer text-muted-foreground hover:text-destructive" onClick={() => void remove("pages", p.id, p.title)} aria-label={`Delete ${p.title}`}><Trash2 className="h-3.5 w-3.5" /></button>}
                    </td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <Th>Banner</Th>
                  <Th>Where</Th>
                  <Th align="right">Order</Th>
                  <Th>Status</Th>
                  <Th align="right"><span className="sr-only">Actions</span></Th>
                </tr>
              </TableHead>
              <TableBody
                columns={5}
                loading={loading && banners.length === 0}
                empty={<TableEmpty columns={5} icon={ImageIcon} title="No banners yet" />}
              >
                {banners.map((b) => (
                  <tr key={b.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-3.5"><div className="font-medium text-foreground">{b.title}</div><div className="text-muted-foreground">{b.subtitle}</div></td>
                    <td className="px-4 py-3.5">{humanize(b.placement)}</td>
                    <td className={cn("px-4 py-3.5", numericCell)}>{b.sortOrder}</td>
                    <td className="px-4 py-3.5"><Badge variant={b.isActive ? "success" : "secondary"}>{b.isActive ? "Showing" : "Off"}</Badge></td>
                    <td className="px-4 py-3.5 text-right space-x-3">
                    {mayWrite && (
                      <button
                        className="cursor-pointer text-muted-foreground hover:text-foreground"
                        aria-label={`Edit ${b.title}`}
                        onClick={() => editBanner(b)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {mayWrite && <button className="cursor-pointer text-muted-foreground hover:text-destructive" onClick={() => void remove("banners", b.id, b.title)} aria-label={`Delete ${b.title}`}><Trash2 className="h-3.5 w-3.5" /></button>}
                    </td>
                  </tr>
                ))}
              </TableBody>
            </Table>
          )}
        </TableContainer>
      </Card>

      <Dialog open={!!pageForm} onOpenChange={(o) => !o && setPageForm(null)}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          {pageForm && (
            <>
              <DialogHeader><DialogTitle>{pageForm.id ? "Edit page" : "New page"}</DialogTitle></DialogHeader>
              {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
              <form onSubmit={savePage} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Title"><Input required value={pageForm.title} onChange={(e) => setPageForm({ ...pageForm, title: e.target.value })} /></Field>
                  <Field label="Address"><Input required value={pageForm.slug} onChange={(e) => setPageForm({ ...pageForm, slug: e.target.value })} placeholder="delivery-returns" /></Field>
                  <Field label="Kind">
                    <SelectField
                      size="sm"
                      label="Kind"
                      value={pageForm.kind}
                      onValueChange={(v) => setPageForm({ ...pageForm, kind: v })}
                      options={[{ value: "page", label: "Page" }, { value: "blog", label: "Guide / blog post" }]}
                    />
                  </Field>
                </div>
                <Field label="Body" hint="Markdown: ## headings, **bold**, lists.">
                  <textarea rows={12} className={textareaClass} value={pageForm.body} onChange={(e) => setPageForm({ ...pageForm, body: e.target.value })} />
                </Field>
                {pageForm.kind === "blog" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Excerpt"><Input value={pageForm.excerpt} onChange={(e) => setPageForm({ ...pageForm, excerpt: e.target.value })} /></Field>
                    <Field label="Cover image URL"><Input value={pageForm.coverImageUrl} onChange={(e) => setPageForm({ ...pageForm, coverImageUrl: e.target.value })} /></Field>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="SEO title"><Input value={pageForm.seoTitle} onChange={(e) => setPageForm({ ...pageForm, seoTitle: e.target.value })} /></Field>
                  <Field label="SEO description"><Input value={pageForm.seoDescription} onChange={(e) => setPageForm({ ...pageForm, seoDescription: e.target.value })} /></Field>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <input type="checkbox" className="h-4 w-4 rounded border-input" checked={pageForm.isPublished} onChange={(e) => setPageForm({ ...pageForm, isPublished: e.target.checked })} />
                  Published
                </label>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setPageForm(null)}>Cancel</Button>
                  <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save page"}</Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!bannerForm} onOpenChange={(o) => !o && setBannerForm(null)}>
        <DialogContent className="sm:max-w-lg">
          {bannerForm && (
            <>
              <DialogHeader><DialogTitle>{bannerForm.id ? "Edit banner" : "New banner"}</DialogTitle></DialogHeader>
              {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
              <form onSubmit={saveBanner} className="space-y-4">
                <Field label="Title"><Input required value={bannerForm.title} onChange={(e) => setBannerForm({ ...bannerForm, title: e.target.value })} /></Field>
                <Field label="Subtitle"><Input value={bannerForm.subtitle} onChange={(e) => setBannerForm({ ...bannerForm, subtitle: e.target.value })} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Where">
                    <SelectField
                      size="sm"
                      label="Where"
                      value={bannerForm.placement}
                      onValueChange={(v) => setBannerForm({ ...bannerForm, placement: v })}
                      options={[{ value: "home_hero", label: "Home — hero slider" }, { value: "home_strip", label: "Home — announcement strip" }]}
                    />
                  </Field>
                  <Field label="Order"><Input type="number" min={0} value={bannerForm.sortOrder} onChange={(e) => setBannerForm({ ...bannerForm, sortOrder: Number(e.target.value) })} /></Field>
                </div>
                <Field label="Image URL"><Input value={bannerForm.imageUrl} onChange={(e) => setBannerForm({ ...bannerForm, imageUrl: e.target.value })} /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Link"><Input value={bannerForm.linkUrl} onChange={(e) => setBannerForm({ ...bannerForm, linkUrl: e.target.value })} placeholder="/category/electrical" /></Field>
                  <Field label="Button label"><Input value={bannerForm.ctaLabel} onChange={(e) => setBannerForm({ ...bannerForm, ctaLabel: e.target.value })} placeholder="Shop now" /></Field>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <input type="checkbox" className="h-4 w-4 rounded border-input" checked={bannerForm.isActive} onChange={(e) => setBannerForm({ ...bannerForm, isActive: e.target.checked })} />
                  Showing
                </label>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setBannerForm(null)}>Cancel</Button>
                  <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save banner"}</Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
