"use client";

import React, { useCallback, useEffect, useState } from "react";
import { BellRing, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableContainer, TableEmpty, TableHead, Th, numericCell,
} from "@/components/ui/data-table";
import { MobileEmpty, MobileList, MobileRow } from "@/components/ui/mobile-list";
import { Notice, PageHeader, errorText } from "../shared";

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
      <MobileList
        loading={loading && items.length === 0}
        empty={<MobileEmpty icon={BellRing} title="Nobody is waiting for a product" />}
      >
        {items.map((d) => (
          <MobileRow
            key={d.productId}
            title={d.productName}
            subtitle={`${d.waiting} waiting`}
            fields={[
              { label: "Waiting", value: d.waiting, numeric: true },
              { label: "Options", value: d.variants, numeric: true },
              { label: "Oldest request", value: d.oldest ? new Date(d.oldest).toLocaleDateString("en-AE") : "—" },
            ]}
          />
        ))}
      </MobileList>

      <Card className="hidden overflow-hidden md:block">
        <TableContainer>
          <Table>
            <TableHead>
              <tr>
                <Th>Product</Th>
                <Th align="right">Waiting</Th>
                <Th align="right">Options</Th>
                <Th>Oldest request</Th>
              </tr>
            </TableHead>
            <TableBody
              columns={4}
              loading={loading && items.length === 0}
              empty={<TableEmpty columns={4} icon={BellRing} title="Nobody is waiting for a product" />}
            >
              {items.map((d) => (
                <tr key={d.productId}>
                  <td className="px-4 py-3.5 font-medium text-foreground">{d.productName}</td>
                  <td className={cn("px-4 py-3.5 font-medium text-foreground", numericCell)}>{d.waiting}</td>
                  <td className={cn("px-4 py-3.5 text-muted-foreground", numericCell)}>{d.variants}</td>
                  <td className="px-4 py-3.5 text-muted-foreground tabular-nums">{d.oldest ? new Date(d.oldest).toLocaleDateString("en-AE") : "—"}</td>
                </tr>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
    </div>
  );
}
