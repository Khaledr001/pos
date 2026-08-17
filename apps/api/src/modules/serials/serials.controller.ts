import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { SerialsService } from "./serials.service.js";
import {
  ListSerialsSchema,
  MarkDamagedSchema,
  type ListSerialsDto,
  type MarkDamagedDto,
} from "./dto.js";

@ApiTags("serials")
@Controller("serials")
export class SerialsController {
  constructor(private readonly serials: SerialsService) {}

  @Get()
  @RequirePermissions("inventory:read")
  list(@Query(zodPipe(ListSerialsSchema)) query: ListSerialsDto) {
    return this.serials.list(query);
  }

  /** Before `:id`-shaped routes below — this one takes the serial itself, not a uuid. */
  @Get(":serial/lookup")
  @RequirePermissions("inventory:read")
  @ApiOperation({ summary: "Warranty and provenance lookup by serial number" })
  findBySerial(@Param("serial") serial: string) {
    return this.serials.findBySerial(serial);
  }

  /**
   * `inventory:adjust`, not `inventory:read` — this moves stock when the unit
   * was still available, exactly like any other write-off.
   */
  @Post(":id/damaged")
  @RequirePermissions("inventory:adjust")
  @Audited("serial_number", "mark-damaged")
  markDamaged(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(MarkDamagedSchema)) dto: MarkDamagedDto,
  ) {
    return this.serials.markDamaged(id, dto);
  }
}
