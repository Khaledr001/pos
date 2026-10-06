"use client";

import React, { useCallback, useEffect, useState } from "react";
import { BellRing, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loading, Notice, PageHeader, errorText } from "../shared";

interface Demand {
  productId: string;
  productName: string;
  waiting: number;
  variants: number;
  oldest: string | null;
}

export default function StockAlertsPage() {
  const { tokens } = useAuth();
  const auth = { accessToken: tokens?.accessToken };
  const [items, setItems] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await api.get<{ items: Demand[] }>("/storefront-admin/stock-alerts", auth)).items);
    } catch (err) {
      setError(errorText(err, "Failed to load stock alerts."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader title="Stock Alerts" description="Shoppers waiting for a sold-out product to come back. The most wanted are first: a restocking signal.">
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </PageHeader>
      {error && <Notice kind="error" message={error} onClose={() => setError(null)} />}
      <Card className="overflow-hidden">
        {loading ? (
          <Loading label="Loading stock alerts..." />
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <BellRing className="mx-auto h-12 w-12 text-muted-foreground/30" />
            <h3 className="mt-4 text-sm font-semibold text-foreground">Nobody is waiting for a product</h3>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-secondary/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3.5 font-medium">Product</th>
                <th className="px-4 py-3.5 text-right font-medium">Waiting</th>
                <th className="px-4 py-3.5 text-right font-medium">Options</th>
                <th className="px-4 py-3.5 font-medium">Oldest request</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((d) => (
                <tr key={d.productId}>
                  <td className="px-4 py-3.5 font-medium text-foreground">{d.productName}</td>
                  <td className="px-4 py-3.5 text-right font-medium text-foreground">{d.waiting}</td>
                  <td className="px-4 py-3.5 text-right text-muted-foreground">{d.variants}</td>
                  <td className="px-4 py-3.5 text-muted-foreground">{d.oldest ? new Date(d.oldest).toLocaleDateString("en-AE") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
