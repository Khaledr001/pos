import type { ApiSuccess } from "@devsfleet/shared-types";
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";
import { map } from "rxjs/operators";

/**
 * Wraps every successful response in the ApiSuccess envelope.
 *
 * Together with AllExceptionsFilter this gives clients exactly two response
 * shapes to handle. The POS in particular benefits: it parses responses from a
 * background sync worker with no UI to fall back on, so "sometimes an array,
 * sometimes an object, sometimes a bare string" is not workable.
 *
 * A handler returning `{ items, meta }` has its `meta` lifted into the
 * envelope, so paginated endpoints need no special casing.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiSuccess<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccess<T>> {
    return next.handle().pipe(
      map((data) => {
        if (isPaginated(data)) {
          return { success: true, data: data.items as T, meta: data.meta };
        }
        return { success: true, data };
      }),
    );
  }
}

function isPaginated(
  value: unknown,
): value is { items: unknown[]; meta: Record<string, unknown> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "items" in value &&
    "meta" in value &&
    Array.isArray((value as { items: unknown }).items)
  );
}
