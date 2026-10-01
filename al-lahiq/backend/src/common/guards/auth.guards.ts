import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { StaffRole } from '../../generated/prisma/enums.js';
import { ApiError } from '../api-error.js';
import { AccessClaims, AppRequest, COOKIES, readToken } from '../auth.js';

async function verify(
  jwt: JwtService,
  token: string | null,
  typ: AccessClaims['typ'],
): Promise<AccessClaims | null> {
  if (!token) return null;
  try {
    const claims = await jwt.verifyAsync<AccessClaims>(token);
    return claims.typ === typ ? claims : null;
  } catch {
    return null;
  }
}

/** Requires a logged-in customer. */
@Injectable()
export class CustomerAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const claims = await verify(
      this.jwt,
      readToken(req, COOKIES.customerAccess),
      'customer',
    );
    if (!claims) throw ApiError.unauthorized();
    req.customer = { id: claims.sub };
    return true;
  }
}

/** Attaches the customer if logged in; never blocks. */
@Injectable()
export class OptionalCustomerGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const claims = await verify(
      this.jwt,
      readToken(req, COOKIES.customerAccess),
      'customer',
    );
    if (claims) req.customer = { id: claims.sub };
    return true;
  }
}

export const ROLES_KEY = 'staffRoles';

/**
 * Restricts an admin route to the given roles. OWNER always passes.
 * Without @Roles, any active staff member may call the route.
 */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const claims = await verify(
      this.jwt,
      readToken(req, COOKIES.staffAccess),
      'staff',
    );
    if (!claims?.role) throw ApiError.unauthorized();
    req.staff = { id: claims.sub, role: claims.role };

    const required = this.reflector.getAllAndOverride<StaffRole[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (required?.length && claims.role !== 'OWNER' && !required.includes(claims.role)) {
      throw ApiError.forbidden();
    }
    return true;
  }
}
