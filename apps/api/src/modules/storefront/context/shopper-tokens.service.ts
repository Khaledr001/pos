import { and, eq, isNull, schema, type Transaction } from "@devsfleet/db";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Env } from "../../../config/env.js";

interface ShopperClaims {
  sub: string;
  cid: string;
  tid: string;
  typ: "shopper";
}

export interface ShopperPrincipal {
  accountId: string;
  customerId: string;
  tenantId: string;
}

export interface IssuedShopperTokens {
  accessToken: string;
  refreshToken: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * Shopper access and refresh tokens.
 *
 * Signed with a key the staff JwtStrategy does not hold, so a shopper token
 * presented to a staff route fails signature verification outright — not a
 * claim check somebody could forget to write. The tenant is a claim, and
 * StorefrontGuard compares it with the tenant the host resolved to, so a
 * token from one shop is worthless on another.
 */
@Injectable()
export class ShopperTokens {
  private readonly jwt: JwtService;
  private readonly accessTtl: string;
  private readonly refreshMaxAgeMs: number;

  constructor(config: ConfigService<Env, true>) {
    const explicit = config.get("STOREFRONT_JWT_SECRET", { infer: true });
    const secret =
      explicit ??
      createHmac("sha256", config.get("JWT_ACCESS_SECRET", { infer: true }))
        .update("devsfleet:storefront:shopper")
        .digest("hex");
    this.jwt = new JwtService({ secret });
    this.accessTtl = config.get("STOREFRONT_ACCESS_TTL", { infer: true });
    this.refreshMaxAgeMs = config.get("STOREFRONT_REFRESH_DAYS", { infer: true }) * 86_400_000;
  }

  /** null for anything that is not a live shopper token — expired, forged, or staff. */
  async verifyAccess(token: string): Promise<ShopperPrincipal | null> {
    try {
      const claims = await this.jwt.verifyAsync<ShopperClaims>(token);
      if (claims.typ !== "shopper" || !claims.sub || !claims.cid || !claims.tid) return null;
      return { accountId: claims.sub, customerId: claims.cid, tenantId: claims.tid };
    } catch {
      return null;
    }
  }

  /** Start a new session family. Called on login and registration. */
  async issue(tx: Transaction, principal: ShopperPrincipal): Promise<IssuedShopperTokens> {
    return this.issueInFamily(tx, principal, randomUUID());
  }

  /**
   * Trade a refresh token for a new pair.
   *
   * A token that was already rotated is evidence somebody else holds a copy,
   * so the whole family is revoked and both parties are signed out — the
   * legitimate shopper logs in again; whoever stole the token cannot.
   *
   * Returns a refusal rather than throwing it. Throwing inside the caller's
   * transaction would roll back the very revocation that answers a stolen
   * token, so the caller commits first and refuses after.
   */
  async rotate(
    tx: Transaction,
    refreshToken: string,
  ): Promise<{ principal: ShopperPrincipal; tokens: IssuedShopperTokens } | { refused: string }> {
    const session = await tx.query.shopperSessions.findFirst({
      where: (t, { eq: e }) => e(t.tokenHash, sha256(refreshToken)),
    });
    if (!session) return { refused: "Your session has ended. Sign in again." };

    if (session.revokedAt) {
      await tx
        .update(schema.shopperSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.shopperSessions.familyId, session.familyId), isNull(schema.shopperSessions.revokedAt)));
      return { refused: "Your session has ended. Sign in again." };
    }
    if (session.expiresAt.getTime() <= Date.now()) return { refused: "Your session has expired. Sign in again." };

    const account = await tx.query.shopperAccounts.findFirst({
      where: (t, { eq: e }) => e(t.id, session.accountId),
      columns: { id: true, customerId: true, tenantId: true, isActive: true },
    });
    if (!account?.isActive) return { refused: "This account is no longer active." };

    await tx
      .update(schema.shopperSessions)
      .set({ revokedAt: new Date() })
      .where(eq(schema.shopperSessions.id, session.id));

    const principal = { accountId: account.id, customerId: account.customerId, tenantId: account.tenantId };
    return { principal, tokens: await this.issueInFamily(tx, principal, session.familyId) };
  }

  async revoke(tx: Transaction, refreshToken: string): Promise<void> {
    const session = await tx.query.shopperSessions.findFirst({
      where: (t, { eq: e }) => e(t.tokenHash, sha256(refreshToken)),
      columns: { familyId: true },
    });
    if (!session) return;
    await tx
      .update(schema.shopperSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(schema.shopperSessions.familyId, session.familyId), isNull(schema.shopperSessions.revokedAt)));
  }

  private async issueInFamily(
    tx: Transaction,
    principal: ShopperPrincipal,
    familyId: string,
  ): Promise<IssuedShopperTokens> {
    const claims: ShopperClaims = {
      sub: principal.accountId,
      cid: principal.customerId,
      tid: principal.tenantId,
      typ: "shopper",
    };
    const accessToken = await this.jwt.signAsync(claims, { expiresIn: this.accessTtl as never });
    const refreshToken = randomBytes(32).toString("base64url");

    await tx.insert(schema.shopperSessions).values({
      tenantId: principal.tenantId,
      accountId: principal.accountId,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshMaxAgeMs),
    });

    const decoded = this.jwt.decode<{ exp: number; iat: number }>(accessToken);
    return {
      accessToken,
      refreshToken,
      accessMaxAgeMs: (decoded.exp - decoded.iat) * 1000,
      refreshMaxAgeMs: this.refreshMaxAgeMs,
    };
  }
}
