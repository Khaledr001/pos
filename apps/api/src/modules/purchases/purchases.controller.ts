import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PurchasesService } from "./purchases.service.js";
import {
  CreatePurchaseOrderSchema,
  ListPurchaseOrdersSchema,
  ReceiveGoodsSchema,
  UpdatePurchaseOrderSchema,
  type CreatePurchaseOrderDto,
  type ListPurchaseOrdersDto,
  type ReceiveGoodsDto,
  type UpdatePurchaseOrderDto,
} from "./dto.js";

@ApiTags("purchases")
@Controller("purchases")
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  @RequirePermissions("purchase:read")
  @ApiOperation({ summary: "Purchase orders" })
  list(@Query(zodPipe(ListPurchaseOrdersSchema)) query: ListPurchaseOrdersDto) {
    return this.purchases.list(query);
  }

  /**
   * `purchase:receive`, not `purchase:write`.
   *
   * Raising an order and confirming goods arrived are different powers: the
   * second one moves stock and creates a payable, and separating them is what
   * makes an invented delivery need two people.
   */
  @Post("receive")
  @RequirePermissions("purchase:receive")
  @Audited("goods_receipt", "create")
  @ApiOperation({ summary: "Receive a delivery; moves stock and landed cost" })
  receive(@Body(zodPipe(ReceiveGoodsSchema)) dto: ReceiveGoodsDto) {
    return this.purchases.receive(dto);
  }

  @Get("receipts/:id")
  @RequirePermissions("purchase:read")
  findReceipt(@Param("id", ParseUUIDPipe) id: string) {
    return this.purchases.findReceipt(id);
  }

  @Get(":id")
  @RequirePermissions("purchase:read")
  findById(@Param("id", ParseUUIDPipe) id: string) {
    return this.purchases.findById(id);
  }

  @Post()
  @RequirePermissions("purchase:write")
  @Audited("purchase_order", "create")
  create(@Body(zodPipe(CreatePurchaseOrderSchema)) dto: CreatePurchaseOrderDto) {
    return this.purchases.createOrder(dto);
  }

  @Patch(":id")
  @RequirePermissions("purchase:write")
  @Audited("purchase_order", "update")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdatePurchaseOrderSchema)) dto: UpdatePurchaseOrderDto,
  ) {
    return this.purchases.updateOrder(id, dto);
  }

  @Post(":id/send")
  @RequirePermissions("purchase:write")
  @Audited("purchase_order", "send")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Mark the order as sent to the supplier" })
  send(@Param("id", ParseUUIDPipe) id: string) {
    return this.purchases.sendOrder(id);
  }

  @Post(":id/cancel")
  @RequirePermissions("purchase:write")
  @Audited("purchase_order", "cancel")
  @HttpCode(HttpStatus.OK)
  cancel(@Param("id", ParseUUIDPipe) id: string) {
    return this.purchases.cancelOrder(id);
  }
}
