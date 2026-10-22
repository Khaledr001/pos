"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Banknote,
  Building2,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  FileText,
  Landmark,
  LayoutGrid,
  List,
  Loader2,
  Minus,
  Package,
  Pause,
  Phone,
  Plus,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  ShieldAlert,
  ShoppingCart,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import {
  DEFAULT_TENANT_SETTINGS,
  hasPermission,
  type Permission,
  type PaymentMethod,
  type TaxMode,
} from "@devsfleet/shared-types";
import { Money, calculateDocument } from "@devsfleet/shared-utils";
import { api, apiDownload, printBlob, saveBlob } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import {
  addHeldCart,
  heldCartsKey,
  parseHeldCarts,
  reconcileHeldLines,
  removeHeldCart,
  serializeHeldCarts,
  type HeldCart,
  type HeldUnit,
  type HeldVariant,
} from "@/lib/held-carts";
import { cn } from "@/lib/utils";
import { HeldCartsDialog, type ResumeMode } from "./held-carts-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * The back-office sales terminal.
 *
 * A counter sale rung up from the admin panel rather than a till — a phone
 * order, a trade customer invoiced from the office, a walk-in served while the
 * POS is down. It posts to the very same `POST /sales` the terminals use, with
 * `source: "admin"`, so the document, the stock movement and the tax figures
 * are indistinguishable from any other sale except in where they came from.
 *
 * Cash is taken here WITHOUT a drawer — a business decision, made knowing
 * the cost.
 * -------------------------------------------------------------------------
 * A till's cash sale carries a `cashSessionId`, and that is what a day-close
 * reconciles: counted notes against recorded cash sales. This page sends no
 * session, so its cash is recorded on the sale and in the cash totals, but
 * belongs to no drawer — it will not appear in any drawer's expected amount.
 * Whoever takes cash at the office desk is accountable for it outside the
 * day-close count. If that ever needs to reconcile, the fix is to open a
 * drawer session for this page, not to drop the cash button.
 *
 * The page covers the whole window, sidebar and header included. It is a
 * counter, not a report: the room is for the catalogue and the cart.
 */

// ── Contracts ────────────────────────────────────────────────────────────────

interface Branch {
  id: string;
  name: string;
  code: string;
}

/** A row from `GET /products/search` — the same one the POS searches with. */
interface SearchVariant {
  /** The VARIANT id. This is what a sale line carries. */
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  productName: string;
  variantName: string | null;
  unitAbbr: string;
  categoryName: string | null;
  /** Null on a product that inherits the tenant's default rate. */
  taxRate: string | null;
  /** At the searched branch, in the BASE unit, always. */
  stock: string;
  sellingPrice: string;
  minSellingPrice: string | null;
}

/** A packaging from `GET /products/variants/:id/units` — a box, a roll. */
interface VariantUnit {
  id: string;
  unitId: string;
  unitName: string;
  unitAbbr: string;
  /** Base units per pack. "100" on a 100 m roll. */
  conversionFactor: string;
  priceOverride: string | null;
  isSellable: boolean;
}

interface Customer {
  id: string;
  name: string;
  company: string | null;
  phone: string | null;
  creditLimit: string;
  creditBalance: string;
  creditOnHold: boolean;
}

interface SaleReceipt {
  id: string;
  saleNumber: string;
  /** Cash handed back. Only cash can be over-tendered, so only cash produces it. */
  change?: string;
  branchId: string;
  total: string;
  paidAmount: string;
  dueAmount: string;
  subtotal: string;
  taxAmount: string;
  discountAmount: string;
  items?: Array<{ id: string; productName: string; quantity: string; total: string }>;
}

/**
 * A cart line.
 *
 * `quantity` and `unitPrice` are denominated in `unit` — 2 rolls at 340.00 the
 * roll, not 200 metres at 3.40. The server does the same and converts to base
 * units itself, which is what lets a receipt say "2 roll" instead of "200 m".
 */
interface SellLine {
  key: string;
  variant: SearchVariant;
  quantity: string;
  /** `null` is the base unit, which has no `variant_units` row at all. */
  unit: VariantUnit | null;
  unitPrice: string;
  discountPercent: string;
}

interface Tender {
  id: string;
  method: Exclude<PaymentMethod, "loyalty_points">;
  /** What was handed over. For cash this may exceed what is owed; the server keeps the difference out as change. */
  amount: string;
  reference: string;
}

const PAYMENT_METHODS: Array<{
  method: Tender["method"];
  label: string;
  icon: typeof CreditCard;
  /** Null for cash — there is nothing to reference. */
  referenceLabel: string | null;
}> = [
  { method: "cash", label: "Cash", icon: Banknote, referenceLabel: null },
  { method: "card", label: "Card", icon: CreditCard, referenceLabel: "Terminal auth code" },
  { method: "bank_transfer", label: "Bank transfer", icon: Landmark, referenceLabel: "Transfer reference" },
  { method: "cheque", label: "Cheque", icon: FileText, referenceLabel: "Cheque number" },
];

const BRANCH_KEY = "devsfleet_sell_branch";
const VIEW_KEY = "devsfleet_sell_view";

type CatalogueView = "list" | "grid";

/** How many variants the catalogue pane holds, browsing or searching. */
const BROWSE_LIMIT = 24;

// ── Money helpers ────────────────────────────────────────────────────────────

/**
 * Grouped thousands, always two decimals.
 *
 * `toDecimalString` alone gives "12450.00", and a wholesale total of five or
 * six figures is genuinely hard to read ungrouped — the difference between
 * 12,450.00 and 124,500.00 is one glance at a comma, or a careful digit count
 * without one.
 */
function money(minor: Money.Minor4, currency: string): string {
  const plain = Money.toDecimalString(minor, 2);
  const sign = plain.startsWith("-") ? "-" : "";
  const [whole = "0", fraction = "00"] = plain.replace("-", "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}${currency} ${grouped}.${fraction}`;
}

/** What one `line.unit` costs at list: a flat pack price, else base × factor. */
function listPriceFor(variant: SearchVariant, unit: VariantUnit | null): string {
  if (unit?.priceOverride) return unit.priceOverride;
  if (!unit) return variant.sellingPrice;
  return Money.toDecimalString(
    Money.multiplyByQuantity(Money.toMinor(variant.sellingPrice), unit.conversionFactor),
    4,
  );
}

/**
 * Is this line being sold away from its list price?
 *
 * Compared by VALUE rather than tracked as an "edited" flag. A flag drifts
 * from the truth the moment somebody types a figure back to what it already
 * was: the row would still badge as repriced, and — worse — the request would
 * still carry an explicit `unitPrice`, which suppresses the server's own
 * quantity-break ladder. One derived answer keeps the badge and the payload
 * from ever disagreeing.
 */
function isRepriced(line: SellLine): boolean {
  return (
    Money.toMinor(line.unitPrice || "0") !==
    Money.toMinor(listPriceFor(line.variant, line.unit))
  );
}

/** The floor scales with the packaging — a box may not be sold under cost either. */
function floorFor(variant: SearchVariant, unit: VariantUnit | null): Money.Minor4 | null {
  if (!variant.minSellingPrice) return null;
  return Money.multiplyByQuantity(
    Money.toMinor(variant.minSellingPrice),
    unit?.conversionFactor ?? "1",
  );
}

/**
 * Stock is held in the BASE unit. A quantity typed in a packaging has to be
 * scaled down from it before it means anything as a ceiling — otherwise 250 m
 * on the shelf reads as 250 sellable rolls instead of 2.5.
 */
function maxQuantityFor(line: SellLine): number {
  const stock = Number(line.variant.stock);
  if (!Number.isFinite(stock) || stock <= 0) return 0;
  const factor = line.unit ? Number(line.unit.conversionFactor) : 1;
  if (!Number.isFinite(factor) || factor <= 0) return stock;
  return stock / factor;
}

function trimQty(value: number): string {
  return String(Number(value.toFixed(4)));
}

/**
 * Every numeric field on this page holds raw text, and `Money.toMinor` throws
 * a TypeError on anything that is not a decimal. Thrown from inside a render —
 * which is where the totals are computed — that is a blank page, not a
 * validation message. So the character set is constrained on the way in and
 * the money helpers only ever see something they can parse.
 *
 * Partial input ("", "3.", ".5") is deliberately allowed through: `toMinor`
 * reads all three as a number, and rejecting them would make the field
 * impossible to type a decimal into.
 */
function decimalOnly(raw: string, maxDecimals = 4): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const [whole = "", ...rest] = cleaned.split(".");
  return rest.length > 0 ? `${whole}.${rest.join("").slice(0, maxDecimals)}` : whole;
}

/** Same, capped at 100 — the API's own ceiling, so the preview cannot show a
 *  total the server would never agree to. */
