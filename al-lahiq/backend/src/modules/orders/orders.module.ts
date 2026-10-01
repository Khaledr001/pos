import { Controller, Get, Global, Module, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { InvoicesService } from '../invoices/invoices.service.js';
import { toOrderView } from './order.mapper.js';
import { OrdersService } from './orders.service.js';

/** Guest-friendly order tracking by the unguessable token in emails. */
@ApiTags('orders')
@Controller('orders/track')
export class OrderTrackingController {
  constructor(
    private readonly orders: OrdersService,
    private readonly invoices: InvoicesService,
  ) {}

  @Get(':token')
  async track(@Param('token', ParseUUIDPipe) token: string) {
    return toOrderView(await this.orders.getView({ trackingToken: token }));
  }

  @Get(':token/invoice.pdf')
  async invoice(@Param('token', ParseUUIDPipe) token: string, @Res() res: Response) {
    const order = await this.orders.getView({ trackingToken: token });
    const pdf = await this.invoices.pdf(order.id);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${pdf.filename}"`);
    res.send(pdf.buffer);
  }
}

@Global()
@Module({
  controllers: [OrderTrackingController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
