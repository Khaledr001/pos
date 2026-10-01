import type { Request } from 'express';
import type { StaffRole } from '../generated/prisma/enums.js';

/**
 * Customers and staff use separate cookies so the same browser can be logged
 * into the shop and the admin panel at the same time.
 */
export const COOKIES = {
  customerAccess: 'al_at',
  customerRefresh: 'al_rt',
  staffAccess: 'al_sat',
  staffRefresh: 'al_srt',
  cart: 'al_cart',
} as const;

export type SubjectType = 'customer' | 'staff';

export interface AccessClaims {
  sub: string;
  typ: SubjectType;
  role?: StaffRole;
}

export interface CustomerPrincipal {
  id: string;
}

export interface StaffPrincipal {
  id: string;
  role: StaffRole;
}

export interface AppRequest extends Request {
  customer?: CustomerPrincipal;
  staff?: StaffPrincipal;
  rawBody?: Buffer;
}

/** Reads a token from the cookie, falling back to `Authorization: Bearer`. */
export function readToken(req: Request, cookieName: string): string | null {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[
    cookieName
  ];
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}
