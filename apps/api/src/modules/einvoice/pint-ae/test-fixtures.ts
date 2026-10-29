import { DEFAULT_TENANT_SETTINGS, type TenantSettings } from "@devsfleet/shared-types";
import type { SnapshotSource } from "./snapshot.js";

/** A UAE business that has everything an e-invoice needs. Specs override only what they are testing. */
export function tenantSettings(patch: Partial<TenantSettings> = {}): TenantSettings {
  return {
    ...DEFAULT_TENANT_SETTINGS,
    legalName: "Al Lahiq Electric Trading LLC",
    trn: "100234567800003",
    phone: "+97143334444",
    email: "accounts@allahiq.example",
    legalAddress: { line1: "Shop 4, Naif Road", city: "Dubai", subdivision: "DXB", countryCode: "AE" },
    einvoice: {
      ...DEFAULT_TENANT_SETTINGS.einvoice,
      enabled: true,
      legalRegistration: { id: "112345678", type: "TL", authority: "Dubai Economy and Tourism" },
    },
    ...patch,
  };
}

export const CUSTOMER = {
  name: "Khaled Rahman",
  company: "Noor Electronics FZE",
  trn: "100987654300003",
  email: "buyer@noor.example",
  phone: "+971501234567",
  paymentTermDays: 30,
  addressLine1: "Warehouse 12, Industrial Area 3",
  addressLine2: null,
  addressCity: "Sharjah",
  addressSubdivision: "SHJ",
  addressPostalCode: null,
  addressCountry: "AE",
  einvoiceScheme: null,
  einvoiceEndpoint: null,
};

export function line(over: Partial<SnapshotSource["lines"][number]> = {}): SnapshotSource["lines"][number] {
  return {
    sortOrder: 0,
    productName: "Cable 2.5mm",
    variantName: "Default",
    productSku: "CAB-25",
    quantity: "50.0000",
    unitPrice: "2.2000",
    taxPercent: "5.0000",
    taxAmount: "5.5000",
    lineSubtotal: "110.0000",
    taxCategory: "S",
    taxExemptionCode: null,
    unitCode: "MTR",
    ...over,
  };
}

export function invoiceSource(over: Partial<SnapshotSource> = {}): SnapshotSource {
  return {
    docType: "invoice",
    uuid: "f12f329f-6430-4399-b661-7c5cd9c3a9e6",
    sale: {
      saleNumber: "INV-DXB-2026-000123",
      occurredAt: new Date("2026-11-03T08:15:30Z"),
      currency: "AED",
      exchangeRate: "1.0000",
      taxMode: "exclusive",
      subtotal: "110.0000",
      taxAmount: "5.5000",
      total: "115.5000",
      dueAmount: "115.5000",
      creditReason: null,
    },
    lines: [line()],
    payments: [],
    tenant: { name: "Al Lahiq", settings: tenantSettings() },
    customer: CUSTOMER,
    original: null,
    ...over,
  };
}

/** A return, the way the platform stores it: every figure negative. */
export function creditNoteSource(over: Partial<SnapshotSource> = {}): SnapshotSource {
  return invoiceSource({
    docType: "credit_note",
    uuid: "f1c9d83d-e31f-43fc-919f-10b961f599e7",
    sale: {
      saleNumber: "CRN-DXB-2026-000007",
      occurredAt: new Date("2026-11-05T09:00:00Z"),
      currency: "AED",
      exchangeRate: "1.0000",
      taxMode: "exclusive",
      subtotal: "-22.0000",
      taxAmount: "-1.1000",
      total: "-23.1000",
      dueAmount: "0.0000",
      creditReason: "DL8.61.1.D",
    },
    lines: [line({ quantity: "-10.0000", lineSubtotal: "-22.0000", taxAmount: "-1.1000" })],
    original: { saleNumber: "INV-DXB-2026-000123", occurredAt: new Date("2026-11-03T08:15:30Z") },
    ...over,
  });
}
