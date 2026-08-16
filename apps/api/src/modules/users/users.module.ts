import { Module } from "@nestjs/common";
import { PlanLimitService } from "../../common/guards/plan-limit.service.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

@Module({
  controllers: [UsersController],
  providers: [UsersService, PlanLimitService],
  exports: [UsersService],
})
export class UsersModule {}
