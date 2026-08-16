import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { DayCloseService } from "./day-close.service.js";
import {
  CloseDaySchema,
  ListDaysSchema,
  OpenDaySchema,
  PreviewDaySchema,
  type CloseDayDto,
  type ListDaysDto,
  type OpenDayDto,
  type PreviewDayDto,
} from "./dto.js";

@ApiTags("day-close")
@Controller("day-close")
export class DayCloseController {
  constructor(private readonly dayClose: DayCloseService) {}

  @Get()
  @RequirePermissions("day_close:read")
  @ApiOperation({ summary: "Day-close history" })
  list(@Query(zodPipe(ListDaysSchema)) query: ListDaysDto) {
    return this.dayClose.list(query);
  }

  /**
   * Declared before `:id`, or Express reads "preview" as an id and every
   * request 400s on an invalid UUID.
   */
  @Get("preview")
  @RequirePermissions("day_close:read")
  @ApiOperation({ summary: "Live figures for a date, or the frozen snapshot if closed" })
  preview(@Query(zodPipe(PreviewDaySchema)) query: PreviewDayDto) {
    return this.dayClose.preview(query);
  }

  @Get(":id")
  @RequirePermissions("day_close:read")
  @ApiOperation({ summary: "One day close, with its expenses" })
  findById(@Param("id", ParseUUIDPipe) id: string) {
    return this.dayClose.findById(id);
  }

  /**
   * `day_close:manage`, which the cashier role does not carry. Someone who
   * sold all day should not be the one who signs off what the drawer holds.
   */
  @Post("open")
  @RequirePermissions("day_close:manage")
  @Audited("daily_closing", "open")
  @ApiOperation({ summary: "Open a day with a cash float" })
  open(@Body(zodPipe(OpenDaySchema)) dto: OpenDayDto) {
    return this.dayClose.open(dto);
  }

  @Post(":id/close")
  @RequirePermissions("day_close:manage")
  @Audited("daily_closing", "close")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Count the cash and freeze the day" })
  close(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(CloseDaySchema)) dto: CloseDayDto,
  ) {
    return this.dayClose.close(id, dto);
  }
}
