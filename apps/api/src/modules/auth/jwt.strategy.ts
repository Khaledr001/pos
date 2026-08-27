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

    /**
     * A token with no ABAC claims is refused outright.
     *
     * It used to be defaulted instead, and the default was described as failing
     * closed — but `allowedBranchIds: []` is the encoding of EVERY branch (see
     * assertBranchInScope), so the "safe" fallback silently handed a legacy
     * token access to the whole estate while capping its discount at zero.
     *
     * There is no value of `allowedBranchIds` that means "nowhere", so the
     * honest fallback is not to have one. Access tokens live fifteen minutes;
     * the cost of this is one refresh after a deploy.
     */
    if (!payload.abac || !Array.isArray(payload.abac.allowedBranchIds)) {
      throw new UnauthorizedException("Access token is missing its authorisation claims");
    }

    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      branchId: payload.branchId,
      roleId: payload.roleId,
      roleName: payload.roleName,
      permissions: payload.permissions ?? [],
      abac: payload.abac,
      isPlatformAdmin: payload.isPlatformAdmin ?? false,
      planId: payload.planId ?? "free",
      trialEndsAt: payload.trialEndsAt ?? null,
      ...(payload.deviceId ? { deviceId: payload.deviceId } : {}),
      ...(payload.impersonatedBy ? { impersonatedBy: payload.impersonatedBy } : {}),
    };
  }
}
