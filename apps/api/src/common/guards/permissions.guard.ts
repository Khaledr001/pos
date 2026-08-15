import { hasPermission, type AuthenticatedUser, type Permission } from "@devsfleet/shared-types";
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "../decorators/index.js";

/**
 * Enforces `@RequirePermissions(...)`.
 *
 * Authorisation is always a permission check, never a role-name check. Roles
 * are tenant-editable rows; a tenant that renames "manager" to "supervisor", or
 * adds a fifth role, must not break the API. `hasPermission` lives in
 * @devsfleet/shared-types so the admin panel greys out the same buttons this
 * guard would reject.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException("Authentication required for this operation");
    }

    const missing = required.filter((p) => !hasPermission(user.permissions, p));

    if (missing.length > 0) {
      // Naming the missing permission is deliberate. This is an authenticated
      // staff member, not an anonymous attacker, and "you need product:write"
      // is what lets them ask their manager for the right thing.
      throw new ForbiddenException(
        `Missing permission${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
      );
    }

    return true;
  }
}
