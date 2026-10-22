import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Audited, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { CashRegisterService } from "./cash-register.service.js";
import {
  CashMovementSchema, CloseSessionSchema, ListSessionsSchema, OpenSessionSchema,
  type CashMovementDto, type CloseSessionDto, type ListSessionsDto, type OpenSessionDto,
} from "./dto.js";

@ApiTags("cash-register")
@Controller("cash-register")
export class CashRegisterController {
  constructor(private readonly cash: CashRegisterService) {}

  /**
   * The back office's view of every drawer. `day_close:read`, not `cash:open`:
   * reading drawer variances is a reconciliation job, and the till's own
   * permission to open a drawer should not carry it.
   */
  @Get("sessions")
  @RequirePermissions("day_close:read")
  @ApiOperation({ summary: "Drawer sessions with their totals and variance" })
  sessions(@Query(zodPipe(ListSessionsSchema)) query: ListSessionsDto) {
    return this.cash.listSessions(query);
  }

  @Get("sessions/:id")
  @RequirePermissions("day_close:read")
  @ApiOperation({ summary: "One drawer session, with its pay-ins, pay-outs and cash sales" })
  session(@Param("id", ParseUUIDPipe) id: string) {
    return this.cash.getSession(id);
  }

  @Get("current")
  @RequirePermissions("cash:open")
  @ApiOperation({ summary: "The open drawer for this branch and terminal" })
  current(@Query("branchId") branchId: string, @Query("deviceId") deviceId?: string) {
    return this.cash.current(branchId, deviceId);
  }

  @Get("history")
  @RequirePermissions("cash:open")
  @ApiOperation({ summary: "Past sessions, with variance" })
  history(@Query("branchId") branchId?: string) {
    return this.cash.history(branchId);
  }

  @Post("open")
  @RequirePermissions("cash:open")
  @Audited("cash_sessions", "open")
  @ApiOperation({ summary: "Open the drawer with a counted float" })
  open(@Body(zodPipe(OpenSessionSchema)) dto: OpenSessionDto) {
    return this.cash.open(dto);
  }

  @Post(":id/close")
  @RequirePermissions("cash:close")
  @Audited("cash_sessions", "close")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Close the drawer; freezes totals and variance" })
  close(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(CloseSessionSchema)) dto: CloseSessionDto,
  ) {
    return this.cash.close(id, dto);
  }

  @Post(":id/movements")
  @RequirePermissions("cash:movement")
  @Audited("cash_movements", "create")
  @ApiOperation({ summary: "Pay in or pay out, with a mandatory reason" })
  movement(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(CashMovementSchema)) dto: CashMovementDto,
  ) {
    return this.cash.recordMovement(id, dto);
  }
}
