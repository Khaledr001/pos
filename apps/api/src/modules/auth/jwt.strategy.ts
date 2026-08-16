import type { AuthenticatedUser, JwtPayload } from "@devsfleet/shared-types";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import type { Env } from "../../config/env.js";

/**
 * Validates the access token and turns its payload into the principal.
 *
 * Deliberately does NOT hit the database. An access token lives 15 minutes, and
 * a database round-trip on every request — including every item of a sync push
 * — is a cost with no matching benefit. Revocation is handled at refresh time:
 * killing a session revokes the refresh token, so the user is out within one
 * access-token lifetime. If a case ever needs instant revocation (a terminal
 * reported stolen), that is a Redis denylist keyed on `jti`, not a per-request
 * SELECT.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get("JWT_ACCESS_SECRET", { infer: true }),
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    // A platform operator legitimately has no tenant, so only `sub` is
    // universally required.
    if (!payload.sub) {
      throw new UnauthorizedException("Malformed access token");
    }
    if (!payload.tenantId && !payload.isPlatformAdmin) {
      throw new UnauthorizedException("Access token names no business");
    }

    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      branchId: payload.branchId,
      roleId: payload.roleId,
      roleName: payload.roleName,
      permissions: payload.permissions ?? [],
      /**
       * Defaulted rather than assumed present: a token minted before these
       * claims existed would otherwise yield `undefined` ceilings, and an
       * undefined ceiling compares as "no limit". Failing closed means an old
       * token grants nothing instead of everything.
       */
      abac: payload.abac ?? {
        maxDiscountPercent: "0",
        maxSaleAmount: "0",
        canApproveRefund: false,
        canViewCost: false,
        allowedBranchIds: [],
      },
      isPlatformAdmin: payload.isPlatformAdmin ?? false,
      planId: payload.planId ?? "free",
      trialEndsAt: payload.trialEndsAt ?? null,
      ...(payload.deviceId ? { deviceId: payload.deviceId } : {}),
    };
  }
}
