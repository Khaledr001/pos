import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { AppRequest, COOKIES, CustomerPrincipal } from '../../common/auth.js';
import { AppConfig } from '../../config/app-config.service.js';
import { CartService } from './cart.service.js';

/** Finds the visitor's cart and sets the guest cart cookie when one is created. */
@Injectable()
export class CartContext {
  constructor(
    private readonly carts: CartService,
    private readonly config: AppConfig,
  ) {}

  async resolve(req: AppRequest, res: Response, customer?: CustomerPrincipal) {
    const cookie = (req.cookies as Record<string, string> | undefined)?.[COOKIES.cart];
    const { cart, created } = await this.carts.resolve(cookie, customer?.id);
    if (created && !customer) {
      res.cookie(COOKIES.cart, cart.id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.config.get('COOKIE_SECURE'),
        domain: this.config.get('COOKIE_DOMAIN'),
        path: '/',
        maxAge: 60 * 86_400_000,
      });
    }
    return cart;
  }
}
