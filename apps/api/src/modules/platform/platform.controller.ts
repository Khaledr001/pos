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
import { Throttle } from "@nestjs/throttler";
import { PlatformOnly } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PlatformService } from "./platform.service.js";
import {
  ChangePlanSchema,
  CreateTenantSchema,
  ImpersonateSchema,
  ListAuditLogsSchema,
  ListTenantsSchema,
  SuspendTenantSchema,
  UpdateTenantSchema,
  type ChangePlanDto,
  type CreateTenantDto,
  type ImpersonateDto,
  type ListAuditLogsDto,
  type ListTenantsDto,
  type SuspendTenantDto,
  type UpdateTenantDto,
} from "./dto.js";

/**
 * Operating the SaaS itself.
 *
 * `@PlatformOnly()` sits on the CONTROLLER, not on each method — a new route
 * added here is protected by default rather than by remembering. There is no
 * tenant permission that reaches any of this.
 *
 * NOTE: `@Audited()` does NOT work on these routes. The interceptor skips any
 * principal without a `tenantId`, which every platform operator is. Mutating
 * methods must call `PlatformService.writeAudit` inside their own transaction
 * instead — which is stronger anyway, since it commits atomically with the
 * change it describes.
 */
@ApiTags("platform")
@PlatformOnly()
@Controller("admin")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get("stats")
  @ApiOperation({ summary: "Platform-wide statistics and MRR" })
  stats() {
    return this.platform.stats();
  }

  @Get("tenants")
  @ApiOperation({ summary: "Every business on the platform" })
  listTenants(@Query(zodPipe(ListTenantsSchema)) query: ListTenantsDto) {
    return this.platform.listTenants(query);
  }

  /**
   * Same work as public self-registration — a tenant, a user, and the seeded
   * rows behind them — so it gets a comparable limit rather than the global
   * 120/min a product listing gets.
   */
  @Post("tenants")
  @Throttle({ default: { limit: 20, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "Provision a new business directly from platform console" })
  createTenant(@Body(zodPipe(CreateTenantSchema)) dto: CreateTenantDto) {
    return this.platform.createTenant(dto);
  }

  @Get("tenants/:id")
  @ApiOperation({
    summary: "Detailed single-tenant metrics, branches, users, and audit log",
  })
  getTenant(@Param("id", ParseUUIDPipe) id: string) {
    return this.platform.getTenant(id);
  }

  @Patch("tenants/:id")
  @ApiOperation({ summary: "Update business configuration from platform console" })
  updateTenant(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(UpdateTenantSchema)) dto: UpdateTenantDto,
  ) {
    return this.platform.updateTenant(id, dto);
  }

  @Post("tenants/:id/suspend")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Suspend a business and revoke its live sessions" })
  suspend(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(SuspendTenantSchema)) dto: SuspendTenantDto,
  ): Promise<void> {
    return this.platform.suspend(id, dto);
  }

  @Post("tenants/:id/activate")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Reverse a suspension" })
  activate(@Param("id", ParseUUIDPipe) id: string): Promise<void> {
    return this.platform.activate(id);
  }

  @Post("tenants/:id/plan")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Move a business to another plan, effective now" })
  changePlan(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(ChangePlanSchema)) dto: ChangePlanDto,
  ): Promise<void> {
    return this.platform.changePlan(id, dto);
  }

  /**
   * Tightly throttled: this is the most invasive operation the product has,
   * and a legitimate operator needs it a handful of times a day, not a
   * hundred times a minute.
   */
  @Post("tenants/:id/impersonate")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Sign in as this business's administrator for support (audit-logged)",
  })
  impersonate(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(zodPipe(ImpersonateSchema)) dto: ImpersonateDto,
  ) {
    return this.platform.impersonate(id, dto);
  }

  @Get("audit-logs")
  @ApiOperation({ summary: "Platform operator audit trail across all tenants" })
  listAuditLogs(@Query(zodPipe(ListAuditLogsSchema)) query: ListAuditLogsDto) {
    return this.platform.listAuditLogs(query);
  }

  @Get("system-health")
  @ApiOperation({ summary: "Infrastructure health, database latency, and system memory" })
  systemHealth() {
    return this.platform.systemHealth();
  }
}
