import { Module } from "@nestjs/common";
import { DayCloseController } from "./day-close.controller.js";
import { DayCloseService } from "./day-close.service.js";

@Module({
  controllers: [DayCloseController],
  providers: [DayCloseService],
  exports: [DayCloseService],
})
export class DayCloseModule {}
