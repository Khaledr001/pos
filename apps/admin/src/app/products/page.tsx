"use client";

import React, { useState } from "react";
import {
  Package,
  Search,
  Plus,
} from "lucide-react";

interface Product {
  sku: string;
  barcode: string;
  name: string;
  category: string;
  unit: string;
  retailPrice: string;
  wholesalePrice: string;
  stockQty: number;
  taxPercent: number;
}

const SAMPLE_PRODUCTS: Product[] = [
  {
    sku: "PVC-ELB-001",
    barcode: "629104000101",
    name: "PVC 90° Elbow 1\" High Pressure (Class E)",
    category: "Pipes & Fittings",
    unit: "Piece",
    retailPrice: "2.50",
    wholesalePrice: "2.20",
    stockQty: 450,
    taxPercent: 5,
  },
  {
    sku: "PVC-TEE-002",
    barcode: "629104000102",
    name: "PVC Equal Tee 1\" Heavy Duty",
    category: "Pipes & Fittings",
    unit: "Piece",
    retailPrice: "3.20",
    wholesalePrice: "2.80",
    stockQty: 280,
    taxPercent: 5,
  },
  {
    sku: "EL-CBL-3CX25",
    barcode: "629104000201",
    name: "Ducab 3-Core 2.5mm² Flexible Copper Cable (100m Roll)",
    category: "Electrical",
    unit: "Roll",
    retailPrice: "245.00",
    wholesalePrice: "215.00",
    stockQty: 35,
    taxPercent: 5,
  },
  {
    sku: "EL-SWT-1G",
    barcode: "629104000202",
    name: "Schneider 1-Gang 2-Way Light Switch (White)",
    category: "Electrical",
    unit: "Piece",
    retailPrice: "14.50",
    wholesalePrice: "11.50",
    stockQty: 160,
    taxPercent: 5,
  },
  {
    sku: "PNT-JOT-MATT-18L",
    barcode: "629104000301",
    name: "Jotun Fenomastic Pure Colours Matt Interior Paint 18L",
    category: "Paint",
    unit: "Drum",
    retailPrice: "210.00",
    wholesalePrice: "185.00",
    stockQty: 42,
    taxPercent: 5,
  },
  {
    sku: "SAN-ANG-VLV",
    barcode: "629104000401",
    name: "Grohe 1/2\" Chrome Angle Valve with Filter",
    category: "Sanitary",
    unit: "Piece",
    retailPrice: "38.00",
    wholesalePrice: "32.00",
    stockQty: 95,
    taxPercent: 5,
  },
];

const CATEGORIES = ["All", "Pipes & Fittings", "Electrical", "Paint", "Sanitary"];

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState("All");

  const filtered = SAMPLE_PRODUCTS.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku.toLowerCase().includes(search.toLowerCase()) ||
      p.barcode.includes(search);
    const matchesCat = selectedCat === "All" || p.category === selectedCat;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-[--color-fg]">
              Product Catalogue
            </h1>
            <span className="rounded-full bg-[--color-brand]/10 px-2.5 py-0.5 text-xs font-semibold text-[--color-brand]">
              5,000+ SKU Target
            </span>
          </div>
          <p className="mt-1 text-xs text-[--color-muted]">
            Multi-unit catalogue for Hardware, Electrical, Sanitary, and Paint retail with wholesale tier pricing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1.5 rounded-lg bg-[--color-brand] px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 transition-opacity cursor-pointer">
            <Plus className="h-4 w-4" />
            <span>Add Product</span>
          </button>
        </div>
      </div>

      {/* Category Pills & Search */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCat(cat)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                selectedCat === cat
                  ? "bg-[--color-brand] text-white shadow-sm"
                  : "border border-[--color-border] bg-[--color-surface] text-[--color-muted] hover:bg-[--color-border]/50 hover:text-[--color-fg]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[--color-muted]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by SKU, barcode, name..."
            className="w-full rounded-lg border border-[--color-border] bg-[--color-surface] py-1.5 pl-9 pr-3 text-xs text-[--color-fg] placeholder-[--color-muted] focus:border-[--color-brand] focus:outline-none focus:ring-1 focus:ring-[--color-brand]"
          />
        </div>
      </div>

      {/* Products Table */}
      <div className="overflow-hidden rounded-xl border border-[--color-border] bg-[--color-surface] shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[--color-border] bg-[--color-bg] font-medium text-[--color-muted]">
              <tr>
                <th className="px-4 py-3.5">SKU & Barcode</th>
                <th className="px-4 py-3.5">Product Name</th>
                <th className="px-4 py-3.5">Category</th>
                <th className="px-4 py-3.5">Unit</th>
                <th className="px-4 py-3.5 text-right">Retail (AED)</th>
                <th className="px-4 py-3.5 text-right">Wholesale (AED)</th>
                <th className="px-4 py-3.5 text-right">Stock Qty</th>
                <th className="px-4 py-3.5 text-center">VAT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[--color-border]">
              {filtered.map((item) => (
                <tr key={item.sku} className="hover:bg-[--color-bg]/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex flex-col font-mono text-[11px]">
                      <span className="font-bold text-[--color-brand]">{item.sku}</span>
                      <span className="text-[10px] text-[--color-muted]">{item.barcode}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-[--color-fg]">{item.name}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-md bg-[--color-border]/60 px-2 py-0.5 text-[10px] font-medium text-[--color-fg]">
                      {item.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[--color-muted]">{item.unit}</td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-[--color-fg]">
                    {item.retailPrice}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[--color-muted]">
                    {item.wholesalePrice}
                  </td>
                  <td className="px-4 py-3 text-right font-mono">
                    <span
                      className={`inline-block font-semibold ${
                        item.stockQty < 50 ? "text-[--color-warning]" : "text-[--color-success]"
                      }`}
                    >
                      {item.stockQty}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-[10px] font-medium text-[--color-muted]">
                      {item.taxPercent}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
