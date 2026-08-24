"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Package,
  ShoppingCart,
  Users,
  FileText,
  LayoutDashboard,
  GitBranch,
  Boxes,
  Truck,
  BarChart3,
  MessageSquare,
  UserCheck,
  ShieldCheck,
  Tablet,
  ScrollText,
  Settings,
  Sun,
  Moon,
  LogOut,
  ArrowRight,
  Loader2,
  FolderTree,
  Tag,
  Wallet,
  Building2,
  Sparkles,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

// ─── Static Navigation Catalog ────────────────────────────────────────────────

interface NavAction {
  id: string;
  category: "Navigation" | "Actions";
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  keywords?: string[];
  perform?: () => void;
}

const STATIC_NAVIGATION: NavAction[] = [
  { id: "dash", category: "Navigation", title: "Dashboard", subtitle: "Overview and business metrics", icon: LayoutDashboard, href: "/" },
  { id: "products", category: "Navigation", title: "Products List", subtitle: "Catalog, variants, pricing and images", icon: Package, href: "/products", keywords: ["items", "goods", "sku", "stock"] },
  { id: "categories", category: "Navigation", title: "Categories", subtitle: "Manage product hierarchies", icon: FolderTree, href: "/categories" },
  { id: "brands", category: "Navigation", title: "Brands", subtitle: "Product brands and manufacturers", icon: Tag, href: "/brands" },
  { id: "inventory", category: "Navigation", title: "Inventory Stock", subtitle: "Stock levels, bin locations and adjustments", icon: Boxes, href: "/inventory", keywords: ["stock", "quantity", "warehouse"] },
  { id: "transfers", category: "Navigation", title: "Stock Transfers", subtitle: "Inter-branch stock movements", icon: Truck, href: "/transfers", keywords: ["move", "dispatch"] },
  { id: "sales", category: "Navigation", title: "Sales & Orders", subtitle: "Tax invoices, completed orders and receipts", icon: ShoppingCart, href: "/sales", keywords: ["invoices", "orders", "bills"] },
  { id: "quotations", category: "Navigation", title: "Quotations", subtitle: "Price quotes, estimates and conversions", icon: FileText, href: "/quotations", keywords: ["quotes", "proforma", "estimate"] },
  { id: "dayclose", category: "Navigation", title: "Day Close Registers", subtitle: "Cash registers, drawer counts and daily reconciliation", icon: Wallet, href: "/day-close", keywords: ["cash", "drawer", "shift", "reconciliation"] },
  { id: "customers", category: "Navigation", title: "Customers", subtitle: "Client database, loyalty points and credit ledgers", icon: Users, href: "/customers", keywords: ["clients", "buyers", "credit"] },
  { id: "purchases", category: "Navigation", title: "Purchase Orders", subtitle: "Procurement, goods receipts and vendor billing", icon: FileText, href: "/purchases", keywords: ["po", "procurement", "buy"] },
  { id: "suppliers", category: "Navigation", title: "Suppliers", subtitle: "Vendor records and contacts", icon: Truck, href: "/suppliers", keywords: ["vendors", "distributors"] },
  { id: "reports", category: "Navigation", title: "Reports & KPIs", subtitle: "Sales analytics, profitability and inventory valuations", icon: BarChart3, href: "/reports", keywords: ["analytics", "metrics", "financial"] },
  { id: "whatsapp", category: "Navigation", title: "WhatsApp AI Assistant", subtitle: "Automated quotes, catalog chats and inquiries", icon: MessageSquare, href: "/whatsapp", keywords: ["bot", "chat", "messages"] },
  { id: "branches", category: "Navigation", title: "Branches & Warehouses", subtitle: "Store locations and warehouses", icon: GitBranch, href: "/branches" },
  { id: "users", category: "Navigation", title: "Staff & Users", subtitle: "Employee accounts and store assignments", icon: UserCheck, href: "/users", keywords: ["staff", "employees", "cashiers"] },
  { id: "roles", category: "Navigation", title: "Roles & Permissions", subtitle: "Access control policies and security overrides", icon: ShieldCheck, href: "/roles", keywords: ["security", "access", "permissions"] },
  { id: "devices", category: "Navigation", title: "POS Terminals", subtitle: "Registered counters, tablets and receipt printers", icon: Tablet, href: "/devices", keywords: ["terminals", "hardware", "registers"] },
  { id: "audit", category: "Navigation", title: "Audit Trail", subtitle: "Immutable system activity log", icon: ScrollText, href: "/audit-log", keywords: ["logs", "activity", "history"] },
  { id: "settings", category: "Navigation", title: "Settings", subtitle: "Company info, tax settings and API configuration", icon: Settings, href: "/settings", keywords: ["config", "vat", "preferences"] },
];

// ─── Live Search Result Types ─────────────────────────────────────────────────

interface LiveProductHit {
  id: string;
  sku: string;
  productName: string;
  variantName: string;
  sellingPrice: string | null;
}

interface LiveCustomerHit {
  id: string;
  name: string;
  phone?: string | null;
  company?: string | null;
}

