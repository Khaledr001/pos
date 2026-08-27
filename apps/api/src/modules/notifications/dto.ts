import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, NOTIFICATION_TYPES } from "@devsfleet/shared-types";
import { z } from "zod";

export const ListNotificationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  unreadOnly: z.coerce.boolean().default(false),
  type: z.enum(NOTIFICATION_TYPES).optional(),
});
export type ListNotificationsDto = z.infer<typeof ListNotificationsSchema>;

export const MarkAllReadSchema = z.object({
  /** Omitted clears every type; set to clear just one, e.g. "low stock only". */
  type: z.enum(NOTIFICATION_TYPES).optional(),
});
export type MarkAllReadDto = z.infer<typeof MarkAllReadSchema>;
