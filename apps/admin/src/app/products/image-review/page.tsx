"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft, Check, ExternalLink, ImageOff, Loader2, RefreshCw, Search, SkipForward, X, XCircle,
} from "lucide-react";
import { hasPermission, type Permission } from "@devsfleet/shared-types";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loading, Notice, PageHeader, errorText, selectClass } from "../../online-store/shared";

interface Candidate {
  id: string;
  imageUrl: string;
  thumbnailUrl: string | null;
  sourcePageUrl: string;
  sourceDomain: string;
  title: string | null;
  width: number | null;
  height: number | null;
  matchScore: number;
  query: string | null;
}

interface ReviewProduct {
  productId: string;
  name: string;
  sku: string;
  brand: string | null;
  category: string | null;
  candidates: Candidate[];
}

interface Summary {
  totalProducts: number;
  withImage: number;
  rejectedOnly: number;
  awaitingReview: number;
  needSearch: number;
}

interface Option { id: string; name: string; children?: Option[] }
type ListResponse = ReviewProduct[] & { meta?: { total: number; page: number; totalPages: number } };

const PAGE_SIZE = 50;

function flatten(options: Option[], depth = 0): { id: string; label: string }[] {
  return options.flatMap((o) => [
    { id: o.id, label: `${"  ".repeat(depth)}${o.name}` },
    ...flatten(o.children ?? [], depth + 1),
  ]);
}

/** Thumbnail from a third-party host: no referrer (hotlink protection), and a graceful fallback. */
function CandidateImage({ candidate, name }: { candidate: Candidate; name: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-lg bg-secondary text-center text-[11px] text-muted-foreground">
        <ImageOff className="h-6 w-6" aria-hidden />
        Preview unavailable
      </div>
    );
  }
  return (
    <img
      src={candidate.thumbnailUrl ?? candidate.imageUrl}
      alt={candidate.title ?? `Candidate photo for ${name}`}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
      className="aspect-square w-full rounded-lg bg-white object-contain"
    />
  );
}

