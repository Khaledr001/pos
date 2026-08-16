import type { Currency, Locale, PrintFormat, TaxMode } from "./enums.js";

/**
 * Shape of `tenants.settings` (JSONB).
 *
 * Everything a tenant can vary without a code change lives here. Read it
 * through `resolveTenantSettings()` so a tenant row written before a field
 * existed still produces a complete object.
 */
export interface TenantSettings {
  /** Legal / display identity, used on invoices and quotation PDFs. */
  legalName?: string;
  /** UAE Tax Registration Number. Printed on tax invoices. */
  trn?: string;
  logoUrl?: string;
  addressLines?: string[];
  phone?: string;
  email?: string;

  currency: {
    /** Books currency. Every stored amount is in this unless the row says otherwise. */
    base: Currency;
    /** Currencies a document may be issued in. Must include `base`. */
    enabled: Currency[];
    /** Symbol placement + decimals for display only. Never for arithmetic. */
    decimals: number;
  };

  /**
   * VAT is per tenant, not hardcoded. UAE is 5% today; a tenant in another
   * emirate/country or a non-registered tenant sets its own.
   */
  tax: {
    enabled: boolean;
    /** Label printed on documents: "VAT", "GST", "Sales Tax". */
    label: string;
    /** Default percentage applied to new document lines, e.g. 5. */
    defaultRate: number;
    /** Whether unit_price already contains the tax. */
    mode: TaxMode;
    /** Show a tax breakdown block on receipts and invoices. */
    showBreakdown: boolean;
  };

  locale: {
    default: Locale;
    /** Locales the admin UI and WhatsApp AI will respond in. */
    enabled: Locale[];
    timezone: string;
    /** date-fns format string. */
    dateFormat: string;
  };

  sales: {
    /** Block a sale that would take a customer past their credit limit. */
    enforceCreditLimit: boolean;
    /** Block selling below `product_prices.min_selling_price`. */
    enforceFloorPrice: boolean;
    /** Allow the cart to go negative on stock. POS offline mode can force this. */
    allowNegativeStock: boolean;
    /** Max line discount a `sale:discount` holder can apply without escalation. */
    maxDiscountPercent: number;
    /** Days a quotation stays valid by default. */
    quotationValidityDays: number;
  };

  printing: {
    defaultReceiptFormat: PrintFormat;
    /** Formats the POS offers in its print dialog. */
    enabledFormats: PrintFormat[];
    receiptFooter?: string;
    /** Print a second copy for the customer's signature on credit sales. */
    duplicateOnCredit: boolean;
  };

  whatsapp: {
    enabled: boolean;
    /** Bot replies automatically; false = queue for a human. */
    autoReply: boolean;
    /** Hand off to a human after this many AI turns without resolution. */
    escalateAfterTurns: number;
    /** Outside these hours inbound messages get the away template. */
    businessHours?: { start: string; end: string; days: number[] };
    greetingTemplate?: string;
  };

  inventory: {
    /** Reserve stock when a quotation is confirmed, not just when ordered. */
    reserveOnQuotationConfirm: boolean;
    /** Fire a low-stock alert when quantity - reserved <= reorder_level. */
    lowStockAlerts: boolean;
  };
}

export const DEFAULT_TENANT_SETTINGS: TenantSettings = {
  currency: {
    base: "AED",
    enabled: ["AED"],
    decimals: 2,
  },
  tax: {
    enabled: true,
    label: "VAT",
    defaultRate: 5,
    mode: "exclusive",
    showBreakdown: true,
  },
  locale: {
    default: "en",
    enabled: ["en", "ar"],
    timezone: "Asia/Dubai",
    dateFormat: "dd/MM/yyyy",
  },
  sales: {
    enforceCreditLimit: true,
    enforceFloorPrice: true,
    allowNegativeStock: false,
    maxDiscountPercent: 10,
    quotationValidityDays: 14,
  },
  printing: {
    defaultReceiptFormat: "thermal_80",
    enabledFormats: ["thermal_58", "thermal_80", "a4"],
    duplicateOnCredit: true,
  },
  whatsapp: {
    enabled: false,
    autoReply: true,
    escalateAfterTurns: 6,
  },
  inventory: {
    reserveOnQuotationConfirm: true,
    lowStockAlerts: true,
  },
};

/**
 * Shape of `branches.settings` (JSONB). Anything here overrides the tenant.
 * Deliberately narrow — a branch should not be able to redefine tax.
 */
export interface BranchSettings {
  receiptFooter?: string;
  defaultReceiptFormat?: PrintFormat;
  /** Branch-local invoice/receipt number prefix, e.g. "DXB". */
  documentPrefix?: string;
  /** Overrides tenant business hours for the WhatsApp away message. */
  businessHours?: { start: string; end: string; days: number[] };
}

/** Merge stored partial settings over the defaults. One level per section. */
export function resolveTenantSettings(stored: unknown): TenantSettings {
  const s = (stored ?? {}) as Partial<TenantSettings>;
  const d = DEFAULT_TENANT_SETTINGS;
  return {
    ...d,
    ...s,
    currency: { ...d.currency, ...s.currency },
    tax: { ...d.tax, ...s.tax },
    locale: { ...d.locale, ...s.locale },
    sales: { ...d.sales, ...s.sales },
    printing: { ...d.printing, ...s.printing },
    whatsapp: { ...d.whatsapp, ...s.whatsapp },
    inventory: { ...d.inventory, ...s.inventory },
  };
}
