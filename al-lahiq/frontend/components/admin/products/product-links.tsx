"use client";

import type { AdminProductDetail, ProductCard, ProductLinkKind } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { adminApi } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { useAdminQuery, useSetAdminData } from "../data";
import { SearchInput } from "../list-controls";
import { RowControls, useUnsavedWarning } from "../row-controls";
import { useToast } from "../toast";
import { Loading, Panel, Thumb } from "../ui";
import { SaveBar } from "./product-media";

const KIND_LABEL: Record<ProductLinkKind, { title: string; hint: string }> = {
  RELATED: { title: "Related products", hint: "“You may also need”: accessories and parts that go with it." },
  ALTERNATIVE: { title: "Alternatives", hint: "Similar products to offer when this one is out of stock." },
  BOUGHT_TOGETHER: { title: "Often bought together", hint: "Items customers usually add in the same order." },
};
const KINDS = Object.keys(KIND_LABEL) as ProductLinkKind[];

type LinkRow = { toId: string; kind: ProductLinkKind; name: string; slug: string };
const linksFrom = (p: AdminProductDetail): LinkRow[] =>
  [...p.links]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => ({ toId: l.toId, kind: l.kind, name: l.to.name, slug: l.to.slug }));
const sig = (list: LinkRow[]) => JSON.stringify(list.map((l) => [l.toId, l.kind]));

export function ProductLinks({ product, path }: { product: AdminProductDetail; path: string }) {
  const toast = useToast();
  const setData = useSetAdminData();
  const [links, setLinks] = useState<LinkRow[]>(() => linksFrom(product));
  const [saved, setSaved] = useState(() => sig(linksFrom(product)));
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<ProductLinkKind>("RELATED");
  const dirty = sig(links) !== saved;
  useUnsavedWarning(dirty);

  const results = useAdminQuery<ProductCard[]>("/admin/products/pick", { q }, { enabled: q.length >= 2 });

  const save = useMutation({
    mutationFn: () => adminApi.put<AdminProductDetail>(`${path}/links`, { links: links.map((l) => ({ toId: l.toId, kind: l.kind })) }),
    onSuccess: (p) => {
      setData(path, p);
      const next = linksFrom(p);
      setLinks(next);
      setSaved(sig(next));
      toast("Related products saved");
    },
  });

  const has = (id: string, k: ProductLinkKind) => links.some((l) => l.toId === id && l.kind === k);

  return (
    <Panel title="Related products" description="Suggestions shown on this product's page. Only published products are shown to shoppers.">
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {KINDS.map((k) => {
            const rows = links.map((l, i) => ({ l, i })).filter((x) => x.l.kind === k);
            return (
              <section key={k}>
                <h3 className="text-lg">{KIND_LABEL[k].title}</h3>
                <p className="text-[13px] text-steel">{KIND_LABEL[k].hint}</p>
                {rows.length ? (
                  <ul className="mt-2 flex flex-col gap-1">
                    {rows.map(({ l, i }, n) => (
                      <li key={`${l.kind}-${l.toId}`} className="flex items-center gap-2 rounded-[var(--radius-tag)] border border-galv px-2 py-1">
                        <Link href={`/admin/products/${l.toId}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                          {l.name}
                        </Link>
                        <RowControls
                          index={n}
                          count={rows.length}
                          label={l.name}
                          onMove={(d) => {
                            const target = rows[n + d];
                            if (target) setLinks((list) => swap(list, i, target.i));
                          }}
                          onRemove={() => setLinks((list) => list.filter((_, j) => j !== i))}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-steel-light">None yet.</p>
                )}
              </section>
            );
          })}
        </div>

        <div className="rounded-[var(--radius-tag)] border border-galv bg-sheet/60 p-3">
          <h3 className="text-lg">Add products</h3>
          <div className="mt-2 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <span className="shrink-0 text-steel">Add as</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as ProductLinkKind)} className={cn(inputClass, "h-10")}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k].title}
                  </option>
                ))}
              </select>
            </label>
            <SearchInput label="Find a product to add" placeholder="Name or SKU" value={q} onSearch={setQ} />
          </div>
          <div className="mt-2">
            {q.length < 2 ? (
              <p className="py-2 text-sm text-steel">Type at least 2 letters of a product name or SKU, then search.</p>
            ) : results.isPending ? (
              <Loading label="Searching" />
            ) : results.error ? (
              <p className="py-2 text-sm text-signal">Search failed. Try again.</p>
            ) : !results.data?.length ? (
              <p className="py-2 text-sm text-steel">No products found for “{q}”.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-galv rounded-[var(--radius-tag)] border border-galv bg-paper">
                {results.data
                  .filter((c) => c.id !== product.id)
                  .map((c) => {
                    const added = has(c.id, kind);
                    return (
                      <li key={c.id} className="flex items-center gap-2 px-2 py-1.5">
                        <Thumb url={c.image?.url} alt="" size={32} />
                        <span className="min-w-0 flex-1 text-sm">
                          <span className="line-clamp-2">{c.name}</span>
                          {c.brand && <span className="block text-[12px] text-steel">{c.brand.name}</span>}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant={added ? "ghost" : "secondary"}
                          disabled={added}
                          onClick={() => setLinks((list) => [...list, { toId: c.id, kind, name: c.name, slug: c.slug }])}
                        >
                          {added ? "Added" : "Add"}
                        </Button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </div>
      </div>
      <SaveBar
        dirty={dirty}
        loading={save.isPending}
        error={save.error}
        onSave={() => save.mutate()}
        onDiscard={() => {
          setLinks(linksFrom(product));
          save.reset();
        }}
        label="Save related products"
      />
    </Panel>
  );
}

function swap<T>(list: T[], a: number, b: number) {
  const next = [...list];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
