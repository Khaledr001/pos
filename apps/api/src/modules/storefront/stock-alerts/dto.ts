import { z } from "zod";
import { uaePhone } from "../wire.js";

const email = z.string().trim().toLowerCase().pipe(z.email().max(255));

export const SubscribeStockAlertSchema = z.object({
  variantId: z.string().uuid(),
  email,
  /** Optional; an empty box on the form is "no phone", not a validation error. */
  phone: z.union([z.literal("").transform(() => undefined), uaePhone]).optional(),
  /**
   * Honeypot. Hidden from people, so only a script fills it. The request is
   * answered as a success and nothing is stored, which tells the bot nothing.
   */
  website: z.string().max(200).optional(),
});
export type SubscribeStockAlertDto = z.infer<typeof SubscribeStockAlertSchema>;
