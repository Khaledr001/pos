"use client";

import React from "react";
import {
  EAS_UAE_TIN,
  UAE_SUBDIVISIONS,
  UAE_SUBDIVISION_LABELS,
} from "@devsfleet/shared-types";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { isValidTrn, normalizeTrn, tinFromTrn, type EinvoiceCustomerFields } from "@/lib/einvoice";

/**
 * The TRN input with live feedback: a wrong number says so, a right one shows
 * the TIN it contains and the Peppol address an e-invoice to it will use.
 */
export function TrnField({
  value,
  onChange,
  id,
  label = "TRN (Tax Registration Number)",
  placeholder = "100234567800003",
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
  label?: string;
  placeholder?: string;
}) {
  const filled = value.trim().length > 0;
  const valid = isValidTrn(value);
  const tin = valid ? tinFromTrn(value) : null;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-foreground mb-1.5">{label}</label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="off"
        aria-invalid={filled && !valid}
        aria-describedby={`${id}-hint`}
        className="font-mono"
      />
      <p id={`${id}-hint`} className={filled && !valid ? "mt-1 text-[11px] text-destructive" : "mt-1 text-[11px] text-muted-foreground"}>
        {!filled
          ? "A UAE TRN is 15 digits starting with 100. Needed to e-invoice a business."
          : valid
            ? `TIN ${tin} · Peppol address ${EAS_UAE_TIN}:${tin}${normalizeTrn(value) !== value.trim() ? " · spaces and dashes will be removed" : ""}`
            : "A UAE TRN is 15 digits starting with 100."}
      </p>
    </div>
  );
}

/**
 * The structured address an e-invoice is built from, plus the optional Peppol
 * address override. The free-text address elsewhere on the form is still what
 * prints on a receipt.
 */
export function EinvoiceAddressFields({
  value,
  onChange,
  idPrefix,
}: {
  value: EinvoiceCustomerFields;
  onChange: (patch: Partial<EinvoiceCustomerFields>) => void;
  idPrefix: string;
}) {
  const isUae = (value.addressCountry || "AE").toUpperCase() === "AE";
  const peppolHalf = !!value.einvoiceScheme.trim() !== !!value.einvoiceEndpoint.trim();
  const label = "block text-xs font-medium text-foreground mb-1.5";
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        Used on electronic tax invoices. The free-text address above still prints on receipts and quotations.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${idPrefix}-line1`} className={label}>Address line 1</label>
          <Input id={`${idPrefix}-line1`} maxLength={200} value={value.addressLine1} onChange={(e) => onChange({ addressLine1: e.target.value })} placeholder="Building, street" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={`${idPrefix}-line2`} className={label}>Address line 2</label>
          <Input id={`${idPrefix}-line2`} maxLength={200} value={value.addressLine2} onChange={(e) => onChange({ addressLine2: e.target.value })} placeholder="Area, landmark (optional)" />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-city`} className={label}>City</label>
          <Input id={`${idPrefix}-city`} maxLength={100} value={value.addressCity} onChange={(e) => onChange({ addressCity: e.target.value })} placeholder="Sharjah" />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-sub`} className={label}>{isUae ? "Emirate" : "Region / state"}</label>
          {isUae ? (
            <SelectField
              id={`${idPrefix}-sub`}
              size="sm"
              label="Emirate"
              placeholder="— Select emirate —"
              value={value.addressSubdivision}
              onValueChange={(v) => onChange({ addressSubdivision: v })}
              options={UAE_SUBDIVISIONS.map((s) => ({ value: s, label: `${UAE_SUBDIVISION_LABELS[s]} (${s})` }))}
            />
          ) : (
            <Input id={`${idPrefix}-sub`} maxLength={20} value={value.addressSubdivision} onChange={(e) => onChange({ addressSubdivision: e.target.value })} />
          )}
        </div>
        <div>
          <label htmlFor={`${idPrefix}-post`} className={label}>Postal code</label>
          <Input id={`${idPrefix}-post`} maxLength={20} value={value.addressPostalCode} onChange={(e) => onChange({ addressPostalCode: e.target.value })} placeholder="Optional" />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-country`} className={label}>Country (ISO code)</label>
          <Input id={`${idPrefix}-country`} maxLength={2} value={value.addressCountry} onChange={(e) => onChange({ addressCountry: e.target.value.toUpperCase() })} className="font-mono uppercase" placeholder="AE" />
        </div>
      </div>

      <details className="rounded-lg border border-border p-3">
        <summary className="cursor-pointer text-xs font-medium text-foreground">Peppol address (only if it is not their TIN)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_1fr]">
          <div>
            <label htmlFor={`${idPrefix}-scheme`} className={label}>Scheme</label>
            <Input id={`${idPrefix}-scheme`} maxLength={4} value={value.einvoiceScheme} onChange={(e) => onChange({ einvoiceScheme: e.target.value })} placeholder={EAS_UAE_TIN} className="font-mono" />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-endpoint`} className={label}>Identifier</label>
            <Input id={`${idPrefix}-endpoint`} maxLength={100} value={value.einvoiceEndpoint} onChange={(e) => onChange({ einvoiceEndpoint: e.target.value })} className="font-mono" />
          </div>
        </div>
        {peppolHalf && <p role="alert" className="mt-2 text-[11px] text-destructive">Enter both a scheme and an identifier, or neither.</p>}
        <p className="mt-2 text-[11px] text-muted-foreground">Leave blank to use their TIN (scheme {EAS_UAE_TIN}), taken from the TRN.</p>
      </details>
    </div>
  );
}
