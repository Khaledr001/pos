import { z } from "zod";

/** `POST /storefront/forms/:slug/submit`. Answers are validated against the form's own definition by the service. */
export const SubmitFormSchema = z.object({
  values: z
    .record(z.string().max(40), z.union([z.string().max(5000), z.number().finite(), z.boolean()]))
    .refine((v) => Object.keys(v).length <= 40, { message: "Too many fields" }),
  source: z
    .object({
      path: z
        .string()
        .trim()
        .max(300)
        .regex(/^\/(?![/\\])[^\s]*$/, "A path on this site")
        .optional(),
      productId: z.string().uuid().optional(),
    })
    .optional(),
  /** Honeypot: a real form leaves it empty. */
  website: z.string().max(200).optional(),
  /** Epoch ms when the form was shown. */
  startedAt: z.number().int().optional(),
});
export type SubmitFormDto = z.infer<typeof SubmitFormSchema>;
