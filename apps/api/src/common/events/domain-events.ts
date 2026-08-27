import { RequestContext } from "../context/request-context.js";
import type { DomainEventName } from "./event-names.js";

export interface DomainEvent<TName extends DomainEventName = DomainEventName, TPayload = unknown> {
  name: TName;
  tenantId: string;
  payload: TPayload;
}

/**
 * Events a service wants dispatched once — and only once — the transaction
 * that produced them has committed.
 *
 * `record()` is synchronous and touches no database: it appends to the
 * current request's AsyncLocalStorage store (see RequestContextStore.events),
 * which already spans the whole request because RequestContextMiddleware
 * opens it before the guards run. DomainEventsInterceptor drains the array
 * after the handler resolves successfully — the same after-the-fact shape
 * AuditInterceptor uses for its own row, and for the same reason: by the time
 * a controller method returns, `TenantDatabase.run()` has already committed,
 * so an event recorded here can never fire for a write that gets rolled back.
 *
 * Modules communicate through this, never by importing each other's services.
 * A service that wants a side effect in another module records an event and
 * moves on — it does not know or care who is listening.
 */
export const DomainEvents = {
  record<TName extends DomainEventName, TPayload>(event: DomainEvent<TName, TPayload>): void {
    const store = RequestContext.get();
    // Outside a request (a script, a startup task) there is nothing to drain
    // into. That is a shape mismatch worth fixing at the call site, not here.
    if (!store) return;
    (store.events ??= []).push(event);
  },

  /** Pulled and cleared by DomainEventsInterceptor. Not for service code. */
  drain(): DomainEvent[] {
    const store = RequestContext.get();
    if (!store?.events?.length) return [];
    const events = store.events;
    store.events = [];
    return events;
  },
};
