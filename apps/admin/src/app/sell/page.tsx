"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Banknote,
  Building2,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  FileText,
  Landmark,
  Loader2,
  Minus,
  Package,
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
  type PaymentMethod,
  type TaxMode,
} from "@devsfleet/shared-types";
import { Money, calculateDocument } from "@devsfleet/shared-utils";
import { api, apiDownload, printBlob, saveBlob } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

/**
 * The back-office sales terminal.
 *
 * A counter sale rung up from the admin panel rather than a till — a phone
 * order, a trade customer invoiced from the office, a walk-in served while the
 * POS is down. It posts to the very same `POST /sales` the terminals use, with
 * `source: "admin"`, so the document, the stock movement and the tax figures
 * are indistinguishable from any other sale except in where they came from.
 *
 * NO CASH. Deliberately.
 * ----------------------
 * A cash sale belongs to a drawer. Every till sale carries a `cashSessionId`,
 * and that is what makes a day-close reconcile: counted notes against recorded
 * cash sales. This page has no drawer to name, so a cash tender here would be
 * money the system says was taken and no register is accountable for — the
 * branch comes up short at close, every day, by an amount nobody can trace.
 * Card, transfer and cheque all settle away from the drawer, so they are safe
 * to take from a desk. Cash stays at the till.
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
  method: Exclude<PaymentMethod, "cash" | "loyalty_points">;
  amount: string;
  reference: string;
}

const NON_CASH_METHODS: Array<{
  method: Tender["method"];
  label: string;
  icon: typeof CreditCard;
  referenceLabel: string;
}> = [
  { method: "card", label: "Card", icon: CreditCard, referenceLabel: "Terminal auth code" },
  { method: "bank_transfer", label: "Bank transfer", icon: Landmark, referenceLabel: "Transfer reference" },
  { method: "cheque", label: "Cheque", icon: FileText, referenceLabel: "Cheque number" },
];

const BRANCH_KEY = "devsfleet_sell_branch";

/** How many variants the catalogue pane holds, browsing or searching. */
const BROWSE_LIMIT = 24;

// ── Money helpers ────────────────────────────────────────────────────────────

