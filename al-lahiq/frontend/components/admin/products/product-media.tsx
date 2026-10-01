"use client";

import type { AdminProductDetail } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, inputClass } from "@/components/ui/field";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { rowKey } from "../catalog-helpers";
import { useInvalidate, useSetAdminData } from "../data";
import { move, RowControls, useUnsavedWarning } from "../row-controls";
import { useToast } from "../toast";
import { Panel, Thumb } from "../ui";
import { UploadButton } from "../upload";

function SaveBar({
  dirty,
  loading,
  error,
  onSave,
  onDiscard,
  label,
}: {
  dirty: boolean;
  loading: boolean;
  error: unknown;
  onSave: () => void;
  onDiscard: () => void;
  label: string;
}) {
  if (!dirty && !error) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-galv pt-3">
      <div className="min-w-0 flex-1">
        {error ? <FormError message={errorMessage(error)} /> : <p className="text-sm text-[#7a5a0c]">Unsaved changes</p>}
      </div>
      <Button type="button" variant="ghost" onClick={onDiscard}>
        Discard changes
      </Button>
      <Button type="button" onClick={onSave} loading={loading}>
        {label}
      </Button>
    </div>
  );
}

// ── photos ──

type Img = { key: string; url: string; alt: string };
const imagesFrom = (p: AdminProductDetail): Img[] => p.images.map((i) => ({ key: rowKey(), url: i.url, alt: i.alt ?? "" }));
const imgSig = (list: Img[]) => JSON.stringify(list.map((i) => [i.url, i.alt.trim()]));

