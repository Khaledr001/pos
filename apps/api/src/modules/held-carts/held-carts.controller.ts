import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { HeldCartsService } from "./held-carts.service.js";
import {
  HoldCartSchema,
  ListHeldCartsSchema,
  type HoldCartDto,
  type ListHeldCartsDto,
} from "./dto.js";

/**
 * `sale:create` throughout, not a permission of its own.
 *
 * Holding a cart is part of ringing one up. Anyone who can sell can park a
 * sale, and a separate permission would be one more thing to forget to grant.
 */
@ApiTags("held-carts")
@Controller("held-carts")
export class HeldCartsController {
  constructor(private readonly heldCarts: HeldCartsService) {}

  @Get()
  @RequirePermissions("sale:create")
  @ApiOperation({ summary: "Parked carts at this branch" })
  list(@Query(zodPipe(ListHeldCartsSchema)) query: ListHeldCartsDto) {
    return this.heldCarts.list(query);
  }

  @Post()
  @RequirePermissions("sale:create")
  @ApiOperation({ summary: "Park a cart" })
  hold(@Body(zodPipe(HoldCartSchema)) dto: HoldCartDto) {
    return this.heldCarts.hold(dto);
  }

  @Post(":id/restore")
  @RequirePermissions("sale:create")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Take a cart back to the till; it stops being held" })
  restore(@Param("id", ParseUUIDPipe) id: string) {
    return this.heldCarts.restore(id);
  }

  @Delete(":id")
  @RequirePermissions("sale:create")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Discard a parked cart" })
  discard(@Param("id", ParseUUIDPipe) id: string) {
    return this.heldCarts.discard(id);
  }
}
