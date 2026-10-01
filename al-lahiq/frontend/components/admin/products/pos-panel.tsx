"use client";

import type { AdminAttribute, AdminProductDetail, AdminVariant } from "@al-lahiq/api-client";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { adminApi } from "@/lib/api-browser";
import { cn } from "@/lib/cn";
import { formatDateTime, formatQty, uomCount, uomShort } from "@/lib/format";
import { rowKey } from "../catalog-helpers";
import { useAdminQuery, useInvalidate, useSetAdminData } from "../data";
import { useUnsavedWarning } from "../row-controls";
import { useCan } from "../staff-context";
import { useToast } from "../toast";
import { DataTable, Facts, num, Panel } from "../ui";
import { SaveBar } from "./product-media";

const VAT_LABEL: Record<AdminProductDetail["vatClass"], string> = {
  STANDARD_5: "Standard rate, 5%",
  ZERO: "Zero-rated, 0%",
  EXEMPT: "Exempt from VAT",
};

function optionText(options: unknown) {
  if (!options || typeof options !== "object") return null;
  const entries = Object.entries(options as Record<string, unknown>);
  if (!entries.length) return null;
  return entries.map(([k, v]) => `${k.charAt(0).toUpperCase()}${k.slice(1)}: ${String(v)}`).join(", ");
}

/** SKUs, prices and stock as the POS sent them. Read-only: change them in the POS. */
export function PosPanel({ product, path }: { product: AdminProductDetail; path: string }) {
  const attributes = useAdminQuery<AdminAttribute[]>("/admin/attributes");
  return (
    <Panel
      title="From the POS"
      description="SKUs, prices, units, VAT and stock are managed in the POS and update here automatically. To change them, edit the item in the POS."
    >
      <Facts
        className="mb-4"
        items={[
          ["VAT", VAT_LABEL[product.vatClass]],
          ["POS group", product.posGroupCode ? <span className="font-mono">{product.posGroupCode}</span> : "None"],
          ["SKUs", String(product.variants.length)],
        ]}
      />
      <div className="flex flex-col gap-4">
        {product.variants.map((v) => (
          <VariantCard key={v.id} variant={v} attributes={attributes.data ?? []} path={path} />
        ))}
        {!product.variants.length && <p className="text-sm text-steel">The POS hasn&apos;t sent any SKUs for this product yet.</p>}
      </div>
    </Panel>
  );
}

