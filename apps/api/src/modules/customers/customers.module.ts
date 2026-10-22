import { Module } from "@nestjs/common";
import { CustomersController } from "./customers.controller.js";
import { CustomersService } from "./customers.service.js";
import { PublicStatementsController } from "./public-statements.controller.js";
import { StatementShareService } from "./statement-share.service.js";

@Module({
  controllers: [CustomersController, PublicStatementsController],
  providers: [CustomersService, StatementShareService],
  exports: [CustomersService],
})
export class CustomersModule {}
