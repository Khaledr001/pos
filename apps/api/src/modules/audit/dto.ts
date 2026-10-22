import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "@devsfleet/shared-types";
import { z } from "zod";
import { sortSchema } from "../../common/db/list-query.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

export const ListAuditLogSchema = z.object({
  branchId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  entityType: z.string().trim().max(50).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  /** Action, entity type or the acting user's name. */
  q: z.string().trim().max(100).optional(),
  ...sortSchema(["createdAt", "action", "entityType"], { sortBy: "createdAt", sortOrder: "desc" }),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ListAuditLogDto = z.infer<typeof ListAuditLogSchema>;
