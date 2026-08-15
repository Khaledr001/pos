import type { AuthenticatedUser } from "@devsfleet/shared-types";
import { ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { RequestContext } from "../context/request-context.js";
import { IS_PUBLIC_KEY } from "../decorators/index.js";

/**
 * Global authentication guard. Registered in AppModule as an APP_GUARD, so
 * every route is protected by default and must opt out with `@Public()`.
 *
 * Besides validating the token, it publishes the principal into the
 * AsyncLocalStorage request context — which is what makes TenantDatabase able
 * to scope queries without every service having to pass a tenantId down.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  /**
   * Passport types this generically, but JwtStrategy.validate is the only
   * producer and it always returns an AuthenticatedUser — hence the narrowing
   * on the way out.
   */
  override handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: AuthenticatedUser | false,
    info: unknown,
  ): TUser {
    if (err || !user) {
      // `info` distinguishes an expired token from a malformed one, which the
      // client needs: the first means "refresh", the second means "log in".
      const reason =
        info instanceof Error && info.name === "TokenExpiredError"
          ? "Access token expired"
          : "Invalid or missing access token";
      throw new UnauthorizedException(reason);
    }

    RequestContext.setUser(user);
    return user as TUser;
  }
}
