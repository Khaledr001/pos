import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import type { Response } from 'express';
import { ApiError } from '../../common/api-error.js';
import type { CustomerPrincipal } from '../../common/auth.js';
import { CurrentCustomer } from '../../common/decorators/principals.js';
import { CustomerAuthGuard } from '../../common/guards/auth.guards.js';
import { InvoicesService } from '../invoices/invoices.service.js';
import { OrdersService } from '../orders/orders.service.js';
import {
  CreateListDto,
  ListItemDto,
  SaveAddressDto,
  TradeApplicationDto,
  UpdateAddressDto,
  UpdateProfileDto,
} from './account.dto.js';
import { AccountService } from './account.service.js';

@ApiTags('account')
@Controller('me')
@UseGuards(CustomerAuthGuard)
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly orders: OrdersService,
    private readonly invoices: InvoicesService,
  ) {}

  @Patch('profile')
  updateProfile(@CurrentCustomer() c: CustomerPrincipal, @Body() dto: UpdateProfileDto) {
    return this.account.updateProfile(c.id, dto);
  }

  @Post('trade-application')
  applyForTrade(@CurrentCustomer() c: CustomerPrincipal, @Body() dto: TradeApplicationDto) {
    return this.account.applyForTrade(c.id, dto);
  }

  // addresses
  @Get('addresses')
  addresses(@CurrentCustomer() c: CustomerPrincipal) {
    return this.account.addresses(c.id);
  }

  @Post('addresses')
  addAddress(@CurrentCustomer() c: CustomerPrincipal, @Body() dto: SaveAddressDto) {
    return this.account.addAddress(c.id, dto);
  }

  @Patch('addresses/:id')
  updateAddress(
    @CurrentCustomer() c: CustomerPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.account.updateAddress(c.id, id, dto);
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  deleteAddress(@CurrentCustomer() c: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.deleteAddress(c.id, id);
  }

  // orders
  @Get('orders')
  orderList(
    @CurrentCustomer() c: CustomerPrincipal,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
  ) {
    return this.account.orders(c.id, page ?? 1);
  }

  @Get('orders/:id')
  order(@CurrentCustomer() c: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.order(c.id, id);
  }

  @Post('orders/:id/reorder')
  reorder(@CurrentCustomer() c: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.reorder(c.id, id);
  }

  @Get('orders/:id/invoice.pdf')
  async invoice(
    @CurrentCustomer() c: CustomerPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const order = await this.orders.getView({ id, customerId: c.id });
    const pdf = await this.invoices.pdf(order.id);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `attachment; filename="${pdf.filename}"`);
    res.send(pdf.buffer);
  }

  // project lists & wishlist
  @Get('lists')
  lists(@CurrentCustomer() c: CustomerPrincipal) {
    return this.account.lists(c.id);
  }

  @Post('lists')
  createList(@CurrentCustomer() c: CustomerPrincipal, @Body() dto: CreateListDto) {
    return this.account.createList(c.id, dto);
  }

  @Get('lists/:id')
  list(@CurrentCustomer() c: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.list(c.id, id);
  }

  @Patch('lists/:id')
  renameList(
    @CurrentCustomer() c: CustomerPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateListDto,
  ) {
    return this.account.renameList(c.id, id, dto);
  }

  @Delete('lists/:id')
  @HttpCode(204)
  deleteList(@CurrentCustomer() c: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.deleteList(c.id, id);
  }

  /** `:id` may be "wishlist". */
  @Post('lists/:id/items')
  addToList(@CurrentCustomer() c: CustomerPrincipal, @Param('id') id: string, @Body() dto: ListItemDto) {
    if (id !== 'wishlist' && !isUUID(id)) throw ApiError.notFound('List');
    return this.account.addToList(c.id, id, dto);
  }

  @Delete('lists/:id/items/:itemId')
  removeFromList(
    @CurrentCustomer() c: CustomerPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.account.removeFromList(c.id, id, itemId);
  }

  @Post('lists/:id/to-cart')
  listToCart(@CurrentCustomer() c: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.listToCart(c.id, id);
  }
}

@Module({
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