function percentOnly(raw: string): string {
  const clean = decimalOnly(raw, 2);
  return Number(clean) > 100 ? "100" : clean;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SellPage() {
  const { user, tokens, isImpersonating } = useAuth();
  const accessToken = tokens?.accessToken;
  const router = useRouter();

  // Tenant money rules. Defaults stand in until /tenant answers, so the first
  // paint is never wrong by more than the tenant's own configuration.
  const [taxMode, setTaxMode] = useState<TaxMode>(DEFAULT_TENANT_SETTINGS.tax.mode);
  const [decimals, setDecimals] = useState(DEFAULT_TENANT_SETTINGS.currency.decimals);
  const [currency, setCurrency] = useState(DEFAULT_TENANT_SETTINGS.currency.base);
  const [taxLabel, setTaxLabel] = useState(DEFAULT_TENANT_SETTINGS.tax.label);
  const [defaultTaxRate, setDefaultTaxRate] = useState(
    String(DEFAULT_TENANT_SETTINGS.tax.defaultRate),
  );

  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState<string>("");

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchVariant[]>([]);
  const [searching, setSearching] = useState(false);

  const [lines, setLines] = useState<SellLine[]>([]);
  /** Packagings, once fetched, keyed by variant id. `[]` means "base unit only". */
  const [unitsByVariant, setUnitsByVariant] = useState<Record<string, VariantUnit[]>>({});

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);

  const [documentDiscount, setDocumentDiscount] = useState("0");
  const [notes, setNotes] = useState("");

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SaleReceipt | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  /** List or grid, remembered per browser — it is a habit, not a per-sale choice. */
  const [view, setView] = useState<CatalogueView>("list");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(VIEW_KEY);
      if (stored === "list" || stored === "grid") setView(stored);
    } catch {
      // Storage blocked: the default stands.
    }
  }, []);
  function chooseView(next: CatalogueView) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Not worth telling anyone about.
    }
  }

  /**
   * The terminal is drawn over the whole window from `document.body`, so the
   * app shell's sidebar and header sit underneath it. Portalled only after
   * mount — there is no `document` on the server — and the page behind is
   * kept from scrolling under a wheel that was meant for the catalogue.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const [exitOpen, setExitOpen] = useState(false);

  /**
   * Below lg the cart is a drawer rather than a pane — the catalogue needs
   * the whole width of a phone. Closed again if the window widens past lg,
   * where the pane is back and an open drawer would show the cart twice.
   */
  const [cartOpen, setCartOpen] = useState(false);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)");
    const onChange = () => wide.matches && setCartOpen(false);
    wide.addEventListener("change", onChange);
    return () => wide.removeEventListener("change", onChange);
  }, []);

  function leave() {
    if (window.history.length > 1) router.back();
    else router.push("/");
  }

  /** Leaving with a cart asks first — the cart lives only in this page. */
  function requestExit() {
    if (lines.length === 0) leave();
    else setExitOpen(true);
  }

  /**
   * Which result the keyboard is on.
   *
   * -1 means "nothing chosen yet", which is not the same as "row 0": a scan
   * arrives as a burst of keystrokes followed by Enter, and it must commit the
   * exact barcode match rather than whatever happens to be highlighted.
   */
  const [activeIndex, setActiveIndex] = useState(-1);

  /**
   * The idempotency key for the sale currently being rung up.
   *
   * Minted when the cart stops being empty and held until that cart is
   * actually banked. A checkout that times out can therefore be retried on the
   * same key, and the server returns the original invoice instead of writing a
   * second one — the same protection the terminals get from their outbox.
   */
  const localIdRef = useRef<string | null>(null);

  // ── Held (parked) carts ────────────────────────────────────────────────────

  const [held, setHeld] = useState<HeldCart[]>([]);
  const [heldOpen, setHeldOpen] = useState(false);
  const [resuming, setResuming] = useState(false);
  /** Non-error feedback: what changed when a parked cart was brought back. */
  const [notices, setNotices] = useState<string[]>([]);

  const heldKey =
    user?.tenantId && user.id && branchId ? heldCartsKey(user.tenantId, user.id, branchId) : null;

  // ── Tenant settings + branches ─────────────────────────────────────────────

  useEffect(() => {
    if (!accessToken) return;
    void (async () => {
      try {
        const tenant = await api.get<{
          settings: {
            tax: { mode: TaxMode; defaultRate: number | string; label: string };
            currency: { base: string; decimals: number };
          };
        }>("/tenant", { accessToken });
        setTaxMode(tenant.settings.tax.mode);
        setTaxLabel(tenant.settings.tax.label);
        setDefaultTaxRate(String(tenant.settings.tax.defaultRate));
        setCurrency(tenant.settings.currency.base);
        setDecimals(tenant.settings.currency.decimals);
      } catch {
        // Defaults already loaded. A settings read failing is not a reason to
        // refuse to sell — the server recomputes every total anyway.
      }
    })();
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken) return;
    void (async () => {
      try {
        const res = await api.get<{ items: Branch[] }>("/branches", { accessToken });
        const items = res.items ?? [];
        setBranches(items);

        /**
         * Never guessed. A tenant-wide admin is scoped to every branch, so
         * "the first one" would be an arbitrary shop to book stock out of —
         * and the mistake is invisible until someone counts the shelves.
         *
         * The operator's OWN branch is not a guess, and neither is the one
         * they last chose here, so those two are allowed to preselect.
         */
        const remembered =
          typeof window !== "undefined" ? localStorage.getItem(BRANCH_KEY) : null;
        const preselect =
          (remembered && items.some((b) => b.id === remembered) && remembered) ||
          (user?.branchId && items.some((b) => b.id === user.branchId) && user.branchId) ||
          (items.length === 1 ? items[0]!.id : "");
        if (preselect) setBranchId(preselect);
      } catch (err: any) {
        setError(err?.message || "Could not load branches.");
      }
    })();
  }, [accessToken, user?.branchId]);

  function chooseBranch(id: string) {
    setBranchId(id);
    if (typeof window !== "undefined") localStorage.setItem(BRANCH_KEY, id);
    // Prices and stock are both branch-dependent; keeping a cart across a
    // branch change would sell one shop's stock at another's price list.
    if (lines.length > 0) resetCart();
    setResults([]);
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  /**
   * Runs on an empty box too, which is what puts a browsable catalogue on
   * screen the moment a branch is chosen.
   *
   * `q` defaults to "" server-side and every match filter is skipped when
   * there are no tokens, so the endpoint falls through to `ORDER BY sku` —
   * the same priced, in-scope, active rows a search returns, just unfiltered.
   * A single character is no longer swallowed either: it was refused here for
   * no reason the server shares.
   *
   * The 250ms debounce is kept for the empty case as well. It costs nothing
   * perceptible on first paint and it means switching branch twice in quick
   * succession fires one request, not two.
   */
  useEffect(() => {
    if (!accessToken || !branchId) return;
    const term = query.trim();

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const rows = await api.get<SearchVariant[]>("/products/search", {
            accessToken,
            query: {
              q: term,
              branchId,
              limit: BROWSE_LIMIT,
              ...(customer ? { customerId: customer.id } : {}),
            },
          });
          if (!cancelled) setResults(rows ?? []);
        } catch (err: any) {
          if (!cancelled) setError(err?.message || "Search failed.");
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, branchId, accessToken, customer]);

  // Any new result set invalidates the old highlight position.
  useEffect(() => {
    setActiveIndex(-1);
  }, [results]);

  /**
   * The scan loop: type or scan, press Enter, line added, box cleared, focus
   * kept. A barcode scanner is a keyboard that types a code and sends Enter,
   * so supporting it is entirely a matter of handling that Enter — which this
   * page previously did not, making it unusable with the one input device a
   * sales counter actually has.
   */
  function commitSearch() {
    if (results.length === 0) return;
    const term = query.trim().toLowerCase();

    /*
     * An exact barcode or SKU beats the highlight and beats relevance order.
     * A scanned code is unambiguous — resolving it to "whatever ranked first"
     * is how the wrong product ends up on an invoice.
     */
    const exact =
      term.length > 0
        ? results.find(
            (r) => r.barcode?.toLowerCase() === term || r.sku.toLowerCase() === term,
          )
        : undefined;

    const chosen = exact ?? results[activeIndex >= 0 ? activeIndex : 0];
    if (!chosen) return;
    if (Number(chosen.stock) <= 0) {
      setError(`${chosen.productName} has no stock at this branch.`);
      return;
    }

    addVariant(chosen);
    // Cleared so the next scan starts from nothing rather than appending to
    // the last code; focus never leaves the box.
    setQuery("");
    setActiveIndex(-1);
    searchRef.current?.focus();
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitSearch();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setActiveIndex((current) => {
        const next =
          event.key === "ArrowDown"
            ? Math.min(current + 1, results.length - 1)
            : Math.max(current - 1, 0);
        resultsRef.current
          ?.querySelector(`[data-index="${next}"]`)
          ?.scrollIntoView({ block: "nearest" });
        return next;
      });
      return;
    }
    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
      setActiveIndex(-1);
    }
  }

  // ── Cart ───────────────────────────────────────────────────────────────────

  const loadUnits = useCallback(
    async (variantId: string) => {
      if (!accessToken || unitsByVariant[variantId]) return;
      try {
        const rows = await api.get<VariantUnit[]>(`/products/variants/${variantId}/units`, {
          accessToken,
        });
        setUnitsByVariant((current) => ({
          ...current,
          [variantId]: (rows ?? []).filter((u) => u.isSellable),
        }));
      } catch {
        setUnitsByVariant((current) => ({ ...current, [variantId]: [] }));
      }
    },
    [accessToken, unitsByVariant],
  );

  function addVariant(variant: SearchVariant) {
    setError(null);

    if (Number(variant.stock) <= 0) {
      setError(`${variant.productName} has no stock at this branch.`);
      return;
    }

    localIdRef.current ??= crypto.randomUUID();
    void loadUnits(variant.id);

    setLines((current) => {
      // Same variant, same packaging, untouched price and no discount: one
      // line with a bigger number reads better than two identical rows.
      const existing = current.find(
        (l) =>
          l.variant.id === variant.id &&
          !l.unit &&
          !isRepriced(l) &&
          l.discountPercent === "0",
      );

      if (existing) {
        const ceiling = maxQuantityFor(existing);
        const next = Math.min(Number(existing.quantity) + 1, ceiling);
        if (next <= Number(existing.quantity)) return current;
        return current.map((l) =>
          l.key === existing.key ? { ...l, quantity: trimQty(next) } : l,
        );
      }

      return [
        ...current,
        {
          key: crypto.randomUUID(),
          variant,
          quantity: "1",
          unit: null,
          unitPrice: variant.sellingPrice,
          discountPercent: "0",
        },
      ];
    });
  }

  function patchLine(key: string, patch: Partial<SellLine>) {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function setQuantity(key: string, raw: string) {
    const clean = decimalOnly(raw);
    const parsed = Number(clean);
    setLines((current) =>
      current.map((l) => {
        if (l.key !== key) return l;
        // Mid-typing values ("", "2.") are kept verbatim — clamping them would
        // fight the operator's keystrokes. The commit path re-checks anyway.
        if (!Number.isFinite(parsed) || parsed <= 0) return { ...l, quantity: clean };
        return { ...l, quantity: trimQty(Math.min(parsed, maxQuantityFor(l))) };
      }),
    );
  }

  function nudgeQuantity(key: string, delta: number) {
    const line = lines.find((l) => l.key === key);
    if (!line) return;
    const next = Number(line.quantity) + delta;
    if (next <= 0) {
      removeLine(key);
      return;
    }
    setQuantity(key, String(next));
  }

  /** Switching packaging re-lists the price; an override does not survive it. */
  function setLineUnit(key: string, unit: VariantUnit | null) {
    setLines((current) =>
      current.map((l) => {
        if (l.key !== key) return l;
        const next = { ...l, unit, unitPrice: listPriceFor(l.variant, unit) };
        const ceiling = maxQuantityFor(next);
        return { ...next, quantity: trimQty(Math.min(Number(next.quantity) || 1, ceiling)) };
      }),
    );
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((l) => l.key !== key));
  }

  /**
   * `results` is deliberately NOT cleared here. The search effect owns it, and
   * clearing it when `query` is already "" leaves an empty catalogue that
   * nothing will refill — no dependency changed, so the effect never re-runs.
   * Same branch, same rows: they are still correct.
   */
  function resetCart() {
    setLines([]);
    setCustomer(null);
    setDocumentDiscount("0");
    setNotes("");
    setQuery("");
    setError(null);
    localIdRef.current = null;
  }

  // ── Totals ─────────────────────────────────────────────────────────────────

  /**
   * From `calculateDocument`, never hand-rolled. The API runs this exact
   * function on the same inputs, so the figure on screen and the figure on the
   * invoice cannot drift apart.
   */
  const totals = useMemo(
    () =>
      calculateDocument({
        taxMode,
        decimals,
        documentDiscountPercent: documentDiscount || "0",
        lines: lines.map((l) => ({
          quantity: Number(l.quantity) > 0 ? l.quantity : "0",
          unitPrice: l.unitPrice || "0",
          discountPercent: l.discountPercent || "0",
          taxPercent: l.variant.taxRate ?? defaultTaxRate,
        })),
      }),
    [lines, documentDiscount, taxMode, decimals, defaultTaxRate],
  );

  /** Lines priced under the floor. The server refuses these without approval. */
  const belowFloor = useMemo(
    () =>
      lines.filter((l) => {
        const floor = floorFor(l.variant, l.unit);
        if (floor === null) return false;
        const unit = Money.toMinor(l.unitPrice || "0");
        const effective = unit - Money.percentOf(unit, l.discountPercent || "0");
        return effective < floor;
      }),
    [lines],
  );

  const invalidQuantities = lines.some(
    (l) => !Number.isFinite(Number(l.quantity)) || Number(l.quantity) <= 0,
  );

  const canCheckout =
    Boolean(branchId) && lines.length > 0 && !invalidQuantities && Money.isPositive(totals.total);

  // ── Held carts ─────────────────────────────────────────────────────────────

  /**
   * Every mutation re-reads storage first. Another tab on the same branch can
   * park or resume at any moment, and writing back this tab's remembered list
   * would silently undo what it did.
   */
  function readHeld(): HeldCart[] {
    if (!heldKey) return [];
    try {
      return parseHeldCarts(localStorage.getItem(heldKey));
    } catch {
      return [];
    }
  }

  function writeHeld(next: HeldCart[]): boolean {
    if (!heldKey) return false;
    try {
      localStorage.setItem(heldKey, serializeHeldCarts(next));
    } catch {
      setError("Held carts could not be saved — browser storage is full or blocked.");
      return false;
    }
    setHeld(next);
    return true;
  }

  useEffect(() => {
    setHeld(readHeld());
    if (!heldKey) return;
    // `storage` fires only in OTHER tabs, which is exactly the sync wanted.
    function onStorage(event: StorageEvent) {
      if (event.key === heldKey || event.key === null) setHeld(readHeld());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldKey]);

  /** The live cart as a parkable record — its own clientId travels with it. */
  function snapshotCart(): HeldCart {
    return {
      id: crypto.randomUUID(),
      heldAt: new Date().toISOString(),
      clientId: localIdRef.current ?? crypto.randomUUID(),
      branchId,
      customer,
      lines: lines.map((l) => ({
        variant: l.variant,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
      })),
      documentDiscount,
      notes,
      total: Money.toDecimalString(totals.total, 2),
    };
  }

  function holdCart(): boolean {
    if (!heldKey || lines.length === 0) return false;
    setError(null);
    const result = addHeldCart(readHeld(), snapshotCart());
    if (!result.ok) {
      setError(
        result.reason === "full"
          ? "Held carts are full. Resume or delete one before holding another."
          : "There is nothing in the cart to hold.",
      );
      return false;
    }
    if (!writeHeld(result.carts)) return false;
    // resetCart drops localIdRef, so the next cart mints its own key and a
    // retry of the parked sale can never be mistaken for it.
    resetCart();
    setNotices(["Cart held. Find it under Held carts."]);
    searchRef.current?.focus();
    return true;
  }

  /**
   * Bring a parked cart back, re-checked against the catalogue as it is now.
   *
   * Nothing local is touched until every lookup has answered: if prices cannot
   * be re-read, the cart stays parked and the live cart stays as it was,
   * rather than resuming on numbers nobody has verified.
   */
  async function resumeHeld(target: HeldCart, mode: ResumeMode) {
    if (!accessToken || !branchId || resuming) return;
    setResuming(true);
    setError(null);
    try {
      const fresh = new Map<string, HeldVariant>();
      const freshUnits = new Map<string, HeldUnit[]>();
      const variantIds = [...new Set(target.lines.map((l) => l.variant.id))];

      const lookups = await Promise.allSettled([
        ...target.lines
          .filter((l, i, all) => all.findIndex((x) => x.variant.id === l.variant.id) === i)
          .map(async (l) => {
            const rows = await api.get<SearchVariant[]>("/products/search", {
              accessToken,
              query: {
                q: l.variant.sku,
                branchId,
                limit: 50,
                ...(target.customer ? { customerId: target.customer.id } : {}),
              },
            });
            const match = (rows ?? []).find((r) => r.id === l.variant.id);
            if (match) fresh.set(match.id, match);
          }),
        ...target.lines
          .filter((l) => l.unit)
          .map(async (l) => {
            const rows = await api.get<VariantUnit[]>(
              `/products/variants/${l.variant.id}/units`,
              { accessToken },
            );
            freshUnits.set(
              l.variant.id,
              (rows ?? []).filter((u) => u.isSellable),
            );
          }),
      ]);
      if (lookups.some((r) => r.status === "rejected")) {
        setError("Could not re-check prices and stock, so the cart was not resumed. Try again.");
        return;
      }

      let customerNow: Customer | null = target.customer;
      if (target.customer) {
        try {
          customerNow = await api.get<Customer>(`/customers/${target.customer.id}`, {
            accessToken,
          });
        } catch {
          // Keep the parked snapshot; the server enforces credit at checkout.
        }
      }

      const { lines: kept, notices: changes } = reconcileHeldLines(
        target.lines,
        fresh,
        freshUnits,
        listPriceFor,
        (a, b) => Money.toMinor(a || "0") === Money.toMinor(b || "0"),
      );

      // Re-read, because another tab may have resumed or deleted it meanwhile.
      const stored = readHeld();
      if (!stored.some((c) => c.id === target.id)) {
        setError("That held cart is gone — it was resumed or deleted in another tab.");
        return;
      }
      let next = removeHeldCart(stored, target.id);
      if (mode === "park-current" && lines.length > 0) {
        // Swapping one for one cannot overflow the cap, but check anyway.
        const parked = addHeldCart(next, snapshotCart());
        if (!parked.ok) {
          setError("Could not hold the current cart. Delete a held cart first.");
          return;
        }
        next = parked.carts;
      }
      if (!writeHeld(next)) return;

      localIdRef.current = kept.length > 0 ? target.clientId : null;
      setLines(kept.map((l) => ({ ...l, key: crypto.randomUUID() })));
      setCustomer(customerNow);
      setDocumentDiscount(target.documentDiscount);
      setNotes(target.notes);
      setQuery("");
      for (const l of kept) void loadUnits(l.variant.id);

      setNotices(
        kept.length === 0
          ? [...changes, "No items from that cart could be resumed."]
          : changes.length > 0
            ? changes
            : ["Cart resumed. Prices and stock are unchanged."],
      );
      setHeldOpen(false);
    } finally {
      setResuming(false);
    }
  }

  function deleteHeld(target: HeldCart) {
    writeHeld(removeHeldCart(readHeld(), target.id));
  }

  // F8 parks the cart, or opens the list when the counter is empty — the same
  // reading the POS gives it. Refs keep the one window listener current.
  const hotkeyRef = useRef<() => void>(() => {});
  hotkeyRef.current = () => {
    if (!branchId || paymentOpen || customerPickerOpen || receipt || heldOpen || exitOpen || cartOpen) return;
    if (lines.length === 0) setHeldOpen(true);
    else holdCart();
  };
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "F8" || event.repeat) return;
      event.preventDefault();
      hotkeyRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Commit ─────────────────────────────────────────────────────────────────

  const [committing, setCommitting] = useState(false);

  async function commit(tenders: Tender[]) {
    if (!accessToken || !branchId) return;
    setCommitting(true);
    setError(null);

    localIdRef.current ??= crypto.randomUUID();

    try {
      const sale = await api.post<SaleReceipt>(
        "/sales",
        {
          branchId,
          customerId: customer?.id ?? null,
          /**
           * No drawer behind this page — cash included, by decision (see the
           * top of the file). Sent explicitly rather than omitted so the
           * intent is legible in the request itself.
           */
          cashSessionId: null,
          source: "admin",
          localId: localIdRef.current,
          lines: lines.map((l) => ({
            variantId: l.variant.id,
            quantity: Number(l.quantity),
            ...(l.unit ? { unitId: l.unit.unitId } : {}),
            /* Sent only when moved off list. Omitting it lets the server's
               own ladder price the line, so a quantity break still applies
               and a price changed since this page loaded is not overridden
               by a stale figure. */
            ...(isRepriced(l) ? { unitPrice: l.unitPrice } : {}),
            ...(Number(l.discountPercent) > 0
              ? { discountPercent: Number(l.discountPercent) }
              : {}),
          })),
          payments: tenders
            .filter((t) => Number(t.amount) > 0)
            .map((t) => ({
              method: t.method,
              amount: Number(t.amount),
              ...(t.reference.trim() ? { reference: t.reference.trim() } : {}),
            })),
          ...(Number(documentDiscount) > 0
            ? { documentDiscountPercent: Number(documentDiscount) }
            : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        { accessToken },
      );

      setReceipt(sale);
      setPaymentOpen(false);
      // Only now is the key spent — a failure above leaves it intact so a
      // retry lands on the same invoice rather than a second one.
      localIdRef.current = null;
      setLines([]);
      setCustomer(null);
      setDocumentDiscount("0");
      setNotes("");
      setQuery("");
      // `results` is left standing — see resetCart. The next sale starts on
      // the same catalogue rather than a blank pane.
    } catch (err: any) {
      setError(err?.message || "The sale was refused.");
    } finally {
      setCommitting(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const activeBranch = branches.find((b) => b.id === branchId) ?? null;
  const lineCount = lines.length;

  const cartLines =
    lineCount === 0 ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-center">
        <ShoppingCart className="size-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Scan or pick a product to start the sale.</p>
      </div>
    ) : (
      <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
        {lines.map((line) => (
          <CartRow
            key={line.key}
            line={line}
            units={unitsByVariant[line.variant.id] ?? []}
            currency={currency}
            onQuantity={(v) => setQuantity(line.key, v)}
            onNudge={(d) => nudgeQuantity(line.key, d)}
            onUnit={(u) => setLineUnit(line.key, u)}
            onPrice={(v) => patchLine(line.key, { unitPrice: decimalOnly(v) })}
            onResetPrice={() => patchLine(line.key, { unitPrice: listPriceFor(line.variant, line.unit) })}
            onDiscount={(v) => patchLine(line.key, { discountPercent: percentOnly(v) })}
            onRemove={() => removeLine(line.key)}
          />
        ))}
      </ul>
    );

  /** Discount and note. `where` keeps the input id unique while the pane and the drawer both exist. */
  const cartExtras = (where: "pane" | "drawer") => (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`doc-discount-${where}`} className="flex-1 text-xs font-medium text-muted-foreground">
          Whole-sale discount %
        </label>
        <Input
          id={`doc-discount-${where}`}
          value={documentDiscount}
          onChange={(e) => setDocumentDiscount(percentOnly(e.target.value))}
          inputMode="decimal"
          className="h-8 w-20 text-right font-mono text-xs"
        />
      </div>
      <Input
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Note on the invoice (optional)"
        aria-label="Note on the invoice"
        className="h-8 text-xs"
        maxLength={1000}
      />
    </div>
  );

  function openPayment() {
    setError(null);
    setCartOpen(false);
    setPaymentOpen(true);
  }

  const terminal = (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      aria-label="Sales terminal"
    >
      {/* ── Top bar: who is selling, where, and to whom ─────────────────── */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-card px-3 py-2 sm:px-4">
        {/* Phone: title and exit share the first row, branch and actions the
            second, the customer the third. From lg it is one row, in reading
            order, with exit last. */}
        <div className="order-1 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShoppingCart className="size-4.5" />
          </span>
          <div className="leading-tight">
            <h1 className="text-sm font-bold tracking-tight">Sales Terminal</h1>
            <p className="max-w-40 truncate text-[11px] text-muted-foreground">{user?.name}</p>
          </div>
        </div>

        {/* Branch — the one decision this page will not make for you. */}
        <div className="order-3 lg:order-2">
          <BranchMenu
            branches={branches}
            branchId={branchId}
            cartHasLines={lineCount > 0}
            onChoose={chooseBranch}
          />
        </div>

        {isImpersonating && (
          <span className="order-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
            Impersonating
          </span>
        )}

        {/* Customer. On narrow screens it drops to a row of its own under
            the controls rather than squeezing them. */}
        <div className="order-5 w-full lg:order-4 lg:w-auto lg:min-w-0 lg:flex-1">
          <CustomerBar
            customer={customer}
            currency={currency}
            onChange={() => setCustomerPickerOpen(true)}
            onClear={() => setCustomer(null)}
          />
        </div>

        <div className="order-4 ml-auto flex items-center gap-1.5 lg:order-5 lg:ml-0">
          {branchId && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={lineCount === 0 || !heldKey}
                onClick={holdCart}
                title="Park this cart and clear the counter (F8)"
              >
                <Pause className="size-3.5" />
                <span className="hidden sm:inline">Hold</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!heldKey}
                onClick={() => setHeldOpen(true)}
                aria-label={`Held carts, ${held.length} on hold`}
              >
                <span className="hidden sm:inline">Held</span>
                <Badge variant={held.length > 0 ? "default" : "secondary"} className="px-1.5 py-0">
                  {held.length}
                </Badge>
              </Button>
            </>
          )}
          {lineCount > 0 && (
            <Button variant="outline" size="sm" onClick={resetCart} title="Clear cart">
              <RotateCcw className="size-3.5" />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          )}
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={requestExit}
          aria-label="Exit sales terminal"
          title="Exit sales terminal"
          className="order-2 ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive lg:order-6 lg:ml-0"
        >
          <X className="size-5" />
        </Button>
      </header>

      {(error || notices.length > 0) && (
        <div className="shrink-0 space-y-2 border-b border-border px-3 py-2 sm:px-4">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label="Dismiss"
                className="cursor-pointer rounded p-0.5 hover:bg-destructive/10"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
          {notices.length > 0 && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-sm text-amber-700 dark:text-amber-400"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <ul className="flex-1 space-y-0.5">
                {notices.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setNotices([])}
                aria-label="Dismiss"
                className="cursor-pointer rounded p-0.5 hover:bg-amber-500/10"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      {!branchId ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
          <Building2 className="size-10 text-muted-foreground/50" />
          <p className="text-base font-semibold">Choose a branch to start</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Use the branch menu at the top. Stock comes out of the branch you pick and the
            sale is booked against it, so nothing is preselected on your behalf.
          </p>
        </div>
      ) : (
        /* 60 / 40. Each pane scrolls on its own on a wide screen, so a long
           cart never pushes the catalogue out of reach; below lg they stack
           and the page scrolls as one. */
        <main className="min-h-0 flex-1 overflow-y-auto lg:grid lg:grid-cols-[3fr_2fr] lg:overflow-hidden">
          {/* ── Catalogue ──────────────────────────────────────────────── */}
          <section aria-label="Catalogue" className="flex flex-col lg:min-h-0 lg:border-r lg:border-border">
            <div className="shrink-0 space-y-1.5 p-3 sm:p-4 sm:pb-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onSearchKeyDown}
                    placeholder="Scan a barcode, or search by name or SKU…"
                    aria-label="Search products"
                    aria-describedby="sell-search-help"
                    className="h-11 pl-9 pr-10 text-sm"
                    autoFocus
                  />
                  {searching && (
                    <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>

                <div role="group" aria-label="Catalogue layout" className="flex shrink-0 rounded-lg border border-input p-0.5">
                  {(
                    [
                      { value: "list", label: "List view", icon: List },
                      { value: "grid", label: "Grid view", icon: LayoutGrid },
                    ] as const
                  ).map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => chooseView(value)}
                      aria-pressed={view === value}
                      aria-label={label}
                      title={label}
                      className={cn(
                        "flex w-10 cursor-pointer items-center justify-center rounded-md transition-colors",
                        view === value
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
                {/* Named where they are used, not hidden in a help screen. */}
                <p id="sell-search-help" className="hidden sm:block">
                  <Kbd>Enter</Kbd> adds · <Kbd>↑</Kbd> <Kbd>↓</Kbd> choose · <Kbd>Esc</Kbd> clears ·{" "}
                  <Kbd>F8</Kbd> hold
                </p>
                {results.length > 0 && (
                  <span className="ml-auto tabular-nums">
                    {/* An exactly-full page is almost certainly truncated, and
                        saying so is what tells the operator to keep typing
                        rather than conclude the item is not stocked. */}
                    {results.length}
                    {results.length === BROWSE_LIMIT ? "+ shown · search to narrow" : " shown"}
                  </span>
                )}
              </div>
            </div>

            <div className="px-3 pb-3 sm:px-4 sm:pb-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
              {results.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
                  <Package className="size-7 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    {searching
                      ? "Loading the catalogue…"
                      : query.trim()
                        ? `Nothing matches “${query.trim()}” at ${activeBranch?.name ?? "this branch"}.`
                        : `No priced products at ${activeBranch?.name ?? "this branch"} yet.`}
                  </p>
                </div>
              ) : view === "list" ? (
                <div ref={resultsRef} className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {results.map((variant, index) => {
                    const stock = Number(variant.stock);
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        data-index={index}
                        onClick={() => addVariant(variant)}
                        disabled={stock <= 0}
                        className={cn(
                          "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                          stock > 0 ? "cursor-pointer hover:bg-accent" : "cursor-not-allowed opacity-50",
                          /* Keyboard highlight is an inset ring, not a background:
                             the row already uses background for hover, and two
                             meanings on one property cannot both be read. */
                          index === activeIndex && "bg-accent ring-2 ring-inset ring-primary",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {variant.productName}
                            {variant.variantName && (
                              <span className="text-muted-foreground"> · {variant.variantName}</span>
                            )}
                          </p>
                          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span className="font-mono">{variant.sku}</span>
                            {variant.categoryName && <span className="truncate">· {variant.categoryName}</span>}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="font-mono text-sm font-semibold tabular-nums">
                            {money(Money.toMinor(variant.sellingPrice), currency)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">per {variant.unitAbbr}</p>
                        </div>
                        <StockBadge variant={variant} />
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div
                  ref={resultsRef}
                  className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4"
                >
                  {results.map((variant, index) => {
                    const stock = Number(variant.stock);
                    return (
                      <button
                        key={variant.id}
                        type="button"
                        data-index={index}
                        onClick={() => addVariant(variant)}
                        disabled={stock <= 0}
                        className={cn(
                          "flex min-h-32 flex-col gap-2 rounded-xl border border-border bg-card p-3 text-left shadow-xs transition-colors",
                          stock > 0
                            ? "cursor-pointer hover:border-primary/50 hover:bg-accent"
                            : "cursor-not-allowed opacity-50",
                          index === activeIndex && "border-primary ring-2 ring-primary",
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm font-medium leading-snug">
                            {variant.productName}
                            {variant.variantName && (
                              <span className="text-muted-foreground"> · {variant.variantName}</span>
                            )}
                          </p>
                          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{variant.sku}</p>
                        </div>
                        <div className="flex items-end justify-between gap-2">
                          <p className="font-mono text-sm font-bold tabular-nums">
                            {money(Money.toMinor(variant.sellingPrice), currency)}
                            <span className="block font-sans text-[10px] font-normal text-muted-foreground">
                              per {variant.unitAbbr}
                            </span>
                          </p>
                          <StockBadge variant={variant} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* ── Cart ───────────────────────────────────────────────────── */}
          <section aria-label="Cart" className="hidden min-h-0 flex-col bg-secondary/20 lg:flex">
            <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5 sm:px-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cart</span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {lineCount} {lineCount === 1 ? "line" : "lines"}
              </span>
            </div>

            {cartLines}
            <div className="shrink-0 border-t border-border bg-card px-3 py-2.5 sm:px-4">
              {cartExtras("pane")}
            </div>
          </section>
        </main>
      )}

      {/* ── Bottom bar: the figures and the one way forward ──────────────── */}
      <footer className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-t border-border bg-card px-3 py-2.5 sm:px-4">
        <dl className="flex flex-1 flex-wrap items-center gap-x-6 gap-y-1 text-xs">
          <BarFigure label="Items" value={String(lineCount)} />
          <BarFigure label="Subtotal" value={money(totals.subtotal, currency)} />
          {Money.isPositive(totals.discountAmount) && (
            <BarFigure label="Discount" value={`− ${money(totals.discountAmount, currency)}`} />
          )}
          <BarFigure label={taxLabel} value={money(totals.taxAmount, currency)} />
          <div className="flex items-baseline gap-2">
            <dt className="text-sm font-semibold">Total</dt>
            <dd className="font-mono text-xl font-bold tabular-nums">{money(totals.total, currency)}</dd>
          </div>
        </dl>

        {belowFloor.length > 0 && (
          <p
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400"
            title="The server refuses a sale below the floor price unless your role carries price:override_floor."
          >
            <ShieldAlert className="size-3.5 shrink-0" />
            {belowFloor.length === 1 ? "1 line below floor" : `${belowFloor.length} lines below floor`}
          </p>
        )}

        <div className="flex w-full gap-2 sm:w-auto">
          {branchId && (
            <Button
              variant="outline"
              size="lg"
              className="relative h-12 shrink-0 px-4 lg:hidden"
              onClick={() => setCartOpen(true)}
              aria-label={`Open cart, ${lineCount} ${lineCount === 1 ? "line" : "lines"}`}
            >
              <ShoppingCart className="size-5" />
              <span className="hidden sm:inline">Cart</span>
              {lineCount > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold tabular-nums text-primary-foreground">
                  {lineCount}
                </span>
              )}
            </Button>
          )}
          <Button
            size="lg"
            className="h-12 flex-1 text-base sm:min-w-56 sm:flex-none"
            disabled={!canCheckout}
            onClick={openPayment}
          >
            <Receipt className="size-5" />
            Charge {money(totals.total, currency)}
          </Button>
        </div>
      </footer>
    </div>
  );

  if (!mounted) return null;

  return createPortal(
    <>
      {terminal}

      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent className="max-w-[min(28rem,92vw)] sm:max-w-md md:max-w-md lg:max-w-md">
          <SheetHeader className="py-3">
            <SheetTitle>Cart</SheetTitle>
            <SheetDescription className="text-xs">
              {lineCount} {lineCount === 1 ? "line" : "lines"}
              {customer ? ` · ${customer.name}` : " · Walk-in customer"}
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="flex flex-col p-0 sm:px-0">{cartLines}</SheetBody>
          <SheetFooter className="flex-col gap-3 sm:flex-col sm:justify-start">
            {cartExtras("drawer")}
            <div className="space-y-1 border-t border-border pt-2 text-xs">
              <TotalRow label="Subtotal" value={money(totals.subtotal, currency)} />
              {Money.isPositive(totals.discountAmount) && (
                <TotalRow label="Discount" value={`− ${money(totals.discountAmount, currency)}`} />
              )}
              <TotalRow label={taxLabel} value={money(totals.taxAmount, currency)} />
              <div className="flex items-baseline justify-between border-t border-border pt-1.5">
                <span className="text-sm font-semibold">Total</span>
                <span className="font-mono text-lg font-bold tabular-nums">{money(totals.total, currency)}</span>
              </div>
            </div>
            <Button size="lg" className="h-12 w-full text-base" disabled={!canCheckout} onClick={openPayment}>
              <Receipt className="size-5" />
              Charge {money(totals.total, currency)}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        total={totals.total}
        currency={currency}
        customer={customer}
        committing={committing}
        /* A refusal has to be readable where the operator is looking — the
           banner behind is covered by this very dialog. */
        error={error}
        onConfirm={commit}
      />

      <HeldCartsDialog
        open={heldOpen}
        onOpenChange={setHeldOpen}
        carts={held}
        liveCartHasLines={lineCount > 0}
        busy={resuming}
        error={error}
        formatTotal={(c) => money(Money.toMinor(c.total), currency)}
        onResume={(c, mode) => void resumeHeld(c, mode)}
        onDelete={deleteHeld}
      />

      <CustomerPicker
        open={customerPickerOpen}
        onClose={() => setCustomerPickerOpen(false)}
        onPick={(c) => {
          setCustomer(c);
          setCustomerPickerOpen(false);
        }}
        accessToken={accessToken}
        currency={currency}
        canCreate={hasPermission((user?.permissions ?? []) as Permission[], "customer:write")}
      />

      <ReceiptDialog
        sale={receipt}
        currency={currency}
        taxLabel={taxLabel}
        accessToken={accessToken}
        onClose={() => {
          setReceipt(null);
          searchRef.current?.focus();
        }}
      />

      <Dialog open={exitOpen} onOpenChange={setExitOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Leave the sales terminal?</DialogTitle>
            <DialogDescription>
              The cart has {lineCount} {lineCount === 1 ? "line" : "lines"} and lives only on this
              page. Hold it to pick it up later, or discard it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setExitOpen(false)}>
              Stay
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setExitOpen(false);
                resetCart();
                leave();
              }}
            >
              Discard and leave
            </Button>
            {heldKey && (
              <Button
                onClick={() => {
                  setExitOpen(false);
                  if (holdCart()) leave();
                }}
              >
                <Pause className="size-4" />
                Hold and leave
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>,
    document.body,
  );
}

function BarFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function StockBadge({ variant }: { variant: SearchVariant }) {
  const stock = Number(variant.stock);
  return (
    <Badge variant={stock > 0 ? "success" : "destructive"} className="shrink-0 font-mono">
      {stock > 0 ? `${trimQty(stock)} ${variant.unitAbbr}` : "Out"}
    </Badge>
  );
}

/**
 * Who the sale is for, across the top. Credit is what decides whether an
 * unpaid balance can go on their account, so it is shown before anything is
 * rung up rather than discovered at payment.
 */
function CustomerBar({
  customer,
  currency,
  onChange,
  onClear,
}: {
  customer: Customer | null;
  currency: string;
  onChange: () => void;
  onClear: () => void;
}) {
  const available = customer
    ? Money.max(
        Money.subtract(Money.toMinor(customer.creditLimit), Money.toMinor(customer.creditBalance)),
        0n,
      )
    : 0n;

  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background px-3 py-1.5">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          customer ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground",
        )}
      >
        <UserRound className="size-4" />
      </span>

      {customer ? (
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <span className="truncate">{customer.name}</span>
            {customer.company && (
              <span className="hidden truncate font-normal text-muted-foreground sm:inline">· {customer.company}</span>
            )}
            {customer.creditOnHold && (
              <Badge variant="destructive" className="shrink-0 px-1.5 py-0 text-[10px]">
                Credit on hold
              </Badge>
            )}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
            {customer.phone && (
              <span className="inline-flex items-center gap-1">
                <Phone className="size-3" />
                {customer.phone}
              </span>
            )}
            <span className="tabular-nums">
              Balance {money(Money.toMinor(customer.creditBalance), currency)} of{" "}
              {money(Money.toMinor(customer.creditLimit), currency)}
            </span>
            <span className="tabular-nums font-medium text-foreground">
              Available {money(available, currency)}
            </span>
          </p>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Walk-in customer</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Attach a customer to sell on account or earn loyalty.
          </p>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-1">
        {customer && (
          <Button variant="ghost" size="icon" onClick={onClear} aria-label="Remove customer" className="size-8">
            <X className="size-3.5" />
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onChange}>
          <UserRound className="size-3.5" />
          {customer ? "Change" : "Attach"}
        </Button>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-secondary px-1 py-px font-mono text-[10px] font-medium text-foreground">
      {children}
    </kbd>
  );
}

// ── Branch menu ──────────────────────────────────────────────────────────────

/**
 * Which branch the sale comes out of, as a header dropdown.
 *
 * Styled as unmistakably ACTIVE when nothing is chosen — this is the one
 * control the page will not decide on your behalf, and a quiet outline button
 * reads as optional chrome rather than the thing standing between you and a
 * sale.
 */
function BranchMenu({
  branches,
  branchId,
  cartHasLines,
  onChoose,
}: {
  branches: Branch[];
  branchId: string;
  cartHasLines: boolean;
  onChoose: (id: string) => void;
}) {
  const active = branches.find((b) => b.id === branchId) ?? null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={branches.length === 0}
          className={cn(
            "gap-2",
            !active && branches.length > 0 && "border-primary text-primary",
          )}
        >
          <Building2 className="size-3.5" />
          <span className="max-w-40 truncate">
            {branches.length === 0
              ? "Loading branches…"
              : (active?.name ?? "Choose a branch")}
          </span>
          {active && (
            <span className="font-mono text-[10px] opacity-60">{active.code}</span>
          )}
          <ChevronDown className="size-3.5 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Selling from
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuRadioGroup value={branchId} onValueChange={onChoose}>
          {branches.map((branch) => (
            <DropdownMenuRadioItem key={branch.id} value={branch.id}>
              <span className="flex-1 truncate">{branch.name}</span>
              <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                {branch.code}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        {cartHasLines && (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
              Switching branch clears the cart — stock and prices are per branch.
            </p>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Cart row ─────────────────────────────────────────────────────────────────

function CartRow({
  line,
  units,
  currency,
  onQuantity,
  onNudge,
  onUnit,
  onPrice,
  onResetPrice,
  onDiscount,
  onRemove,
}: {
  line: SellLine;
  units: VariantUnit[];
  currency: string;
  onQuantity: (value: string) => void;
  onNudge: (delta: number) => void;
  onUnit: (unit: VariantUnit | null) => void;
  onPrice: (value: string) => void;
  onResetPrice: () => void;
  onDiscount: (value: string) => void;
  onRemove: () => void;
}) {
  const unitLabel = line.unit?.unitAbbr ?? line.variant.unitAbbr;
  const ceiling = maxQuantityFor(line);
  const atCeiling = Number(line.quantity) >= ceiling;

  const listPrice = Money.toMinor(listPriceFor(line.variant, line.unit));
  const repriced = isRepriced(line);
  const raised = Money.toMinor(line.unitPrice || "0") > listPrice;

  const lineTotal = useMemo(() => {
    const gross = Money.multiplyByQuantity(
      Money.toMinor(line.unitPrice || "0"),
      Number(line.quantity) > 0 ? line.quantity : "0",
    );
    return gross - Money.percentOf(gross, line.discountPercent || "0");
  }, [line.unitPrice, line.quantity, line.discountPercent]);

  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{line.variant.productName}</p>
          <p className="truncate font-mono text-[11px] text-muted-foreground">
            {line.variant.sku}
          </p>
        </div>
        <span className="shrink-0 font-mono text-sm font-semibold">
          {money(lineTotal, currency)}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${line.variant.productName}`}
          className="shrink-0 cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Quantity */}
        <div className="flex items-center rounded-lg border border-input">
          <button
            type="button"
            onClick={() => onNudge(-1)}
            aria-label="Decrease quantity"
            className="cursor-pointer px-1.5 py-1 text-muted-foreground hover:text-foreground"
          >
            <Minus className="size-3" />
          </button>
          <input
            value={line.quantity}
            onChange={(e) => onQuantity(e.target.value)}
            inputMode="decimal"
            aria-label="Quantity"
            className="w-14 border-0 bg-transparent text-center font-mono text-xs focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onNudge(1)}
            disabled={atCeiling}
            aria-label="Increase quantity"
            className="cursor-pointer px-1.5 py-1 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Plus className="size-3" />
          </button>
        </div>

        {/* Packaging. Only offered when the product actually has one. */}
        {units.length > 0 ? (
          <select
            value={line.unit?.unitId ?? ""}
            onChange={(e) =>
              onUnit(e.target.value ? (units.find((u) => u.unitId === e.target.value) ?? null) : null)
            }
            aria-label="Unit"
            className="h-7 cursor-pointer rounded-lg border border-input bg-transparent px-1.5 text-xs"
          >
            <option value="">{line.variant.unitAbbr}</option>
            {units.map((u) => (
              <option key={u.id} value={u.unitId}>
                {u.unitAbbr} ({u.conversionFactor} {line.variant.unitAbbr})
              </option>
            ))}
          </select>
        ) : (
          <span className="px-1 text-xs text-muted-foreground">{unitLabel}</span>
        )}

        {/* Unit price — type what you are actually charging, either direction */}
        <div className="flex items-center gap-1">
          <input
            value={line.unitPrice}
            onChange={(e) => onPrice(e.target.value)}
            onFocus={(e) => e.target.select()}
            inputMode="decimal"
            aria-label={`Unit price of ${line.variant.productName}`}
            title={
              repriced
                ? `Edited — list is ${money(listPrice, currency)}`
                : "Sell at a different price — type it here"
            }
            className={cn(
              "h-7 w-20 rounded-lg border bg-transparent px-1.5 text-right font-mono text-xs",
              repriced ? "border-primary font-semibold text-primary" : "border-input",
            )}
          />
          {repriced && (
            <button
              type="button"
              onClick={onResetPrice}
              title={`Restore list price ${money(listPrice, currency)}`}
              aria-label="Restore list price"
              className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="size-3" />
            </button>
          )}
        </div>

        {/* Line discount */}
        <div className="flex items-center rounded-lg border border-input">
          <input
            value={line.discountPercent}
            onChange={(e) => onDiscount(e.target.value)}
            inputMode="decimal"
            aria-label="Line discount percent"
            className="w-10 border-0 bg-transparent px-1 text-right font-mono text-xs focus:outline-none"
          />
          <span className="pr-1.5 text-[10px] text-muted-foreground">%</span>
        </div>
      </div>

      {/* Which way the price was moved, and from what. Kept on the row rather
          than only in a tooltip so a mistyped figure is visible at a glance. */}
      {repriced && (
        <p
          className={cn(
            "text-[10px] font-medium",
            raised ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400",
          )}
        >
          {raised ? "▲ Above" : "▼ Below"} list {money(listPrice, currency)} per {unitLabel}
        </p>
      )}

      {atCeiling && (
        <p className="text-[10px] text-muted-foreground">
          All {trimQty(ceiling)} {unitLabel} in stock at this branch.
        </p>
      )}
    </li>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

// ── Payment ──────────────────────────────────────────────────────────────────

function PaymentDialog({
  open,
  onClose,
  total,
  currency,
  customer,
  committing,
  error,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  total: Money.Minor4;
  currency: string;
  customer: Customer | null;
  committing: boolean;
  error: string | null;
  onConfirm: (tenders: Tender[]) => void | Promise<void>;
}) {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [method, setMethod] = useState<Tender["method"]>("cash");
  const [amountInput, setAmountInput] = useState("");
  const [reference, setReference] = useState("");
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTenders([]);
      setMethod("cash");
      setAmountInput("");
      setReference("");
    }
  }, [open]);

  /** What was handed over, cash over-tender included. */
  const tendered = tenders.reduce<Money.Minor4>(
    (sum, t) => Money.add(sum, Money.toMinor(t.amount || "0")),
    0n,
  );
  const outstanding = Money.max(Money.subtract(total, tendered), 0n);
  /** Only cash can be over-tendered, so whatever exceeds the total is change. */
  const change = Money.max(Money.subtract(tendered, total), 0n);
  const settled = !Money.isPositive(outstanding);

  const pending = amountInput.trim() ? Money.toMinor(amountInput) : outstanding;
  const active = PAYMENT_METHODS.find((m) => m.method === method)!;
  const isCash = method === "cash";

  /**
   * A non-cash tender cannot exceed what is owed — the API refuses it, and it
   * is right to: overcharging a card is not change, it is an overcharge with
   * nothing recorded to explain it. Cash may exceed it; the rest is change.
   */
  const overTender = !isCash && pending > outstanding;

  /** "Exact", then the next round notes up — what a customer actually hands over. */
  const quickCash = useMemo(() => {
    if (!Money.isPositive(outstanding)) return [];
    const amounts = [outstanding];
    for (const step of ["10", "50", "100", "500"]) {
      const unit = Money.toMinor(step);
      const rounded = ((outstanding + unit - 1n) / unit) * unit;
      if (rounded > outstanding && !amounts.includes(rounded)) amounts.push(rounded);
    }
    return amounts.slice(0, 4);
  }, [outstanding]);

  function addTender(amount: Money.Minor4 = pending) {
    if (!Money.isPositive(amount) || settled) return;
    if (!isCash && amount > outstanding) return;
    setTenders((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        method,
        amount: Money.toDecimalString(amount, 2),
        reference: isCash ? "" : reference.trim(),
      },
    ]);
    setAmountInput("");
    setReference("");
  }

  /** The unpaid remainder goes on the customer's account, not into a payment row. */
  const onAccount = !settled;
  const accountBlocked = onAccount && !customer;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg" onOpenAutoFocus={(e) => {
        e.preventDefault();
        amountRef.current?.focus();
      }}>
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
          <DialogDescription>
            {money(total, currency)} due. Split it across methods if the customer pays more than one way.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {PAYMENT_METHODS.map(({ method: value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMethod(value);
                  amountRef.current?.focus();
                }}
                aria-pressed={method === value}
                className={cn(
                  "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs font-semibold transition-colors",
                  method === value
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-input text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                <Icon className="size-4" />
                {label}
              </button>
            ))}
          </div>

          <div className={cn("grid gap-2", !isCash && "sm:grid-cols-2")}>
            <div>
              <label htmlFor="tender-amount" className="mb-1 block text-xs font-medium">
                {isCash ? `Cash received (${currency})` : `Amount (${currency})`}
              </label>
              <Input
                ref={amountRef}
                id="tender-amount"
                value={amountInput}
                onChange={(e) => setAmountInput(decimalOnly(e.target.value, 2))}
                onKeyDown={(e) => e.key === "Enter" && addTender()}
                inputMode="decimal"
                placeholder={Money.toDecimalString(outstanding, 2)}
                className="h-11 text-right font-mono text-base"
              />
            </div>
            {active.referenceLabel && (
              <div>
                <label htmlFor="tender-ref" className="mb-1 block text-xs font-medium">
                  {active.referenceLabel}
                </label>
                <Input
                  id="tender-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={100}
                  className="h-11"
                />
              </div>
            )}
          </div>

          {isCash && quickCash.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {quickCash.map((amount, i) => (
                <Button
                  key={String(amount)}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="font-mono tabular-nums"
                  onClick={() => addTender(amount)}
                >
                  {i === 0 ? "Exact" : Money.toDecimalString(amount, 0)}
                </Button>
              ))}
            </div>
          )}

          {overTender && (
            <p className="text-[11px] text-destructive">
              A {active.label.toLowerCase()} payment cannot exceed the {money(outstanding, currency)} still
              owed. Only cash can be over-tendered.
            </p>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => addTender()}
            disabled={!Money.isPositive(pending) || overTender || settled}
          >
            <Plus className="size-3.5" />
            Add {money(pending, currency)} {active.label.toLowerCase()}
          </Button>

          {tenders.length > 0 && (
            <ul className="space-y-1 border-t border-border pt-2">
              {tenders.map((tender) => {
                const meta = PAYMENT_METHODS.find((m) => m.method === tender.method);
                return (
                  <li
                    key={tender.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-medium">{meta?.label}</span>
                    {tender.reference && (
                      <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
                        {tender.reference}
                      </span>
                    )}
                    <span className="ml-auto font-mono font-semibold tabular-nums">
                      {money(Money.toMinor(tender.amount), currency)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setTenders((c) => c.filter((t) => t.id !== tender.id))}
                      aria-label={`Remove ${meta?.label ?? ""} payment`}
                      className="cursor-pointer rounded p-0.5 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-1 rounded-lg border border-border bg-secondary/40 p-2.5 text-xs">
            <TotalRow label="Total due" value={money(total, currency)} />
            <TotalRow label="Tendered" value={money(tendered, currency)} />
            {Money.isPositive(change) ? (
              <div
                className="flex items-baseline justify-between border-t border-border pt-1.5"
                aria-live="polite"
              >
                <span className="font-semibold">Change due</span>
                <span className="font-mono text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {money(change, currency)}
                </span>
              </div>
            ) : (
              <div className="flex items-baseline justify-between border-t border-border pt-1.5">
                <span className="font-semibold">{settled ? "Settled" : "On account"}</span>
                <span
                  className={cn(
                    "font-mono text-sm font-bold tabular-nums",
                    settled ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {money(outstanding, currency)}
                </span>
              </div>
            )}
          </div>

          {onAccount && (
            <p
              className={cn(
                "flex items-start gap-1.5 rounded-lg border p-2 text-[11px]",
                accountBlocked
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
              )}
            >
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {accountBlocked
                  ? "An unpaid balance goes on an account, and a walk-in has none. Attach a customer or take the full amount."
                  : `${money(outstanding, currency)} will be added to ${customer!.name}’s balance. Their credit limit is checked by the server.`}
              </span>
            </p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive"
          >
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={committing}>
            Cancel
          </Button>
          <Button
            onClick={() => void onConfirm(tenders)}
            disabled={committing || accountBlocked}
            className="min-w-40"
          >
            {committing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Booking…
              </>
            ) : settled ? (
              "Complete sale"
            ) : (
              "Complete on account"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Customer picker ──────────────────────────────────────────────────────────

function CustomerPicker({
  open,
  onClose,
  onPick,
  accessToken,
  currency,
  canCreate,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (customer: Customer) => void;
  accessToken: string | undefined;
  currency: string;
  /** Hides "New customer" for staff the server would refuse anyway. The server is the control. */
  canCreate: boolean;
}) {
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);
  const emptyForm = {
    name: "", company: "", phone: "", whatsappPhone: "", email: "", trn: "", address: "",
    type: "retail" as "retail" | "wholesale" | "vip", creditLimit: "0", paymentTermDays: "0", notes: "",
  };
  const [form, setForm] = useState(emptyForm);
  const setField = (key: keyof typeof emptyForm) => (value: string) => setForm((f) => ({ ...f, [key]: value }));
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function startCreating() {
    // What was typed to search is usually the name or number of the person who turned out to be new.
    const typed = term.trim();
    const looksLikePhone = /^[+\d][\d\s-]{5,}$/.test(typed);
    setForm({ ...emptyForm, name: looksLikePhone ? "" : typed, phone: looksLikePhone ? typed : "" });
    setCreateError(null);
    setCreating(true);
  }

  async function createCustomer(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setCreateError(null);
    try {
      const created = await api.post<{ id: string }>(
        "/customers",
        {
          name: form.name.trim(),
          company: form.company.trim() || undefined,
          phone: form.phone.trim() || undefined,
          whatsappPhone: form.whatsappPhone.trim() || undefined,
          email: form.email.trim() || undefined,
          trn: form.trn.trim() || undefined,
          address: form.address.trim() || undefined,
          type: form.type,
          creditLimit: Number.parseFloat(form.creditLimit) || 0,
          paymentTermDays: Number.parseInt(form.paymentTermDays, 10) || 0,
          notes: form.notes.trim() || undefined,
        },
        { accessToken },
      );
      // Read it back so the sale holds the same shape the picker's list gives it, credit fields included.
      const customer = await api.get<Customer>(`/customers/${created.id}`, { accessToken });
      setCreating(false);
      setTerm("");
      onPick(customer);
    } catch (err: any) {
      setCreateError(err?.message || "Could not create the customer.");
    } finally {
      setSaving(false);
    }
  }
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !accessToken) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await api.get<{ items: Customer[] }>("/customers", {
            accessToken,
            query: { pageSize: 25, ...(term.trim() ? { q: term.trim() } : {}) },
          });
          if (!cancelled) setRows(res.items ?? []);
        } catch {
          if (!cancelled) setRows([]);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, term, accessToken]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setCreating(false);
          onClose();
        }
      }}
    >
      <DialogContent className={creating ? "sm:max-w-2xl" : "sm:max-w-md"}>
        <DialogHeader>
          <DialogTitle>{creating ? "New customer" : "Attach a customer"}</DialogTitle>
          <DialogDescription>
            {creating
              ? "Saved to your customer list and attached to this sale."
              : "Needed for anything left unpaid, and for loyalty and contract pricing."}
          </DialogDescription>
        </DialogHeader>

        {creating ? (
          <form onSubmit={createCustomer} className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            {createError && (
              <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {createError}
              </div>
            )}
            <div className="space-y-3 rounded-xl border border-border p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Contact information</p>
              <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="nc-name" className="mb-1.5 block text-xs font-medium text-foreground">Full name *</label>
                <Input id="nc-name" required value={form.name} onChange={(e) => setField("name")(e.target.value)} maxLength={255} autoFocus />
              </div>
              <div>
                <label htmlFor="nc-company" className="mb-1.5 block text-xs font-medium text-foreground">Company</label>
                <Input id="nc-company" value={form.company} onChange={(e) => setField("company")(e.target.value)} maxLength={255} />
              </div>
              <div>
                <label htmlFor="nc-phone" className="mb-1.5 block text-xs font-medium text-foreground">Phone</label>
                <Input id="nc-phone" value={form.phone} onChange={(e) => setField("phone")(e.target.value)} type="tel" inputMode="tel" maxLength={20} placeholder="+971 50 123 4567" />
              </div>
              <div>
                <label htmlFor="nc-whatsapp" className="mb-1.5 block text-xs font-medium text-foreground">WhatsApp number</label>
                <Input id="nc-whatsapp" value={form.whatsappPhone} onChange={(e) => setField("whatsappPhone")(e.target.value)} type="tel" inputMode="tel" maxLength={20} placeholder="+971 50 123 4567" />
              </div>
              <div>
                <label htmlFor="nc-email" className="mb-1.5 block text-xs font-medium text-foreground">Email</label>
                <Input id="nc-email" value={form.email} onChange={(e) => setField("email")(e.target.value)} type="email" maxLength={255} />
              </div>
              <div>
                <label htmlFor="nc-trn" className="mb-1.5 block text-xs font-medium text-foreground">TRN (tax registration number)</label>
                <Input id="nc-trn" value={form.trn} onChange={(e) => setField("trn")(e.target.value)} maxLength={20} className="font-mono" />
              </div>
              </div>
              <div>
                <label htmlFor="nc-address" className="mb-1.5 block text-xs font-medium text-foreground">Address</label>
                <Input id="nc-address" maxLength={1000} value={form.address} onChange={(e) => setField("address")(e.target.value)} />
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-border p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Business terms</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="nc-type" className="mb-1.5 block text-xs font-medium text-foreground">Customer type</label>
                  <select
                    id="nc-type"
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as "retail" | "wholesale" | "vip" }))}
                    className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
                  >
                    <option value="retail">Retail</option>
                    <option value="wholesale">Wholesale</option>
                    <option value="vip">VIP</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="nc-credit" className="mb-1.5 block text-xs font-medium text-foreground">Credit limit ({currency})</label>
                  <Input id="nc-credit" type="number" min="0" step="100" value={form.creditLimit} onChange={(e) => setField("creditLimit")(e.target.value)} className="font-mono" />
                </div>
                <div>
                  <label htmlFor="nc-terms" className="mb-1.5 block text-xs font-medium text-foreground">Payment terms (days)</label>
                  <Input id="nc-terms" type="number" min="0" max="365" step="1" value={form.paymentTermDays} onChange={(e) => setField("paymentTermDays")(e.target.value)} className="font-mono" />
                </div>
              </div>
              <div>
                <label htmlFor="nc-notes" className="mb-1.5 block text-xs font-medium text-foreground">Internal notes</label>
                <Input id="nc-notes" maxLength={1000} value={form.notes} onChange={(e) => setField("notes")(e.target.value)} placeholder="Any special instructions or notes…" />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>Back</Button>
              <Button type="submit" disabled={saving || !form.name.trim()}>{saving ? "Saving…" : "Save and attach"}</Button>
            </DialogFooter>
          </form>
        ) : (
        <>
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Name, company or phone…"
          autoFocus
        />

        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {loading && (
            <li className="p-4 text-center text-xs text-muted-foreground">Searching…</li>
          )}
          {!loading && rows.length === 0 && (
            <li className="p-4 text-center text-xs text-muted-foreground">
              No customers match.
            </li>
          )}
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onPick(row)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {row.company || row.phone || "—"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  {row.creditOnHold ? (
                    <Badge variant="destructive">On hold</Badge>
                  ) : (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {money(Money.toMinor(row.creditBalance), currency)}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>

        <DialogFooter>
          {canCreate && (
            <Button variant="secondary" onClick={startCreating}>
              <UserRound className="h-4 w-4" /> New customer
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Receipt ──────────────────────────────────────────────────────────────────

function ReceiptDialog({
  sale,
  currency,
  taxLabel,
  accessToken,
  onClose,
}: {
  sale: SaleReceipt | null;
  currency: string;
  taxLabel: string;
  accessToken: string | undefined;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"print" | "save" | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  async function withInvoice(action: "print" | "save") {
    if (!sale) return;
    setBusy(action);
    setPdfError(null);
    try {
      const { blob, filename } = await apiDownload(`/sales/${sale.id}/invoice`, {
        ...(accessToken ? { accessToken } : {}),
      });
      if (action === "print") printBlob(blob, sale.saleNumber);
      else saveBlob(blob, filename ?? `${sale.saleNumber}.pdf`);
    } catch (err: any) {
      // The sale is already banked; only the paper failed. Saying so keeps
      // this from reading as a failed sale.
      setPdfError(err?.message || "The sale is saved, but the invoice PDF could not be fetched.");
    } finally {
      setBusy(null);
    }
  }

  const due = sale ? Money.toMinor(sale.dueAmount) : 0n;
  const change = sale?.change ? Money.toMinor(sale.change) : 0n;

  return (
    <Dialog open={Boolean(sale)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-500" />
            Sale booked
          </DialogTitle>
          <DialogDescription>
            {sale?.saleNumber} — the stock is out and the document is on the ledger.
          </DialogDescription>
        </DialogHeader>

        {sale && (
          <div className="space-y-1 rounded-lg border border-border bg-secondary/40 p-3 text-xs">
            <TotalRow label="Subtotal" value={money(Money.toMinor(sale.subtotal), currency)} />
            <TotalRow label={taxLabel} value={money(Money.toMinor(sale.taxAmount), currency)} />
            <TotalRow label="Paid" value={money(Money.toMinor(sale.paidAmount), currency)} />
            {Money.isPositive(due) && (
              <TotalRow label="On account" value={money(due, currency)} />
            )}
            {Money.isPositive(change) && (
              <TotalRow label="Change given" value={money(change, currency)} />
            )}
            <div className="flex items-baseline justify-between border-t border-border pt-1.5">
              <span className="text-sm font-semibold">Total</span>
              <span className="font-mono text-base font-bold">
                {money(Money.toMinor(sale.total), currency)}
              </span>
            </div>
          </div>
        )}

        {pdfError && (
          <p role="alert" className="text-[11px] text-destructive">
            {pdfError}
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void withInvoice("print")} disabled={busy !== null}>
              {busy === "print" ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />}
              Print
            </Button>
            <Button variant="outline" onClick={() => void withInvoice("save")} disabled={busy !== null}>
              {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />}
              PDF
            </Button>
          </div>
          <Button onClick={onClose}>New sale</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
