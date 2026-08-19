import { schema } from "@devsfleet/db";
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, tap } from "rxjs";
import { TenantDatabase } from "../../database/tenant-database.service.js";
import { RequestContext } from "../context/request-context.js";
import { AUDIT_KEY } from "../decorators/index.js";

interface AuditMetadata {
  entityType: string;
  action: string;
}

/**
 * Writes the `audit_log` row that `@Audited(...)` promises.
 *
 * Until this existed the decorator set metadata nothing read: around sixty
 * routes declared an audit trail and produced no rows, which is worse than
 * having none — a reviewer sees `@Audited("users", "update")` on the
 * role-assignment route and reasonably concludes escalation is traceable.
 *
 * WHAT THIS CAN AND CANNOT PROMISE
 *
 * The row is written AFTER the handler succeeds, on its own transaction. It
 * therefore cannot be atomic with the change it describes, and a crash in
 * between leaves an action unlogged. That is a real limitation, and it is the
 * reason `PlatformService` keeps writing its own audit row inside the same
 * transaction as the impersonation it records: where the audit trail is the
 * entire point of the operation, it belongs in the transaction, not here.
 *
 * For the rest — a stock adjustment, a credit-limit edit, a day close — an
 * after-the-fact row that is occasionally missing is worth far more than the
 * nothing that was being written before.
 *
 * A failure to audit never fails the request. The money already moved; refusing
 * the response would not un-move it, and would turn a logging outage into an
 * outage of the till. It is logged at error level instead, which is what a
 * monitor should alert on.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly db: TenantDatabase,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<AuditMetadata>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!meta) return next.handle();

    return next.handle().pipe(
      tap((result) => {
        // Fire and forget: the response is already on its way, and awaiting a
        // second round trip to Postgres would add it to every audited route's
        // latency for no benefit to the caller.
        void this.write(meta, context, result);
      }),
    );
  }

  private async write(
    meta: AuditMetadata,
    context: ExecutionContext,
    result: unknown,
  ): Promise<void> {
    const store = RequestContext.get();
    const user = store?.user;

    // A platform operator acting across tenants has no tenant of their own, and
    // `PlatformService` already writes its own row with the right tenant on it.
    if (!user?.tenantId) return;

    try {
      const request = context.switchToHttp().getRequest<{
        params?: Record<string, string>;
      }>();

      await this.db.run(async (tx) => {
        await tx.insert(schema.auditLog).values({
          tenantId: user.tenantId!,
          branchId: store?.branchId ?? user.branchId ?? null,
          userId: user.id,
          entityType: meta.entityType,
          action: meta.action,
          entityId: entityIdFrom(request.params, result),
          ...(store?.ipAddress ? { ipAddress: store.ipAddress } : {}),
          requestId: RequestContext.requestId,
        });
      });
    } catch (error) {
      this.logger.error(
        {
          err: error,
          entityType: meta.entityType,
          action: meta.action,
          userId: user.id,
          requestId: RequestContext.requestId,
        },
        "Failed to write an audit row — the action succeeded and is now unlogged",
      );
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Which row the action touched.
 *
 * A create names its subject only in the response; an update or delete names it
 * in the path. Both are checked, response first, because on a create the path
 * has no id at all and on an update the two agree.
 */
function entityIdFrom(
  params: Record<string, string> | undefined,
  result: unknown,
): string | null {
  const fromResult = (result as { id?: unknown } | null | undefined)?.id;
  if (typeof fromResult === "string" && UUID.test(fromResult)) return fromResult;

  for (const value of Object.values(params ?? {})) {
    if (typeof value === "string" && UUID.test(value)) return value;
  }
  return null;
}