export default function ImageReviewPage() {
  const { tokens, user } = useAuth();
  const auth = useMemo(() => ({ accessToken: tokens?.accessToken }), [tokens?.accessToken]);
  const canWrite = hasPermission((user?.permissions ?? []) as Permission[], "product:write");

  const [items, setItems] = useState<ReviewProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [onlyWithoutImage, setOnlyWithoutImage] = useState(true);
  const [categories, setCategories] = useState<{ id: string; label: string }[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeCandidate, setActiveCandidate] = useState(0);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [reviewedNow, setReviewedNow] = useState(0);
  // Candidates ticked for the open product, in the order they were ticked: the first becomes the main photo.
  const [picked, setPicked] = useState<string[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!auth.accessToken) return;
    void Promise.allSettled([
      api.get<Option[]>("/categories", auth),
      api.get<{ id: string; name: string }[]>("/brands", auth),
    ]).then(([c, b]) => {
      if (c.status === "fulfilled") setCategories(flatten(c.value ?? []));
      if (b.status === "fulfilled") setBrands(b.value ?? []);
    });
  }, [auth]);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api.get<Summary>("/product-image-candidates/summary", auth));
    } catch {
      /* the list still works without the counters */
    }
  }, [auth]);

  const load = useCallback(async () => {
    if (!auth.accessToken) return;
    setLoading(true);
    setLoadError(null);
    try {
      const rows = await api.get<ListResponse>("/product-image-candidates", {
        ...auth,
        query: {
          page, limit: PAGE_SIZE, status: "pending", onlyWithoutImage,
          q: q || undefined, categoryId: categoryId || undefined, brandId: brandId || undefined,
        },
      });
      setItems([...rows]);
      setTotal(rows.meta?.total ?? rows.length);
      setTotalPages(rows.meta?.totalPages ?? 1);
      setSelectedId((current) => (rows.some((r) => r.productId === current) ? current : (rows[0]?.productId ?? null)));
      setActiveCandidate(0);
    } catch (err) {
      setLoadError(errorText(err, "Failed to load products to review."));
    } finally {
      setLoading(false);
    }
  }, [auth, page, q, categoryId, brandId, onlyWithoutImage]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { setPage(1); }, [q, categoryId, brandId, onlyWithoutImage]);

  const selectedIndex = items.findIndex((p) => p.productId === selectedId);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : undefined;

  const select = useCallback((index: number) => {
    const next = items[Math.max(0, Math.min(items.length - 1, index))];
    if (next) { setSelectedId(next.productId); setActiveCandidate(0); }
  }, [items]);

  /** Remove a product from the queue and land on whatever now occupies its slot. */
  const advance = useCallback((productId: string) => {
    setItems((prev) => {
      const index = prev.findIndex((p) => p.productId === productId);
      const rest = prev.filter((p) => p.productId !== productId);
      const next = rest[Math.min(index, rest.length - 1)];
      setSelectedId(next?.productId ?? null);
      setActiveCandidate(0);
      return rest;
    });
    setTotal((t) => Math.max(0, t - 1));
  }, []);

  const bump = (change: Partial<Record<keyof Summary, number>>) =>
    setSummary((s) => (s ? Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v + (change[k as keyof Summary] ?? 0)])) as unknown as Summary : s));

  useEffect(() => setPicked([]), [selectedId]);

  const withPending = async (key: string, fn: () => Promise<void>) => {
    setPending((p) => new Set(p).add(key));
    try { await fn(); } finally {
      setPending((p) => { const n = new Set(p); n.delete(key); return n; });
    }
  };

  const approveMany = async (product: ReviewProduct, ids: string[]) => {
    if (!canWrite || ids.length === 0 || pending.has(product.productId)) return;
    const snapshot = items;
    advance(product.productId);
    bump({ withImage: 1, awaitingReview: -1 });
    setReviewedNow((n) => n + 1);
    setPicked([]);
    await withPending(product.productId, async () => {
      // One at a time and in order, so the first ticked photo is the one that becomes primary.
      const failed: { id: string; message: string }[] = [];
      for (const id of ids) {
        try {
          await api.post(`/product-image-candidates/${id}/approve`, undefined, auth);
        } catch (err) {
          failed.push({ id, message: errorText(err, "Could not use this photo.") });
        }
      }
      if (failed.length === ids.length) {
        setItems(snapshot);
        setSelectedId(product.productId);
        setTotal((t) => t + 1);
        bump({ withImage: -1, awaitingReview: 1 });
        setReviewedNow((n) => Math.max(0, n - 1));
        setFailures((f) => ({ ...f, ...Object.fromEntries(failed.map((x) => [x.id, x.message])) }));
        setNotice({ kind: "error", message: failed[0]?.message ?? "Could not use these photos." });
      } else if (failed.length > 0) {
        setNotice({ kind: "error", message: `${ids.length - failed.length} of ${ids.length} photos saved for “${product.name}”; ${failed.length} failed: ${failed[0]?.message}` });
      } else {
        setNotice({ kind: "success", message: `${ids.length} photos saved for “${product.name}”.` });
      }
    });
  };

  const approve = async (product: ReviewProduct, candidate: Candidate) => {
    if (!canWrite || pending.has(product.productId)) return;
    setFailures((f) => Object.fromEntries(Object.entries(f).filter(([id]) => id !== candidate.id)));
    // Approval downloads the photo server-side, so it can take seconds and can fail.
    // The product leaves the queue immediately and comes back, with the reason, if it does.
    const snapshot = items;
    advance(product.productId);
    bump({ withImage: 1, awaitingReview: -1 });
    setReviewedNow((n) => n + 1);
    await withPending(product.productId, async () => {
      try {
        await api.post(`/product-image-candidates/${candidate.id}/approve`, undefined, auth);
        setNotice({ kind: "success", message: `Photo from ${candidate.sourceDomain} saved for “${product.name}”.` });
      } catch (err) {
        setItems(snapshot);
        setSelectedId(product.productId);
        setTotal((t) => t + 1);
        bump({ withImage: -1, awaitingReview: 1 });
        setReviewedNow((n) => Math.max(0, n - 1));
        setFailures((f) => ({ ...f, [candidate.id]: errorText(err, "Could not use this photo.") }));
        setNotice({ kind: "error", message: errorText(err, "Could not use this photo.") });
      }
    });
  };

  const reject = async (product: ReviewProduct, candidate: Candidate) => {
    if (!canWrite || pending.has(candidate.id)) return;
    const remaining = product.candidates.filter((c) => c.id !== candidate.id);
    const snapshot = items;
    if (remaining.length === 0) {
      advance(product.productId);
      bump({ rejectedOnly: 1, awaitingReview: -1 });
      setReviewedNow((n) => n + 1);
    } else {
      setItems((prev) => prev.map((p) => (p.productId === product.productId ? { ...p, candidates: remaining } : p)));
      setActiveCandidate((i) => Math.min(i, remaining.length - 1));
    }
    await withPending(candidate.id, async () => {
      try {
        await api.post(`/product-image-candidates/${candidate.id}/reject`, undefined, auth);
      } catch (err) {
        setItems(snapshot);
        setSelectedId(product.productId);
        if (remaining.length === 0) { setTotal((t) => t + 1); bump({ rejectedOnly: -1, awaitingReview: 1 }); setReviewedNow((n) => Math.max(0, n - 1)); }
        setNotice({ kind: "error", message: errorText(err, "Could not reject this photo.") });
      }
    });
  };

  const rejectAll = async (product: ReviewProduct) => {
    if (!canWrite || pending.has(product.productId)) return;
    const snapshot = items;
    advance(product.productId);
    bump({ rejectedOnly: 1, awaitingReview: -1 });
    setReviewedNow((n) => n + 1);
    await withPending(product.productId, async () => {
      try {
        await api.post(`/product-image-candidates/products/${product.productId}/reject-all`, undefined, auth);
      } catch (err) {
        setItems(snapshot);
        setSelectedId(product.productId);
        setTotal((t) => t + 1);
        bump({ rejectedOnly: -1, awaitingReview: 1 });
        setReviewedNow((n) => Math.max(0, n - 1));
        setNotice({ kind: "error", message: errorText(err, "Could not reject the candidates.") });
      }
    });
  };

  const skip = () => { if (selectedIndex >= 0) select(selectedIndex + 1); };

  // Keyboard: ↑/↓ or j/k product, ←/→ candidate, 1-9 jump, Enter approve, r reject, x reject all, s skip.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
      const candidate = selected?.candidates[activeCandidate];
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); select(selectedIndex + 1); }
      else if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); select(selectedIndex - 1); }
      else if (e.key === "ArrowRight" && selected) { e.preventDefault(); setActiveCandidate((i) => Math.min(selected.candidates.length - 1, i + 1)); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); setActiveCandidate((i) => Math.max(0, i - 1)); }
      else if (/^[1-9]$/.test(e.key) && selected && Number(e.key) <= selected.candidates.length) setActiveCandidate(Number(e.key) - 1);
      else if (e.key === "Enter" && selected && candidate && target.tagName !== "BUTTON" && target.tagName !== "A") { e.preventDefault(); void approve(selected, candidate); }
      else if (e.key === "r" && selected && candidate) void reject(selected, candidate);
      else if (e.key === "x" && selected) void rejectAll(selected);
      else if (e.key === "s") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    document.getElementById(`product-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const done = summary ? summary.withImage + summary.rejectedOnly : 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Image review" description="Pick the right photo for each product. Nothing is published until you approve it.">
        <Link href="/products" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Products
        </Link>
        <Button variant="outline" size="sm" onClick={() => { void load(); void loadSummary(); }} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </PageHeader>

      {summary && (
        <div aria-live="polite" className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{done} of {summary.totalProducts} done</span>
            <span>{summary.awaitingReview} awaiting review · {summary.needSearch} not searched yet{reviewedNow > 0 ? ` · ${reviewedNow} this session` : ""}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={summary.totalProducts} aria-label="Products with an image decision">
            <div className="h-full bg-primary transition-all" style={{ width: `${summary.totalProducts ? (done / summary.totalProducts) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {notice && <Notice kind={notice.kind} message={notice.message} onClose={() => setNotice(null)} />}
      {!canWrite && <Notice kind="error" message="You can look, but approving or rejecting needs the product:write permission." onClose={() => undefined} />}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Card className="flex max-h-[calc(100vh-15rem)] min-h-[24rem] flex-col overflow-hidden">
          <div className="space-y-2 border-b border-border p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or SKU" aria-label="Search products" className="h-9 pl-8 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select aria-label="Category" className={selectClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <select aria-label="Brand" className={selectClass} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                <option value="">All brands</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={onlyWithoutImage} onChange={(e) => setOnlyWithoutImage(e.target.checked)} />
              Only products with no image
            </label>
            <p className="text-[11px] text-muted-foreground">{total} product{total === 1 ? "" : "s"} · keys: ↑↓ product, ←→ photo, Enter approve, R reject, X reject all, S skip</p>
          </div>

          <div role="listbox" aria-label="Products to review" className="flex-1 overflow-y-auto">
            {loading ? <Loading label="Loading..." /> : loadError ? (
              <div className="p-4"><Notice kind="error" message={loadError} onClose={() => void load()} /></div>
            ) : items.length === 0 ? (
              <p className="p-6 text-center text-xs text-muted-foreground">Nothing to review with these filters.</p>
            ) : items.map((p) => (
              <button
                key={p.productId}
                id={`product-${p.productId}`}
                role="option"
                aria-selected={p.productId === selectedId}
                onClick={() => { setSelectedId(p.productId); setActiveCandidate(0); }}
                className={cn("flex w-full items-start justify-between gap-2 border-b border-border px-3 py-2.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", p.productId === selectedId && "bg-accent")}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{p.name}</span>
                  <span className="block truncate text-muted-foreground">{[p.brand, p.category].filter(Boolean).join(" · ") || p.sku}</span>
                </span>
                <Badge variant="secondary">{p.candidates.length}</Badge>
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-border p-2 text-xs">
            <Button variant="ghost" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((n) => n - 1)}>Previous</Button>
            <span className="text-muted-foreground">Page {page}</span>
            <Button variant="ghost" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage((n) => n + 1)}>Next</Button>
          </div>
        </Card>

        <div ref={panelRef} className="min-w-0">
          {!selected ? (
            <Card className="py-20 text-center">
              <Check className="mx-auto h-10 w-10 text-muted-foreground/40" aria-hidden />
              <h2 className="mt-3 text-sm font-semibold text-foreground">{loading ? "Loading..." : "All caught up"}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {summary && summary.needSearch > 0
                  ? `${summary.needSearch} products have no candidates yet. Run the finder: pnpm --filter @devsfleet/images run find`
                  : "No products are waiting for a photo decision."}
              </p>
            </Card>
          ) : (
            <Card className="space-y-4 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-semibold text-foreground">{selected.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {[selected.brand, selected.category].filter(Boolean).join(" · ")}{selected.brand || selected.category ? " · " : ""}SKU {selected.sku}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={skip}><SkipForward className="h-3.5 w-3.5" /> Skip</Button>
                  <Button variant="outline" size="sm" disabled={!canWrite || pending.has(selected.productId)} onClick={() => void rejectAll(selected)}>
                    <XCircle className="h-3.5 w-3.5" /> None of these
                  </Button>
                </div>
              </div>

              {picked.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
                  <p className="text-xs text-foreground">
                    {picked.length} {picked.length === 1 ? "photo" : "photos"} selected. Photo 1 becomes the main image; the rest are added to the gallery.
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPicked([])}>Clear</Button>
                    <Button size="sm" disabled={!canWrite || pending.has(selected.productId)} onClick={() => void approveMany(selected, picked)}>
                      <Check className="h-3.5 w-3.5" /> Approve {picked.length} selected
                    </Button>
                  </div>
                </div>
              )}

              <ul className="grid grid-cols-2 gap-3 xl:grid-cols-3" aria-label="Candidate photos">
                {selected.candidates.map((c, index) => {
                  const failure = failures[c.id];
                  return (
                    <li key={c.id}>
                      <div
                        className={cn("space-y-2 rounded-xl border p-2", index === activeCandidate ? "border-primary ring-2 ring-primary/30" : "border-border")}
                        onClick={() => setActiveCandidate(index)}
                      >
                        <div className="relative">
                          <CandidateImage candidate={c} name={selected.name} />
                          <span className="absolute left-1.5 top-1.5 rounded bg-background/90 px-1.5 text-[10px] font-medium text-foreground">{index + 1}</span>
                          <label
                            className="absolute right-1.5 top-1.5 inline-flex cursor-pointer items-center gap-1 rounded bg-background/90 px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={picked.includes(c.id)}
                              disabled={!canWrite}
                              onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((id) => id !== c.id) : [...p, c.id]))}
                            />
                            {picked.includes(c.id) ? `Pick ${picked.indexOf(c.id) + 1}` : "Select"}
                          </label>
                        </div>
                        <div className="space-y-0.5 text-[11px]">
                          <p className="truncate font-medium text-foreground" title={c.title ?? undefined}>{c.title ?? c.sourceDomain}</p>
                          <p className="flex items-center justify-between text-muted-foreground">
                            <span className="truncate">{c.sourceDomain}</span>
                            <span>{c.width && c.height ? `${c.width}×${c.height}` : "size unknown"}</span>
                          </p>
                          <div className="flex items-center justify-between">
                            <a href={c.sourcePageUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                              Open source page <ExternalLink className="h-3 w-3" aria-hidden />
                            </a>
                            <Badge variant={c.matchScore >= 70 ? "success" : "secondary"}>score {c.matchScore}</Badge>
                          </div>
                          {failure && <p role="alert" className="text-destructive">{failure}</p>}
                        </div>
                        <div className="flex gap-1.5">
                          <Button size="sm" className="flex-1" disabled={!canWrite || pending.has(selected.productId)} onClick={(e) => { e.stopPropagation(); void approve(selected, c); }}>
                            {pending.has(selected.productId) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Approve
                          </Button>
                          <Button size="sm" variant="outline" aria-label={`Reject photo ${index + 1}`} disabled={!canWrite || pending.has(c.id)} onClick={(e) => { e.stopPropagation(); void reject(selected, c); }}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                These photos belong to other websites. Approving copies the file into your store and records the source; check you have the right to use it, and prefer brand or manufacturer sources.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
