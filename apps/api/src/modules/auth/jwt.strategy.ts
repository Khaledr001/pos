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
    if (!payload.sub || !payload.tenantId) {
      throw new UnauthorizedException("Malformed access token");
    }

    return {
      id: payload.sub,
      tenantId: payload.tenantId,
      branchId: payload.branchId,
      roleId: payload.roleId,
      roleName: payload.roleName,
      permissions: payload.permissions ?? [],
      ...(payload.deviceId ? { deviceId: payload.deviceId } : {}),
    };
  }
}