interface LiveSaleHit {
  id: string;
  saleNumber: string;
  totalAmount: string;
  customerName?: string | null;
}

interface LiveQuotationHit {
  id: string;
  quotationNumber: string;
  total: string;
  customerName?: string | null;
}

interface SearchItem {
  id: string;
  category: string;
  title: string;
  subtitle?: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
}

interface CommandSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery?: string;
}

export function CommandSearchDialog({
  open,
  onOpenChange,
  initialQuery = "",
}: CommandSearchProps) {
  const router = useRouter();
  const { logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  // Live entity results
  const [products, setProducts] = useState<LiveProductHit[]>([]);
  const [customers, setCustomers] = useState<LiveCustomerHit[]>([]);
  const [sales, setSales] = useState<LiveSaleHit[]>([]);
  const [quotations, setQuotations] = useState<LiveQuotationHit[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Synchronize initial query when opened
  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialQuery]);

  // Debounced live API search
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setProducts([]);
      setCustomers([]);
      setSales([]);
      setQuotations([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const [prodRes, custRes, salesRes, quoteRes] = await Promise.allSettled([
          api.get<LiveProductHit[]>("/products/search", { query: { q: trimmed, limit: 5 } }),
          api.get<{ items: LiveCustomerHit[] } | LiveCustomerHit[]>("/customers", { query: { q: trimmed, pageSize: 5 } }),
          api.get<{ items: LiveSaleHit[] } | LiveSaleHit[]>("/sales", { query: { query: trimmed, limit: 5 } }),
          api.get<{ items: LiveQuotationHit[] } | LiveQuotationHit[]>("/quotations", { query: { search: trimmed, pageSize: 5 } }),
        ]);

        if (prodRes.status === "fulfilled" && Array.isArray(prodRes.value)) {
          setProducts(prodRes.value.slice(0, 5));
        } else {
          setProducts([]);
        }

        if (custRes.status === "fulfilled") {
          const val = custRes.value;
          const list = Array.isArray(val) ? val : (val?.items ?? []);
          setCustomers(list.slice(0, 4));
        } else {
          setCustomers([]);
        }

        if (salesRes.status === "fulfilled") {
          const val = salesRes.value;
          const list = Array.isArray(val) ? val : (val?.items ?? []);
          setSales(list.slice(0, 3));
        } else {
          setSales([]);
        }

        if (quoteRes.status === "fulfilled") {
          const val = quoteRes.value;
          const list = Array.isArray(val) ? val : (val?.items ?? []);
          setQuotations(list.slice(0, 3));
        } else {
          setQuotations([]);
        }
      } catch {
        // Quietly fail for background search
      } finally {
        setLoading(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  const handleSelect = useCallback((action: () => void) => {
    onOpenChange(false);
    action();
  }, [onOpenChange]);

  // Build unified search items list
  const combinedItems: SearchItem[] = [];

  const trimmedQuery = query.toLowerCase().trim();

  // 1. Live Products
  if (products.length > 0) {
    for (const p of products) {
      combinedItems.push({
        id: `prod-${p.id}`,
        category: "Products & Stock",
        title: p.productName + (p.variantName && p.variantName !== "Default" ? ` · ${p.variantName}` : ""),
        subtitle: `SKU: ${p.sku}`,
        badge: p.sellingPrice ? `AED ${parseFloat(p.sellingPrice).toFixed(2)}` : undefined,
        icon: Package,
        onSelect: () => handleSelect(() => router.push(`/products`)),
      });
    }
  }

  // 2. Live Customers
  if (customers.length > 0) {
    for (const c of customers) {
      combinedItems.push({
        id: `cust-${c.id}`,
        category: "Customers",
        title: c.name,
        subtitle: c.company || c.phone || "Customer record",
        icon: Users,
        onSelect: () => handleSelect(() => router.push(`/customers`)),
      });
    }
  }

  // 3. Live Sales
  if (sales.length > 0) {
    for (const s of sales) {
      combinedItems.push({
        id: `sale-${s.id}`,
        category: "Sales & Invoices",
        title: `Invoice #${s.saleNumber || s.id.slice(0, 8)}`,
        subtitle: s.customerName ? `Customer: ${s.customerName}` : "Walk-in sale",
        badge: `AED ${parseFloat(s.totalAmount).toFixed(2)}`,
        icon: ShoppingCart,
        onSelect: () => handleSelect(() => router.push(`/sales`)),
      });
    }
  }

  // 4. Live Quotations
  if (quotations.length > 0) {
    for (const q of quotations) {
      combinedItems.push({
        id: `quote-${q.id}`,
        category: "Quotations",
        title: `Quotation #${q.quotationNumber}`,
        subtitle: q.customerName ? `Customer: ${q.customerName}` : "Quotation estimate",
        badge: `AED ${parseFloat(q.total).toFixed(2)}`,
        icon: FileText,
        onSelect: () => handleSelect(() => router.push(`/quotations`)),
      });
    }
  }

  // 5. Navigation Pages (Filtered by keywords and title)
  const matchedNav = STATIC_NAVIGATION.filter((nav) => {
    if (!trimmedQuery) return true;
    if (nav.title.toLowerCase().includes(trimmedQuery)) return true;
    if (nav.subtitle?.toLowerCase().includes(trimmedQuery)) return true;
    if (nav.keywords?.some((k) => k.includes(trimmedQuery))) return true;
    return false;
  });

  for (const nav of matchedNav) {
    combinedItems.push({
      id: `nav-${nav.id}`,
      category: "Pages",
      title: nav.title,
      subtitle: nav.subtitle,
      icon: nav.icon,
      onSelect: () => handleSelect(() => nav.href && router.push(nav.href)),
    });
  }

  // 6. Quick Actions
  const staticActions: SearchItem[] = [
    {
      id: "action-theme",
      category: "Quick Actions",
      title: theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
      subtitle: "Change application appearance",
      icon: theme === "dark" ? Sun : Moon,
      onSelect: () => handleSelect(() => toggleTheme()),
    },
    {
      id: "action-logout",
      category: "Quick Actions",
      title: "Sign Out",
      subtitle: "Log out of your admin session",
      icon: LogOut,
      onSelect: () => handleSelect(() => logout()),
    },
  ];

  for (const action of staticActions) {
    if (!trimmedQuery || action.title.toLowerCase().includes(trimmedQuery)) {
      combinedItems.push(action);
    }
  }

  // Keyboard navigation inside list
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < combinedItems.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : combinedItems.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (combinedItems[selectedIndex]) {
        combinedItems[selectedIndex].onSelect();
      }
    } else if (e.key === "Escape") {
      onOpenChange(false);
    }
  };

  // Group items by category for rendering
  const groupedCategories: Array<{ name: string; items: SearchItem[] }> = [];
  let currentCategory = "";
  let currentGroup: SearchItem[] = [];

  for (const item of combinedItems) {
    if (item.category !== currentCategory) {
      if (currentGroup.length > 0) {
        groupedCategories.push({ name: currentCategory, items: currentGroup });
      }
      currentCategory = item.category;
      currentGroup = [item];
    } else {
      currentGroup.push(item);
    }
  }
  if (currentGroup.length > 0) {
    groupedCategories.push({ name: currentCategory, items: currentGroup });
  }

  let itemCounter = 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl p-0 gap-0 overflow-hidden rounded-2xl border border-border shadow-2xl bg-popover/95 backdrop-blur-2xl"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Global Search & Command Palette</DialogTitle>

        {/* ── Search Input Header ── */}
        <div className="relative flex items-center border-b border-border px-4 py-3.5">
          <Search className="h-5 w-5 text-muted-foreground mr-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search products, orders, customers, pages or commands..."
            className="flex-1 bg-transparent text-sm font-medium placeholder:text-muted-foreground/60 focus:outline-none text-foreground"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-primary mr-2" />}
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded-md border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
            ESC
          </kbd>
        </div>

        {/* ── Results Container ── */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin space-y-4"
        >
          {combinedItems.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Search className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
              <p className="text-sm font-medium">No results found for &ldquo;{query}&rdquo;</p>
              <p className="text-xs text-muted-foreground/70 mt-1">Try searching by product name, SKU, customer or section name.</p>
            </div>
          ) : (
            groupedCategories.map((group) => (
              <div key={group.name} className="space-y-1">
                <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/60">
                  {group.name}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const currentIndex = itemCounter++;
                    const isSelected = selectedIndex === currentIndex;
                    const Icon = item.icon;

                    return (
                      <div
                        key={item.id}
                        onClick={item.onSelect}
                        onMouseEnter={() => setSelectedIndex(currentIndex)}
                        className={cn(
                          "group relative flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium cursor-pointer transition-all duration-150 select-none",
                          isSelected
                            ? "bg-primary/10 text-primary shadow-xs"
                            : "text-foreground hover:bg-muted/60",
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div
                            className={cn(
                              "flex h-7 w-7 items-center justify-center rounded-lg transition-colors shrink-0",
                              isSelected
                                ? "bg-primary text-primary-foreground shadow-xs"
                                : "bg-muted text-muted-foreground group-hover:text-foreground",
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold text-foreground">
                              {item.title}
                            </p>
                            {item.subtitle && (
                              <p className="truncate text-[11px] text-muted-foreground/80">
                                {item.subtitle}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          {item.badge && (
                            <Badge variant="outline" className="font-mono text-[10px] font-bold">
                              {item.badge}
                            </Badge>
                          )}
                          {isSelected && (
                            <ArrowRight className="h-3.5 w-3.5 text-primary animate-pulse" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── Footer Keyboard Tips ── */}
        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-muted px-1 py-0.5 text-[10px] border border-border">↑</kbd>
              <kbd className="rounded bg-muted px-1 py-0.5 text-[10px] border border-border">↓</kbd>
              Navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-muted px-1 py-0.5 text-[10px] border border-border">↵</kbd>
              Select
            </span>
          </div>
          <span className="flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-primary" />
            DevsFleet Quick Search
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