function VariantCard({ variant: v, attributes, path }: { variant: AdminVariant; attributes: AdminAttribute[]; path: string }) {
  const options = optionText(v.options);
  const totalStock = v.stock.reduce((a, s) => a + s.quantity, 0);
  return (
    <article className="rounded-[var(--radius-panel)] border border-galv">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-galv bg-sheet/70 px-3 py-2">
        <h3 className="text-lg">{v.name}</h3>
        <span className="font-mono text-sm">{v.sku}</span>
        <Badge tone={v.active ? "pipe" : "neutral"}>{v.active ? "Active in POS" : "Inactive in POS"}</Badge>
        <span className="ml-auto text-sm text-steel">
          Available online: <span className="font-cond text-base font-semibold text-ink">{formatQty(v.available)}</span> {uomShort(v.baseUom)}
        </span>
      </header>
      <div className="grid gap-4 p-3 lg:grid-cols-2">
        <Facts
          items={[
            ["Barcode", v.barcode ? <span className="font-mono">{v.barcode}</span> : "None"],
            ["Options", options ?? "None"],
            ["Sold by", uomCount(1, v.baseUom).replace(/^1 /, "")],
            [
              "Other units",
              v.uomConversions.length
                ? v.uomConversions.map((c) => `1 ${uomShort(c.uom)} = ${uomCount(c.factor, v.baseUom)}`).join(", ")
                : "None",
            ],
            ["Weight", v.weightGrams ? `${formatQty(v.weightGrams / 1000)} kg` : "Not set"],
          ]}
        />
        <div className="min-w-0">
          <h4 className="mb-1 text-sm font-semibold">Stock by branch</h4>
          {v.stock.length ? (
            <div className="rounded-[var(--radius-tag)] border border-galv">
              <DataTable minWidth={280}>
                <thead>
                  <tr>
                    <th scope="col">Branch</th>
                    <th scope="col" className="!text-right">
                      On hand
                    </th>
                    <th scope="col">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {v.stock.map((s) => (
                    <tr key={s.code}>
                      <td>
                        {s.branch} <span className="font-mono text-[12px] text-steel">{s.code}</span>
                      </td>
                      <td className={num}>{formatQty(s.quantity)}</td>
                      <td className="text-[13px] text-steel">{formatDateTime(s.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          ) : (
            <p className="text-sm text-steel">No stock reported by the POS.</p>
          )}
          {v.stock.length > 0 && totalStock > v.available && (
            <p className="mt-1 text-[12px] text-steel">
              “Available online” is lower than on-hand stock because of the safety buffer and stock held for open orders.
            </p>
          )}
        </div>
        <div className="min-w-0 lg:col-span-2">
          <h4 className="mb-1 text-sm font-semibold">Prices</h4>
          {v.prices.length ? (
            <div className="rounded-[var(--radius-tag)] border border-galv">
              <DataTable minWidth={560}>
                <thead>
                  <tr>
                    <th scope="col">Unit</th>
                    <th scope="col">Price list</th>
                    <th scope="col" className="!text-right">
                      Incl. VAT
                    </th>
                    <th scope="col" className="!text-right">
                      Excl. VAT
                    </th>
                    <th scope="col">Quantity breaks (excl. VAT)</th>
                  </tr>
                </thead>
                <tbody>
                  {v.prices.map((p) => (
                    <tr key={`${p.uom}-${p.priceListCode}`}>
                      <td>{uomShort(p.uom)}</td>
                      <td className="font-mono text-[13px]">{p.priceListCode}</td>
                      <td className={num}>{p.unit.formatted}</td>
                      <td className={num}>{p.unitNet.formatted}</td>
                      <td className="text-[13px]">
                        {p.tiers.filter((t) => t.minQty > 1).length
                          ? p.tiers
                              .filter((t) => t.minQty > 1)
                              .map((t) => `${formatQty(t.minQty)}+ at ${t.unitNet.formatted}`)
                              .join(", ")
                          : "None"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          ) : (
            <p className="rounded-[var(--radius-tag)] bg-signal-tint px-3 py-2 text-sm text-signal">
              No price from the POS. Shoppers can&apos;t buy this SKU until it has a retail price.
            </p>
          )}
        </div>
        <div className="min-w-0 lg:col-span-2">
          <VariantFilters key={v.id} variant={v} attributes={attributes} path={path} />
        </div>
      </div>
    </article>
  );
}

type AttrRow = { key: string; attributeId: string; value: string };
const rowsFrom = (v: AdminVariant): AttrRow[] => v.attributes.map((a) => ({ key: rowKey(), attributeId: a.attributeId, value: a.value }));
const sig = (rows: AttrRow[]) => JSON.stringify(rows.map((r) => [r.attributeId, r.value.trim()]));

/** Filter values shoppers use in category pages (e.g. Size: 20 mm). Website-owned, so editable. */
function VariantFilters({ variant, attributes, path }: { variant: AdminVariant; attributes: AdminAttribute[]; path: string }) {
  const toast = useToast();
  const setData = useSetAdminData();
  const invalidate = useInvalidate();
  const canEditAttributes = useCan("catalog");
  const [rows, setRows] = useState<AttrRow[]>(() => rowsFrom(variant));
  const [saved, setSaved] = useState(() => sig(rowsFrom(variant)));
  const dirty = sig(rows) !== saved;
  useUnsavedWarning(dirty);

  const save = useMutation({
    mutationFn: () =>
      adminApi.put<AdminProductDetail>(`/admin/variants/${variant.id}/attributes`, {
        attributes: rows
          .filter((r) => r.attributeId && r.value.trim())
          .map((r) => ({ attributeId: r.attributeId, value: r.value.trim() })),
      }),
    onSuccess: (p) => {
      setData(path, p);
      void invalidate("/admin/products");
      const v = p.variants.find((x) => x.id === variant.id);
      const next = v ? rowsFrom(v) : [];
      setRows(next);
      setSaved(sig(next));
      toast(`Filters saved for ${variant.sku}`);
    },
  });

  const used = new Set(rows.map((r) => r.attributeId));
  const unitOf = (id: string) => attributes.find((a) => a.id === id)?.unit;

  return (
    <div className="rounded-[var(--radius-tag)] border border-dashed border-galv p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">Filters for this SKU</h4>
        <p className="text-[13px] text-steel">
          Values shoppers can filter by.{" "}
          {canEditAttributes && (
            <Link href="/admin/attributes" className="text-pipe underline underline-offset-2">
              Manage filter attributes
            </Link>
          )}
        </p>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={r.key} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <label className="w-full sm:w-56">
              <span className="sr-only">Filter {i + 1}</span>
              <select
                value={r.attributeId}
                onChange={(e) => setRows((list) => list.map((x, j) => (j === i ? { ...x, attributeId: e.target.value } : x)))}
                className={cn(inputClass, "h-9")}
              >
                <option value="">Choose a filter</option>
                {attributes.map((a) => (
                  <option key={a.id} value={a.id} disabled={used.has(a.id) && a.id !== r.attributeId}>
                    {a.name}
                    {a.unit ? ` (${a.unit})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1">
              <span className="sr-only">Value for filter {i + 1}</span>
              <input
                value={r.value}
                maxLength={100}
                placeholder={unitOf(r.attributeId) ? `Value in ${unitOf(r.attributeId)}` : "Value"}
                onChange={(e) => setRows((list) => list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                className={cn(inputClass, "h-9")}
              />
            </label>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows((list) => list.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-steel">No filter values yet.</p>}
        {rows.length < 30 && attributes.length > rows.length && (
          <div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRows((list) => [...list, { key: rowKey(), attributeId: "", value: "" }])}>
              <Plus className="size-4" aria-hidden />
              Add a filter value
            </Button>
          </div>
        )}
      </div>
      <SaveBar
        dirty={dirty}
        loading={save.isPending}
        error={save.error}
        onSave={() => save.mutate()}
        onDiscard={() => {
          setRows(rowsFrom(variant));
          save.reset();
        }}
        label={`Save filters for ${variant.sku}`}
      />
    </div>
  );
}
