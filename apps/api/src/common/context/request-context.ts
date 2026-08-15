import type { AuthenticatedUser } from "@devsfleet/shared-types";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-request state, carried through the call stack without threading it
 * through every signature.
 *
 * AsyncLocalStorage rather than NestJS request-scoped providers: a
 * request-scoped provider forces Nest to rebuild that provider's entire
 * dependency subtree on every request, which on a hot sync endpoint is real
 * cost. ALS gives the same ambient access for free, and works from places DI
 * does not reach — a repository helper, a pino formatter, an error filter.
 *
 * Populated by RequestContextMiddleware (requestId) and JwtAuthGuard (user).
 */
export interface RequestContextStore {
  requestId: string;
  /** Set once the request is authenticated. Absent on public routes. */
  user?: AuthenticatedUser;
  /** Convenience mirror of user.tenantId, so DB helpers need not unwrap. */
  tenantId?: string;
  /** The branch this request acts on: an explicit override, or the user's own. */
  branchId?: string | null;
  ipAddress?: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  /** Run `fn` with a fresh store. Called once per request, by the middleware. */
  run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  },

  /** The active store, or undefined outside a request (a cron job, boot). */
  get(): RequestContextStore | undefined {
    return storage.getStore();
  },

  /**
   * The tenant this request belongs to.
   *
   * Throws rather than returning undefined: a database call without tenant
   * scope is a security bug, and it must fail here — loudly, at the call site —
   * rather than silently returning an empty result set that looks like "no
   * data" to whoever is reading the screen.
   */
  requireTenantId(): string {
    const tenantId = storage.getStore()?.tenantId;
    if (!tenantId) {
      throw new Error(
        "No tenant in the request context. Either the route is @Public() and " +
          "should not be touching tenant data, or it is running outside a " +
          "request and should use withPlatformAdmin() explicitly.",
      );
    }
    return tenantId;
  },

  requireUser(): AuthenticatedUser {
    const user = storage.getStore()?.user;
    if (!user) throw new Error("No authenticated user in the request context.");
    return user;
  },

  get requestId(): string {
    return storage.getStore()?.requestId ?? "no-request-context";
  },

  /** Attach the authenticated principal. Called by JwtAuthGuard. */
  setUser(user: AuthenticatedUser): void {
    const store = storage.getStore();
    if (!store) return;
    store.user = user;
    store.tenantId = user.tenantId;
    store.branchId = user.branchId;
  },

  /** Narrow the request to one branch, after the guard has authorised it. */
  setBranchId(branchId: string | null): void {
    const store = storage.getStore();
    if (store) store.branchId = branchId;
  },
};
