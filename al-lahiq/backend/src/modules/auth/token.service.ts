import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { CookieOptions, Response } from 'express';
import { ApiError } from '../../common/api-error.js';
import { AccessClaims, COOKIES, SubjectType } from '../../common/auth.js';
import { AppConfig } from '../../config/app-config.service.js';
import type { StaffRole } from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
  ) {}

  async issue(
    typ: SubjectType,
    subjectId: string,
    role?: StaffRole,
    familyId: string = randomUUID(),
  ): Promise<IssuedTokens> {
    const claims: AccessClaims = { sub: subjectId, typ, ...(role ? { role } : {}) };
    const accessToken = await this.jwt.signAsync(claims, {
      expiresIn: this.config.get('ACCESS_TOKEN_TTL_SECONDS'),
    });
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        subjectType: typ,
        subjectId,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(
          Date.now() + this.config.get('REFRESH_TOKEN_TTL_DAYS') * 86_400_000,
        ),
      },
    });
    return { accessToken, refreshToken };
  }

  /**
   * Rotates a refresh token. Presenting an already-rotated token means it was
   * stolen or replayed, so the whole token family is revoked.
   */
  async rotate(
    typ: SubjectType,
    refreshToken: string | undefined,
    resolveRole?: (subjectId: string) => Promise<StaffRole | null>,
  ): Promise<{ subjectId: string; tokens: IssuedTokens }> {
    if (!refreshToken) throw ApiError.unauthorized();
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (!row || row.subjectType !== typ) throw ApiError.unauthorized();

    if (row.revokedAt) {
      await this.revokeFamily(row.familyId);
      throw ApiError.unauthorized('Session expired, please log in again');
    }
    if (row.expiresAt < new Date()) throw ApiError.unauthorized();

    let role: StaffRole | undefined;
    if (resolveRole) {
      const r = await resolveRole(row.subjectId);
      if (!r) {
        await this.revokeFamily(row.familyId);
        throw ApiError.unauthorized();
      }
      role = r;
    }

    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    const tokens = await this.issue(typ, row.subjectId, role, row.familyId);
    return { subjectId: row.subjectId, tokens };
  }

  async revoke(refreshToken: string | undefined) {
    if (!refreshToken) return;
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (row) await this.revokeFamily(row.familyId);
  }

  private async revokeFamily(familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ── cookies ──

  private baseCookie(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('COOKIE_SECURE'),
      domain: this.config.get('COOKIE_DOMAIN'),
    };
  }

  setCookies(res: Response, typ: SubjectType, tokens: IssuedTokens) {
    const names = this.cookieNames(typ);
    res.cookie(names.access, tokens.accessToken, {
      ...this.baseCookie(),
      path: '/',
      maxAge: this.config.get('ACCESS_TOKEN_TTL_SECONDS') * 1000,
    });
    // Path "/" so the Next.js proxy can renew an expired session on page loads.
    res.cookie(names.refresh, tokens.refreshToken, {
      ...this.baseCookie(),
      path: '/',
      maxAge: this.config.get('REFRESH_TOKEN_TTL_DAYS') * 86_400_000,
    });
  }

  clearCookies(res: Response, typ: SubjectType) {
    const names = this.cookieNames(typ);
    res.clearCookie(names.access, { ...this.baseCookie(), path: '/' });
    res.clearCookie(names.refresh, { ...this.baseCookie(), path: '/' });
  }

  cookieNames(typ: SubjectType) {
    return typ === 'customer'
      ? { access: COOKIES.customerAccess, refresh: COOKIES.customerRefresh }
      : { access: COOKIES.staffAccess, refresh: COOKIES.staffRefresh };
  }
}
