import { Global, Module } from '@nestjs/common';
import { CartContext } from './cart-context.service.js';
import { CartController } from './cart.controller.js';
import { CartService } from './cart.service.js';

@Global()
@Module({
  controllers: [CartController],
  providers: [CartService, CartContext],
  exports: [CartService, CartContext],
})
export class CartModule {}
