import { DELIVERY_METHODS, WEB_PAYMENT_METHODS } from "@devsfleet/shared-types";
import { z } from "zod";
import { AddressSchema, emirate, uaePhone, uaeTrn, wireEnum } from "../wire.js";

export const QuoteSchema = z.object({
  deliveryMethod: wireEnum(DELIVERY_METHODS).optional(),
  emirate: emirate.optional(),
  pickupBranchId: z.string().uuid().optional(),
});
export type QuoteDto = z.infer<typeof QuoteSchema>;

export const PlaceOrderSchema = z
  .object({
    /**
     * Minted by the browser once per checkout attempt and resent on every
     * retry. A double click, or a retry after a timeout, returns the order
     * already placed instead of placing a second one.
     */
    idempotencyKey: z.string().uuid().optional(),
    deliveryMethod: wireEnum(DELIVERY_METHODS),
    contact: z.object({
      fullName: z.string().trim().min(2).max(120),
      email: z.string().trim().toLowerCase().pipe(z.email().max(255)),
      phone: uaePhone,
    }),
    address: AddressSchema.optional(),
    addressId: z.string().uuid().optional(),
    saveAddress: z.boolean().optional(),
    pickupBranchId: z.string().uuid().optional(),
    pickupSlotStart: z.string().datetime().optional(),
    paymentMethod: wireEnum(WEB_PAYMENT_METHODS),
    companyName: z.string().trim().max(200).optional(),
    trn: uaeTrn.optional(),
    notes: z.string().trim().max(1000).optional(),
    /** The total the shopper was shown, in fils. A mismatch means they would pay something they did not see. */
    expectedTotalFils: z.number().int().min(0).optional(),
  })
  .refine((dto) => dto.deliveryMethod !== "pickup" || (dto.pickupBranchId && dto.pickupSlotStart), {
    message: "Choose a branch and a pickup time",
    path: ["pickupSlotStart"],
  })
  .refine((dto) => dto.deliveryMethod !== "courier" || dto.address || dto.addressId, {
    message: "A delivery address is required",
    path: ["address"],
  });
export type PlaceOrderDto = z.infer<typeof PlaceOrderSchema>;
