import type { AuthenticatedUser } from "@devsfleet/shared-types";
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PLATFORM_ONLY_KEY } from "../decorators/index.js";

/**
 * Gate for `@PlatformOnly()`.
 *
 * The check is `isPlatformAdmin` on the principal, which comes from a column no
 * tenant-facing endpoint can write. A tenant administrator has every permission
 * inside their own business and still cannot pass this — which is the point,
 * because these routes read across all businesses.
 *
 * Registered globally so a new platform route cannot forget it: without the
 * decorator the guard is inert, with it the guard is unavoidable.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const platformOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!platformOnly) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();

    if (!request.user?.isPlatformAdmin) {
      // Deliberately vague. This endpoint's existence is not a tenant's
      // business, and naming it invites probing.
      throw new ForbiddenException("Not available");
    }
    return true;
  }
}
