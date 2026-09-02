"use client";

import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  FileUp,
  Loader2,
  FileSpreadsheet,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function BulkImportPage() {
  const router = useRouter();
  const { tokens } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [branches, setBranches] = useState<{ id: string; name: string; code: string }[]>([]);
  const [branchId, setBranchId] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number; rejected: number;
    autoCreated: { categories: string[]; brands: string[] };
    errors: { row: number; reason: string }[];
    dryRun: boolean;
  } | null>(null);

  // Fetch branches for the opening stock dropdown
  useEffect(() => {
    if (!tokens?.accessToken) return;
    api.get<{ items: { id: string; name: string; code: string }[] }>("/branches", { accessToken: tokens.accessToken })
      .then((res) => {
        const bs = res?.items ?? [];
        setBranches(bs);
        if (bs.length > 0 && bs[0]) setBranchId(bs[0].id);
      })
      .catch(console.error);
  }, [tokens]);

  // When a file is selected, run dry-run automatically
  useEffect(() => {
    if (file) {
      runImport(true);
    }
  }, [file, branchId]); // Re-run if branch changes while file is selected

  const downloadTemplate = async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1"}/products/import/template`,
        { headers: tokens?.accessToken ? { authorization: `Bearer ${tokens.accessToken}` } : {} },
      );
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "import-template.xlsx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err: any) {
      setError(err?.message || "Failed to download template.");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); setResult(null); setError(null); }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setFile(f); setResult(null); setError(null); }
  };

  const runImport = async (dryRun: boolean) => {
    if (!file) return;
    setRunning(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const params = new URLSearchParams();
      params.set("dryRun", String(dryRun));
      if (branchId) params.set("branchId", branchId);

      const res = await api.postForm<typeof result>(
        `/products/import?${params.toString()}`,
        formData,
        { accessToken: tokens?.accessToken },
      );
      setResult(res);

      if (!dryRun && res && res.created > 0) {
        // Navigate back to products after successful import
        router.push("/products");
      }
    } catch (err: any) {
      setError(err?.message || "Import failed.");
      setResult(null);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12 pt-4">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
          <Link href="/" className="hover:text-primary transition-colors">Home</Link>
          <ChevronRight className="h-3 w-3" />
          <Link href="/products" className="hover:text-primary transition-colors">Products</Link>
          <ChevronRight className="h-3 w-3" />
          <span className="text-primary">Bulk Import</span>
        </div>
        
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Bulk Import Products</h1>
        <p className="mt-1.5 text-sm text-muted-foreground max-w-3xl">
          Import products from an Excel file. Download the template, fill it in, and upload it here.
        </p>
      </div>

      {/* Step 1: Download */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
            1
          </div>
          <h2 className="text-lg font-bold text-card-foreground">Download the template</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          One row per product. Columns marked with * are required. Unit must match a name that already exists (see the "Valid Values" sheet inside the template). Category and Brand are created automatically when the name is new. SKU is optional — leave it blank and one is auto-generated from the category prefix (e.g. ELC-0007). Current Stock creates opening stock in the selected warehouse.
        </p>
        <Button variant="outline" onClick={downloadTemplate} className="gap-2">
          <Download className="h-4 w-4 text-muted-foreground" />
          Download Excel Template
        </Button>
      </div>

      {/* Step 2: Upload */}
      <div className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
            2
          </div>
          <h2 className="text-lg font-bold text-card-foreground">Upload your file</h2>
        </div>

        <div className="space-y-6">
          {/* Branch Selector */}
          {branches.length > 0 && (
            <div className="max-w-md">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                Warehouse for opening stock
              </label>
              <Select value={branchId || "none"} onValueChange={(val) => setBranchId(val === "none" ? "" : val)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="No warehouse (skip stock)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No warehouse (skip stock)</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-2">
                Rows with an "Current Stock" value create stock in this warehouse.
              </p>
            </div>
          )}

          {/* File Drop Zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-12 cursor-pointer transition-colors",
              dragOver
                ? "border-primary bg-primary/5"
                : file
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50 bg-muted/20",
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
            {file ? (
              <>
                <FileSpreadsheet className="h-10 w-10 text-emerald-500" />
                <p className="text-sm font-medium text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB · Click to change
                </p>
              </>
            ) : (
              <>
                <FileSpreadsheet className="h-10 w-10 text-emerald-500" />
                <p className="text-sm font-medium text-foreground">
                  Click to choose a file or drag it here
                </p>
                <p className="text-xs text-muted-foreground">
                  .xlsx, .xls, or .csv — max 1,000 rows
                </p>
              </>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Results Preview */}
          {result && (
            <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className={cn(
                "rounded-xl border p-6",
                result.dryRun
                  ? "border-amber-500/30 bg-amber-500/5"
                  : "border-emerald-500/30 bg-emerald-500/5",
              )}>
                <div className="flex items-center justify-between mb-6">
                  <p className={cn(
                    "text-sm font-bold uppercase tracking-wider",
                    result.dryRun ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400",
                  )}>
                    {result.dryRun ? "⚡ Dry Run Preview" : "✅ Import Complete"}
                  </p>
                  
                  {result.dryRun && result.created > 0 && (
                    <Button
                      onClick={() => runImport(false)}
                      disabled={running}
                      className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                      {running ? "Importing…" : `Confirm & Import ${result.created} products`}
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: "Created", value: result.created, color: "text-emerald-600 dark:text-emerald-400" },
                    { label: "Rejected", value: result.rejected, color: "text-destructive" },
                  ].map((stat) => (
                    <div key={stat.label} className="text-center rounded-lg bg-background p-4 border shadow-sm">
                      <p className={cn("text-3xl font-black tabular-nums", stat.color)}>{stat.value}</p>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mt-1">{stat.label}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Auto-created entities */}
              {(result.autoCreated.categories.length > 0 || result.autoCreated.brands.length > 0) && (
                <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-3">
                    Entities that will be auto-created
                  </p>
                  <div className="space-y-2">
                    {result.autoCreated.categories.length > 0 && (
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">Categories:</span>{" "}
                        <span className="text-muted-foreground">{result.autoCreated.categories.join(", ")}</span>
                      </p>
                    )}
                    {result.autoCreated.brands.length > 0 && (
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">Brands:</span>{" "}
                        <span className="text-muted-foreground">{result.autoCreated.brands.join(", ")}</span>
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Errors */}
              {result.errors.length > 0 && (
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-destructive mb-3">
                    {result.errors.length} error(s) found
                  </p>
                  <div className="max-h-60 overflow-y-auto space-y-1.5 rounded-md bg-background/50 p-2">
                    {result.errors.map((err, i) => (
                      <p key={i} className="text-sm text-muted-foreground">
                        <span className="font-mono font-semibold text-destructive">Row {err.row}:</span>{" "}
                        {err.reason}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
