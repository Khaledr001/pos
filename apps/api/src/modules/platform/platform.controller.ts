import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PlatformOnly } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { PlatformService } from "./platform.service.js";
import {
  ChangePlanSchema,
  ListTenantsSchema,
  SuspendTenantSchema,
  type ChangePlanDto,
  type ListTenantsDto,
  type SuspendTenantDto,
} from "./dto.js";

/**
 * Operating the SaaS itself.
 *
 * `@PlatformOnly()` sits on the CONTROLLER, not on each method — a new route
 * added here is protected by default rather than by remembering. There is no
 * tenant permission that reaches any of this.
 */
@ApiTags("platform")
@PlatformOnly()
@Controller("admin")
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get("stats")
  @ApiOperation({ summary: "Platform-wide statistics" })
  stats() {
    return this.platform.stats();
  }

  @Get("tenants")
  @ApiOperation({ summary: "Every business on the platform" })
  listTenants(@Query(zodPipe(ListTenantsSchema)) query: ListTenantsDto) {
    return this.platform.listTenants(query);
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

  @Post("tenants/:id/impersonate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Sign in as this business's administrator for support (audit-logged)",
  })
  impersonate(@Param("id", ParseUUIDPipe) id: string) {
    return this.platform.impersonate(id);
  }
}
