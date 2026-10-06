import { DEFAULT_PAGE_SIZE, IMAGE_CANDIDATE_STATUSES } from "@devsfleet/shared-types";
import { z } from "zod";
import { zQueryBoolean } from "../../common/pipes/zod-validation.pipe.js";

const httpsUrl = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => {
      try {
        const u = new URL(v);
        return u.protocol === "https:" && !u.username && !u.password;
      } catch {
        return false;
      }
    }, "Must be an https:// URL without credentials");

/** A page can be http (it is only a link for a human); the image itself must be https. */
const pageUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => {
    try {
      return ["http:", "https:"].includes(new URL(v).protocol);
    } catch {
      return false;
    }
  }, "Must be an http(s) URL");

export const CandidateInputSchema = z.object({
  productId: z.string().uuid(),
  imageUrl: httpsUrl(2000),
  thumbnailUrl: httpsUrl(2000).optional(),
  sourcePageUrl: pageUrl,
  title: z.string().trim().max(500).optional(),
  width: z.coerce.number().int().min(1).max(100_000).optional(),
  height: z.coerce.number().int().min(1).max(100_000).optional(),
  matchScore: z.coerce.number().int().min(0).max(100).default(0),
  query: z.string().trim().max(500).optional(),
});
export type CandidateInput = z.infer<typeof CandidateInputSchema>;

export const BulkCandidatesSchema = z.object({
  candidates: z.array(CandidateInputSchema).min(1).max(500),
});
export type BulkCandidatesDto = z.infer<typeof BulkCandidatesSchema>;

export const ListCandidatesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  status: z.enum(IMAGE_CANDIDATE_STATUSES).default("pending"),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  q: z.string().trim().max(255).optional(),
  onlyWithoutImage: zQueryBoolean(true),
});
export type ListCandidatesDto = z.infer<typeof ListCandidatesSchema>;
