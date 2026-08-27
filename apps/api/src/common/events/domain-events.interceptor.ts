import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { Observable, tap } from "rxjs";
import { DomainEvents } from "./domain-events.js";

/**
 * Dispatches whatever `DomainEvents.record()` accumulated during this
 * request, once the handler has already returned successfully.
 *
 * Mirrors AuditInterceptor's shape and reasoning: `tap()` only runs on the
 * success path, so a request that throws (a failed AppError, a rolled-back
 * transaction) never reaches it — its events are dropped along with the write
 * that would have produced them, which is the entire point of dispatching
 * after the handler resolves rather than the moment `record()` is called.
 *
 * Dispatch itself is fire-and-forget per listener: awaiting a notification
 * fan-out here would put every low-stock check's latency on the response to
 * whichever sale caused it, for a side effect the caller of that route never
 * asked to wait for. A listener that throws is logged and does not affect any
 * other listener or the response already sent.
 */
@Injectable()
export class DomainEventsInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DomainEventsInterceptor.name);

  constructor(private readonly emitter: EventEmitter2) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      tap(() => {
        for (const event of DomainEvents.drain()) {
          void this.emitter.emitAsync(event.name, event).catch((error: unknown) => {
            this.logger.error(
              { err: error, event: event.name, tenantId: event.tenantId },
              "A domain event listener threw",
            );
          });
        }
      }),
    );
  }
}
