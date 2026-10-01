import {
  Global,
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { AppConfig } from '../../config/app-config.service.js';

type Handler = (data: any) => Promise<void>;

interface Registration {
  handler: Handler;
  concurrency: number;
  attempts: number;
}

/**
 * Thin wrapper over BullMQ. Modules register a handler per queue; producers
 * call enqueue(). With QUEUES_ENABLED=false (tests) jobs run inline, so
 * behaviour is deterministic without Redis workers.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, Registration>();
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];

  constructor(private readonly config: AppConfig) {}

  private get enabled() {
    return this.config.get('QUEUES_ENABLED');
  }

  private get connection() {
    const url = new URL(this.config.get('REDIS_URL'));
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      password: url.password || undefined,
      db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
      maxRetriesPerRequest: null,
    };
  }

  register(queue: string, handler: Handler, opts: { concurrency?: number; attempts?: number } = {}) {
    this.handlers.set(queue, {
      handler,
      concurrency: opts.concurrency ?? 5,
      attempts: opts.attempts ?? 5,
    });
  }

  async enqueue(queue: string, data: unknown, opts: JobsOptions = {}) {
    const reg = this.handlers.get(queue);
    if (!reg) throw new Error(`No handler registered for queue "${queue}"`);

    if (!this.enabled) {
      try {
        await reg.handler(data);
      } catch (err) {
        this.logger.error(`Inline job ${queue} failed: ${(err as Error).message}`);
      }
      return;
    }

    await this.queue(queue).add(queue, data, {
      attempts: reg.attempts,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
      ...opts,
    });
  }

  private queue(name: string) {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, prefix: 'al' });
      this.queues.set(name, q);
    }
    return q;
  }

  onApplicationBootstrap() {
    if (!this.enabled) return;
    for (const [name, reg] of this.handlers) {
      const worker = new Worker(name, (job) => reg.handler(job.data), {
        connection: this.connection,
        prefix: 'al',
        concurrency: reg.concurrency,
      });
      worker.on('failed', (job, err) =>
        this.logger.warn(`Job ${name}#${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`),
      );
      this.workers.push(worker);
    }
    this.logger.log(`Started workers: ${[...this.handlers.keys()].join(', ')}`);
  }

  async onModuleDestroy() {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

@Global()
@Module({ providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
