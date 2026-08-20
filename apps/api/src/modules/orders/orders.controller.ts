import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import {
  CancelOrderSchema, CreateOrderSchema, FulfillOrderSchema, ListOrdersSchema,
  type CancelOrderDto, type CreateOrderDto, type FulfillOrderDto, type ListOrdersDto,
} from "./dto.js";
import { OrdersService } from "./orders.service.js";

@ApiTags("orders")
@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions("order:read")
  @ApiOperation({ summary: "List orders" })
  list(@Query(zodPipe(ListOrdersSchema)) query: ListOrdersDto) {
    return this.orders.list(query);
  }

  @Get(":id")
  @RequirePermissions("order:read")
  @ApiOperation({ summary: "Order with its lines and fulfilment progress" })
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.orders.findById(id);
  }

  @Post()
  @RequirePermissions("order:write")
  @Audited("orders", "create")
  @ApiOperation({ summary: "Create an order — reserves nothing until confirmed" })
  create(@Body(zodPipe(CreateOrderSchema)) dto: CreateOrderDto) {
    return this.orders.create(dto);
  }

  @Post(":id/confirm")
  @RequirePermissions("order:write")
  @Audited("orders", "confirm")
  @ApiOperation({ summary: "Confirm — reserves stock for every line" })
  confirm(@Param("id", ParseUUIDPipe) id: string) {
    return this.orders.confirm(id);
  }

  @Post(":id/cancel")
  @RequirePermissions("order:write")
  @Audited("orders", "cancel")
  @ApiOperation({ summary: "Cancel — releases whatever remains reserved" })
  cancel(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(CancelOrderSchema)) dto: CancelOrderDto,
  ) {
    return this.orders.cancel(id, dto);
  }

  @Post(":id/fulfill")
  @RequirePermissions("order:write")
  @Audited("orders", "fulfill")
  @ApiOperation({ summary: "Hand over some or all remaining lines as a real sale" })
  fulfill(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(FulfillOrderSchema)) dto: FulfillOrderDto,
  ) {
    return this.orders.fulfill(id, dto);
  }
}
