import { Package, ScanBarcode, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Money } from "@devsfleet/shared-utils";
import { amount, quantity as fmtQuantity } from "../lib/money.js";
import { posData, type PosProduct } from "../lib/pos-data.js";

/**
 * Catalogue search.
 *
 * Searches the LOCAL mirror, never the API — a terminal must find a product
 * with the network down. Results are keyboard-navigable because the fastest
 * cashiers never leave the keyboard: type three letters, arrow down, Enter.
 *
 * Debounced at 120ms. Long enough to avoid a query per keystroke across 5,000
 * SKUs, short enough that it still feels immediate at counter typing speed.
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
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

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
        setResults(found);
        setHighlighted(0);
        setLoading(false);
      });
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Keep the highlighted row on screen when arrowing through a long list.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

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
        onPick(product);
        setQuery("");
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
          aria-hidden
        />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          className="field pl-10 text-base"
          placeholder="Scan a barcode, or type a name or SKU"
          aria-label="Search products"
          autoComplete="off"
          spellCheck={false}
        />
        <ScanBarcode
          className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-600"
          aria-hidden
        />
      </div>

      <ul
        ref={listRef}
        className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1"
        aria-label="Search results"
      >
        {results.map((product, index) => {
          const stock = Number(product.stock);
          const active = index === highlighted;

          return (
            <li key={product.id} data-index={index}>
              <button
                type="button"
                onClick={() => {
                  onPick(product);
                  setQuery("");
                  inputRef.current?.focus();
                }}
                onMouseEnter={() => setHighlighted(index)}
                className={[
                  "flex w-full items-center gap-4 rounded-lg border px-3.5 py-3 text-left transition-colors",
                  active
                    ? "border-brass/50 bg-brass/8"
                    : "border-steel-700 bg-steel-850 hover:bg-steel-800",
                ].join(" ")}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{product.name}</div>
                  <div className="mt-0.5 flex items-center gap-2.5 text-[11px]">
                    <span className="num text-zinc-500">{product.sku}</span>
                    {product.categoryName && (
                      <span className="text-zinc-600">{product.categoryName}</span>
                    )}
                    <span
                      className={
                        stock <= 0
                          ? "text-signal-red"
                          : stock < 20
                            ? "text-signal-amber"
                            : "text-zinc-500"
                      }
                    >
                      {stock <= 0
                        ? "Out of stock"
                        : `${fmtQuantity(product.stock)} ${product.unitAbbr} in stock`}
                    </span>
                  </div>
                </div>

                <div className="text-right">
                  <div className="num text-[15px] font-semibold">
                    {amount(Money.toMinor(product.sellingPrice))}
                  </div>
                  <div className="text-[10px] text-zinc-500">per {product.unitAbbr}</div>
                </div>
              </button>
            </li>
          );
        })}

        {!loading && results.length === 0 && (
          <li className="flex flex-col items-center gap-2 py-14 text-center">
            <Package className="size-7 text-steel-700" aria-hidden />
            <p className="text-[13px] text-zinc-500">
              {query ? `Nothing matches "${query}"` : "The catalogue is empty"}
            </p>
            {query && (
              <p className="text-[12px] text-zinc-600">
                Check the spelling, or scan the barcode instead.
              </p>
            )}
          </li>
        )}
      </ul>
    </div>
  );
}
