"use client";

import React, { useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { apiDownload, saveBlob } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Format = "csv" | "xlsx";

/**
 * Downloads every row the page's CURRENT filters match — not the page on
 * screen — as CSV or Excel.
 *
 * The file is named here rather than from the response: the API does not
 * expose Content-Disposition to the browser across origins, so the header is
 * unreadable. The rule matches the server's: `sales_2026-10-01_2026-10-31`.
 */
export function ExportMenu({
  path,
  query,
  filenameBase,
  onError,
}: {
  /** e.g. "/sales/export" */
  path: string;
  query: Record<string, string | number | boolean | undefined>;
  filenameBase: string;
  onError: (message: string | null) => void;
}) {
  const { tokens } = useAuth();
  const [busy, setBusy] = useState<Format | null>(null);

  async function download(format: Format) {
    setBusy(format);
    onError(null);
    try {
      const { blob, filename } = await apiDownload(path, {
        accessToken: tokens?.accessToken,
        query: { ...query, format },
      });
      const from = typeof query.from === "string" ? query.from : "";
      const to = typeof query.to === "string" ? query.to : "";
      const stamp = from || to ? `${from || "start"}_${to || "today"}` : new Date().toISOString().slice(0, 10);
      saveBlob(blob, filename ?? `${filenameBase}_${stamp}.${format}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "The export failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy !== null} aria-label="Export">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          {busy ? "Exporting…" : "Export"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => void download("xlsx")} className="cursor-pointer">
          <FileSpreadsheet className="h-4 w-4" />
          Excel (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void download("csv")} className="cursor-pointer">
          <FileText className="h-4 w-4" />
          CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
