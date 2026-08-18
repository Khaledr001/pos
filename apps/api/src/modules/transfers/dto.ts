import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, TRANSFER_STATUSES } from "@devsfleet/shared-types";
import { z } from "zod";

export const CreateTransferSchema = z
  .object({
    fromBranchId: z.string().uuid(),
    toBranchId: z.string().uuid(),
    items: z
      .array(
        z.object({
          variantId: z.string().uuid(),
          quantity: z.coerce.number().positive("Quantity must be positive"),
        }),
      )
      .min(1, "A transfer must contain at least one item"),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.fromBranchId !== v.toBranchId, {
    message: "Source and destination branches must differ",
    path: ["toBranchId"],
  });

export type CreateTransferDto = z.infer<typeof CreateTransferSchema>;

export const ListTransfersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  status: z.enum(TRANSFER_STATUSES).optional(),
  /** If provided, returns transfers where this branch is either the source or destination */
  branchId: z.string().uuid().optional(),
  /** Optional filter for specifically incoming or outgoing relative to the branchId */
  direction: z.enum(["incoming", "outgoing"]).optional(),
});

export type ListTransfersDto = z.infer<typeof ListTransfersSchema>;
