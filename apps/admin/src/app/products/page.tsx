"use client";

import React, { useState } from "react";
import { Package, Search, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

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
  { sku: "PVC-ELB-001", barcode: "629104000101", name: 'PVC 90° Elbow 1" High Pressure (Class E)', category: "Pipes & Fittings", unit: "Piece", retailPrice: "2.50", wholesalePrice: "2.20", stockQty: 450, taxPercent: 5 },
  { sku: "PVC-TEE-002", barcode: "629104000102", name: 'PVC Equal Tee 1" Heavy Duty', category: "Pipes & Fittings", unit: "Piece", retailPrice: "3.20", wholesalePrice: "2.80", stockQty: 280, taxPercent: 5 },
  { sku: "EL-CBL-3CX25", barcode: "629104000201", name: "Ducab 3-Core 2.5mm² Flexible Copper Cable (100m Roll)", category: "Electrical", unit: "Roll", retailPrice: "245.00", wholesalePrice: "215.00", stockQty: 35, taxPercent: 5 },
  { sku: "EL-SWT-1G", barcode: "629104000202", name: "Schneider 1-Gang 2-Way Light Switch (White)", category: "Electrical", unit: "Piece", retailPrice: "14.50", wholesalePrice: "11.50", stockQty: 160, taxPercent: 5 },
  { sku: "PNT-JOT-MATT-18L", barcode: "629104000301", name: "Jotun Fenomastic Pure Colours Matt Interior Paint 18L", category: "Paint", unit: "Drum", retailPrice: "210.00", wholesalePrice: "185.00", stockQty: 42, taxPercent: 5 },
  { sku: "SAN-ANG-VLV", barcode: "629104000401", name: 'Grohe 1/2" Chrome Angle Valve with Filter', category: "Sanitary", unit: "Piece", retailPrice: "38.00", wholesalePrice: "32.00", stockQty: 95, taxPercent: 5 },
];

const CATEGORIES = ["All", "Pipes & Fittings", "Electrical", "Paint", "Sanitary"];

export default function ProductsPage() {
  const [search, setSearch] = useState("");
  const [selectedCat, setSelectedCat] = useState("All");

  const filtered = SAMPLE_PRODUCTS.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) || p.sku.toLowerCase().includes(search.toLowerCase()) || p.barcode.includes(search);
    const matchesCat = selectedCat === "All" || p.category === selectedCat;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Product Catalogue</h1>
            <Badge variant="secondary">5,000+ SKU Target</Badge>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">Multi-unit catalogue for Hardware, Electrical, Sanitary, and Paint retail with wholesale tier pricing.</p>
        </div>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          Add Product
        </Button>
      </div>

      {/* ── Filters ── */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              variant={selectedCat === cat ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCat(cat)}
              className={cn("text-xs", selectedCat === cat && "gradient-brand border-0")}
            >
              {cat}
            </Button>
          ))}
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by SKU, barcode, name..." className="pl-10 bg-secondary/30" />
        </div>
      </div>

      {/* ── Table ── */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3.5 font-medium">SKU & Barcode</th>
                <th className="px-4 py-3.5 font-medium">Product Name</th>
                <th className="px-4 py-3.5 font-medium">Category</th>
                <th className="px-4 py-3.5 font-medium">Unit</th>
                <th className="px-4 py-3.5 text-right font-medium">Retail (AED)</th>
                <th className="px-4 py-3.5 text-right font-medium">Wholesale (AED)</th>
                <th className="px-4 py-3.5 text-right font-medium">Stock Qty</th>
                <th className="px-4 py-3.5 text-center font-medium">VAT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((item) => (
                <tr key={item.sku} className="hover:bg-secondary/30 transition-colors">
                  <td className="px-4 py-3.5">
                    <div className="flex flex-col font-mono text-[11px]">
                      <span className="font-bold text-primary">{item.sku}</span>
                      <span className="text-[10px] text-muted-foreground">{item.barcode}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="font-medium text-foreground">{item.name}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <Badge variant="secondary" className="text-[10px]">{item.category}</Badge>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground">{item.unit}</td>
                  <td className="px-4 py-3.5 text-right font-mono font-semibold text-foreground">{item.retailPrice}</td>
                  <td className="px-4 py-3.5 text-right font-mono text-muted-foreground">{item.wholesalePrice}</td>
                  <td className="px-4 py-3.5 text-right font-mono">
                    <span className={cn("font-semibold", item.stockQty < 50 ? "text-amber-500" : "text-emerald-500")}>
                      {item.stockQty}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="text-[10px] font-medium text-muted-foreground">{item.taxPercent}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