function money(minor: Money.Minor4, currency: string): string {
  return `${currency} ${Money.toDecimalString(minor, 2)}`;
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
  const { user, tokens } = useAuth();
  const accessToken = tokens?.accessToken;

  // Tenant money rules. Defaults stand in until /tenant answers, so the first
  // paint is never wrong by more than the tenant's own configuration.
  const [taxMode, setTaxMode] = useState<TaxMode>(DEFAULT_TENANT_SETTINGS.tax.mode);
  const [decimals, setDecimals] = useState(DEFAULT_TENANT_SETTINGS.currency.decimals);
  const [currency, setCurrency] = useState(DEFAULT_TENANT_SETTINGS.currency.base);
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

  /**
   * The idempotency key for the sale currently being rung up.
   *
   * Minted when the cart stops being empty and held until that cart is
   * actually banked. A checkout that times out can therefore be retried on the
   * same key, and the server returns the original invoice instead of writing a
   * second one — the same protection the terminals get from their outbox.
   */
  const localIdRef = useRef<string | null>(null);

  // ── Tenant settings + branches ─────────────────────────────────────────────

  useEffect(() => {
    if (!accessToken) return;
    void (async () => {
      try {
        const tenant = await api.get<{
          settings: {
            tax: { mode: TaxMode; defaultRate: number | string };
            currency: { base: string; decimals: number };
          };
        }>("/tenant", { accessToken });
        setTaxMode(tenant.settings.tax.mode);
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
           * There is no drawer behind this page, and saying otherwise is what
           * breaks a day-close. Sent explicitly rather than omitted so the
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <ShoppingCart className="size-5 text-primary" />
            Sales Terminal
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Ring up a sale from the office. Posts the same document a POS terminal would.
          </p>
        </div>

        {/* Branch — the one decision this page will not make for you. Parked
            in the header rather than a card of its own: it is set once and
            then only glanced at, so it earns a corner, not a row. */}
        <div className="flex items-center gap-2">
          <BranchMenu
            branches={branches}
            branchId={branchId}
            cartHasLines={lines.length > 0}
            onChoose={chooseBranch}
          />

          {lines.length > 0 && (
            <Button variant="outline" size="sm" onClick={resetCart}>
              <RotateCcw className="size-3.5" />
              Clear cart
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
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

      {!branchId ? (
        <Card className="flex flex-col items-center justify-center gap-2 p-12 text-center">
          <Building2 className="size-8 text-muted-foreground/50" />
          <p className="text-sm font-semibold">Choose a branch to start</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Use the branch menu at the top right. Stock comes out of the branch you pick
            and the sale is booked against it, so nothing is preselected on your behalf.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_24rem] xl:grid-cols-[1fr_27rem]">
          {/* ── Catalogue ──────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, SKU or barcode…"
                className="h-11 pl-9 text-sm"
                autoFocus
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
            </div>

            {results.length === 0 ? (
              <Card className="flex flex-col items-center justify-center gap-2 p-10 text-center">
                <Package className="size-7 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {searching
                    ? "Loading the catalogue…"
                    : query.trim()
                      ? `Nothing matches “${query.trim()}” at ${activeBranch?.name ?? "this branch"}.`
                      : `No priced products at ${activeBranch?.name ?? "this branch"} yet.`}
                </p>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {query.trim() ? "Matches" : "Catalogue"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {/* An exactly-full page is almost certainly truncated, and
                        saying so is what tells the operator to keep typing
                        rather than conclude the item is not stocked. */}
                    {results.length}
                    {results.length === BROWSE_LIMIT ? "+ shown · search to narrow" : " shown"}
                  </span>
                </div>

                <div className="divide-y divide-border">
                {results.map((variant) => {
                  const stock = Number(variant.stock);
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      onClick={() => addVariant(variant)}
                      disabled={stock <= 0}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                        stock > 0
                          ? "cursor-pointer hover:bg-accent"
                          : "cursor-not-allowed opacity-50",
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
                          {variant.categoryName && <span>· {variant.categoryName}</span>}
                        </p>
                      </div>

                      <div className="shrink-0 text-right">
                        <p className="font-mono text-sm font-semibold">
                          {money(Money.toMinor(variant.sellingPrice), currency)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          per {variant.unitAbbr}
                        </p>
                      </div>

                      <Badge
                        variant={stock > 0 ? "success" : "destructive"}
                        className="shrink-0 font-mono"
                      >
                        {stock > 0 ? `${trimQty(stock)} ${variant.unitAbbr}` : "Out"}
                      </Badge>
                    </button>
                  );
                })}
                </div>
              </Card>
            )}
          </div>

          {/* ── Cart ───────────────────────────────────────────────────── */}
          <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Cart
                </span>
                <span className="text-xs text-muted-foreground">
                  {lines.length} {lines.length === 1 ? "line" : "lines"}
                </span>
              </div>

              {lines.length === 0 ? (
                <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                  Click a product on the left to add it.
                </p>
              ) : (
                <ul className="max-h-[22rem] divide-y divide-border overflow-y-auto">
                  {lines.map((line) => (
                    <CartRow
                      key={line.key}
                      line={line}
                      units={unitsByVariant[line.variant.id] ?? []}
                      currency={currency}
                      onQuantity={(v) => setQuantity(line.key, v)}
                      onNudge={(d) => nudgeQuantity(line.key, d)}
                      onUnit={(u) => setLineUnit(line.key, u)}
                      onPrice={(v) =>
                        patchLine(line.key, { unitPrice: decimalOnly(v) })
                      }
                      onResetPrice={() =>
                        patchLine(line.key, {
                          unitPrice: listPriceFor(line.variant, line.unit),
                        })
                      }
                      onDiscount={(v) =>
                        patchLine(line.key, { discountPercent: percentOnly(v) })
                      }
                      onRemove={() => removeLine(line.key)}
                    />
                  ))}
                </ul>
              )}
            </Card>

            {/* Customer */}
            <Card className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Customer
                  </p>
                  {customer ? (
                    <>
                      <p className="truncate text-sm font-medium">{customer.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {customer.company ? `${customer.company} · ` : ""}
                        Balance {money(Money.toMinor(customer.creditBalance), currency)} of{" "}
                        {money(Money.toMinor(customer.creditLimit), currency)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">Walk-in</p>
                  )}
                </div>
                <div className="flex shrink-0 gap-1">
                  {customer && (
                    <Button variant="ghost" size="icon" onClick={() => setCustomer(null)}>
                      <X className="size-3.5" />
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setCustomerPickerOpen(true)}>
                    <UserRound className="size-3.5" />
                    {customer ? "Change" : "Attach"}
                  </Button>
                </div>
              </div>
            </Card>

            {/* Totals */}
            <Card className="space-y-2 p-3">
              <div className="flex items-center gap-2">
                <label
                  htmlFor="doc-discount"
                  className="flex-1 text-xs font-medium text-muted-foreground"
                >
                  Whole-sale discount %
                </label>
                <Input
                  id="doc-discount"
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
                className="h-8 text-xs"
                maxLength={1000}
              />

              <div className="space-y-1 border-t border-border pt-2 text-xs">
                <TotalRow label="Subtotal" value={money(totals.subtotal, currency)} />
                {Money.isPositive(totals.discountAmount) && (
                  <TotalRow
                    label="Discount"
                    value={`− ${money(totals.discountAmount, currency)}`}
                  />
                )}
                <TotalRow label="Tax" value={money(totals.taxAmount, currency)} />
                <div className="flex items-baseline justify-between border-t border-border pt-1.5">
                  <span className="text-sm font-semibold">Total</span>
                  <span className="font-mono text-lg font-bold">
                    {money(totals.total, currency)}
                  </span>
                </div>
              </div>

              {belowFloor.length > 0 && (
                <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-600 dark:text-amber-400">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {belowFloor.length === 1 ? "One line is" : `${belowFloor.length} lines are`}{" "}
                    priced below the floor. The server will refuse the sale unless your role
                    carries <span className="font-mono">price:override_floor</span>.
                  </span>
                </p>
              )}

              <Button
                className="h-10 w-full"
                disabled={!canCheckout}
                onClick={() => {
                  setError(null);
                  setPaymentOpen(true);
                }}
              >
                <Receipt className="size-4" />
                Take payment · {money(totals.total, currency)}
              </Button>

              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <Banknote className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Card, transfer, cheque or on account. Cash belongs to a till drawer, so it
                  is taken at the POS — never here.
                </span>
              </p>
            </Card>
          </div>
        </div>
      )}

      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        total={totals.total}
        currency={currency}
        customer={customer}
        committing={committing}
        /* A refusal has to be readable where the operator is looking — the
           banner on the page behind is covered by this very dialog. */
        error={error}
        onConfirm={commit}
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
      />

      <ReceiptDialog
        sale={receipt}
        currency={currency}
        accessToken={accessToken}
        onClose={() => {
          setReceipt(null);
          searchRef.current?.focus();
        }}
      />
    </div>
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
      <span className="font-mono">{value}</span>
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
  const [method, setMethod] = useState<Tender["method"]>("card");
  const [amountInput, setAmountInput] = useState("");
  const [reference, setReference] = useState("");

  useEffect(() => {
    if (open) {
      setTenders([]);
      setMethod("card");
      setAmountInput("");
      setReference("");
    }
  }, [open]);

  const taken = tenders.reduce<Money.Minor4>(
    (sum, t) => Money.add(sum, Money.toMinor(t.amount || "0")),
    0n,
  );
  const outstanding = Money.max(Money.subtract(total, taken), 0n);
  const settled = !Money.isPositive(outstanding);

  const pending = amountInput.trim() ? Money.toMinor(amountInput) : outstanding;
  const active = NON_CASH_METHODS.find((m) => m.method === method)!;

  /**
   * A non-cash tender cannot exceed what is owed — the API refuses it, and it
   * is right to: change comes out of a drawer, and overcharging a card is not
   * change, it is an overcharge with nothing recorded to explain it.
   */
  const overTender = pending > outstanding;

  function addTender() {
    if (!Money.isPositive(pending) || overTender) return;
    setTenders((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        method,
        amount: Money.toDecimalString(pending, 2),
        reference: reference.trim(),
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Take payment</DialogTitle>
          <DialogDescription>
            {money(total, currency)} due. Cash is not offered here — it belongs to a till
            drawer, and a drawerless cash sale is what makes a day-close come up short.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {NON_CASH_METHODS.map(({ method: value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setMethod(value)}
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

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label htmlFor="tender-amount" className="mb-1 block text-xs font-medium">
                Amount ({currency})
              </label>
              <Input
                id="tender-amount"
                value={amountInput}
                onChange={(e) => setAmountInput(decimalOnly(e.target.value, 2))}
                onKeyDown={(e) => e.key === "Enter" && addTender()}
                inputMode="decimal"
                placeholder={Money.toDecimalString(outstanding, 2)}
                className="text-right font-mono"
              />
            </div>
            <div>
              <label htmlFor="tender-ref" className="mb-1 block text-xs font-medium">
                {active.referenceLabel}
              </label>
              <Input
                id="tender-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={100}
              />
            </div>
          </div>

          {overTender && (
            <p className="text-[11px] text-destructive">
              A {active.label.toLowerCase()} payment cannot exceed the{" "}
              {money(outstanding, currency)} still owed.
            </p>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={addTender}
            disabled={!Money.isPositive(pending) || overTender}
          >
            <Plus className="size-3.5" />
            Add {money(pending, currency)} {active.label.toLowerCase()}
          </Button>

          {tenders.length > 0 && (
            <ul className="space-y-1 border-t border-border pt-2">
              {tenders.map((tender) => {
                const meta = NON_CASH_METHODS.find((m) => m.method === tender.method);
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
                    <span className="font-mono font-semibold">
                      {money(Money.toMinor(tender.amount), currency)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setTenders((c) => c.filter((t) => t.id !== tender.id))}
                      aria-label="Remove payment"
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
            <TotalRow label="Taken" value={money(taken, currency)} />
            <div className="flex items-baseline justify-between border-t border-border pt-1.5">
              <span className="font-semibold">{settled ? "Settled" : "On account"}</span>
              <span
                className={cn(
                  "font-mono text-sm font-bold",
                  settled ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
                )}
              >
                {money(outstanding, currency)}
              </span>
            </div>
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
}: {
  open: boolean;
  onClose: () => void;
  onPick: (customer: Customer) => void;
  accessToken: string | undefined;
  currency: string;
}) {
  const [term, setTerm] = useState("");
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
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Attach a customer</DialogTitle>
          <DialogDescription>
            Needed for anything left unpaid, and for loyalty and contract pricing.
          </DialogDescription>
        </DialogHeader>

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
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Receipt ──────────────────────────────────────────────────────────────────

function ReceiptDialog({
  sale,
  currency,
  accessToken,
  onClose,
}: {
  sale: SaleReceipt | null;
  currency: string;
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
            <TotalRow label="Tax" value={money(Money.toMinor(sale.taxAmount), currency)} />
            <TotalRow label="Paid" value={money(Money.toMinor(sale.paidAmount), currency)} />
            {Money.isPositive(due) && (
              <TotalRow label="On account" value={money(due, currency)} />
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