export function ProductImages({ product, path }: { product: AdminProductDetail; path: string }) {
  const toast = useToast();
  const setData = useSetAdminData();
  const invalidate = useInvalidate();
  const [images, setImages] = useState<Img[]>(() => imagesFrom(product));
  const [saved, setSaved] = useState(() => imgSig(imagesFrom(product)));
  const dirty = imgSig(images) !== saved;
  useUnsavedWarning(dirty);

  const save = useMutation({
    mutationFn: () =>
      adminApi.put<AdminProductDetail>(`${path}/images`, {
        images: images.map((i) => ({ url: i.url, ...(i.alt.trim() ? { alt: i.alt.trim() } : {}) })),
      }),
    onSuccess: (p) => {
      setData(path, p);
      void invalidate("/admin/products");
      const next = imagesFrom(p);
      setImages(next);
      setSaved(imgSig(next));
      toast("Photos saved");
    },
  });

  return (
    <Panel
      title="Photos"
      description="The first photo is the main one in listings. Describe each photo for shoppers using screen readers."
      actions={
        images.length < 20 && (
          <UploadButton
            accept="image/png,image/jpeg,image/webp"
            multiple
            onUploaded={(files) =>
              setImages((list) => [
                ...list,
                ...files.slice(0, 20 - list.length).map((f) => ({ key: rowKey(), url: f.url, alt: product.name })),
              ])
            }
          >
            Upload photos
          </UploadButton>
        )
      }
    >
      {images.length ? (
        <ul className="flex flex-col gap-2">
          {images.map((img, i) => (
            <li key={img.key} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-tag)] border border-galv p-2 sm:flex-nowrap">
              <Thumb url={img.url} alt={img.alt || `Photo ${i + 1}`} size={64} />
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[13px] text-steel">
                  {i === 0 ? "Main photo" : `Photo ${i + 1}`}: description
                </span>
                <input
                  value={img.alt}
                  maxLength={200}
                  onChange={(e) => setImages((list) => list.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
                  className={cn(inputClass, "h-9")}
                  placeholder="e.g. Chrome basin mixer, side view"
                />
              </label>
              <RowControls
                index={i}
                count={images.length}
                label={`photo ${i + 1}`}
                onMove={(d) => setImages((list) => move(list, i, d))}
                onRemove={() => setImages((list) => list.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-steel">No photos yet. Shoppers see a plain placeholder with the brand name instead.</p>
      )}
      <SaveBar
        dirty={dirty}
        loading={save.isPending}
        error={save.error}
        onSave={() => save.mutate()}
        onDiscard={() => {
          setImages(imagesFrom(product));
          save.reset();
        }}
        label="Save photos"
      />
    </Panel>
  );
}

// ── documents ──

type DocKind = "datasheet" | "manual" | "certificate";
type Doc = { key: string; title: string; url: string; kind: DocKind };
const KINDS: { value: DocKind; label: string }[] = [
  { value: "datasheet", label: "Datasheet" },
  { value: "manual", label: "Manual" },
  { value: "certificate", label: "Certificate" },
];
const docsFrom = (p: AdminProductDetail): Doc[] =>
  p.documents.map((d) => ({
    key: rowKey(),
    title: d.title,
    url: d.url,
    kind: (KINDS.some((k) => k.value === d.kind) ? d.kind : "datasheet") as DocKind,
  }));
const docSig = (list: Doc[]) => JSON.stringify(list.map((d) => [d.title.trim(), d.url, d.kind]));

function titleFromFile(name: string) {
  const base = name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 120) || "Datasheet";
}

export function ProductDocuments({ product, path }: { product: AdminProductDetail; path: string }) {
  const toast = useToast();
  const setData = useSetAdminData();
  const [docs, setDocs] = useState<Doc[]>(() => docsFrom(product));
  const [saved, setSaved] = useState(() => docSig(docsFrom(product)));
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = docSig(docs) !== saved;
  useUnsavedWarning(dirty);

  const save = useMutation({
    mutationFn: () =>
      adminApi.put<AdminProductDetail>(`${path}/documents`, {
        documents: docs.map((d) => ({ title: d.title.trim(), url: d.url, kind: d.kind })),
      }),
    onSuccess: (p) => {
      setData(path, p);
      const next = docsFrom(p);
      setDocs(next);
      setSaved(docSig(next));
      toast("Documents saved");
    },
  });

  const onSave = () => {
    if (docs.some((d) => !d.title.trim())) {
      setProblem("Give every document a title shoppers will understand, like “Installation guide”.");
      return;
    }
    setProblem(null);
    save.mutate();
  };

  return (
    <Panel
      title="Documents"
      description="Datasheets, manuals and certificates shoppers can download from the product page (PDF)."
      actions={
        docs.length < 20 && (
          <UploadButton
            accept="application/pdf"
            multiple
            onUploaded={(files) =>
              setDocs((list) => [
                ...list,
                ...files.map((f) => ({ key: rowKey(), title: titleFromFile(f.name), url: f.url, kind: "datasheet" as DocKind })),
              ])
            }
          >
            Upload PDF
          </UploadButton>
        )
      }
    >
      {docs.length ? (
        <ul className="flex flex-col gap-2">
          {docs.map((d, i) => (
            <li key={d.key} className="flex flex-wrap items-center gap-2 rounded-[var(--radius-tag)] border border-galv p-2 sm:flex-nowrap">
              <a href={d.url} target="_blank" rel="noopener" className="shrink-0 rounded p-1.5 text-steel hover:text-pipe" aria-label={`Open ${d.title || "document"}`}>
                <FileText className="size-5" />
              </a>
              <label className="min-w-0 flex-1">
                <span className="sr-only">Document {i + 1} title</span>
                <input
                  value={d.title}
                  maxLength={120}
                  onChange={(e) => setDocs((list) => list.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                  className={cn(inputClass, "h-9")}
                  placeholder="Title"
                />
              </label>
              <label>
                <span className="sr-only">Document {i + 1} type</span>
                <select
                  value={d.kind}
                  onChange={(e) => setDocs((list) => list.map((x, j) => (j === i ? { ...x, kind: e.target.value as DocKind } : x)))}
                  className={cn(inputClass, "h-9 w-36")}
                >
                  {KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <RowControls
                index={i}
                count={docs.length}
                label={`document ${i + 1}`}
                onMove={(delta) => setDocs((list) => move(list, i, delta))}
                onRemove={() => setDocs((list) => list.filter((_, j) => j !== i))}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-steel">No documents. Upload the manufacturer&apos;s datasheet if you have one.</p>
      )}
      {problem && <FormError message={problem} />}
      <SaveBar
        dirty={dirty}
        loading={save.isPending}
        error={save.error}
        onSave={onSave}
        onDiscard={() => {
          setDocs(docsFrom(product));
          setProblem(null);
          save.reset();
        }}
        label="Save documents"
      />
    </Panel>
  );
}

export { SaveBar };
