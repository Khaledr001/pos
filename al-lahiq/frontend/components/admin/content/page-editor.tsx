"use client";

import type { Page } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, FormError, SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { useAdminQuery, useInvalidate, useSetAdminData } from "../data";
import { slugify } from "../helpers";
import { MarkdownEditor } from "../markdown-editor";
import { ConfirmModal } from "../modal";
import { useUnsavedWarning } from "../row-controls";
import { useToast } from "../toast";
import { ErrorState, Loading, PageHeader, Panel } from "../ui";
import { ImageInput } from "../upload";

export function PageEditorLoader({ id }: { id: string }) {
  const { data, error, isPending, refetch } = useAdminQuery<Page>(`/admin/content/pages/${id}`);
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (isPending) return <Loading label="Loading page" />;
  return <PageEditor key={data.id} page={data} />;
}

type State = {
  slug: string;
  title: string;
  kind: string;
  excerpt: string;
  coverImageUrl: string | null;
  body: string;
  published: boolean;
  seoTitle: string;
  seoDescription: string;
};

const fromPage = (p: Page | null): State => ({
  slug: p?.slug ?? "",
  title: p?.title ?? "",
  kind: p?.kind ?? "page",
  excerpt: p?.excerpt ?? "",
  coverImageUrl: p?.coverImageUrl ?? null,
  body: p?.body ?? "",
  published: p?.published ?? false,
  seoTitle: p?.seoTitle ?? "",
  seoDescription: p?.seoDescription ?? "",
});

export function PageEditor({ page }: { page: Page | null }) {
  const router = useRouter();
  const toast = useToast();
  const invalidate = useInvalidate();
  const setData = useSetAdminData();
  const [form, setForm] = useState<State>(() => fromPage(page));
  const [saved, setSaved] = useState(() => JSON.stringify(fromPage(page)));
  const [slugTouched, setSlugTouched] = useState(!!page);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = JSON.stringify(form) !== saved;
  useUnsavedWarning(dirty);

  const set = <K extends keyof State>(k: K, v: State[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      page ? adminApi.patch<Page>(`/admin/content/pages/${page.id}`, body) : adminApi.post<Page>("/admin/content/pages", body),
    onSuccess: (p) => {
      void invalidate("/admin/content/pages");
      setData(`/admin/content/pages/${p.id}`, p);
      const next = fromPage(p);
      setForm(next);
      setSaved(JSON.stringify(next));
      toast(page ? "Page saved" : "Page created");
      if (!page) router.replace(`/admin/content/pages/${p.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => adminApi.delete(`/admin/content/pages/${page!.id}`),
    onSuccess: () => {
      void invalidate("/admin/content/pages");
      toast("Page deleted");
      router.replace("/admin/content");
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!form.title.trim()) return setProblem("Enter a title.");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.slug)) return setProblem("The web address can only use lowercase letters, numbers and single dashes.");
    save.mutate({
      slug: form.slug,
      title: form.title.trim(),
      kind: form.kind,
      excerpt: form.excerpt.trim() || null,
      coverImageUrl: form.coverImageUrl,
      body: form.body,
      published: form.published,
      seoTitle: form.seoTitle.trim() || null,
      seoDescription: form.seoDescription.trim() || null,
    });
  };

  return (
    <>
      <PageHeader
        back={{ href: "/admin/content", label: "Pages and banners" }}
        title={page ? page.title : "New page"}
        meta={
          page && (
            <>
              <Badge tone={page.published ? "pipe" : "neutral"}>{page.published ? "Published" : "Draft"}</Badge>
              <span>Last changed {formatDateTime(page.updatedAt)}</span>
            </>
          )
        }
      />
      <form onSubmit={submit} noValidate>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel className="min-w-0">
            <div className="flex flex-col gap-4">
              <TextField
                label="Title"
                required
                maxLength={200}
                value={form.title}
                autoFocus={!page}
                onChange={(e) => {
                  set("title", e.target.value);
                  if (!slugTouched) set("slug", slugify(e.target.value));
                }}
              />
              <TextField
                label="Web address"
                value={form.slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  set("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"));
                }}
                hint={page ? "Changing it breaks links people have saved." : "Made from the title. You can change it."}
              />
              <MarkdownEditor label="Content" value={form.body} onChange={(v) => set("body", v)} rows={18} maxLength={100000} />
            </div>
          </Panel>
          <div className="flex flex-col gap-4">
            <Panel title="Publishing">
              <div className="flex flex-col gap-4">
                <SelectField
                  label="Type"
                  value={form.kind}
                  onChange={(e) => set("kind", e.target.value)}
                  hint="Guides are listed with other buying guides. Pages are for store information like delivery and returns."
                >
                  <option value="page">Page</option>
                  <option value="blog">Guide</option>
                </SelectField>
                <Checkbox label="Published (visible in the shop)" checked={form.published} onChange={(e) => set("published", e.target.checked)} />
              </div>
            </Panel>
            <Panel title="Listing">
              <div className="flex flex-col gap-4">
                <TextAreaField
                  label="Short summary (optional)"
                  rows={3}
                  maxLength={400}
                  value={form.excerpt}
                  onChange={(e) => set("excerpt", e.target.value)}
                  hint={`Shown in guide listings. ${form.excerpt.length} of 400 characters.`}
                />
                <ImageInput label="Cover image" value={form.coverImageUrl} onChange={(v) => set("coverImageUrl", v)} />
              </div>
            </Panel>
            <Panel title="Search engines">
              <div className="flex flex-col gap-4">
                <TextField
                  label="Page title for Google (optional)"
                  maxLength={70}
                  value={form.seoTitle}
                  onChange={(e) => set("seoTitle", e.target.value)}
                  hint={`${form.seoTitle.length} of 70 characters`}
                />
                <TextAreaField
                  label="Description for Google (optional)"
                  rows={3}
                  maxLength={170}
                  value={form.seoDescription}
                  onChange={(e) => set("seoDescription", e.target.value)}
                  hint={`${form.seoDescription.length} of 170 characters`}
                />
              </div>
            </Panel>
            {page && (
              <Panel title="Delete">
                <p className="mb-3 text-sm text-steel">To take it off the shop but keep it, untick Published instead.</p>
                <Button type="button" variant="secondary" className="text-signal" onClick={() => setConfirmDelete(true)}>
                  Delete page
                </Button>
              </Panel>
            )}
          </div>
        </div>
        <div
          className={cn(
            "sticky bottom-0 z-20 mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border px-4 py-3 shadow-[0_-4px_16px_rgba(28,37,48,0.06)]",
            dirty ? "border-brass/50 bg-brass-tint" : "border-galv bg-paper",
          )}
        >
          <div className="min-w-0 flex-1">
            <FormError message={problem ?? (save.error ? errorMessage(save.error) : null)} />
            {!problem && !save.error && <p className="text-sm text-steel">{dirty ? "You have unsaved changes." : "All changes saved."}</p>}
          </div>
          <Button type="submit" loading={save.isPending} disabled={!dirty}>
            {page ? "Save changes" : "Create page"}
          </Button>
        </div>
      </form>
      {page && (
        <ConfirmModal
          open={confirmDelete}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => remove.mutate()}
          title={`Delete “${page.title}”?`}
          confirmLabel="Delete page"
          loading={remove.isPending}
          error={remove.error ? errorMessage(remove.error) : null}
        >
          The page disappears from the shop and links to it stop working. This can&apos;t be undone.
        </ConfirmModal>
      )}
    </>
  );
}
