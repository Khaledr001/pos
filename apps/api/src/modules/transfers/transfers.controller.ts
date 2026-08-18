import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { CreateTransferDto, CreateTransferSchema, ListTransfersDto, ListTransfersSchema } from "./dto.js";
import { TransfersService } from "./transfers.service.js";

@ApiTags("transfers")
@Controller("transfers")
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Get()
  @RequirePermissions("transfer:read")
  @ApiOperation({ summary: "List incoming and outgoing stock transfers" })
  list(@Query(zodPipe(ListTransfersSchema)) query: ListTransfersDto) {
    return this.transfers.list(query);
  }

  @Get(":id")
  @RequirePermissions("transfer:read")
  @ApiOperation({ summary: "Get transfer details" })
  get(@Param("id") id: string) {
    return this.transfers.get(id);
  }

  @Post()
  @RequirePermissions("transfer:request")
  @Audited("inventory", "transfer_request")
  @ApiOperation({ summary: "Request stock from another branch" })
  create(@Body(zodPipe(CreateTransferSchema)) dto: CreateTransferDto) {
    return this.transfers.create(dto);
  }

  @Post(":id/approve")
  @RequirePermissions("transfer:approve")
  @Audited("inventory", "transfer_approve")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Approve a stock transfer request" })
  approve(@Param("id") id: string) {
    return this.transfers.approve(id);
  }

  @Post(":id/ship")
  @RequirePermissions("transfer:request") // Shippers usually fulfill the request
  @Audited("inventory", "transfer_ship")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Ship a stock transfer (deducts from source)" })
  ship(@Param("id") id: string) {
    return this.transfers.ship(id);
  }

  @Post(":id/receive")
  @RequirePermissions("transfer:receive")
  @Audited("inventory", "transfer_receive")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Receive a stock transfer (adds to destination)" })
  receive(@Param("id") id: string) {
    return this.transfers.receive(id);
  }
}
