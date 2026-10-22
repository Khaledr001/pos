"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SortOrder = "asc" | "desc";

export interface ListQueryState<F extends string> {
  /** What is in the search box, keystroke by keystroke. Bind the input to this. */
  search: string;
  setSearch: (value: string) => void;
  /** The search to send — settles DEBOUNCE_MS after the last keystroke. */
  q: string;
  page: number;
  setPage: (page: number) => void;
  sortBy: string;
  sortOrder: SortOrder;
  /** Same column flips direction; a new column starts at its natural order. */
  toggleSort: (column: string, firstOrder?: SortOrder) => void;
  filters: Record<F, string>;
  setFilter: (name: F, value: string) => void;
  /**
   * False until the URL has been read. Fetching before then loads page 1
   * unfiltered and immediately throws it away for what the URL asked for.
   */
  ready: boolean;
}

const DEBOUNCE_MS = 300;

/**
 * Search, page, sort and filters for a list page, kept in the URL.
 *
 * In the URL so that Back from a record lands on the same page of the same
 * search, and a filtered list can be sent to someone as a link. Read from
 * `window.location` after mount rather than `useSearchParams`, which makes a
 * production build demand a Suspense boundary around every page that lists
 * anything. Written with `history.replaceState`, which Next keeps in step
 * with its router — paging through a list does not fill the Back stack.
 */
export function useListQuery<F extends string = never>(options: {
  sortBy: string;
  sortOrder: SortOrder;
  filters?: Record<F, string>;
}): ListQueryState<F> {
  const defaults = useRef(options).current;
  const defaultFilters = (defaults.filters ?? {}) as Record<F, string>;

  const [ready, setReady] = useState(false);
  const [search, setSearchState] = useState("");
  const [q, setQ] = useState("");
  const [page, setPageState] = useState(1);
  const [sortBy, setSortBy] = useState(defaults.sortBy);
  const [sortOrder, setSortOrder] = useState<SortOrder>(defaults.sortOrder);
  const [filters, setFilters] = useState<Record<F, string>>(defaultFilters);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlQ = params.get("q") ?? "";
    setSearchState(urlQ);
    setQ(urlQ);
    setPageState(Math.max(1, Number(params.get("page")) || 1));
    setSortBy(params.get("sort") ?? defaults.sortBy);
    setSortOrder(params.get("dir") === "asc" ? "asc" : params.get("dir") === "desc" ? "desc" : defaults.sortOrder);
    const fromUrl = { ...defaultFilters };
    for (const name of Object.keys(defaultFilters) as F[]) {
      const value = params.get(name);
      if (value !== null) fromUrl[name] = value;
    }
    setFilters(fromUrl);
    setReady(true);
    // Read once: after this the state is the source and the URL follows it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new search starts from page 1. Kept on the debounced value, not the
  // keystroke, so typing does not bounce the page number while it settles.
  useEffect(() => {
    if (search === q) return;
    const timer = setTimeout(() => {
      setQ(search);
      setPageState(1);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, q]);

  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    const set = (key: string, value: string, fallback: string) => {
      if (value && value !== fallback) params.set(key, value);
      else params.delete(key);
    };
    set("q", q.trim(), "");
    set("page", String(page), "1");
    set("sort", sortBy, defaults.sortBy);
    set("dir", sortOrder, defaults.sortOrder);
    for (const name of Object.keys(filters) as F[]) set(name, filters[name], defaultFilters[name]);
    const query = params.toString();
    const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(window.history.state, "", next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, q, page, sortBy, sortOrder, filters]);

  const setSearch = useCallback((value: string) => setSearchState(value), []);
  const setPage = useCallback((value: number) => setPageState(Math.max(1, value)), []);

  const toggleSort = useCallback(
    (column: string, firstOrder: SortOrder = "asc") => {
      if (column === sortBy) {
        setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
      } else {
        setSortBy(column);
        setSortOrder(firstOrder);
      }
      setPageState(1);
    },
    [sortBy],
  );

  const setFilter = useCallback((name: F, value: string) => {
    setFilters((prev) => ({ ...prev, [name]: value }));
    setPageState(1);
  }, []);

  return { search, setSearch, q, page, setPage, sortBy, sortOrder, toggleSort, filters, setFilter, ready };
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

/**
 * Loads one page of a list, keeping only the answer to the latest request.
 *
 * Every change of search, page or sort aborts the request before it. Without
 * that, typing "pipe" sent four searches, and whichever came back LAST filled
 * the table — often "pi", under a box that says "pipe".
 *
 * `load` must be stable for a given query (wrap it in useCallback over the
 * query values); a new `load` is what triggers a reload.
 */
export function useListData<T>(
  load: (signal: AbortSignal) => Promise<ListResult<T>>,
  enabled: boolean,
) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const loadedOnce = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    load(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems(result.items);
        setTotal(result.total);
        loadedOnce.current = true;
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [load, enabled, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return {
    items,
    total,
    loading,
    /** Loading with nothing to show yet — the skeleton case, as opposed to a refresh. */
    initialLoading: loading && !loadedOnce.current,
    error,
    reload,
  };
}

/**
 * The API answers lists in two shapes — `{ items, meta: { total } }` from the
 * paginated envelope, `{ items, total }` from the older services. One reader
 * for both, so a page does not have to know which it is talking to.
 */
export function readListResult<T>(res: unknown): ListResult<T> {
  if (Array.isArray(res)) {
    const meta = (res as unknown as { meta?: { total?: number } }).meta;
    return { items: res as T[], total: meta?.total ?? res.length };
  }
  const body = (res ?? {}) as { items?: T[]; total?: number; meta?: { total?: number } };
  const items = body.items ?? [];
  return { items, total: body.meta?.total ?? body.total ?? items.length };
}
