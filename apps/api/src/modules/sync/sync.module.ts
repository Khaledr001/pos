import { Module } from "@nestjs/common";
import { CashRegisterModule } from "../cash-register/cash-register.module.js";
import { SalesModule } from "../sales/sales.module.js";
import { SyncController } from "./sync.controller.js";
import { SyncService } from "./sync.service.js";

/**
 * Sync owns no business logic of its own — it replays what a terminal did
 * through the same services an online request uses. An offline sale and an
 * online sale must be subject to identical rules, or the rules are optional.
 */
@Module({
  imports: [SalesModule, CashRegisterModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
