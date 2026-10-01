"use client";

import type { ProjectListSummary } from "@al-lahiq/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, ListChecks } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { FormError, inputClass } from "@/components/ui/field";
import { api } from "@/lib/api-browser";
import { formatDate } from "@/lib/format";
import { QueryError, friendlyError } from "./session";

/** Inline name editor used for creating and renaming lists. */
export function ListNameForm({
  initial = "",
  submitLabel,
  onSubmit,
  onCancel,
  pending,
  label,
}: {
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel?: () => void;
  pending: boolean;
  label: string;
}) {
  const [name, setName] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1.5">
        <span className="text-sm font-medium">{label}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Villa bathroom" className={inputClass} required />
      </label>
      <Button type="submit" loading={pending} disabled={!name.trim()} className="h-11">
        {submitLabel}
      </Button>
      {onCancel && (
        <Button type="button" variant="ghost" onClick={onCancel} className="h-11">
          Cancel
        </Button>
      )}
    </form>
  );
}

function ListRow({ list }: { list: ProjectListSummary }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const refresh = () => qc.invalidateQueries({ queryKey: ["lists"] });
  const rename = useMutation({
    mutationFn: (name: string) => api.patch(`/me/lists/${list.id}`, { name }),
    onSuccess: async () => {
      await refresh();
      setMode("view");
    },
  });
  const remove = useMutation({ mutationFn: () => api.delete(`/me/lists/${list.id}`), onSuccess: refresh });
  const error = rename.error ?? remove.error;

  return (
    <li className="px-4 py-3">
      {mode === "rename" ? (
        <ListNameForm
          label={`New name for ${list.name}`}
          initial={list.name}
          submitLabel="Save name"
          onSubmit={(name) => rename.mutate(name)}
          onCancel={() => setMode("view")}
          pending={rename.isPending}
        />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/account/lists/${list.id}`} className="group flex min-w-0 items-center gap-3">
            {list.isWishlist ? <Heart className="size-5 shrink-0 text-signal" aria-hidden /> : <ListChecks className="size-5 shrink-0 text-pipe" aria-hidden />}
            <span className="min-w-0">
              <span className="block font-cond text-xl font-semibold group-hover:text-pipe group-hover:underline">{list.name}</span>
              <span className="text-sm text-steel">
                {list.itemCount === 1 ? "1 item" : `${list.itemCount} items`}, updated {formatDate(list.updatedAt)}
              </span>
            </span>
          </Link>
          <div className="flex flex-wrap items-center gap-1" aria-live="polite">
            {mode === "delete" ? (
              <>
                <span className="text-[15px]">Delete this list?</span>
                <Button size="sm" variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
                  Delete list
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setMode("view")}>
                  Keep it
                </Button>
              </>
            ) : (
              !list.isWishlist && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setMode("rename")}>
                    Rename
                  </Button>
                  <Button size="sm" variant="ghost" className="text-steel hover:text-signal" onClick={() => setMode("delete")}>
                    Delete
                  </Button>
                </>
              )
            )}
          </div>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <FormError message={friendlyError(error)} />
        </div>
      )}
    </li>
  );
}

export function ListsPage() {
  const qc = useQueryClient();
  const { data: lists, isLoading, error } = useQuery({
    queryKey: ["lists"],
    queryFn: () => api.get<ProjectListSummary[]>("/me/lists"),
  });
  const [formKey, setFormKey] = useState(0);
  const create = useMutation({
    mutationFn: (name: string) => api.post("/me/lists", { name }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["lists"] });
      setFormKey((k) => k + 1);
    },
  });

  return (
    <div>
      <h1 className="text-4xl">Lists</h1>
      <p className="mt-1 max-w-[65ch] text-steel">
        Keep a list for each job, like &ldquo;Villa bathroom&rdquo;, and add it to your cart in one go. Items you save with the heart button go to
        your wishlist.
      </p>

      <section aria-labelledby="new-list" className="mt-6 rounded-[var(--radius-panel)] border border-galv bg-paper p-5">
        <h2 id="new-list" className="mb-3 text-xl">
          Start a project list
        </h2>
        <ListNameForm key={formKey} label="List name" submitLabel="Create list" onSubmit={(name) => create.mutate(name)} pending={create.isPending} />
        <div aria-live="polite" className="mt-2 empty:hidden">
          {create.error && <FormError message={friendlyError(create.error)} />}
        </div>
      </section>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-steel">Loading your lists…</p>
        ) : error ? (
          <QueryError error={error} />
        ) : lists && lists.length === 0 ? (
          <p className="text-steel">
            You have no lists yet. Save products with the heart button on any product page, or start a project list above.
          </p>
        ) : (
          <ul className="divide-y divide-galv rounded-[var(--radius-panel)] border border-galv bg-paper">
            {lists?.map((l) => (
              <ListRow key={l.id} list={l} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
