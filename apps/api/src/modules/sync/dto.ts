import { SYNC_ENTITIES } from "@devsfleet/shared-types";
import { z } from "zod";

/**
 * Mirrors SyncPushRequest / SyncPullRequest in @devsfleet/shared-types.
 *
 * Validated at the boundary rather than trusted, because a terminal that has
 * been offline for a fortnight may be running an older build than the server.
 */
export const SyncPushSchema = z.object({
  deviceId: z.string().uuid(),
  lastCheckpoint: z.string().nullable().default(null),
  items: z
    .array(
      z.object({
        localId: z.string().uuid(),
        entity: z.enum(SYNC_ENTITIES),
        sequence: z.coerce.number().int().min(0),
        occurredAt: z.string().datetime(),
        payload: z.record(z.string(), z.unknown()),
      }),
    )
    // Capped so one terminal cannot hold a write transaction open for minutes
    // after a long outage. It simply pushes several batches.
    .max(200, "Push at most 200 items per batch"),
});
export type SyncPushDto = z.infer<typeof SyncPushSchema>;

export const SyncPullSchema = z.object({
  deviceId: z.string().uuid(),
  /** null = first sync, meaning a full catalogue snapshot. */
  since: z.string().nullable().default(null),
  entities: z.array(z.enum(SYNC_ENTITIES)).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export type SyncPullDto = z.infer<typeof SyncPullSchema>;
