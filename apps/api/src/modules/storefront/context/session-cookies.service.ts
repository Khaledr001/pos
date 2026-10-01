import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import type { Env } from "../../../config/env.js";
import {
  CART_COOKIE,
  clearCookie,
  cookieOptions,
  readCookie,
  SHOPPER_ACCESS_COOKIE,
  SHOPPER_REFRESH_COOKIE,
} from "./cookies.js";
import type { IssuedShopperTokens } from "./shopper-tokens.service.js";

/** A guest cart outlives a session: two months, the same as the website it replaces. */
const CART_MAX_AGE_MS = 60 * 86_400_000;

/** Writes and clears the storefront's cookies. HTTP plumbing only — no decisions. */
@Injectable()
export class SessionCookies {
  private readonly secure: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.secure =
      config.get("STOREFRONT_COOKIE_SECURE", { infer: true }) ??
      config.get("NODE_ENV", { infer: true }) === "production";
  }

  setSession(res: Response, tokens: IssuedShopperTokens): void {
    res.cookie(SHOPPER_ACCESS_COOKIE, tokens.accessToken, cookieOptions(this.secure, tokens.accessMaxAgeMs));
    res.cookie(SHOPPER_REFRESH_COOKIE, tokens.refreshToken, cookieOptions(this.secure, tokens.refreshMaxAgeMs));
  }

  clearSession(res: Response): void {
    clearCookie(res, SHOPPER_ACCESS_COOKIE, this.secure);
    clearCookie(res, SHOPPER_REFRESH_COOKIE, this.secure);
  }

  /** A dead session must not keep being presented on every page load. */
  async clearSessionOnFailure<T>(res: Response, attempt: Promise<T>): Promise<T> {
    try {
      return await attempt;
    } catch (error) {
      this.clearSession(res);
      throw error;
    }
  }

  refreshToken(req: Request): string | undefined {
    return readCookie(req, SHOPPER_REFRESH_COOKIE);
  }

  guestCartId(req: Request): string | undefined {
    const value = readCookie(req, CART_COOKIE);
    return value && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
  }

  setGuestCart(res: Response, cartId: string): void {
    res.cookie(CART_COOKIE, cartId, cookieOptions(this.secure, CART_MAX_AGE_MS));
  }

  clearGuestCart(res: Response): void {
    clearCookie(res, CART_COOKIE, this.secure);
  }
}
