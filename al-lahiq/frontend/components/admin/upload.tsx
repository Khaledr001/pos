"use client";

import type { UploadResult } from "@al-lahiq/api-client";
import { Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { adminApi, errorMessage } from "@/lib/api-browser";
import { Thumb } from "./ui";

export async function uploadFile(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return adminApi.post<UploadResult>("/admin/uploads", fd);
}

/** A button that opens the file picker and uploads the chosen file(s). */
export function UploadButton({
  accept,
  multiple,
  onUploaded,
  children,
  variant = "secondary",
  size = "sm",
}: {
  accept: string;
  multiple?: boolean;
  onUploaded: (files: { url: string; name: string }[]) => void;
  children: ReactNode;
  variant?: "secondary" | "primary" | "ghost";
  size?: "sm" | "md";
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError(null);
    const done: { url: string; name: string }[] = [];
    try {
      for (const f of Array.from(list)) {
        if (f.size > 10 * 1024 * 1024) throw new Error(`${f.name} is larger than 10 MB. Use a smaller file.`);
        const r = await uploadFile(f);
        done.push({ url: r.url, name: f.name });
      }
    } catch (err) {
      setError(err instanceof Error && !("status" in err) ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
      if (done.length) onUploaded(done);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => pick(e.target.files)}
      />
      <Button type="button" variant={variant} size={size} loading={busy} onClick={() => input.current?.click()}>
        {!busy && <Upload className="size-4" aria-hidden />}
        {busy ? "Uploading" : children}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-signal">
          {error}
        </p>
      )}
    </div>
  );
}

/** Single image (category, brand logo, banner, cover): preview, upload, remove. */
export function ImageInput({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string | null;
  onChange: (url: string | null) => void;
  hint?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap items-center gap-3">
        <Thumb url={value} alt={value ? `Current ${label.toLowerCase()}` : ""} size={72} />
        <div className="flex flex-wrap items-start gap-2">
          <UploadButton accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" onUploaded={(f) => onChange(f[0].url)}>
            {value ? "Replace image" : "Upload image"}
          </UploadButton>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              Remove image
            </Button>
          )}
        </div>
      </div>
      {hint && <p className="text-sm text-steel">{hint}</p>}
    </fieldset>
  );
}
