import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService, Tx } from '../../prisma/prisma.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { PosClient } from './pos-client.js';

export const OUTBOX_QUEUE = 'pos-outbox';
export const MAX_ATTEMPTS = 10;
const LEASE_MS = 2 * 60_000;

export type OutboundEventType =
  | 'order.created'
  | 'order.status_changed'
  | 'order.cancelled'
  | 'refund.created'
  | 'customer.trade_requested';

/** Retry delay: 30s, 1m, 2m, 4m ... capped at 1h. */
export function backoffMs(attempts: number) {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3_600_000);
}

/**
 * Transactional outbox. Callers write events in the same transaction as the
 * change, then call kick() after commit. A sweeper retries anything left
 * behind, so no event is lost if the POS or this process is down.
 */
@Injectable()
export class OutboxService implements OnModuleInit {
  private readonly logger = new Logger(OutboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly pos: PosClient,
  ) {}

  onModuleInit() {
    this.jobs.register(OUTBOX_QUEUE, (data: { id: string }) => this.dispatch(data.id), {
      attempts: 1, // retries are scheduled by the outbox itself
      concurrency: 5,
    });
  }

  async add(tx: Tx, type: OutboundEventType, aggregateId: string, data: Prisma.InputJsonValue) {
    const row = await tx.outboxEvent.create({
      data: { type, aggregateId, payload: data },
    });
    return row.id;
  }

  async kick(ids: string[]) {
    // Best effort: the sweeper retries anything that doesn't get queued here.
    for (const id of ids) {
      await this.jobs
        .enqueue(OUTBOX_QUEUE, { id })
        .catch((err: Error) => this.logger.error(`Could not queue outbox event ${id}: ${err.message}`));
    }
  }

  /** Sends one event. Never throws: failures are recorded and rescheduled. */
  async dispatch(id: string) {
    const now = new Date();
    // Lease: only one worker sends a given event at a time.
    const claimed = await this.prisma.outboxEvent.updateMany({
      where: { id, status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: now } },
      data: { nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    if (claimed.count === 0) return;

    const event = await this.prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
    if (!this.pos.configured) {
      // Keep it pending; it goes out once the POS URL is configured.
      await this.prisma.outboxEvent.update({
        where: { id },
        data: { nextAttemptAt: new Date(now.getTime() + 5 * 60_000), lastError: 'POS_BASE_URL not configured' },
      });
      return;
    }

    try {
      await this.pos.sendEvent({
        eventId: event.id,
        type: event.type,
        occurredAt: event.createdAt.toISOString(),
        data: event.payload,
      });
      await this.prisma.outboxEvent.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date(), lastError: null, attempts: { increment: 1 } },
      });
    } catch (err) {
      const attempts = event.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      await this.prisma.outboxEvent.update({
        where: { id },
        data: {
          attempts,
          status: dead ? 'DEAD' : 'FAILED',
          lastError: (err as Error).message.slice(0, 1000),
          nextAttemptAt: new Date(Date.now() + backoffMs(attempts)),
        },
      });
      this.logger.warn(`Outbox ${event.type} ${id} failed (attempt ${attempts}${dead ? ', now DEAD' : ''})`);
    }
  }

  /** Enqueues every event that is due. Runs on an interval. */
  async sweep() {
    const due = await this.prisma.outboxEvent.findMany({
      where: { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      take: 200,
    });
    await this.kick(due.map((d) => d.id));
    return due.length;
  }

  /** Admin: give a DEAD event another go. */
  async retry(id: string) {
    await this.prisma.outboxEvent.update({
      where: { id },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date() },
    });
    await this.kick([id]);
  }
}
