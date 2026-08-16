import { Module } from "@nestjs/common";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import { BranchesController } from "./branches.controller.js";
import { BranchesService } from "./branches.service.js";

/**
 * REFERENCE MODULE — module
 *
 * `TenantDatabase` is not listed: DatabaseModule is @Global, so it is available
 * everywhere without an import. Everything else a module needs must be declared
 * here explicitly.
 */
@Module({
  controllers: [BranchesController],
  providers: [BranchesService, PlanLimitService],
  exports: [BranchesService],
})
export class BranchesModule {}
