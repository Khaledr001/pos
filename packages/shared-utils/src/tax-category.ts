import {
  TAX_CATEGORY_LABELS,
  type TaxCategory,
  type TaxExemptionCode,
} from "@devsfleet/shared-types";
import { toMinor } from "./money.js";
import { AppError, ERROR_CODES } from "./result.js";

export interface ProductTax {
  /** null = inherit the tenant's default rate. */
  taxRate: string | null;
  taxCategory: TaxCategory;
  taxExemptionCode: TaxExemptionCode | null;
}

/** What a request may say about a product's tax. Absent = leave as it is. */
export interface ProductTaxInput {
  taxRate?: number | string | null | undefined;
  taxCategory?: TaxCategory | undefined;
  taxExemptionCode?: TaxExemptionCode | null | undefined;
}

const NEW_PRODUCT: ProductTax = { taxRate: null, taxCategory: "S", taxExemptionCode: null };

const isPositive = (rate: string | number) => toMinor(String(rate)) > 0n;

/**
 * The tax fields a product write results in, or the reason it cannot be.
 *
 * A rate alone cannot say whether a 0% product is zero-rated, exempt or out of
 * scope, and the three are reported to the tax authority differently — so a
 * product carries a category, and the two must agree: standard-rated (S) needs
 * a rate above 0 (or none, to inherit the tenant's), every other category is
 * 0%. Convenience over ceremony where the intent is unambiguous:
 *
 *   - naming only a rate of 0 means "zero-rated" (what it always meant here);
 *   - naming only a non-standard category sets the rate to 0;
 *   - moving a 0% product back to S clears the rate so it inherits again.
 *
 * Contradictions the caller spelled out (S with 0%, Z with 5%, an exemption
 * reason on a non-exempt product) are refused, never silently "fixed".
 *
 * `current` is the stored product for an update; omit it for a create. The
 * result is the COMPLETE trio to write, so callers never merge half a state.
 */
export function resolveProductTax(input: ProductTaxInput, current: ProductTax = NEW_PRODUCT): ProductTax {
  const rateGiven = input.taxRate !== undefined;
  const categoryGiven = input.taxCategory !== undefined;
  const rateInput = input.taxRate === null || input.taxRate === undefined ? null : String(input.taxRate);

  let category: TaxCategory = input.taxCategory ?? current.taxCategory;
  let rate: string | null = rateGiven ? rateInput : current.taxRate;

  if (rateGiven && !categoryGiven && rate !== null) {
    // Only a rate was named: derive what it means.
    // A positive rate is standard-rated; 0% keeps a non-standard category the
    // product already had, and otherwise means zero-rated.
    category = isPositive(rate) ? "S" : current.taxCategory === "S" ? "Z" : current.taxCategory;
  }

  if (category === "S") {
    // Coming back from a non-standard category: the 0% it carried is not a rate to keep.
    if (categoryGiven && !rateGiven && rate !== null && !isPositive(rate)) rate = null;
    if (rate !== null && !isPositive(rate)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        "A standard-rated product needs a VAT rate above 0%. For 0% choose Zero-rated, Exempt or Out of scope.",
      );
    }
  } else {
    if (rateGiven && rate !== null && isPositive(rate)) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        `${TAX_CATEGORY_LABELS[category]} products carry 0% VAT. Remove the rate, or choose Standard rate.`,
      );
    }
    rate = "0";
  }

  let code: TaxExemptionCode | null = input.taxExemptionCode === undefined ? current.taxExemptionCode : input.taxExemptionCode;
  if (category !== "E") {
    if (input.taxExemptionCode) {
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, "An exemption reason only applies to Exempt products.");
    }
    code = null;
  }

  return { taxRate: rate, taxCategory: category, taxExemptionCode: code };
}

/** The VAT treatment frozen onto a document line. */
export interface LineTax {
  taxPercent: string;
  taxCategory: TaxCategory;
  taxExemptionCode: TaxExemptionCode | null;
}

/**
 * What a new document line records about VAT: the rate in force and the
 * category it is reported under (rule 5 — a later change to the product never
 * rewrites an issued invoice).
 *
 * The product's category wins over a stray rate: a zero-rated, exempt or
 * out-of-scope product is 0% whatever the tenant default is, and a "standard"
 * product with no rate to charge is reported as zero-rated rather than as a
 * standard line carrying 0%, which PINT AE would reject.
 */
export function lineTaxFor(
  product: { taxRate: string | null; taxCategory: TaxCategory; taxExemptionCode: TaxExemptionCode | null },
  tenantDefaultRate: number | string,
): LineTax {
  if (product.taxCategory !== "S") {
    return {
      taxPercent: "0",
      taxCategory: product.taxCategory,
      taxExemptionCode: product.taxCategory === "E" ? product.taxExemptionCode : null,
    };
  }
  const rate = product.taxRate ?? String(tenantDefaultRate);
  return {
    taxPercent: rate,
    taxCategory: isPositive(rate) ? "S" : "Z",
    taxExemptionCode: null,
  };
}

/**
 * The category for a line whose rate was already decided elsewhere (the online
 * store prices lines through its own resolver): keep the product's category
 * when it agrees with the rate, otherwise fall back to what the rate implies.
 */
export function categoryForResolvedRate(
  product: { taxCategory: TaxCategory; taxExemptionCode: TaxExemptionCode | null },
  taxPercent: string,
): Pick<LineTax, "taxCategory" | "taxExemptionCode"> {
  const positive = isPositive(taxPercent);
  if (product.taxCategory === "S" ? positive : !positive) {
    return {
      taxCategory: product.taxCategory,
      taxExemptionCode: product.taxCategory === "E" ? product.taxExemptionCode : null,
    };
  }
  return { taxCategory: positive ? "S" : "Z", taxExemptionCode: null };
}
