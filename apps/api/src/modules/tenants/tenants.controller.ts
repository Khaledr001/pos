import type { AuthenticatedUser } from "@devsfleet/shared-types";
import { resolvePlan, trialStatus, PLANS } from "@devsfleet/shared-types";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import { CurrentUser, Public, RequirePermissions } from "../../common/decorators/index.js";
import { zodPipe } from "../../common/pipes/zod-validation.pipe.js";
import { RegistrationService } from "./registration.service.js";
import { TenantsService } from "./tenants.service.js";
import {
  RegisterTenantSchema,
  UpdateTenantSettingsSchema,
  type RegisterTenantDto,
  type UpdateTenantSettingsDto,
} from "./dto.js";

@ApiTags("tenants")
@Controller()
export class TenantsController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly tenants: TenantsService,
    private readonly planLimits: PlanLimitService,
  ) {}

  /**
   * The signup endpoint. Public by necessity.
   *
   * Rate-limited far below the global default: this creates a tenant, a user
   * and five seeded rows, and it is the one unauthenticated write in the
   * system. Without a tight limit it is a free way to fill the database.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @Post("auth/register")
  @ApiOperation({ summary: "Create a business and sign the owner in" })
  register(@Body(zodPipe(RegisterTenantSchema)) dto: RegisterTenantDto) {
    return this.registration.register(dto);
  }

  /** Live availability check for the signup form. */
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get("auth/slug-available")
  @ApiOperation({ summary: "Is this business URL still free?" })
  async slugAvailable(@Query("slug") slug: string) {
    return { slug, available: await this.registration.isSlugAvailable(slug ?? "") };
  }

  /** The plan catalogue, for the pricing page. Public on purpose. */
  @Public()
  @Get("plans")
  @ApiOperation({ summary: "Available subscription plans" })
  plans() {
    return Object.values(PLANS);
  }

  @Get("tenant")
  @ApiOperation({ summary: "The current business, its plan and trial state" })
  async current(@CurrentUser() user: AuthenticatedUser) {
    const tenant = await this.tenants.current();
    const plan = resolvePlan(tenant.planId);

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      settings: tenant.settings,
      plan,
      trial: trialStatus(tenant.planId, tenant.trialEndsAt, new Date()),
      subscriptionEndsAt: tenant.subscriptionEndsAt,
      isActive: tenant.isActive,
      permissions: user.permissions,
    };
  }

  /** Drives the "3 of 5 users" display and the upgrade prompt. */
  @Get("tenant/usage")
  @RequirePermissions("settings:read")
  @ApiOperation({ summary: "Current usage against every plan limit" })
  usage() {
    return this.planLimits.usage();
  }

  @Patch("tenant/settings")
  @RequirePermissions("settings:write")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Update business settings (tax, printing, sales policy)" })
  updateSettings(
    @Body(zodPipe(UpdateTenantSettingsSchema)) dto: UpdateTenantSettingsDto,
  ) {
    return this.tenants.updateSettings(dto);
  }
}
