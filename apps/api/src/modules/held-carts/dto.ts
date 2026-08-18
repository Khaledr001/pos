import { z } from "zod";

export const HoldCartSchema = z.object({
  branchId: z.string().uuid().optional(),
  /** e.g. "blue van guy" — often the only way to tell two parked carts apart. */
  label: z.string().trim().max(80).optional(),
  customerId: z.string().uuid().nullable().optional(),

  /**
   * The cart, as the terminal holds it.
   *
   * Deliberately unvalidated beyond "is an object". A held cart is a draft,
   * not a document: validating its lines here would reject a half-typed cart —
   * exactly the cart someone parks — and would need a migration for every
   * future cart field.
   */
  cartData: z.record(z.string(), z.unknown()),

  /** Shown in the list so a cashier can choose without restoring each one. */
  lineCount: z.coerce.number().int().min(0).default(0),
  total: z.coerce.number().min(0).default(0),

  /** Minted by the terminal. Holding a cart twice on a flaky link is one cart. */
  localId: z.string().uuid().optional(),
});
export type HoldCartDto = z.infer<typeof HoldCartSchema>;

export const ListHeldCartsSchema = z.object({
  branchId: z.string().uuid().optional(),
  /** Managers only; a cashier always sees their own regardless. */
  mine: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((v) => v === true || v === "true")
    .default(true),
});
export type ListHeldCartsDto = z.infer<typeof ListHeldCartsSchema>;
