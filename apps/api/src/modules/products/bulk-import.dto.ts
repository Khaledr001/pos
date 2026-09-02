import { z } from "zod";
import { zQueryBoolean } from "../../common/pipes/zod-validation.pipe.js";

export const BulkImportOptionsSchema = z.object({
  /** Branch to post opening stock against. Required when any row has stock. */
  branchId: z.string().uuid().optional(),
  /** Defaults to true — nothing is written until explicitly set to false. */
  dryRun: zQueryBoolean(true),
});
export type BulkImportOptionsDto = z.infer<typeof BulkImportOptionsSchema>;

export interface BulkImportRowError {
  row: number;
  reason: string;
}

export interface BulkImportResult {
  created: number;
  /** A row whose SKU already exists is skipped, not updated — see `errors`. */
  rejected: number;
  /** Categories and brands that were auto-created (or would be, in dry-run). */
  autoCreated: {
    categories: string[];
    brands: string[];
  };
  errors: BulkImportRowError[];
  dryRun: boolean;
}
