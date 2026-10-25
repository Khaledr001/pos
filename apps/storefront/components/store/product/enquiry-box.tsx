"use client";

import type { ProductDetail, PublicForm } from "@devsfleet/storefront-client";
import { MessageCircle, Phone, Send, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { StockBadge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { PriceTag } from "@/components/ui/price-tag";
import { cn } from "@/lib/cn";
import { formatQty, uomShort, whatsappLink } from "@/lib/format";
import { useSite, useStoreConfig } from "@/lib/store-config";
import { LeadForm } from "../lead-form";
import { TileCalculator } from "./tile-calculator";
import { OptionAxes, useVariantSelection } from "./variant-options";

/** The enquiry form in a native <dialog>: focus is trapped, Escape closes it, the page behind is inert. */
function EnquiryDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  const labelId = "enquiry-title";
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelId}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto max-h-[92vh] w-[min(94vw,36rem)] overflow-y-auto rounded-[var(--radius-panel)] bg-paper p-0 text-ink backdrop:bg-ink/60"
    >
      {open && (
        <div className="p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 id={labelId} className="text-2xl">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-2 inline-flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-tag)] hover:bg-galv/60">
              <X className="size-5" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/**
 * What stands where the buy box would on a catalogue site: choose an option,
 * see its price (when the site shows prices) and stock, then ask — through the
 * enquiry form, WhatsApp or a phone call, whichever the shop switched on.
 */
export function EnquiryBox({
  product,
  form,
  pageUrl,
  storeName,
  phone,
  whatsapp,
}: {
  product: ProductDetail;
  /** The shop's enquiry form, or null when it has none (then only WhatsApp and call can show). */
  form: PublicForm | null;
  /** Absolute address of this product page, for the WhatsApp message. */
  pageUrl: string;
  storeName: string;
  phone: string;
  whatsapp: string;
}) {
  const { site, features } = useSite();
  const { region } = useStoreConfig();
  const { selected, variant, choose, available } = useVariantSelection(product);
  const [open, setOpen] = useState(false);
  const [boxes, setBoxes] = useState<number | null>(null);

  const name = product.name;
  const label = product.optionAxes.map((a) => selected[a.code]).filter(Boolean).join(" / ");
  const unit = variant.units[0];
  const price = features.prices ? (unit?.price ?? null) : null;
  const boxUnit = variant.baseUom === "sqm" ? variant.units.find((u) => u.uom === "box") : undefined;
  const showForm = site.enquiry.form && form;
  const showWhatsapp = site.enquiry.whatsapp && !!whatsapp;
  const showCall = site.enquiry.call && !!phone;

  const subject = `${name}${label ? ` (${label})` : ""}`;
  const waText = `Hello ${storeName}, I'd like to enquire about ${subject}, SKU ${variant.sku}: ${pageUrl}`;
  const message = `Enquiry about ${subject}, SKU ${variant.sku}.`;
  const sourcePath = `${new URL(pageUrl).pathname}?sku=${encodeURIComponent(variant.sku)}`;

  return (
    <div className="space-y-5">
      <OptionAxes product={product} selected={selected} available={available} onChoose={choose} />

      <div className="rounded-[var(--radius-panel)] border border-galv bg-paper p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {price && unit ? (
            <div>
              <PriceTag price={price.unit} uom={unit.uom} was={price.discounted ? price.retailUnit : null} size="xl" />
              <p className="mt-1 text-sm text-steel">
                Incl. {Number(product.taxPercent)}% {region.taxLabel}
              </p>
            </div>
          ) : (
            <p className="font-cond text-2xl font-semibold">Enquire for price</p>
          )}
          <StockBadge label={variant.availability.label} />
        </div>

        {price && variant.units.length > 1 && (
          <table className="mt-4 w-full text-[15px]">
            <caption className="mb-1 text-left text-sm font-medium">Also sold by</caption>
            <tbody>
              {variant.units.slice(1).map((u) =>
                u.price ? (
                  <tr key={u.uom} className="border-t border-galv">
                    <td className="py-1.5">
                      {uomShort(u.uom)}
                      {u.factor !== 1 && <span className="text-steel"> ({formatQty(u.factor)} {uomShort(variant.baseUom)})</span>}
                    </td>
                    <td className="py-1.5 text-right font-cond text-lg font-semibold">{u.price.unit.formatted}</td>
                  </tr>
                ) : null,
              )}
            </tbody>
          </table>
        )}

        {(showForm || showWhatsapp || showCall) ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {showForm && (
              <Button size="lg" className="min-w-40 flex-1" onClick={() => setOpen(true)}>
                <Send className="size-5" aria-hidden /> Enquire
              </Button>
            )}
            {showWhatsapp && (
              <a href={whatsappLink(whatsapp, waText)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "lg", "flex-1")}>
                <MessageCircle className="size-5" aria-hidden /> WhatsApp
              </a>
            )}
            {showCall && (
              <a href={`tel:${phone.replace(/\s/g, "")}`} className={buttonClass("secondary", "lg", "flex-1")}>
                <Phone className="size-5" aria-hidden /> Call us
              </a>
            )}
          </div>
        ) : (
          <p className="mt-4 text-[15px] text-steel">Contact us for availability and a quote.</p>
        )}
        {boxes != null && <p className={cn("mt-3 rounded-[var(--radius-tag)] bg-pipe-tint px-3 py-2 text-[15px] text-pipe-dark")}>{boxes} boxes noted for your enquiry.</p>}
      </div>

      {boxUnit && <TileCalculator boxArea={boxUnit.factor} onUse={setBoxes} />}

      <p className="text-sm text-steel">SKU {variant.sku}</p>

      {showForm && form && (
        <EnquiryDialog open={open} onClose={() => setOpen(false)} title={`Enquire about ${name}`}>
          <LeadForm
            form={form}
            compact
            source={{ productId: product.id, path: sourcePath }}
            initialValues={{ message, ...(boxes ? { quantity: `${boxes} boxes` } : {}) }}
          />
        </EnquiryDialog>
      )}
    </div>
  );
}
