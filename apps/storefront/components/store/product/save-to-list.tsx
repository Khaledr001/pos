"use client";

import type { ProjectListSummary } from "@devsfleet/storefront-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-browser";
import { useMe } from "@/lib/hooks/store";

/** Save the selected option to the wishlist or a project list ("Villa bathroom"). */
export function SaveToList({
  variantId,
  uom,
  quantity,
  onDone,
}: {
  variantId: string;
  uom?: string;
  quantity: number;
  onDone: (message: string | null, error?: string) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: lists } = useQuery({
    queryKey: ["lists"],
    queryFn: () => api.get<ProjectListSummary[]>("/me/lists"),
    enabled: !!me && open,
  });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const save = async (listId: string, listName: string) => {
    setBusy(true);
    try {
      await api.post(`/me/lists/${listId}/items`, { variantId, uom, quantity });
      qc.invalidateQueries({ queryKey: ["lists"] });
      onDone(`Saved to ${listName}`);
      setOpen(false);
    } catch (err) {
      onDone(null, errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const createAndSave = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const list = await api.post<{ id: string; name: string }>("/me/lists", { name: name.trim() });
      setName("");
      await save(list.id, list.name);
    } catch (err) {
      onDone(null, errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant="secondary"
        size="lg"
        aria-label="Save to a list"
        aria-expanded={open}
        onClick={() => (me ? setOpen(!open) : router.push(`/login?next=${encodeURIComponent(pathname)}`))}
      >
        <Heart className="size-5" />
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-[var(--radius-panel)] border border-galv bg-paper p-2 shadow-lg">
          <p className="px-2 py-1 text-sm font-medium text-steel">Save to</p>
          <ul>
            {(lists ?? []).map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => save(l.id, l.name)}
                  className="flex w-full items-center justify-between rounded-[var(--radius-tag)] px-2 py-2 text-left hover:bg-sheet"
                >
                  <span>{l.name}</span>
                  <span className="text-sm text-steel">{l.itemCount}</span>
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-1 flex gap-2 border-t border-galv p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void createAndSave();
            }}
          >
            <label className="sr-only" htmlFor="new-list">
              New list name
            </label>
            <input
              id="new-list"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New list, e.g. Villa bathroom"
              maxLength={80}
              className="h-9 min-w-0 flex-1 rounded-[var(--radius-tag)] border border-galv px-2 text-sm"
            />
            <Button type="submit" size="sm" disabled={!name.trim() || busy} aria-label="Create list and save">
              <Plus className="size-4" />
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
