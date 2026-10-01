import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ZodError } from 'zod';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import { PosEventHandler, RetryableEventError } from './pos-event-handler.service.js';
import { PosEnvelope } from './pos-events.js';

export const INBOUND_QUEUE = 'pos-inbound';

/**
 * Stores each POS event once (unique eventId), answers 202, then applies it
 * from a queue. Invalid payloads fail permanently; "not yet" errors retry.
 */
@Injectable()
export class InboundService implements OnModuleInit {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly handler: PosEventHandler,
  ) {}

  onModuleInit() {
    this.jobs.register(INBOUND_QUEUE, (d: { id: string }) => this.process(d.id), {
      attempts: 8,
      concurrency: 1, // apply POS events in arrival order
    });
  }

  async receive(envelope: PosEnvelope): Promise<'accepted' | 'duplicate'> {
    const inserted = await this.prisma.inboundEvent.createManyAndReturn({
      data: [
        {
          eventId: envelope.eventId,
          type: envelope.type,
          payload: (envelope.data ?? null) as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
    if (!inserted.length) return 'duplicate';
    // The event is stored; if queueing fails the sweeper picks it up.
    await this.jobs
      .enqueue(INBOUND_QUEUE, { id: inserted[0].id })
      .catch((err: Error) => this.logger.error(`Could not queue POS event ${envelope.eventId}: ${err.message}`));
    return 'accepted';
  }

  async process(id: string) {
    const event = await this.prisma.inboundEvent.findUnique({ where: { id } });
    if (!event || event.status === 'PROCESSED' || event.status === 'SKIPPED') return;

    await this.prisma.inboundEvent.update({ where: { id }, data: { attempts: { increment: 1 } } });
    try {
      const result = await this.handler.handle({
        eventId: event.eventId,
        type: event.type,
        data: event.payload,
      });
      await this.prisma.inboundEvent.update({
        where: { id },
        data: { status: result === 'applied' ? 'PROCESSED' : 'SKIPPED', processedAt: new Date(), error: null },
      });
    } catch (err) {
      const message =
        err instanceof ZodError
          ? `Invalid payload: ${err.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`
          : (err as Error).message;
      await this.prisma.inboundEvent.update({
        where: { id },
        data: { status: 'FAILED', error: message.slice(0, 2000) },
      });
      this.logger.warn(`POS event ${event.type} ${event.eventId} failed: ${message}`);
      if (err instanceof RetryableEventError) throw err; // let the queue retry
    }
  }

  /** Admin: re-run a failed event. */
  async retry(id: string) {
    await this.prisma.inboundEvent.update({ where: { id }, data: { status: 'RECEIVED' } });
    await this.jobs.enqueue(INBOUND_QUEUE, { id });
  }

  /** Re-queues events that were stored but never processed (e.g. Redis was down). */
  async sweep() {
    const stuck = await this.prisma.inboundEvent.findMany({
      where: { status: 'RECEIVED', receivedAt: { lt: new Date(Date.now() - 60_000) } },
      orderBy: { receivedAt: 'asc' },
      select: { id: true },
      take: 200,
    });
    for (const e of stuck) await this.jobs.enqueue(INBOUND_QUEUE, { id: e.id });
    return stuck.length;
  }
}
