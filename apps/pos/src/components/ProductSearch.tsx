import {
  AlertCircle,
  Building2,
  Check,
  LayoutGrid,
  List,
  Loader2,
  Package,
  Plus,
  ScanBarcode,
  Search,
  X,
} from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import { Money } from "@devsfleet/shared-utils";
import { amount, quantity as fmtQuantity } from "../lib/money.js";
import { posData, type PosProduct } from "../lib/pos-data.js";
import { CheckBranchesModal } from "./CheckBranchesModal.js";

/**
 * POS Product Catalogue Search & View Grid/List.
 *
 * Supports:
 * - Real-time local SQLite search (offline first)
 * - Grid & List view modes with persistent preference
 * - Out-of-stock guard (blocks adding items with 0 stock)
 * - Rapid keyboard navigation (ArrowUp, ArrowDown, Enter)
 * - Compact design for counter touchscreen density
 * - Inter-branch stock lookup
 */
export function ProductSearch({
  onPick,
  autoFocusSignal,
}: {
  onPick: (product: PosProduct) => void;
  /** Change this value to pull focus back to the box — F1, or after a sale. */
  autoFocusSignal?: number;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PosProduct[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const [loading, setLoading] = useState(false);
  const [checkingProduct, setCheckingProduct] = useState<PosProduct | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">(() => {
    return (localStorage.getItem("pos_view_mode") as "list" | "grid") ?? "list";
  });

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  function changeViewMode(mode: "list" | "grid") {
    setViewMode(mode);
    localStorage.setItem("pos_view_mode", mode);
  }

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [autoFocusSignal]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void posData.searchProducts(query).then((found) => {
        if (cancelled) return;
        setResults(found ?? []);
        setHighlighted(0);
        setLoading(false);
      });
    }, 100);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Keep the highlighted row on screen when arrowing through
  useEffect(() => {
    if (viewMode === "list") {
      listRef.current
        ?.querySelector(`[data-index="${highlighted}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [highlighted, viewMode]);

  function handlePick(product: PosProduct) {
    const stock = Number(product.stock);
    if (stock <= 0) return; // Out of stock cannot be selected!
    onPick(product);
    setQuery("");
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      const product = results[highlighted];
      if (product) {
        event.preventDefault();
        handlePick(product);
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {/* ── Search Toolbar ── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--pos-text-3)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            className="field pl-9.5 pr-8 h-10 text-xs w-full bg-[var(--pos-panel)] border-[var(--pos-border)] text-[var(--pos-text)] rounded-xl"
            placeholder="Scan barcode (F1), search product name or SKU..."
            aria-label="Search products"
            autoComplete="off"
            spellCheck={false}
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--pos-text-3)] hover:text-[var(--pos-text)]"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <ScanBarcode className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[var(--pos-text-3)]/60" />
          )}
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center rounded-xl bg-[var(--pos-panel)] border border-[var(--pos-border)] p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => changeViewMode("list")}
            className={[
              "flex items-center justify-center size-8 rounded-lg transition-colors",
              viewMode === "list"
                ? "bg-[var(--pos-raised)] text-[var(--pos-accent)] shadow-xs"
                : "text-[var(--pos-text-3)] hover:text-[var(--pos-text)]",
            ].join(" ")}
            title="Compact List View"
          >
            <List className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => changeViewMode("grid")}
            className={[
              "flex items-center justify-center size-8 rounded-lg transition-colors",
              viewMode === "grid"
                ? "bg-[var(--pos-raised)] text-[var(--pos-accent)] shadow-xs"
                : "text-[var(--pos-text-3)] hover:text-[var(--pos-text)]",
            ].join(" ")}
            title="Compact Grid View"
          >
            <LayoutGrid className="size-4" />
          </button>
        </div>
      </div>

      {/* ── Product List / Grid Results ── */}
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin"
        aria-label="Search results"
      >
        {loading ? (
          <div className="py-12 text-center text-[var(--pos-text-3)]">
            <Loader2 className="size-6 animate-spin mx-auto mb-2 text-[var(--pos-accent)]" />
            <span className="text-xs">Searching inventory…</span>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 text-center rounded-2xl border border-[var(--pos-border)] bg-[var(--pos-panel)]">
            <Package className="size-8 text-[var(--pos-text-3)]/40" />
            <p className="text-xs font-semibold text-[var(--pos-text)]">
              {query ? `No items found matching "${query}"` : "Catalogue is empty"}
            </p>
            {query && (
              <p className="text-[11px] text-[var(--pos-text-3)]">
                Check spelling or scan barcode on the packaging.
              </p>
            )}
          </div>
        ) : viewMode === "list" ? (
          /* ── LIST VIEW MODE ── */
          <div className="space-y-1">
            {results.map((product, index) => {
              const stock = Number(product.stock);
              const isOutOfStock = stock <= 0;
              const active = index === highlighted;

              return (
                <div
                  key={product.id}
                  data-index={index}
                  onClick={() => !isOutOfStock && handlePick(product)}
                  onMouseEnter={() => setHighlighted(index)}
                  className={[
                    "group relative flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-all select-none",
                    isOutOfStock
                      ? "border-[var(--pos-border)]/60 bg-[var(--pos-panel)]/50 opacity-60 cursor-not-allowed"
                      : active
                        ? "border-[var(--pos-accent)] bg-[var(--pos-raised)] cursor-pointer shadow-xs"
                        : "border-[var(--pos-border)] bg-[var(--pos-panel)] hover:bg-[var(--pos-raised)]/70 hover:border-[var(--pos-accent)]/40 cursor-pointer",
                  ].join(" ")}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-bold text-[var(--pos-text)]">
                        {product.name}
                      </span>
                      {product.variantName && product.variantName !== "Default" && (
                        <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.2 rounded bg-[var(--pos-raised)] text-[var(--pos-text-2)] border border-[var(--pos-border)]">
                          {product.variantName}
                        </span>
                      )}
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-[var(--pos-text-3)]">
                      <span className="font-mono text-[var(--pos-text-2)]">{product.sku}</span>
                      {product.categoryName && (
                        <span>· {product.categoryName}</span>
                      )}
                      <span>·</span>
                      <span
                        className={
                          isOutOfStock
                            ? "font-bold text-signal-red"
                            : stock < 10
                              ? "font-semibold text-signal-amber"
                              : "font-medium text-signal-green"
                        }
                      >
                        {isOutOfStock
                          ? "Out of Stock"
                          : `${fmtQuantity(product.stock)} ${product.unitAbbr} in stock`}
                      </span>
                    </div>
                  </div>

                  {/* Price & Action */}
                  <div className="flex items-center gap-2.5 shrink-0 text-right">
                    <div>
                      <div className="font-mono text-xs font-bold text-[var(--pos-text)]">
                        {amount(Money.toMinor(product.sellingPrice))}
                      </div>
                      <div className="text-[10px] text-[var(--pos-text-3)]">
                        per {product.unitAbbr}
                      </div>
                    </div>

                    {isOutOfStock ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCheckingProduct(product);
                        }}
                        className="btn btn-ghost text-[10px] h-7 px-2 border-signal-amber/40 text-signal-amber hover:bg-signal-amber/10"
                        title="Check stock in other branches"
                      >
                        <Building2 className="size-3 mr-1" />
                        Other Stores
                      </button>
                    ) : (
                      <div className="size-6 rounded-md bg-[var(--pos-accent)]/15 text-[var(--pos-accent)] flex items-center justify-center group-hover:bg-[var(--pos-accent)] group-hover:text-black transition-colors">
                        <Plus className="size-3.5" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* ── GRID VIEW MODE ── */
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {results.map((product, index) => {
              const stock = Number(product.stock);
              const isOutOfStock = stock <= 0;
              const active = index === highlighted;

              return (
                <div
                  key={product.id}
                  data-index={index}
                  onClick={() => !isOutOfStock && handlePick(product)}
                  onMouseEnter={() => setHighlighted(index)}
                  className={[
                    "group relative flex flex-col justify-between rounded-xl border p-3 text-left transition-all select-none",
                    isOutOfStock
                      ? "border-[var(--pos-border)]/60 bg-[var(--pos-panel)]/50 opacity-60 cursor-not-allowed"
                      : active
                        ? "border-[var(--pos-accent)] bg-[var(--pos-raised)] cursor-pointer shadow-xs"
                        : "border-[var(--pos-border)] bg-[var(--pos-panel)] hover:bg-[var(--pos-raised)] hover:border-[var(--pos-accent)]/40 cursor-pointer",
                  ].join(" ")}
                >
                  <div>
                    {/* Top Tag & Stock */}
                    <div className="flex items-center justify-between gap-1 mb-1.5">
                      <span className="font-mono text-[10px] text-[var(--pos-text-3)] truncate">
                        {product.sku}
                      </span>
                      <span
                        className={[
                          "text-[9px] font-bold px-1.5 py-0.2 rounded-md shrink-0",
                          isOutOfStock
                            ? "bg-signal-red/10 text-signal-red border border-signal-red/30"
                            : stock < 10
                              ? "bg-signal-amber/10 text-signal-amber border border-signal-amber/30"
                              : "bg-signal-green/10 text-signal-green border border-signal-green/30",
                        ].join(" ")}
                      >
                        {isOutOfStock ? "Out of Stock" : `${fmtQuantity(product.stock)} ${product.unitAbbr}`}
                      </span>
                    </div>

                    {/* Product Name */}
                    <p className="font-bold text-xs text-[var(--pos-text)] line-clamp-2 leading-tight">
                      {product.name}
                    </p>
                    {product.variantName && product.variantName !== "Default" && (
                      <p className="text-[10px] text-[var(--pos-text-2)] mt-0.5 truncate">
                        {product.variantName}
                      </p>
                    )}
                  </div>

                  {/* Price Bottom Row */}
                  <div className="mt-3 flex items-center justify-between border-t border-[var(--pos-border)]/60 pt-2">
                    <div>
                      <span className="font-mono font-bold text-xs text-[var(--pos-accent)] block">
                        {amount(Money.toMinor(product.sellingPrice))}
                      </span>
                      <span className="text-[9px] text-[var(--pos-text-3)] block">
                        per {product.unitAbbr}
                      </span>
                    </div>

                    {isOutOfStock ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCheckingProduct(product);
                        }}
                        className="btn btn-ghost text-[10px] h-6 px-1.5 text-signal-amber"
                        title="Check other branches"
                      >
                        <Building2 className="size-3" />
                      </button>
                    ) : (
                      <div className="size-6 rounded-md bg-[var(--pos-raised)] text-[var(--pos-text-2)] flex items-center justify-center group-hover:bg-[var(--pos-accent)] group-hover:text-black transition-colors">
                        <Plus className="size-3.5" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Check Other Branches Modal ── */}
      {checkingProduct && (
        <CheckBranchesModal
          product={checkingProduct}
          open={!!checkingProduct}
          onClose={() => {
            setCheckingProduct(null);
            inputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}
