"use client";

import type { AdminBanner, AdminPageRow } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Checkbox, FormError, SelectField, TextField } from "@/components/ui/field";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { formatDate, formatDateTime } from "@/lib/format";
import { useAdminQuery, useInvalidate } from "../data";
import { isoToLocalInput, localInputToIso } from "../helpers";
import { useListParams } from "../list-controls";
import { ConfirmModal, Modal } from "../modal";
import { useToast } from "../toast";
import { DataTable, ErrorState, FilterTabs, FormActions, Loading, num, PageHeader, Panel, Thumb } from "../ui";
import { ImageInput } from "../upload";

export const KIND_LABEL: Record<string, string> = { page: "Page", blog: "Guide" };
const URL_OR_PATH = /^(https?:\/\/|\/)\S*$/;

export function ContentView() {
  const params = useListParams();
  const tab = params.get("tab") === "banners" ? "banners" : "pages";
  return (
    <>
      <PageHeader
        title="Pages and banners"
        description="Guides and information pages (delivery, returns, terms), and the banners on the home page."
        actions={
          tab === "pages" ? (
            <ButtonLink href="/admin/content/pages/new">
              <Plus className="size-4" aria-hidden />
              New page
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="mb-4">
        <FilterTabs
          label="Content type"
          value={tab}
          onChange={(v) => params.set({ tab: v === "pages" ? null : v, kind: null })}
          items={[
            { value: "pages", label: "Pages and guides" },
            { value: "banners", label: "Home page banners" },
          ]}
        />
      </div>
      {tab === "pages" ? <PagesList kind={params.get("kind")} onKind={(k) => params.set({ kind: k })} /> : <BannersList />}
    </>
  );
}

function PagesList({ kind, onKind }: { kind: string; onKind: (k: string) => void }) {
  const { data, error, isPending, refetch } = useAdminQuery<AdminPageRow[]>("/admin/content/pages", { kind });
  return (
    <Panel flush>
      <div className="flex flex-wrap items-center gap-2 border-b border-galv p-3">
        <span className="text-sm text-steel">Show</span>
        {[
          { v: "", l: "Everything" },
          { v: "page", l: "Pages" },
          { v: "blog", l: "Guides" },
        ].map((o) => (
          <Button key={o.v} size="sm" variant={kind === o.v ? "primary" : "secondary"} aria-pressed={kind === o.v} onClick={() => onKind(o.v)}>
            {o.l}
          </Button>
        ))}
      </div>
      {error ? (
        <div className="p-3">
          <ErrorState error={error} onRetry={() => refetch()} />
        </div>
      ) : isPending ? (
        <Loading label="Loading pages" />
      ) : !data.length ? (
        <div className="p-3">
          <EmptyState title="Nothing here yet" action={<ButtonLink href="/admin/content/pages/new">New page</ButtonLink>} />
        </div>
      ) : (
        <DataTable minWidth={640}>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Type</th>
              <th scope="col">Shop</th>
              <th scope="col">Last changed</th>
            </tr>
          </thead>
          <tbody>
            {data.map((p) => (
              <tr key={p.id}>
                <th scope="row">
                  <Link href={`/admin/content/pages/${p.id}`} className="font-medium text-pipe hover:underline">
                    {p.title}
                  </Link>
                  <p className="font-mono text-[12px] text-steel">{p.slug}</p>
                </th>
                <td>{KIND_LABEL[p.kind] ?? p.kind}</td>
                <td>
                  <Badge tone={p.published ? "pipe" : "neutral"}>{p.published ? "Published" : "Draft"}</Badge>
                  {p.publishedAt && p.published && <p className="mt-0.5 text-[12px] text-steel">since {formatDate(p.publishedAt)}</p>}
                </td>
                <td className="whitespace-nowrap">{formatDateTime(p.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Panel>
  );
}

// ── banners ──

const PLACEMENT: Record<string, { label: string; hint: string }> = {
  home_hero: { label: "Home page, large banner", hint: "The big rotating banner at the top of the home page." },
  home_strip: { label: "Home page, small strip", hint: "Short promotional strip lower on the home page." },
};

function bannerState(b: AdminBanner, now: number) {
  if (!b.active) return { label: "Switched off", tone: "neutral" as const };
  if (b.startsAt && new Date(b.startsAt).getTime() > now) return { label: "Scheduled", tone: "brass" as const };
  if (b.endsAt && new Date(b.endsAt).getTime() < now) return { label: "Ended", tone: "neutral" as const };
  return { label: "Showing", tone: "pipe" as const };
}

function BannersList() {
  const { data, error, isPending, refetch, dataUpdatedAt } = useAdminQuery<AdminBanner[]>("/admin/content/banners");
  const [editing, setEditing] = useState<AdminBanner | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminBanner | null>(null);
  const invalidate = useInvalidate();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (b: AdminBanner) => adminApi.delete(`/admin/content/banners/${b.id}`),
    onSuccess: () => {
      void invalidate("/admin/content/banners");
      setDeleting(null);
      toast("Banner deleted");
    },
  });

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus className="size-4" aria-hidden />
          New banner
        </Button>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isPending ? (
        <Loading label="Loading banners" />
      ) : (
        <div className="flex flex-col gap-4">
          {Object.entries(PLACEMENT).map(([placement, meta]) => {
            const rows = data.filter((b) => b.placement === placement);
            return (
              <Panel key={placement} title={meta.label} description={meta.hint} flush>
                {rows.length ? (
                  <DataTable minWidth={720}>
                    <thead>
                      <tr>
                        <th scope="col">Banner</th>
                        <th scope="col">Links to</th>
                        <th scope="col">Dates</th>
                        <th scope="col" className="!text-right">
                          Sort
                        </th>
                        <th scope="col">Status</th>
                        <th scope="col">
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((b) => {
                        const st = bannerState(b, dataUpdatedAt);
                        return (
                          <tr key={b.id}>
                            <th scope="row">
                              <div className="flex items-start gap-2.5">
                                <Thumb url={b.imageUrl} alt="" size={44} />
                                <div className="min-w-0">
                                  <button type="button" onClick={() => setEditing(b)} className="text-left font-medium hover:text-pipe hover:underline">
                                    {b.title}
                                  </button>
                                  {b.subtitle && <p className="line-clamp-2 text-[13px] text-steel">{b.subtitle}</p>}
                                </div>
                              </div>
                            </th>
                            <td>
                              {b.linkUrl ? <span className="font-mono text-[13px] break-all">{b.linkUrl}</span> : <span className="text-steel-light">No link</span>}
                              {b.ctaLabel && <p className="text-[13px] text-steel">Button: {b.ctaLabel}</p>}
                            </td>
                            <td className="text-[13px]">
                              {b.startsAt || b.endsAt ? (
                                <>
                                  <p>From {b.startsAt ? formatDateTime(b.startsAt) : "now"}</p>
                                  <p>Until {b.endsAt ? formatDateTime(b.endsAt) : "switched off"}</p>
                                </>
                              ) : (
                                <span className="text-steel">Always</span>
                              )}
                            </td>
                            <td className={num}>{b.sortOrder}</td>
                            <td>
                              <Badge tone={st.tone}>{st.label}</Badge>
                            </td>
                            <td>
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="sm" onClick={() => setEditing(b)}>
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-signal hover:bg-signal-tint"
                                  onClick={() => {
                                    remove.reset();
                                    setDeleting(b);
                                  }}
                                >
                                  Delete
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </DataTable>
                ) : (
                  <p className="p-4 text-sm text-steel">No banners here.</p>
                )}
              </Panel>
            );
          })}
        </div>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing && editing !== "new" ? "Edit banner" : "New banner"}>
        {editing && (
          <BannerForm
            key={editing === "new" ? "new" : editing.id}
            banner={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onDone={(created) => {
              setEditing(null);
              void invalidate("/admin/content/banners");
              toast(created ? "Banner created" : "Banner saved");
            }}
          />
        )}
      </Modal>
      <ConfirmModal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting)}
        title="Delete this banner?"
        confirmLabel="Delete banner"
        loading={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
      >
        “{deleting?.title}” is removed from the home page. To hide it for a while instead, edit it and switch it off.
      </ConfirmModal>
    </>
  );
}

function BannerForm({ banner, onDone, onCancel }: { banner: AdminBanner | null; onDone: (created: boolean) => void; onCancel: () => void }) {
  const [placement, setPlacement] = useState(banner?.placement ?? "home_hero");
  const [title, setTitle] = useState(banner?.title ?? "");
  const [subtitle, setSubtitle] = useState(banner?.subtitle ?? "");
  const [imageUrl, setImageUrl] = useState<string | null>(banner?.imageUrl ?? null);
  const [linkUrl, setLinkUrl] = useState(banner?.linkUrl ?? "");
  const [ctaLabel, setCtaLabel] = useState(banner?.ctaLabel ?? "");
  const [sortOrder, setSortOrder] = useState(String(banner?.sortOrder ?? 0));
  const [active, setActive] = useState(banner?.active ?? true);
  const [startsAt, setStartsAt] = useState(isoToLocalInput(banner?.startsAt));
  const [endsAt, setEndsAt] = useState(isoToLocalInput(banner?.endsAt));
  const [problem, setProblem] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      banner ? adminApi.patch(`/admin/content/banners/${banner.id}`, body) : adminApi.post("/admin/content/banners", body),
    onSuccess: () => onDone(!banner),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!title.trim()) return setProblem("Enter a headline for the banner.");
    const link = linkUrl.trim();
    if (link && !URL_OR_PATH.test(link)) return setProblem("The link must be a shop address starting with / (like /category/plumbing) or a full https:// link.");
    const sort = Number(sortOrder);
    if (!Number.isInteger(sort)) return setProblem("Sort order must be a whole number.");
    const s = localInputToIso(startsAt);
    const en = localInputToIso(endsAt);
    if (s && en && en <= s) return setProblem("The end date must be after the start date.");
    save.mutate({
      placement,
      title: title.trim(),
      subtitle: subtitle.trim() || null,
      imageUrl,
      linkUrl: link || null,
      ctaLabel: ctaLabel.trim() || null,
      sortOrder: sort,
      active,
      startsAt: s,
      endsAt: en,
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <FormError message={problem ?? (save.error ? errorMessage(save.error) : null)} />
      <SelectField label="Where it shows" value={placement} onChange={(e) => setPlacement(e.target.value)}>
        {Object.entries(PLACEMENT).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </SelectField>
      <TextField label="Headline" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      <TextField label="Text under the headline (optional)" maxLength={240} value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
      <ImageInput label="Banner image" value={imageUrl} onChange={setImageUrl} hint="Wide images work best, around 1600 × 600 pixels." />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Link (optional)"
          placeholder="/category/plumbing"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          hint="A shop address starting with /, or a full https:// link."
        />
        <TextField label="Button text (optional)" placeholder="Shop plumbing" maxLength={40} value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} />
        <TextField label="Show from (optional)" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} hint="Leave empty to start now." />
        <TextField label="Show until (optional)" type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} hint="Leave empty to keep showing it." />
        <TextField label="Sort order" type="number" step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} hint="Lower numbers show first." />
      </div>
      <Checkbox label="Switched on" checked={active} onChange={(e) => setActive(e.target.checked)} />
      <FormActions className="justify-end">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          {banner ? "Save changes" : "Create banner"}
        </Button>
      </FormActions>
    </form>
  );
}
