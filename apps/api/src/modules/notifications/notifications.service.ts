import { and, count, desc, eq, schema, sql } from "@devsfleet/db";
import type { Notification } from "@devsfleet/db";
import type { NotificationSeverity, NotificationType, Paginated } from "@devsfleet/shared-types";
import { AppError, ERROR_CODES } from "@devsfleet/shared-utils";
import { Injectable } from "@nestjs/common";
import { RequestContext } from "../../common/context/request-context.js";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import type { ListNotificationsDto, MarkAllReadDto } from "./dto.js";

export interface NotifyInput {
  tenantId: string;
  userId: string;
  branchId?: string | null;
  type: NotificationType;
  severity?: NotificationSeverity;
  title: string;
  message: string;
  /** Both present or both absent — a partial reference cannot dedupe. */
  referenceType?: string;
  referenceId?: string;
}

/**
 * A user's own inbox.
 *
 * Every route this backs is self-scoped: `RequestContext.requireUser().id`
 * is the filter on every query, never an id taken from the request. There is
 * no route here that reads or edits another user's notifications, which is
 * why the controller carries no @RequirePermissions — see its doc comment.
 *
 * `notify()` is the one method NOT self-scoped. It is called from event
 * listeners, which run after the request that triggered them has already
 * responded, so it takes an explicit tenantId and goes through `runAs()`
 * rather than `run()` — the same pattern TenantDatabase documents for
 * background jobs arriving with no session.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly db: TenantDatabase) {}

  async list(query: ListNotificationsDto): Promise<Paginated<Notification>> {
    const userId = RequestContext.requireUser().id;
    const { page, limit, unreadOnly, type } = query;
    const offset = (page - 1) * limit;

    const where = and(
      eq(schema.notifications.userId, userId),
      unreadOnly ? eq(schema.notifications.isRead, false) : undefined,
      type ? eq(schema.notifications.type, type) : undefined,
    );

    return this.db.run(async (tx) => {
      const [items, [totals]] = await Promise.all([
        tx
          .select()
          .from(schema.notifications)
          .where(where)
          .orderBy(desc(schema.notifications.createdAt))
          .limit(limit)
          .offset(offset),
        tx.select({ value: count() }).from(schema.notifications).where(where),
      ]);

      const total = totals?.value ?? 0;
      const totalPages = Math.max(1, Math.ceil(total / limit));

      return {
        items,
        meta: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      };
    });
  }

  /** The panel badge's only dependency — cheap enough to be the socket's fallback poll. */
  async unreadCount(): Promise<{ total: number; byType: Record<string, number> }> {
    const userId = RequestContext.requireUser().id;

    return this.db.run(async (tx) => {
      const rows = await tx
        .select({ type: schema.notifications.type, value: count() })
        .from(schema.notifications)
        .where(and(eq(schema.notifications.userId, userId), eq(schema.notifications.isRead, false)))
        .groupBy(schema.notifications.type);

      let total = 0;
      const byType: Record<string, number> = {};
      for (const row of rows) {
        byType[row.type] = row.value;
        total += row.value;
      }
      return { total, byType };
    });
  }

  async markRead(id: string): Promise<Notification> {
    const userId = RequestContext.requireUser().id;

    return this.db.run(async (tx) => {
      const [row] = await tx
        .update(schema.notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)))
        .returning();

      if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, `Notification ${id} not found`);
      return row;
    });
  }

  async markAllRead(dto: MarkAllReadDto): Promise<{ updated: number }> {
    const userId = RequestContext.requireUser().id;

    return this.db.run(async (tx) => {
      const rows = await tx
        .update(schema.notifications)
        .set({ isRead: true, readAt: new Date() })
        .where(
          and(
            eq(schema.notifications.userId, userId),
            eq(schema.notifications.isRead, false),
            dto.type ? eq(schema.notifications.type, dto.type) : undefined,
          ),
        )
        .returning({ id: schema.notifications.id });

      return { updated: rows.length };
    });
  }

  async remove(id: string): Promise<void> {
    const userId = RequestContext.requireUser().id;

    await this.db.run(async (tx) => {
      const [row] = await tx
        .delete(schema.notifications)
        .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)))
        .returning({ id: schema.notifications.id });

      if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, `Notification ${id} not found`);
    });
  }

  /**
   * Write one recipient's row — or refresh it, if an unread one already
   * exists for the same (user, type, referenceType, referenceId).
   *
   * The refresh IS the dedupe: uq_notifications_dedupe is a partial unique
   * index on exactly those four columns, scoped to unread rows with a
   * reference. A second crossing while the first is still unread updates
   * title/message/createdAt in place instead of stacking a duplicate; once
   * read, a fresh crossing is free to notify again.
   */
  async notify(input: NotifyInput): Promise<Notification> {
    const hasReference = Boolean(input.referenceType && input.referenceId);

    const [row] = await this.db.runAs(input.tenantId, async (tx) => {
      const insert = tx.insert(schema.notifications).values({
        tenantId: input.tenantId,
        userId: input.userId,
        branchId: input.branchId ?? null,
        type: input.type,
        severity: input.severity ?? "info",
        title: input.title,
        message: input.message,
        ...(hasReference
          ? { referenceType: input.referenceType, referenceId: input.referenceId }
          : {}),
      });

      if (!hasReference) return insert.returning();

      return insert
        .onConflictDoUpdate({
          target: [
            schema.notifications.userId,
            schema.notifications.type,
            schema.notifications.referenceType,
            schema.notifications.referenceId,
          ],
          targetWhere: sql`is_read = false and reference_id is not null`,
          set: {
            severity: input.severity ?? "info",
            title: input.title,
            message: input.message,
            createdAt: new Date(),
          },
        })
        .returning();
    });

    if (!row) throw new AppError(ERROR_CODES.INTERNAL_ERROR, "Failed to write a notification");
    return row;
  }
}
