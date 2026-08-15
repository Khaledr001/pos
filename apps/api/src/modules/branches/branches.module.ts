import { Module } from "@nestjs/common";
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
  providers: [BranchesService],
  exports: [BranchesService],
})
export class BranchesModule {}
