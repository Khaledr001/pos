import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@devsfleet/shared-types";
import { z } from "zod";
import { zQueryBoolean } from "../../common/pipes/zod-validation.pipe.js";

/**
 * REFERENCE MODULE — DTOs
 *
 * `branches` is the worked example every other module copies. It is small
 * enough to read in one sitting and exercises the whole stack: Zod validation,
 * permission guards, tenant-scoped queries, pagination, soft delete.
 *
 * See docs/PATTERNS.md before writing a new module.
 */

export const CreateBranchSchema = z.object({
  name: z.string().trim().min(1).max(255),
  /**
   * Appears in document numbers (INV-DXB-2026-000001), so keep it short and
   * stable.
   *
   * `.toUpperCase()` comes BEFORE `.regex()`. Zod applies checks in order, so
   * with a trailing `.transform()` the pattern would run against the raw input
   * and reject `"auh"` instead of normalising it — which is exactly what a user
   * types.
   */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9]+$/, "Code must be letters and digits only"),
  address: z.string().max(1000).optional(),
  phone: z.string().max(20).optional(),
  email: z.string().email().max(255).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type CreateBranchDto = z.infer<typeof CreateBranchSchema>;

/**
 * `.partial()` on the create schema rather than a hand-written update schema.
 * A field added to create is then automatically updatable, and the two can
 * never disagree about validation rules.
 *
 * `code` is omitted: it is embedded in every document number already issued by
 * this branch, so changing it would orphan that history.
 */
export const UpdateBranchSchema = CreateBranchSchema.omit({ code: true })
  .partial()
  .extend({ isActive: z.boolean().optional() });
export type UpdateBranchDto = z.infer<typeof UpdateBranchSchema>;

export const ListBranchesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  q: z.string().trim().max(255).optional(),
  /** Defaults to active only — the common case is a picker, not an audit. */
  includeInactive: zQueryBoolean(false),
  sortBy: z.enum(["name", "code", "createdAt"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});
export type ListBranchesDto = z.infer<typeof ListBranchesSchema>;
