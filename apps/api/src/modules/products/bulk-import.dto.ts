import { z } from "zod";
import { zQueryBoolean } from "../../common/pipes/zod-validation.pipe.js";

export const BulkImportOptionsSchema = z.object({
  /** Branch to post opening stock against. Required when any row has stock. */
  branchId: z.string().uuid().optional(),
  /** Defaults to true — nothing is written until explicitly set to false. */
  dryRun: zQueryBoolean(true),
  /**
   * A row naming a product that already exists moves that product to the
   * row's category instead of being skipped. Nothing else about it changes.
   */
  moveExisting: zQueryBoolean(false),
});
export type BulkImportOptionsDto = z.infer<typeof BulkImportOptionsSchema>;

export interface BulkImportRowError {
  row: number;
  /** Set when the workbook has more than one product sheet. */
  sheet?: string;
  reason: string;
}

export interface BulkImportResult {
  created: number;
  /** A row whose SKU already exists is skipped, not updated — see `errors`. */
  rejected: number;
  /** Existing products moved to the row's category (`moveExisting` only). */
  recategorized: number;
  /** Categories and brands that were auto-created (or would be, in dry-run). */
  autoCreated: {
    /** A sub-category reads "Parent / Child". */
    categories: string[];
    brands: string[];
    /** Existing flat categories moved under the parent the sheet names, as "Parent / Child". */
    regrouped: string[];
  };
  errors: BulkImportRowError[];
  dryRun: boolean;
}
