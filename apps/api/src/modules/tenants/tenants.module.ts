import { Module } from "@nestjs/common";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { RegistrationService } from "./registration.service.js";
import { TenantsController } from "./tenants.controller.js";
import { TenantsService } from "./tenants.service.js";

/**
 * The SaaS entry point: signup, plan state, and business settings.
 *
 * Imports AuthModule because registration signs the new owner straight in —
 * a signup that ends at a login form loses people who have just proved they
 * know the password.
 */
@Module({
  imports: [AuthModule],
  controllers: [TenantsController],
  providers: [RegistrationService, TenantsService, PlanLimitService],
  exports: [TenantsService, PlanLimitService],
})
export class TenantsModule {}
